// The main game version as a setting (#541): category before global before
// the default, unknown ids never handed out, an event's own version wins.
let mockConfig = {};
jest.mock("../../../src/stores/configStore", () => ({ getConfig: () => mockConfig }));
// #737: the versions the Raid-Helper scan stored per snapshot.
const mockSnapshots = new Map();
let mockSnapshotError = null;
jest.mock("../../../src/stores/raidEventStore", () => ({
    versionOfRaidEvent: (id) => {
        if (mockSnapshotError) throw mockSnapshotError;
        return mockSnapshots.get(id) || "";
    },
}));

const {
    mainVersionFor, versionOfEvent, rulesForEvent, classesOfVersion, knownVersion, snapshotVersionOf,
} = require("../../../src/services/versions/mainVersion");

beforeEach(() => {
    mockConfig = {};
    mockSnapshots.clear();
    mockSnapshotError = null;
});

describe("mainVersionFor", () => {
    it("is TBC while nothing is set", () => {
        expect(mainVersionFor()).toBe("tbc");
        expect(mainVersionFor({ categoryId: "c1" })).toBe("tbc");
    });

    it("reads the global main version from the settings", () => {
        mockConfig = { mainVersion: "forever" };
        expect(mainVersionFor()).toBe("forever");
        expect(mainVersionFor({ categoryId: "c1" })).toBe("forever");
    });

    it("takes the category's own version before the global one", () => {
        mockConfig = { mainVersion: "forever", categoryVersion: { c1: "tbc" } };
        expect(mainVersionFor({ categoryId: "c1" })).toBe("tbc");
        expect(mainVersionFor({ categoryId: "c2" })).toBe("forever");
    });

    it("skips an id no rule set knows, at every level", () => {
        mockConfig = { mainVersion: "wotlk", categoryVersion: { c1: "cata", c2: "" } };
        expect(mainVersionFor({ categoryId: "c1" })).toBe("tbc");
        expect(mainVersionFor({ categoryId: "c2" })).toBe("tbc");
        mockConfig = { mainVersion: "classic", categoryVersion: { c1: "cata" } };
        expect(mainVersionFor({ categoryId: "c1" })).toBe("classic");
    });

    it("uses a config handed in instead of the stored one", () => {
        mockConfig = { mainVersion: "forever" };
        expect(mainVersionFor({ config: { mainVersion: "classic" } })).toBe("classic");
        expect(mainVersionFor({ categoryId: "x", config: { categoryVersion: { x: "forever" } } })).toBe("forever");
    });

    it("survives a malformed or unreadable config", () => {
        mockConfig = { categoryVersion: ["forever"] };
        expect(mainVersionFor({ categoryId: "0" })).toBe("tbc");
        mockConfig = null;
        expect(mainVersionFor()).toBe("tbc");
    });
});

describe("versionOfEvent / rulesForEvent", () => {
    it("keeps the event's own version whatever the setting says", () => {
        mockConfig = { mainVersion: "forever" };
        expect(versionOfEvent({ versionId: "tbc", categoryId: "c1" })).toBe("tbc");
        expect(rulesForEvent({ versionId: "classic" }).id).toBe("classic");
    });

    it("gives an event without a (known) version the one its category plays", () => {
        mockConfig = { mainVersion: "forever", categoryVersion: { c1: "tbc" } };
        expect(versionOfEvent({ categoryId: "c1" })).toBe("tbc");
        expect(versionOfEvent({ versionId: "bogus", categoryId: "c2" })).toBe("forever");
        expect(rulesForEvent(null).id).toBe("forever");
    });

    // #737: a scanned Raid-Helper raid keeps the version it was stored with.
    it("reads a Raid-Helper snapshot's stored version before the category's of today", () => {
        mockSnapshots.set("rh-1", "tbc");
        mockConfig = { mainVersion: "forever", categoryVersion: { c1: "forever" } };
        expect(versionOfEvent({ id: "rh-1", categoryId: "c1" })).toBe("tbc");
        expect(versionOfEvent({ id: "rh-1", versionId: "classic", categoryId: "c1" })).toBe("classic");
        // not scanned yet (a coming raid): the category's version of today
        expect(versionOfEvent({ id: "rh-2", categoryId: "c1" })).toBe("forever");
    });

    it("reads an own event's stored version through the hook eventStore registers", () => {
        const { registerOwnEventVersions } = require("../../../src/services/versions/mainVersion");
        mockConfig = { mainVersion: "forever" };
        registerOwnEventVersions((id) => (id.startsWith("eh-") ? ({ "eh-1": "tbc" }[id] || "") : null));
        try {
            expect(versionOfEvent({ id: "eh-1" })).toBe("tbc");
            // an own event that is gone: today's version, never another store's answer
            mockSnapshots.set("eh-2", "classic");
            expect(versionOfEvent({ id: "eh-2" })).toBe("forever");
            mockSnapshots.set("rh-1", "tbc");
            expect(versionOfEvent({ id: "rh-1" })).toBe("tbc");
        } finally {
            registerOwnEventVersions(null);
        }
        expect(versionOfEvent({ id: "eh-1" })).toBe("forever");
    });

    it("counts a snapshot store that cannot answer as nothing stored", () => {
        mockConfig = { mainVersion: "forever" };
        mockSnapshotError = new Error("broken");
        expect(snapshotVersionOf("rh-1")).toBe("");
        expect(versionOfEvent({ id: "rh-1" })).toBe("forever");
        expect(snapshotVersionOf("")).toBe("");
    });
});

describe("classesOfVersion / knownVersion", () => {
    it("lists a version's classes in the picker's shape", () => {
        const list = classesOfVersion("forever");
        expect(list.length).toBe(9);
        expect(Object.keys(list[0]).sort()).toEqual(["color", "icon", "id", "label"]);
    });

    it("falls back to the main version's list for an unknown id", () => {
        mockConfig = { mainVersion: "classic" };
        expect(classesOfVersion("nope").map((c) => c.id)).toEqual(classesOfVersion("classic").map((c) => c.id));
    });

    it("knows only the rule sets' ids", () => {
        expect(knownVersion(" forever ")).toBe("forever");
        expect(knownVersion("wotlk")).toBe("");
        expect(knownVersion(null)).toBe("");
    });
});

// "Andere Versionen ausblenden" (#563): one question every list asks.
describe("hiding the other versions (#563)", () => {
    const {
        hidesOtherVersions, visibleVersions, isVersionVisible, visibleRows, otherVersions, resolveVersionQuery,
    } = require("../../../src/services/versions/mainVersion");

    it("shows every version while the setting is off", () => {
        mockConfig = { mainVersion: "forever" };
        expect(hidesOtherVersions()).toBe(false);
        expect(visibleVersions()).toEqual(["tbc", "classic", "forever"]);
        expect(isVersionVisible("tbc")).toBe(true);
        const rows = [{ v: "tbc" }, { v: "forever" }];
        expect(visibleRows(rows, (r) => r.v)).toBe(rows);
    });

    it("shows only the main version while it is on", () => {
        mockConfig = { mainVersion: "forever", hideOtherVersions: true };
        expect(hidesOtherVersions()).toBe(true);
        expect(visibleVersions()).toEqual(["forever"]);
        expect(isVersionVisible("forever")).toBe(true);
        expect(isVersionVisible("tbc")).toBe(false);
        // an unknown or missing id counts as the main version
        expect(isVersionVisible("")).toBe(true);
        expect(isVersionVisible("wotlk")).toBe(true);
        expect(visibleRows([{ v: "tbc" }, { v: "forever" }, { v: "classic" }], (r) => r.v)).toEqual([{ v: "forever" }]);
    });

    it("only a literal true hides anything", () => {
        expect(hidesOtherVersions({ hideOtherVersions: "yes" })).toBe(false);
        expect(hidesOtherVersions({ hideOtherVersions: true })).toBe(true);
    });

    it("names every version but the main one for the archive", () => {
        mockConfig = { mainVersion: "forever" };
        expect(otherVersions()).toEqual(["tbc", "classic"]);
        expect(otherVersions({ mainVersion: "tbc" })).toEqual(["classic", "forever"]);
    });

    it("ignores ?version= of another version and 'all' while hidden", () => {
        mockConfig = { mainVersion: "forever", hideOtherVersions: true };
        expect(resolveVersionQuery("tbc")).toEqual({ versionId: "forever", mainVersion: "forever" });
        expect(resolveVersionQuery("all")).toEqual({ versionId: "forever", mainVersion: "forever" });
        mockConfig = { mainVersion: "forever" };
        expect(resolveVersionQuery("tbc")).toEqual({ versionId: "tbc", mainVersion: "forever" });
    });

    it("answers one version for every page: 'all' is the main version, only a caller with allowAll reads across (#741)", () => {
        mockConfig = { mainVersion: "forever" };
        expect(resolveVersionQuery("all")).toEqual({ versionId: "forever", mainVersion: "forever" });
        expect(resolveVersionQuery("")).toEqual({ versionId: "forever", mainVersion: "forever" });
        expect(resolveVersionQuery("all", { allowAll: true })).toEqual({ versionId: "", mainVersion: "forever" });
        // hidden versions win over allowAll
        mockConfig = { mainVersion: "forever", hideOtherVersions: true };
        expect(resolveVersionQuery("all", { allowAll: true })).toEqual({ versionId: "forever", mainVersion: "forever" });
    });
});
