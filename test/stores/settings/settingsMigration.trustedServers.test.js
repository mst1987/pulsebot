// #1073: the servers listed when the mark "vertrauenswürdig" arrives get it once, so nothing changes
// for them. The note that this ran lives in config.json and is written with the marks: a server listed
// later, or one a full admin took the mark from, has none and gets none, whatever else gets lost.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());
jest.mock("../../../src/stores/loot/reportStore", () => ({ listReports: jest.fn(() => []), getReport: () => null, assignGuilds: jest.fn(() => 0) }));

const fs = require("fs");
const { settingsPath } = require("../../../src/config/paths");
const configStore = require("../../../src/stores/settings/configStore");
const { migrateSettings, migrateTrustedServers } = require("../../../src/stores/settings/settingsMigration");

const A = "1100000000000000001";
const B = "1100000000000000002";
const C = "1100000000000000003";
const quiet = { log: () => {}, warn: () => {} };
const CONFIG = settingsPath("config.json");
const MIGRATIONS = settingsPath("migrations.json");

const load = (servers, extra = {}) => fs.__store.set(CONFIG, JSON.stringify({ discordServers: { servers, links: [] }, ...extra }));
const stored = () => JSON.parse(fs.__store.get(CONFIG));
const trustedIds = () => stored().discordServers.servers.filter((s) => s.trusted === true).map((s) => s.guildId);

// Only A kept its mark, a full admin took B's away, C came later: what a second run would undo.
const afterTheFirstRun = () => load([{ guildId: A, label: "", trusted: true }, { guildId: B, label: "" }, { guildId: C, label: "" }], { trustedServersMigrated: true });

beforeEach(() => {
    fs.__store.clear();
    configStore.useFile(null);
});
afterEach(() => jest.restoreAllMocks());

describe("stores/settings/settingsMigration migrateTrustedServers (#1073)", () => {
    it("marks every listed server, says so and notes it at the top of the file", () => {
        load([{ guildId: A, label: "" }, { guildId: B, label: "" }]);
        expect(migrateTrustedServers()).toEqual(["config.json: 2 bestehende/r Server als vertrauenswürdig markiert (#1073)"]);
        expect(trustedIds()).toEqual([A, B]);
        expect(stored().trustedServersMigrated).toBe(true);
        expect(stored().discordServers.trustedServersMigrated).toBeUndefined();
    });

    it("writes the marks and the note in one write", () => {
        load([{ guildId: A, label: "" }]);
        const write = jest.spyOn(configStore, "writeStored");
        migrateTrustedServers();
        expect(write).toHaveBeenCalledTimes(1);
        expect(write.mock.calls[0][0]).toMatchObject({ trustedServersMigrated: true, discordServers: { servers: [{ guildId: A, trusted: true }] } });
    });

    it("does not touch migrations.json", () => {
        load([{ guildId: A, label: "" }]);
        migrateTrustedServers();
        expect(fs.__store.has(MIGRATIONS)).toBe(false);
    });

    it("does not run twice: a mark taken away stays away", () => {
        load([{ guildId: A, label: "" }]);
        migrateTrustedServers();
        const file = stored();
        file.discordServers.servers[0] = { guildId: A, label: "" };
        fs.__store.set(CONFIG, JSON.stringify(file));
        expect(migrateTrustedServers()).toEqual([]);
        expect(trustedIds()).toEqual([]);
    });

    it("leaves a server listed later without the mark", () => {
        load([{ guildId: A, label: "" }]);
        migrateTrustedServers();
        const file = stored();
        file.discordServers.servers.push({ guildId: C, label: "" });
        fs.__store.set(CONFIG, JSON.stringify(file));
        expect(migrateTrustedServers()).toEqual([]);
        expect(trustedIds()).toEqual([A]);
    });

    it("sets the note with an empty list, so a later first server stays unmarked", () => {
        load([]);
        expect(migrateTrustedServers()).toEqual([]);
        expect(stored().trustedServersMigrated).toBe(true);
        const file = stored();
        file.discordServers.servers.push({ guildId: A, label: "" });
        fs.__store.set(CONFIG, JSON.stringify(file));
        expect(migrateTrustedServers()).toEqual([]);
        expect(trustedIds()).toEqual([]);
    });

    describe("on a fresh install", () => {
        it.each([
            ["no file", () => {}],
            ["an empty file", () => fs.__store.set(CONFIG, "{}")],
        ])("writes nothing with %s", (_what, prepare) => {
            prepare();
            const before = fs.__store.get(CONFIG);
            expect(migrateTrustedServers()).toEqual([]);
            expect(fs.__store.get(CONFIG)).toBe(before);
        });

        it("the first save carries the note, in the same write: its server stays unmarked", () => {
            migrateTrustedServers();
            configStore.saveConfig({ discordServers: { servers: [{ guildId: A, label: "" }] } });
            expect(stored().trustedServersMigrated).toBe(true);
            expect(migrateTrustedServers()).toEqual([]);
            expect(trustedIds()).toEqual([]);
        });

        it.each([
            ["an unrelated first save", () => configStore.saveConfig({ adminRoleIds: ["1"] })],
            ["a first write of its exact content (the raid sheets)", () => configStore.writeStored({ raidsheets: [] })],
        ])("%s carries it as well: a server entered after it stays unmarked", (_what, first) => {
            first();
            configStore.saveConfig({ discordServers: { servers: [{ guildId: A, label: "" }] } });
            expect(migrateTrustedServers()).toEqual([]);
            expect(trustedIds()).toEqual([]);
        });
    });

    it("takes nothing but true for the note", () => {
        load([{ guildId: A, label: "" }], { trustedServersMigrated: "yes" });
        expect(migrateTrustedServers()).toHaveLength(1);
        expect(stored().trustedServersMigrated).toBe(true);
    });

    it("runs inside migrateSettings, once", () => {
        load([{ guildId: A, label: "" }]);
        const first = migrateSettings(quiet);
        expect(first.error).toBeUndefined();
        expect(first.changes.filter((line) => line.includes("vertrauenswürdig"))).toHaveLength(1);
        expect(trustedIds()).toEqual([A]);
        const second = migrateSettings(quiet);
        expect(second.changes.filter((line) => line.includes("vertrauenswürdig"))).toEqual([]);
    });

    describe("when migrations.json gets lost", () => {
        it.each([
            ["is corrupt", () => fs.__store.set(MIGRATIONS, "{ not json")],
            ["is gone", () => fs.__store.delete(MIGRATIONS)],
        ])("hands out no new mark when it %s", (_what, lose) => {
            afterTheFirstRun();
            lose();
            expect(migrateSettings(quiet).changes.filter((line) => line.includes("vertrauenswürdig"))).toEqual([]);
            expect(trustedIds()).toEqual([A]);
            expect(stored().trustedServersMigrated).toBe(true);
        });
    });

    describe("when config.json cannot be read", () => {
        it.each([
            ["broken JSON", "{ not json"],
            ["an array", "[1]"],
        ])("writes nothing into %s and warns", (_what, content) => {
            fs.__store.set(CONFIG, content);
            const warn = jest.fn();
            expect(migrateTrustedServers(warn)).toEqual([]);
            expect(fs.__store.get(CONFIG)).toBe(content);
            expect(warn).toHaveBeenCalledWith(expect.stringContaining("nicht lesbar"));
        });

        it("the next start finishes once the file is repaired", () => {
            fs.__store.set(CONFIG, "{ not json");
            migrateTrustedServers(() => {});
            load([{ guildId: A, label: "" }]);
            expect(migrateTrustedServers(() => {})).toHaveLength(1);
            expect(trustedIds()).toEqual([A]);
            expect(stored().trustedServersMigrated).toBe(true);
        });

        it("a save that replaces the broken file carries the note: its new list stays unmarked", () => {
            fs.__store.set(CONFIG, "{ not json");
            configStore.saveConfig({ discordServers: { servers: [{ guildId: A, label: "" }] } });
            expect(stored().trustedServersMigrated).toBe(true);
            expect(migrateTrustedServers(() => {})).toEqual([]);
            expect(trustedIds()).toEqual([]);
        });

        it("the other migrations go on", () => {
            fs.__store.set(CONFIG, "{ not json");
            const later = jest.spyOn(require("../../../src/stores/roster/recruitmentStore"), "migrateVersions");
            const warn = jest.fn();
            const result = migrateSettings({ log: () => {}, warn });
            expect(result.error).toBeUndefined();
            expect(later).toHaveBeenCalled();
            expect(warn).toHaveBeenCalledWith(expect.stringContaining("#1073"));
        });
    });

    describe("when writing fails", () => {
        // Only the write of this migration fails: the others of the start share the store.
        const failTheNote = () => {
            const real = configStore.writeStored;
            return jest.spyOn(configStore, "writeStored").mockImplementation((value) => {
                if (value.trustedServersMigrated === true && !stored().trustedServersMigrated) throw new Error("EROFS");
                return real(value);
            });
        };

        it("leaves marks and note away, warns and does not throw", () => {
            load([{ guildId: A, label: "" }]);
            const before = fs.__store.get(CONFIG);
            failTheNote();
            const warn = jest.fn();
            expect(migrateTrustedServers(warn)).toEqual([]);
            expect(fs.__store.get(CONFIG)).toBe(before);
            expect(warn).toHaveBeenCalledWith(expect.stringContaining("EROFS"));
        });

        it("goes on with the other migrations, the next start finishes", () => {
            load([{ guildId: A, label: "" }]);
            const write = failTheNote();
            const later = jest.spyOn(require("../../../src/stores/roster/recruitmentStore"), "migrateVersions");
            const warn = jest.fn();
            const first = migrateSettings({ log: () => {}, warn });
            expect(first.error).toBeUndefined();
            expect(later).toHaveBeenCalled();
            expect(stored().trustedServersMigrated).toBeUndefined();
            expect(trustedIds()).toEqual([]);
            write.mockRestore();
            expect(migrateSettings(quiet).changes.filter((line) => line.includes("vertrauenswürdig"))).toHaveLength(1);
            expect(trustedIds()).toEqual([A]);
        });
    });

    describe("no save reaches the note", () => {
        it.each([
            ["false", false],
            ["null", null],
            ["undefined", undefined],
        ])("%s does not clear it, and nothing runs again", (_what, value) => {
            afterTheFirstRun();
            configStore.saveConfig({ trustedServersMigrated: value });
            expect(stored().trustedServersMigrated).toBe(true);
            expect(migrateTrustedServers()).toEqual([]);
            expect(trustedIds()).toEqual([A]);
        });

        it("true does not set it, so the first start still marks", () => {
            load([{ guildId: A, label: "" }]);
            configStore.saveConfig({ trustedServersMigrated: true });
            expect(stored().trustedServersMigrated).toBeUndefined();
            expect(migrateTrustedServers()).toHaveLength(1);
            expect(trustedIds()).toEqual([A]);
        });

        it.each([
            ["an unrelated save", () => configStore.saveConfig({ adminRoleIds: ["1"] })],
            ["a save of the whole list", () => configStore.saveConfig({ discordServers: { servers: [{ guildId: A, label: "x" }, { guildId: C, label: "" }] } })],
            ["a removed category", () => configStore.dropCategoryEntries("cat1", ["categoryRoles"])],
        ])("%s keeps it, and nothing runs again", (_what, save) => {
            afterTheFirstRun();
            save();
            expect(stored().trustedServersMigrated).toBe(true);
            expect(configStore.getConfig().trustedServersMigrated).toBe(true);
            expect(migrateTrustedServers()).toEqual([]);
            expect(trustedIds()).toEqual([A]);
        });
    });
});
