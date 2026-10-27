// Every raid has a stored version (#737): the start-up migration stamps
// Raid-Helper snapshots and rosters without one, once and logged; afterwards a
// switch of the main or category version moves no stored raid, loot, log,
// attendance night or roster (golden master below), and a rescan keeps TBC.
jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());
// Attendance without evaluated logs: the signups decide (the report directory needs a real disk).
jest.mock("../../src/stores/reportStore", () => ({ listReports: () => [], getReport: () => null, assignGuilds: () => 0 }));
jest.mock("../../src/stores/logStore", () => ({ listLogs: () => [], migrateGuilds: () => 0 }));

const fs = require("fs");
const { settingsPath } = require("../../src/config/paths");
const { migrateSettings, migrateStoredVersions } = require("../../src/stores/settingsMigration");
const configStore = require("../../src/stores/configStore");
const raidEventStore = require("../../src/stores/raidEventStore");
const rosterStore = require("../../src/stores/rosterStore");
const lootStore = require("../../src/stores/lootStore");
const { versionOfEvent, mainVersionFor } = require("../../src/services/events/mainVersion");
const { versionOfLog } = require("../../src/services/events/storedVersion");
const { listStoredEvents } = require("../../src/services/events/eventSources");
const { buildVersionContext, eventVersion } = require("../../src/services/characters/characterVersions");
const { buildAttendanceContext } = require("../../src/services/characters/rosterAttendance");
const { archiveExport } = require("../../src/services/events/contentVersions");

const CONFIG_FILE = settingsPath("config.json");
const OWN_EVENTS_FILE = settingsPath("events.json");
const G = "1100000000000000001";
const U1 = "200000000000000001";
const U2 = "200000000000000002";
const NOW = Date.UTC(2026, 9, 10, 12);
const DAY = 86400;
const PAST = Math.floor(NOW / 1000) - 7 * DAY;
const quiet = { log: () => {}, warn: () => {} };

/** The stored data of a TBC guild from before #737: no version on any snapshot or roster. */
function seed() {
    fs.__store.set(CONFIG_FILE, JSON.stringify({ categoryIds: ["mon", "fri"], mainVersion: "tbc" }));
    fs.__store.set(raidEventStore.RAID_EVENTS_FILE, JSON.stringify({ events: [
        { id: "rh-1", guildId: G, title: "Black Temple", categoryId: "mon", categoryName: "Montag", startTime: PAST, signUps: [{ userId: U1, specName: "Fury", status: "primary" }], setup: [], firstSeenAt: 1, updatedAt: 1 },
        { id: "rh-2", guildId: G, title: "Hyjal", categoryId: "fri", categoryName: "Freitag", startTime: PAST - DAY, signUps: [{ userId: U2, specName: "Holy1", status: "primary" }], setup: [], firstSeenAt: 1, updatedAt: 1 },
    ] }));
    fs.__store.set(OWN_EVENTS_FILE, JSON.stringify({ events: [
        { id: "eh-1", guildId: G, title: "Karazhan", categoryId: "mon", categoryName: "Montag", startTime: PAST - 2 * DAY, versionId: "tbc" },
    ] }));
    fs.__store.set(rosterStore.ROSTERS_FILE, JSON.stringify({
        rosters: { r1: { id: "r1", guildId: G, name: "Montag", categoryId: "mon", members: { [U1]: { status: "core", chars: ["vexa"] } } } },
        migratedCategories: ["mon", "fri"],
    }));
    lootStore.addImport("rh-1", [{ itemId: 32837, itemName: "Warglaive of Azzinoth", character: "Vexa", source: "gargul", rawId: "a" }], { eventLabel: "Black Temple", categoryId: "mon" });
    lootStore.addImport("eh-1", [{ itemId: 30183, itemName: "Nether Vortex", character: "Kargoth", source: "gargul", rawId: "b" }], { eventLabel: "Karazhan", categoryId: "mon" });
}

const LOGS = [{ id: "l1", eventId: "rh-1" }, { id: "l2", eventId: "eh-1" }, { id: "l3", eventId: "" }];

/** Which version every stored record has right now. */
function snapshotOfVersions() {
    const ctx = buildVersionContext({});
    const attendance = (versionId) => [...buildAttendanceContext(G, { versionId, now: NOW }).allRaidsByCategory.values()]
        .flat().map((r) => r.id).sort();
    return {
        events: Object.fromEntries(listStoredEvents(G, { now: NOW }).map((e) => [e.id, versionOfEvent(e)])),
        byId: ["rh-1", "rh-2", "eh-1"].map((id) => versionOfEvent({ id, categoryId: "mon" })),
        loot: lootStore.listAll().map((it) => [it.eventId, eventVersion(ctx, it.eventId)]),
        logs: LOGS.map((l) => [l.id, versionOfLog(l)]),
        roster: rosterStore.getRoster("r1").versionId,
        attendanceTbc: attendance("tbc"),
        attendanceForever: attendance("forever"),
    };
}

/** Switch the guild to Forever: main version and both categories. */
function switchToForever() {
    configStore.writeStored({ ...configStore.readStored(), mainVersion: "forever", categoryVersion: { mon: "forever", fri: "forever" } });
}

beforeEach(() => {
    fs.__store.clear();
    jest.spyOn(Date, "now").mockReturnValue(NOW);
});
afterEach(() => jest.restoreAllMocks());

describe("stores/settingsMigration — stored versions (#737)", () => {
    it("stamps snapshots and rosters without version with their category's version and logs it", () => {
        seed();
        const log = jest.fn();
        const { changes } = migrateSettings({ log, warn: () => {} });
        expect(changes).toEqual(expect.arrayContaining([
            "raid-events.json: 2 Raid(s) → \"tbc\" (#737)",
            "rosters.json: 1 Roster → \"tbc\" (#737)",
        ]));
        expect(log).toHaveBeenCalledWith("[settings] Migration: raid-events.json: 2 Raid(s) → \"tbc\" (#737)");
        expect(raidEventStore.listRaidEvents("").map((e) => [e.id, e.versionId])).toEqual([["rh-1", "tbc"], ["rh-2", "tbc"]]);
        expect(rosterStore.getRoster("r1").versionId).toBe("tbc");
    });

    it("takes a category's own version where one is set", () => {
        seed();
        configStore.writeStored({ ...configStore.readStored(), categoryVersion: { fri: "forever" } });
        expect(migrateStoredVersions()).toEqual([
            "raid-events.json: 1 Raid(s) → \"tbc\" (#737)",
            "raid-events.json: 1 Raid(s) → \"forever\" (#737)",
            "rosters.json: 1 Roster → \"tbc\" (#737)",
        ]);
        expect(raidEventStore.getRaidEvent("rh-2").versionId).toBe("forever");
    });

    it("is idempotent: the second start finds nothing and writes nothing", () => {
        seed();
        migrateSettings(quiet);
        const raids = fs.__store.get(raidEventStore.RAID_EVENTS_FILE);
        const rosters = fs.__store.get(rosterStore.ROSTERS_FILE);
        fs.writeFileSync.mockClear();
        expect(migrateStoredVersions()).toEqual([]);
        expect(migrateSettings(quiet).changes).toEqual([]);
        expect(fs.writeFileSync).not.toHaveBeenCalled();
        expect(fs.__store.get(raidEventStore.RAID_EVENTS_FILE)).toBe(raids);
        expect(fs.__store.get(rosterStore.ROSTERS_FILE)).toBe(rosters);
    });

    it("finds nothing to do without any stored raid or roster", () => {
        expect(migrateStoredVersions()).toEqual([]);
    });
});

describe("golden master: switching to Forever moves nothing stored (#737)", () => {
    it("keeps every raid, loot row, log, attendance night and roster in TBC", () => {
        seed();
        migrateSettings(quiet);
        const before = snapshotOfVersions();
        expect(before).toEqual({
            events: { "rh-1": "tbc", "rh-2": "tbc", "eh-1": "tbc" },
            byId: ["tbc", "tbc", "tbc"],
            loot: [["rh-1", "tbc"], ["eh-1", "tbc"]],
            logs: [["l1", "tbc"], ["l2", "tbc"], ["l3", ""]],
            roster: "tbc",
            attendanceTbc: ["rh-1", "rh-2"],
            attendanceForever: [],
        });

        switchToForever();
        expect(mainVersionFor({ categoryId: "mon" })).toBe("forever");
        expect(snapshotOfVersions()).toEqual(before);
    });

    it("keeps TBC for a raid scanned again after the switch, a new raid starts in Forever", () => {
        seed();
        migrateSettings(quiet);
        switchToForever();
        // what raidEventScan hands in: the version the category plays now
        const scanned = (id, title) => ({ id, guildId: G, title, categoryId: "mon", categoryName: "Montag", startTime: PAST, versionId: mainVersionFor({ categoryId: "mon" }) });
        raidEventStore.saveRaidEvents([scanned("rh-1", "Black Temple (neu)"), scanned("rh-3", "Onyxia")]);
        expect(raidEventStore.getRaidEvent("rh-1")).toMatchObject({ title: "Black Temple (neu)", versionId: "tbc" });
        expect(versionOfEvent({ id: "rh-1", categoryId: "mon" })).toBe("tbc");
        expect(raidEventStore.getRaidEvent("rh-3").versionId).toBe("forever");
        expect(versionOfEvent({ id: "rh-3", categoryId: "mon" })).toBe("forever");
    });

    it("exports the stored TBC raids as the archive of the other version, loot and signups alike", () => {
        seed();
        migrateSettings(quiet);
        switchToForever();
        const data = archiveExport({ now: NOW });
        expect(data.mainVersion).toBe("forever");
        expect(data.versions).toEqual(["tbc"]);
        expect(data.loot.map((r) => [r.eventId, r.versionId])).toEqual([["rh-1", "tbc"], ["eh-1", "tbc"]]);
        expect(data.attendance.map((r) => [r.eventId, r.versionId])).toEqual([["rh-1", "tbc"], ["rh-2", "tbc"]]);
    });
});
