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
        ])("%s keeps it, and nothing runs again", (_what, save) => {
            afterTheFirstRun();
            save();
            expect(stored().trustedServersMigrated).toBe(true);
            expect(configStore.getConfig().trustedServersMigrated).toBe(true);
            expect(migrateTrustedServers()).toEqual([]);
            expect(trustedIds()).toEqual([A]);
        });

        describe("a removed category", () => {
            const servers = [{ guildId: A, label: "", trusted: true }, { guildId: B, label: "" }];

            it("keeps it, and nothing runs again", () => {
                load(servers, { trustedServersMigrated: true, categoryRoles: { cat1: ["1500000000000000001"] } });
                expect(configStore.dropCategoryEntries("cat1", ["categoryRoles"]).removed).toEqual(["categoryRoles"]);
                expect(stored().categoryRoles).toEqual({});
                expect(stored().trustedServersMigrated).toBe(true);
                expect(migrateTrustedServers()).toEqual([]);
                expect(trustedIds()).toEqual([A]);
            });

            it("does not set it on a file that has not run the migration", () => {
                load(servers.map(({ guildId, label }) => ({ guildId, label })), { categoryRoles: { cat1: ["1500000000000000001"] } });
                expect(configStore.dropCategoryEntries("cat1", ["categoryRoles"]).removed).toEqual(["categoryRoles"]);
                expect(stored().trustedServersMigrated).toBeUndefined();
                expect(migrateTrustedServers()).toHaveLength(1);
                expect(trustedIds()).toEqual([A, B]);
            });
        });
    });

    // A read that fails (no missing file, no broken content) says nothing about the file: it neither
    // counts as new, nor does a write of the defaults follow it.
    describe("when one read of config.json fails", () => {
        const failRead = (n) => {
            const real = fs.readFileSync.getMockImplementation();
            let reads = 0;
            fs.readFileSync.mockImplementation((file, ...rest) => {
                if (file === CONFIG) {
                    reads += 1;
                    if (reads === n) throw Object.assign(new Error("EIO: read"), { code: "EIO" });
                }
                return real(file, ...rest);
            });
            return () => {
                fs.readFileSync.mockImplementation(real);
                return reads;
            };
        };
        const before = () => load([{ guildId: A, label: "" }, { guildId: B, label: "" }], { adminRoleIds: ["7"], roleSync: [] });

        describe.each([
            ["saveConfig", () => configStore.saveConfig({ adminRoleIds: ["8"] })],
            ["a removed category", () => configStore.dropCategoryEntries("cat1", ["categoryRoles"])],
            ["writeStored", () => configStore.writeStored({ raidsheets: [] })],
        ])("%s", (_what, write) => {
            const withCategory = () => ({ trustedServersMigrated: true, categoryRoles: { cat1: ["1500000000000000001"] } });

            it("throws and leaves the file with its note as it is", () => {
                load([{ guildId: A, label: "", trusted: true }], withCategory());
                const file = fs.__store.get(CONFIG);
                const restore = failRead(1);
                expect(write).toThrow("EIO");
                restore();
                expect(fs.__store.get(CONFIG)).toBe(file);
                expect(stored().trustedServersMigrated).toBe(true);
            });

            it("does not make a file with content a new one", () => {
                load([{ guildId: A, label: "" }], { categoryRoles: { cat1: ["1500000000000000001"] } });
                const file = fs.__store.get(CONFIG);
                const restore = failRead(1);
                expect(write).toThrow("EIO");
                restore();
                expect(fs.__store.get(CONFIG)).toBe(file);
                expect(stored().trustedServersMigrated).toBeUndefined();
            });
        });

        it("a save after it marks nothing new: servers entered later stay unmarked", () => {
            afterTheFirstRun();
            const restore = failRead(1);
            expect(() => configStore.saveConfig({ adminRoleIds: ["8"] })).toThrow("EIO");
            restore();
            configStore.saveConfig({ adminRoleIds: ["8"] });
            expect(stored().trustedServersMigrated).toBe(true);
            expect(stored().discordServers.servers).toHaveLength(3);
            expect(migrateTrustedServers()).toEqual([]);
            expect(trustedIds()).toEqual([A]);
        });

        it("a save does not start from the defaults getConfig() kept of that read", () => {
            afterTheFirstRun();
            const restore = failRead(1);
            expect(configStore.getConfig().discordServers.servers).toEqual([]);
            restore();
            configStore.saveConfig({ adminRoleIds: ["8"] });
            expect(stored().trustedServersMigrated).toBe(true);
            expect(stored().discordServers.servers).toHaveLength(3);
            expect(trustedIds()).toEqual([A]);
            expect(stored().adminRoleIds).toEqual(["8"]);
        });

        it("a removed category does not start from them either", () => {
            afterTheFirstRun();
            const file = stored();
            fs.__store.set(CONFIG, JSON.stringify({ ...file, categoryRoles: { cat1: ["1500000000000000001"] } }));
            const restore = failRead(1);
            configStore.getConfig();
            restore();
            expect(configStore.dropCategoryEntries("cat1", ["categoryRoles"]).removed).toEqual(["categoryRoles"]);
            expect(stored().discordServers.servers).toHaveLength(3);
            expect(stored().trustedServersMigrated).toBe(true);
        });

        // A config some earlier migration writes to, so that the writes of the first start are in the loop.
        const legacy = () =>
            load([{ guildId: A, label: "" }, { guildId: B, label: "" }], {
                discordServers: {
                    servers: [{ guildId: A, label: "" }, { guildId: B, label: "" }],
                    links: [{ from: A, to: C, channelId: "1400000000000000011", lang: "", versions: [] }],
                    talkGuildId: C,
                    signupNoteChannelId: "1400000000000000021",
                },
                roleSync: [{ eventRoleId: "1500000000000000001", talkRoleId: "1500000000000000002", direction: "toTalk" }],
            });

        it.each([
            ["a plain config", before],
            ["a config of before", legacy],
        ])("no failed read at the first start leaves the note without the marks, the next start finishes (%s)", (_what, prepare) => {
            prepare();
            const count = failRead(0);
            migrateSettings(quiet);
            const total = count();
            expect(total).toBeGreaterThan(1);
            // what an undisturbed start marks (an old talk server joins the list on the way)
            const everyServer = trustedIds();
            expect(everyServer).toEqual(expect.arrayContaining([A, B]));
            for (let n = 1; n <= total; n += 1) {
                fs.__store.clear();
                prepare();
                const restore = failRead(n);
                const warn = jest.fn();
                const { error } = migrateSettings({ ...quiet, warn });
                restore();
                expect(stored().discordServers.servers.map((s) => s.guildId)).toEqual(expect.arrayContaining([A, B]));
                if (stored().trustedServersMigrated === true) expect(trustedIds()).toEqual(everyServer);
                else {
                    expect(trustedIds()).toEqual([]);
                    // nothing decided: this must not pass in silence
                    expect(error || warn.mock.calls.length).toBeTruthy();
                }
                // the next start: the kept defaults of the failed read are gone with the process
                configStore.useFile(null);
                migrateSettings(quiet);
                expect(stored().trustedServersMigrated).toBe(true);
                expect(trustedIds()).toEqual(everyServer);
            }
        });
    });
});
