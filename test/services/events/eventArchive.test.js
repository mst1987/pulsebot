// An event of a hidden game version (#563): readable through a direct link,
// never changed — the archive flag, the write guard and the raider's line.
let mockConfig = {};
const mockStored = new Map();
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => mockConfig }));
jest.mock("../../../src/services/events/eventSources", () => ({ getStoredEvent: (id) => mockStored.get(id) || null }));

const {
    archiveOf, archivedEventId, archivedRefusal, archivedNotice, ARCHIVED_CODE,
} = require("../../../src/services/events/eventArchive");

beforeEach(() => {
    mockConfig = { mainVersion: "forever", hideOtherVersions: true };
    mockStored.clear();
    mockStored.set("eh-tbc", { id: "eh-tbc", versionId: "tbc", categoryId: "c1" });
    mockStored.set("eh-forever", { id: "eh-forever", versionId: "forever", categoryId: "c2" });
    // a Raid-Helper snapshot carries no version: its category decides
    mockStored.set("rh-1", { id: "rh-1", categoryId: "old" });
});

describe("archiveOf", () => {
    it("marks an event of a hidden version with that version", () => {
        expect(archiveOf({ versionId: "tbc" })).toEqual({ versionId: "tbc", label: "TBC Anniversary", short: "TBC" });
    });

    it("leaves the main version and a switched-off setting alone", () => {
        expect(archiveOf({ versionId: "forever" })).toBeNull();
        mockConfig = { mainVersion: "forever" };
        expect(archiveOf({ versionId: "tbc" })).toBeNull();
        expect(archiveOf(null)).toBeNull();
    });

    it("reads a Raid-Helper event's version from its category", () => {
        mockConfig = { mainVersion: "forever", hideOtherVersions: true, categoryVersion: { old: "tbc" } };
        expect(archiveOf({ categoryId: "old" })).toMatchObject({ versionId: "tbc" });
        expect(archiveOf({ categoryId: "new" })).toBeNull();
    });

    it("uses a config handed in", () => {
        expect(archiveOf({ versionId: "forever" }, { config: { mainVersion: "tbc", hideOtherVersions: true } })).toMatchObject({ versionId: "forever" });
    });
});

describe("archivedEventId / archivedRefusal", () => {
    it("looks an id up in either source", () => {
        expect(archivedEventId("eh-tbc")).toMatchObject({ versionId: "tbc" });
        expect(archivedEventId("eh-forever")).toBeNull();
        expect(archivedEventId("nope")).toBeNull();
        expect(archivedEventId("")).toBeNull();
    });

    it("asks nothing while the setting is off", () => {
        mockConfig = { mainVersion: "forever" };
        expect(archivedEventId("eh-tbc")).toBeNull();
    });

    it("refuses with 409 for the first archived id of a list", () => {
        const refusal = archivedRefusal(["eh-forever", "eh-tbc"]);
        expect(refusal).toMatchObject({ status: 409, code: ARCHIVED_CODE, archive: { versionId: "tbc" } });
        expect(refusal.message).toContain("TBC");
        expect(archivedRefusal("eh-forever")).toBeNull();
        expect(archivedRefusal(undefined)).toBeNull();
    });
});

describe("archivedNotice", () => {
    it("is an English line for a raider, empty for a normal event", () => {
        const text = archivedNotice({ versionId: "tbc" });
        expect(text).toMatch(/^This raid is archived\n/);
        expect(text).toContain("TBC Anniversary");
        expect(archivedNotice({ versionId: "forever" })).toBe("");
    });
});
