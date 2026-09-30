// Kaderplaner-Ablauf: the start turns a planner of #566 (rosters with members
// and bench) into Kader with player states — once, logged, and exactly as the
// golden master says (test/fixtures/kaderMigration/). The characters come from
// the planner's own data, else from the Forever characters of the profiles.
//
//   UPDATE_GOLDEN=1 npx jest test/stores/settingsMigration.kader.test.js
jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());

const fs = require("fs");
const path = require("path");
const { settingsPath } = require("../../src/config/paths");
const { migrateSettings, migrateKaderPlanner } = require("../../src/stores/settingsMigration");
const kaderStore = require("../../src/stores/kaderStore");

const KADER_FILE = settingsPath("kader.json");
const PROFILES_FILE = settingsPath("raider-profiles.json");
const LEGACY = require("../fixtures/kaderMigration/legacy.json");
const GOLDEN_FILE = path.join(__dirname, "..", "fixtures", "kaderMigration", "golden.json");
const NOW = "2026-10-01T12:00:00.000Z";

// the second source of characters: two raiders with a Forever character in their profile
const PROFILES = {
    profiles: {
        "222222222222222222": { userId: "222222222222222222", name: "Mira", characters: [{ name: "Mira Sonnlicht", versionId: "forever", className: "Priest", main: true, specs: [{ key: "Priest-Holy", gear: "ready" }, { key: "Priest-Shadow", gear: "none" }] }] },
        "333333333333333333": { userId: "333333333333333333", name: "Liss", characters: [{ name: "Liss Frost", versionId: "forever", className: "Mage", main: true, specs: [{ key: "Mage-Frost", gear: "usable" }] }] },
    },
};

beforeEach(() => {
    fs.__store.clear();
    fs.__store.set(KADER_FILE, JSON.stringify(LEGACY));
    fs.__store.set(PROFILES_FILE, JSON.stringify(PROFILES));
});

describe("settingsMigration: Kaderplaner of #566 → Kader with states", () => {
    it("migrates every roster into a Kader, as the golden master says", () => {
        const lines = migrateKaderPlanner({ now: NOW });
        expect(lines).toEqual(["kader.json: Server g1: 2 Kader aus dem alten Format übernommen (4 im Roster, 1 auf der Bench, 3 Beispiel-Setup(s))"]);
        const stored = JSON.parse(fs.__store.get(KADER_FILE));
        if (process.env.UPDATE_GOLDEN) jest.requireActual("fs").writeFileSync(GOLDEN_FILE, `${JSON.stringify(stored, null, 4)}\n`);
        expect(stored).toEqual(require(GOLDEN_FILE));
    });

    it("keeps the facts the migration promises", () => {
        migrateKaderPlanner({ now: NOW });
        const planner = kaderStore.readPlanner("g1");
        const [hyjal, barrow] = planner.kaders;
        expect(hyjal).toMatchObject({ id: "r1", name: "Hyjal Mittwoch", leads: [] });
        // the tank slot picks the warrior's protection spec, not his fury main
        expect(hyjal.players["111111111111111111"]).toMatchObject({ state: "roster", decision: { className: "Warrior", spec: "Warrior-Protection" } });
        expect(hyjal.players["111111111111111111"].wishes.map((w) => w.spec)).toEqual(["Warrior-Protection", "Warrior-Fury"]);
        // a raider without planner data: the profile's Forever character
        expect(hyjal.players["222222222222222222"]).toMatchObject({ state: "roster", decision: { className: "Priest", spec: "Priest-Holy" } });
        expect(hyjal.players["333333333333333333"]).toMatchObject({ state: "bench", decision: null, wishes: [{ className: "Mage", spec: "Mage-Frost" }] });
        expect(hyjal.players["111111111111111111"].history).toEqual([{ at: NOW, by: "", type: "migrated", to: "roster" }]);
        // setups: size from the roster size, groups 1–4 kept
        expect(hyjal.setups.map((v) => [v.id, v.size])).toEqual([["v1", 20], ["v2", 20]]);
        expect(hyjal.setups[1].groups[3][4]).toEqual({ userId: "111111111111111111", spec: "Warrior-Protection" });
        expect(barrow.setups.map((v) => [v.id, v.size])).toEqual([["v3", 10]]);
        // known accounts and character data stay per server
        expect(planner.accounts.map((a) => a.userId)).toEqual(["555555555555555555"]);
        expect(Object.keys(planner.assignments).sort()).toEqual(["111111111111111111", "555555555555555555"]);
        expect(JSON.parse(fs.__store.get(KADER_FILE)).guilds.g1.rosters).toBeUndefined();
    });

    it("is idempotent and part of the start's migration run, logged once", () => {
        const log = jest.fn();
        const first = migrateSettings({ log, warn: jest.fn() });
        expect(first.changes.filter((c) => c.startsWith("kader.json"))).toHaveLength(1);
        expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[settings\] Migration: kader\.json: Server g1: 2 Kader/));
        const before = fs.__store.get(KADER_FILE);
        const second = migrateSettings({ log: jest.fn(), warn: jest.fn() });
        expect(second.changes.filter((c) => c.startsWith("kader.json"))).toEqual([]);
        expect(fs.__store.get(KADER_FILE)).toBe(before);
    });

    it("leaves an empty or already migrated planner alone", () => {
        fs.__store.set(KADER_FILE, JSON.stringify({ guilds: { g1: { v: 2, kaders: [] }, g2: {} } }));
        expect(migrateKaderPlanner({ now: NOW })).toEqual([]);
        fs.__store.delete(KADER_FILE);
        expect(migrateKaderPlanner({ now: NOW })).toEqual([]);
    });
});
