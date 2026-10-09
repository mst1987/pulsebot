// The roster migration of #653 inside migrateSettings: once per category,
// logged, never over an existing roster.
jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());

const fs = require("fs");
const { settingsPath } = require("../../src/config/paths");
const { migrateSettings, migrateCategoryRosters } = require("../../src/stores/settingsMigration");
const rosterStore = require("../../src/stores/rosterStore");
const { RAIDER_CHARACTERS_FILE } = require("../../src/stores/raiderCharactersStore");

const CONFIG_FILE = settingsPath("config.json");
const NAMES_FILE = settingsPath("category-names.json");
const RAID_EVENTS_FILE = require("../../src/stores/raidEventStore").RAID_EVENTS_FILE;
const G1 = "1100000000000000001";
const G2 = "1100000000000000002";
const quiet = { log: () => {}, warn: () => {} };

function seed() {
    fs.__store.set(CONFIG_FILE, JSON.stringify({
        categoryIds: ["c1", "c2"],
        categoryRoles: { c1: ["10"], c2: ["20"], c3: ["30"] },
        categoryPlanning: { c1: "raidplan", c2: "raidplan" },
        discordServers: { eventGuilds: [{ guildId: G1 }] },
    }));
    fs.__store.set(RAIDER_CHARACTERS_FILE, JSON.stringify({ c1: { "200000000000000001": "Keslight" } }));
    fs.__store.set(NAMES_FILE, JSON.stringify({ guilds: { [G2]: { c1: "Donnerstag" } } }));
    fs.__store.set(RAID_EVENTS_FILE, JSON.stringify({ events: [{ id: "e1", guildId: G2, categoryId: "c2", categoryName: "Mittwoch", startTime: 100 }] }));
}

beforeEach(() => {
    fs.__store.clear();
});

describe("stores/settingsMigration rosters (#653)", () => {
    it("creates the rosters at start and logs one line", () => {
        seed();
        const log = jest.fn();
        const { changes } = migrateSettings({ log, warn: () => {} });
        const line = changes.find((c) => c.startsWith("rosters.json"));
        expect(line).toContain("3 Roster aus den Raid-Kategorien übernommen");
        expect(log).toHaveBeenCalledWith(`[settings] Migration: ${line}`);
        // server: snapshot (c1), stored event (c2), first event server (c3)
        expect(rosterStore.rosterForCategory("c1")).toMatchObject({ guildId: G2, name: "Donnerstag", roleIds: ["10"], source: { kind: "migration" } });
        expect(rosterStore.rosterForCategory("c2")).toMatchObject({ guildId: G2, name: "Mittwoch", roleIds: ["20"] });
        expect(rosterStore.rosterForCategory("c3")).toMatchObject({ guildId: G1, name: "c3", roleIds: ["30"] });
        expect(rosterStore.rosterForCategory("c1").members["200000000000000001"]).toMatchObject({ status: "core", chars: ["keslight"] });
    });

    it("the second start finds nothing and writes nothing", () => {
        seed();
        migrateSettings(quiet);
        const before = fs.__store.get(rosterStore.ROSTERS_FILE);
        fs.writeFileSync.mockClear();
        const { changes } = migrateSettings(quiet);
        expect(changes).toEqual([]);
        expect(fs.writeFileSync).not.toHaveBeenCalled();
        expect(fs.__store.get(rosterStore.ROSTERS_FILE)).toBe(before);
    });

    it("never overwrites a roster that is already there", () => {
        seed();
        const own = rosterStore.createRoster({ name: "Eigenes", categoryId: "c1", roleIds: ["99"] });
        const lines = migrateCategoryRosters();
        expect(lines[0]).toContain("2 Roster");
        expect(rosterStore.getRoster(own.id)).toMatchObject({ name: "Eigenes", roleIds: ["99"], members: {} });
    });

    it("an install without roles or assignments gets no roster and no rosters.json", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify({ categoryIds: ["c1"], categoryPlanning: { c1: "raidplan" } }));
        expect(migrateCategoryRosters()).toEqual([]);
        expect(fs.__store.has(rosterStore.ROSTERS_FILE)).toBe(false);
    });
});
