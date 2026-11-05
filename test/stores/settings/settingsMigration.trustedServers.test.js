// #1073: the servers listed when the mark "vertrauenswürdig" arrives get it once, so nothing changes
// for them. The mark in migrations.json keeps it from running again: a server listed later, or one a
// full admin took the mark from, has none and gets none.
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

const load = (servers, extra = {}) => fs.__store.set(settingsPath("config.json"), JSON.stringify({ discordServers: { servers, links: [], ...extra } }));
const stored = () => JSON.parse(fs.__store.get(settingsPath("config.json")));
const marked = () => JSON.parse(fs.__store.get(settingsPath("migrations.json")) || "{}");
const trustedIds = () => stored().discordServers.servers.filter((s) => s.trusted === true).map((s) => s.guildId);

beforeEach(() => fs.__store.clear());
afterEach(() => jest.restoreAllMocks());

describe("stores/settings/settingsMigration migrateTrustedServers (#1073)", () => {
    it("marks every listed server, says so and sets the mark", () => {
        load([{ guildId: A, label: "" }, { guildId: B, label: "" }]);
        expect(migrateTrustedServers()).toEqual(["config.json: 2 bestehende/r Server als vertrauenswürdig markiert (#1073)"]);
        expect(trustedIds()).toEqual([A, B]);
        expect(marked().done.trustedServers).toEqual(expect.any(Number));
    });

    it("does not run twice: a mark taken away stays away", () => {
        load([{ guildId: A, label: "" }]);
        migrateTrustedServers();
        const file = stored();
        file.discordServers.servers[0] = { guildId: A, label: "" };
        fs.__store.set(settingsPath("config.json"), JSON.stringify(file));
        expect(migrateTrustedServers()).toEqual([]);
        expect(trustedIds()).toEqual([]);
    });

    it("leaves a server listed later without the mark", () => {
        load([{ guildId: A, label: "" }]);
        migrateTrustedServers();
        const file = stored();
        file.discordServers.servers.push({ guildId: C, label: "" });
        fs.__store.set(settingsPath("config.json"), JSON.stringify(file));
        expect(migrateTrustedServers()).toEqual([]);
        expect(trustedIds()).toEqual([A]);
    });

    it("sets the mark with an empty list, so a later first server stays unmarked", () => {
        load([]);
        expect(migrateTrustedServers()).toEqual([]);
        expect(marked().done.trustedServers).toEqual(expect.any(Number));
    });

    it("sets the mark on a fresh install and writes no config.json for it", () => {
        expect(migrateTrustedServers()).toEqual([]);
        expect(fs.__store.has(settingsPath("config.json"))).toBe(false);
        expect(marked().done.trustedServers).toEqual(expect.any(Number));
    });

    it("leaves the file and the mark alone when writing fails, the next start finishes", () => {
        load([{ guildId: A, label: "" }]);
        const before = fs.__store.get(settingsPath("config.json"));
        const write = jest.spyOn(configStore, "writeStored").mockImplementationOnce(() => { throw new Error("disk full"); });
        expect(() => migrateTrustedServers()).toThrow("disk full");
        expect(fs.__store.get(settingsPath("config.json"))).toBe(before);
        expect(marked().done).toBeUndefined();
        write.mockRestore();
        expect(migrateTrustedServers()).toHaveLength(1);
        expect(trustedIds()).toEqual([A]);
    });

    it("does no harm when a crash right after writing lets it run again", () => {
        load([{ guildId: A, label: "" }]);
        migrateTrustedServers();
        fs.__store.delete(settingsPath("migrations.json"));
        expect(migrateTrustedServers()).toEqual([]);
        expect(trustedIds()).toEqual([A]);
        expect(marked().done.trustedServers).toEqual(expect.any(Number));
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
});
