// The raid categories an absence or attendance can be limited to (src/web/availability/entryCategories.js):
// the active ones, else those of coming raids; names, icons (from event titles only) and the version each plays.
const NOW = Date.UTC(2030, 2, 21, 12, 0);
const sec = (iso) => Math.floor(Date.parse(iso) / 1000);

const mockEvents = [];
jest.mock("../../../src/stores/events/eventStore", () => ({
    listEvents: (_g, { sinceSeconds = 0 } = {}) => mockEvents.filter((e) => e.startTime >= sinceSeconds),
}));
let mockConfig = {};
jest.mock("../../../src/stores/settings/settingsStore", () => ({ getConfig: () => mockConfig }));

const rosterAttendance = require("../../../src/services/characters/rosterAttendance");
const { entryCategories, entryCategoryIds } = require("../../../src/web/availability/entryCategories");

const { CONTENT_ICONS } = rosterAttendance;

beforeEach(() => {
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

    it("nimmt auch Kategorien ohne bekannten Namen an (Prüfung der Eingabe)", () => {
        expect(entryCategoryIds({ now: NOW, config: { categoryIds: ["123456789012345678"] } })).toEqual(["123456789012345678"]);
    });
});

describe("entryCategories", () => {
    it("Name aus Discord, sonst aus den Events; Icon aus den Titeln, Version je Kategorie", () => {
        mockEvents.push(
            // last month's and the coming raids name the content; the newest content gives the icon
            { id: "p", categoryId: "mon", title: "Karazhan", startTime: sec("2030-03-04T19:00Z") },
            { id: "a", categoryId: "mon", title: "Gruul + Magtheridon", startTime: sec("2030-03-25T19:00Z") },
            { id: "b", categoryId: "fri", categoryName: "Freitag-Raid", title: "Spaßabend", startTime: sec("2030-03-28T19:00Z") },
        );
        const config = { categoryIds: ["mon", "fri"], mainVersion: "tbc", categoryVersion: { fri: "forever" } };
        const list = entryCategories({ now: NOW, config, categoryNames: { mon: "Montag" } });
        expect(list).toEqual([
            { id: "mon", name: "Montag", icon: CONTENT_ICONS.mag, versionId: "tbc" },
            { id: "fri", name: "Freitag-Raid", icon: "", versionId: "forever" },
        ]);
    });

    it("liest keine Logs oder Reports: kein Anwesenheits-Kontext", () => {
        const spy = jest.spyOn(rosterAttendance, "buildAttendanceContext");
        mockEvents.push({ id: "a", categoryId: "mon", categoryName: "Montag", title: "Karazhan", startTime: sec("2030-03-25T19:00Z") });
        entryCategories({ now: NOW, config: { categoryIds: ["mon"], mainVersion: "tbc" } });
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it("abgesagte und zu alte Raids zählen weder für Name noch Icon", () => {
        mockEvents.push(
            { id: "x", categoryId: "mon", categoryName: "Alt", title: "Karazhan", startTime: sec("2029-09-01T19:00Z") },
            { id: "y", categoryId: "mon", categoryName: "Abgesagt", title: "Gruul", startTime: sec("2030-03-25T19:00Z"), status: "cancelled" },
        );
        expect(entryCategories({ now: NOW, config: { categoryIds: ["mon"], mainVersion: "tbc" } })).toEqual([]);
    });

    it("ohne Kategorien eine leere Liste; Kategorien ohne Namen fallen weg statt als nackte ID", () => {
        expect(entryCategories({ now: NOW, config: {} })).toEqual([]);
        mockEvents.push({ id: "a", categoryId: "mon", title: "Karazhan", startTime: sec("2030-03-25T19:00Z") });
        const list = entryCategories({ now: NOW, config: { categoryIds: ["123456789012345678", "mon"], mainVersion: "tbc" }, categoryNames: { mon: "Montag" } });
        expect(list).toEqual([{ id: "mon", name: "Montag", icon: CONTENT_ICONS.kara, versionId: "tbc" }]);
    });
});
