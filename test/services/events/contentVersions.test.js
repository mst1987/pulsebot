// The content switch of the menu (#563): which versions it offers, the coming
// raids per version for the settings' warning, and the archive export.
let mockConfig = {};
let mockEvents = [];
let mockSnapshots = [];
let mockLoot = [];
let mockProfiles = [];
let mockTemplates = [];
let mockStored = [];

jest.mock("../../../src/stores/configStore", () => ({ getConfig: () => mockConfig }));
jest.mock("../../../src/stores/settingsStore", () => ({
    getConfig: () => mockConfig,
    listRaidTemplates: () => mockTemplates,
}));
jest.mock("../../../src/stores/eventStore", () => ({
    listEvents: () => mockEvents,
    isOwnEventId: (id) => String(id).startsWith("eh-"),
    getEvent: (id) => mockEvents.find((e) => e.id === id) || null,
}));
jest.mock("../../../src/stores/raidEventStore", () => ({ listRaidEvents: () => mockSnapshots }));
jest.mock("../../../src/stores/lootStore", () => ({ listAll: () => mockLoot }));
jest.mock("../../../src/stores/raiderProfileStore", () => ({ listProfiles: () => mockProfiles }));
jest.mock("../../../src/services/events/eventSources", () => ({ listStoredEvents: () => mockStored }));

const {
    contentVersions, upcomingByVersion, archiveExport, archiveCsv, versionsWithData,
} = require("../../../src/services/events/contentVersions");

const NOW = Date.UTC(2026, 9, 1, 12);
const SEC = Math.floor(NOW / 1000);

beforeEach(() => {
    mockConfig = { mainVersion: "forever" };
    mockEvents = [];
    mockSnapshots = [];
    mockLoot = [];
    mockProfiles = [];
    mockTemplates = [];
    mockStored = [];
});

describe("contentVersions", () => {
    it("offers only the main version without any other data", () => {
        expect(contentVersions()).toEqual({
            mainVersion: "forever", hideOtherVersions: false,
            versions: [{ id: "forever", label: "WoW Forever", short: "Forever" }],
        });
    });

    it("adds every version with events, categories, templates, characters or loot, main version first", () => {
        mockEvents = [{ id: "eh-1", versionId: "tbc" }];
        mockConfig = { mainVersion: "forever", categoryVersion: { c1: "classic" } };
        expect(contentVersions().versions.map((v) => v.id)).toEqual(["forever", "tbc", "classic"]);
    });

    it("counts loot without an own event as TBC, and characters and templates by their version", () => {
        mockLoot = [{ eventId: "rh-99" }];
        expect(versionsWithData(mockConfig).has("tbc")).toBe(true);
        mockLoot = [];
        mockProfiles = [{ characters: [{ versionId: "classic" }] }];
        mockTemplates = [{ versionId: "tbc" }];
        expect([...versionsWithData(mockConfig)].sort()).toEqual(["classic", "tbc"]);
    });

    it("offers nothing but the main version while the others are hidden", () => {
        mockEvents = [{ id: "eh-1", versionId: "tbc" }];
        mockConfig = { mainVersion: "forever", hideOtherVersions: true };
        expect(contentVersions()).toEqual({
            mainVersion: "forever", hideOtherVersions: true,
            versions: [{ id: "forever", label: "WoW Forever", short: "Forever" }],
        });
    });
});

describe("upcomingByVersion", () => {
    it("groups the coming raids by version, soonest first, without cancelled or past ones", () => {
        mockConfig = { mainVersion: "forever", categoryVersion: { old: "tbc" } };
        mockEvents = [
            { id: "eh-2", title: "BT", versionId: "tbc", startTime: SEC + 7200 },
            { id: "eh-1", title: "Hyjal", versionId: "tbc", startTime: SEC + 3600 },
            { id: "eh-x", title: "Gone", versionId: "tbc", startTime: SEC + 3600, status: "cancelled" },
            { id: "eh-old", title: "Old", versionId: "tbc", startTime: SEC - 3600 },
            { id: "eh-f", title: "Ony", versionId: "forever", startTime: SEC + 100 },
        ];
        mockSnapshots = [{ id: "rh-1", title: "Kara", categoryId: "old", startTime: SEC + 50 }];
        expect(upcomingByVersion({ now: NOW })).toEqual({
            tbc: [
                { id: "rh-1", title: "Kara", startTime: SEC + 50 },
                { id: "eh-1", title: "Hyjal", startTime: SEC + 3600 },
                { id: "eh-2", title: "BT", startTime: SEC + 7200 },
            ],
            forever: [{ id: "eh-f", title: "Ony", startTime: SEC + 100 }],
        });
    });
});

describe("archiveExport / archiveCsv", () => {
    beforeEach(() => {
        mockEvents = [{ id: "eh-f", versionId: "forever" }];
        mockLoot = [
            { eventId: "rh-1", eventLabel: "Black Temple", character: "Vexa", itemId: 32837, itemName: "Warglaive of Azzinoth", reasonLabel: "BiS", awardedAt: Date.UTC(2026, 9, 28) },
            { eventId: "eh-f", eventLabel: "Onyxia", character: "Kargoth", itemId: 1, itemName: "Backpack", reasonLabel: "BiS", awardedAt: Date.UTC(2026, 11, 16) },
        ];
        mockStored = [
            { id: "rh-1", title: "Black Temple", categoryName: "TBC Mittwoch", categoryId: "old", startTime: Date.UTC(2026, 9, 28) / 1000, signUps: [{ name: "Vexa", className: "Rogue", specName: "Combat", status: "primary" }] },
            { id: "eh-f", title: "Onyxia", versionId: "forever", startTime: Date.UTC(2026, 11, 16) / 1000, signUps: [{ character: "Kargoth", status: "signed" }] },
        ];
        mockConfig = { mainVersion: "forever", categoryVersion: { old: "tbc" } };
    });

    it("carries loot and attendance of every version but the main one", () => {
        const data = archiveExport({ now: NOW });
        // only the versions with data: Classic has none
        expect(data.versions).toEqual(["tbc"]);
        expect(data.mainVersion).toBe("forever");
        expect(data.loot).toEqual([{
            versionId: "tbc", eventId: "rh-1", date: "2026-10-28", raid: "Black Temple",
            character: "Vexa", itemId: 32837, item: "Warglaive of Azzinoth", reason: "BiS",
        }]);
        expect(data.attendance).toEqual([{
            versionId: "tbc", eventId: "rh-1", date: "2026-10-28", raid: "Black Temple", category: "TBC Mittwoch",
            character: "Vexa", className: "Rogue", spec: "Combat", status: "primary",
        }]);
    });

    it("writes one CSV with a type column, quoting and defusing what needs it", () => {
        const csv = archiveCsv({
            loot: [{ versionId: "tbc", date: "2026-10-28", raid: "BT, Mittwoch", eventId: "rh-1", character: "=Vexa", item: "Glaive \"L\"", itemId: 1, reason: "BiS" }],
            attendance: [{ versionId: "tbc", date: "2026-10-28", raid: "BT", eventId: "rh-1", character: "Vexa", category: "Mi", className: "Rogue", spec: "Combat", status: "primary" }],
        });
        const lines = csv.trim().split("\r\n");
        expect(lines[0]).toBe("type,versionId,date,raid,eventId,character,item,itemId,reason,category,className,spec,status");
        expect(lines[1]).toBe("loot,tbc,2026-10-28,\"BT, Mittwoch\",rh-1,'=Vexa,\"Glaive \"\"L\"\"\",1,BiS,,,,");
        expect(lines[2]).toBe("attendance,tbc,2026-10-28,BT,rh-1,Vexa,,,,Mi,Rogue,Combat,primary");
    });
});
