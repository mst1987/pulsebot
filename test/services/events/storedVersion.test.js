// The stored game version of a raid by its id (#737): an own event's, a
// Raid-Helper snapshot's, never the live setting.
let mockConfig = {};
const mockEvents = new Map();
const mockSnapshots = new Map();
jest.mock("../../../src/stores/configStore", () => ({ getConfig: () => mockConfig }));
jest.mock("../../../src/stores/eventStore", () => ({
    getEvent: (id) => mockEvents.get(id) || null,
    isOwnEventId: (id) => String(id || "").startsWith("eh-"),
}));
jest.mock("../../../src/stores/raidEventStore", () => ({
    versionOfRaidEvent: (id) => mockSnapshots.get(id) || "",
}));

const { storedVersionOf, versionOfLog } = require("../../../src/services/events/storedVersion");

beforeEach(() => {
    mockConfig = { mainVersion: "forever", categoryVersion: { mon: "forever" } };
    mockEvents.clear();
    mockSnapshots.clear();
    mockEvents.set("eh-ony", { id: "eh-ony", versionId: "forever" });
    mockEvents.set("eh-kara", { id: "eh-kara", versionId: "tbc" });
    mockSnapshots.set("rh-1", "tbc");
});

describe("services/events/storedVersion", () => {
    it("reads an own event's version and a snapshot's, whatever the setting says", () => {
        expect(storedVersionOf("eh-ony")).toBe("forever");
        expect(storedVersionOf("eh-kara")).toBe("tbc");
        expect(storedVersionOf("rh-1")).toBe("tbc");
    });

    it("answers \"\" for a raid nobody stored and for no id", () => {
        expect(storedVersionOf("eh-gone")).toBe("");
        expect(storedVersionOf("rh-unscanned")).toBe("");
        expect(storedVersionOf("")).toBe("");
        expect(storedVersionOf(null)).toBe("");
    });

    it("never hands out an id no rule set knows", () => {
        mockEvents.set("eh-odd", { id: "eh-odd", versionId: "wotlk" });
        mockSnapshots.set("rh-odd", "wotlk");
        expect(storedVersionOf("eh-odd")).toBe("");
        expect(storedVersionOf("rh-odd")).toBe("");
    });

    it("gives a log the version of its raid, and none without one", () => {
        expect(versionOfLog({ eventId: "rh-1" })).toBe("tbc");
        expect(versionOfLog({ eventId: "eh-ony" })).toBe("forever");
        expect(versionOfLog({ eventId: "" })).toBe("");
        expect(versionOfLog({})).toBe("");
        expect(versionOfLog(null)).toBe("");
        expect(versionOfLog({ eventId: "rh-unscanned" })).toBe("");
    });
});
