// The raid categories an absence or attendance can be limited to (src/web/availability/entryCategories.js):
// the active ones, else those of coming raids; names, icons and the version each plays.
const NOW = Date.UTC(2030, 2, 21, 12, 0);
const sec = (iso) => Math.floor(Date.parse(iso) / 1000);

const mockContexts = [];
jest.mock("../../../src/services/characters/rosterAttendance", () => ({
    buildAttendanceContext: (_g, { versionId }) => {
        mockContexts.push(versionId);
        return { versionId };
    },
    categoryInfo: (ctx, id) => {
        if (id === "boom") throw new Error("no logs");
        return { icon: id === "mon" ? `boss_${ctx.versionId}` : "" };
    },
}));
const mockEvents = [];
jest.mock("../../../src/stores/eventStore", () => ({
    listEvents: (_g, { sinceSeconds = 0 } = {}) => mockEvents.filter((e) => e.startTime >= sinceSeconds),
}));
let mockConfig = {};
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => mockConfig }));

const { entryCategories, entryCategoryIds } = require("../../../src/web/availability/entryCategories");

beforeEach(() => {
    mockContexts.length = 0;
    mockEvents.length = 0;
    mockConfig = {};
});

describe("entryCategoryIds", () => {
    it("nimmt die aktiven Kategorien, ohne Doppelte", () => {
        mockConfig = { categoryIds: ["mon", "fri", "mon", ""] };
        expect(entryCategoryIds({ now: NOW })).toEqual(["mon", "fri"]);
    });

    it("ohne aktive Kategorien die der kommenden, nicht abgesagten Raids", () => {
        mockEvents.push(
            { id: "a", categoryId: "mon", startTime: sec("2030-03-25T19:00Z") },
            { id: "b", categoryId: "x", startTime: sec("2030-03-26T19:00Z"), status: "cancelled" },
            { id: "c", categoryId: "old", startTime: sec("2030-03-01T19:00Z") },
            { id: "d", categoryId: "", startTime: sec("2030-03-27T19:00Z") },
        );
        expect(entryCategoryIds({ now: NOW, config: {} })).toEqual(["mon"]);
    });
});

describe("entryCategories", () => {
    it("Name aus Discord, sonst aus den Events; Icon und Version je Kategorie", () => {
        mockEvents.push({ id: "a", categoryId: "fri", categoryName: "Freitag-Raid", startTime: sec("2030-03-25T19:00Z") });
        const config = { categoryIds: ["mon", "fri"], mainVersion: "tbc", categoryVersion: { fri: "forever" } };
        const list = entryCategories({ now: NOW, config, categoryNames: { mon: "Montag" } });
        expect(list).toEqual([
            { id: "mon", name: "Montag", icon: "boss_tbc", versionId: "tbc" },
            { id: "fri", name: "Freitag-Raid", icon: "", versionId: "forever" },
        ]);
        // one attendance context per version, not per category
        expect(mockContexts.sort()).toEqual(["forever", "tbc"]);
    });

    it("ohne Kategorien eine leere Liste, ein Fehler beim Icon kostet nur das Icon", () => {
        expect(entryCategories({ now: NOW, config: {} })).toEqual([]);
        const list = entryCategories({ now: NOW, config: { categoryIds: ["boom", "mon"], mainVersion: "tbc" } });
        expect(list).toEqual([
            { id: "boom", name: "", icon: "", versionId: "tbc" },
            { id: "mon", name: "", icon: "boss_tbc", versionId: "tbc" },
        ]);
    });
});
