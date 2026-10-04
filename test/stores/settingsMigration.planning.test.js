// Raidplan ODER Sheet: die Migration beim Start gibt jeder Raid-Kategorie ohne
// gespeicherte Planung die, die sie wirklich benutzt hat — festes Sheet, sonst
// das zuletzt Genutzte (gefüllte Sheet-Kopie oder Raidplan), sonst Raidplan.
jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());

const fs = require("fs");
const { settingsPath } = require("../../src/config/paths");
const { migrateCategoryPlanning, migrateSettings } = require("../../src/stores/settingsMigration");

const CONFIG = settingsPath("config.json");
const put = (name, data) => fs.__store.set(settingsPath(name), JSON.stringify(data));
const config = () => JSON.parse(fs.__store.get(CONFIG));

beforeEach(() => {
    fs.__store.clear();
    put("config.json", {
        categoryIds: ["cat-fixed", "cat-sheet", "cat-plan", "cat-both", "cat-none", "cat-picked"],
        categorySheets: { "cat-fixed": { name: "T6", url: "https://docs.google.com/spreadsheets/d/x" } },
        categoryPlanning: { "cat-picked": "sheet" },
    });
    put("events.json", { events: [
        { id: "eh-sheet", categoryId: "cat-sheet" },
        { id: "eh-plan", categoryId: "cat-plan" },
        { id: "eh-both-a", categoryId: "cat-both" },
        { id: "eh-both-b", categoryId: "cat-both" },
        { id: "eh-picked", categoryId: "cat-picked" },
    ] });
    put("raid-events.json", { events: [{ id: "rh-1", categoryId: "cat-sheet" }] });
    put("event-sheets.json", { events: [
        { eventId: "rh-1", url: "https://docs.google.com/spreadsheets/d/copy", filledAt: 100 },
        { eventId: "eh-both-a", url: "https://docs.google.com/spreadsheets/d/old", filledAt: 100 },
        // a posted fixed sheet without a copy of its own does not count
        { eventId: "eh-plan", filledAt: 900 },
        { eventId: "eh-picked", url: "https://x", filledAt: 50 },
    ] });
    put("raidplans.json", { plans: [
        { eventId: "eh-plan", bosses: { "kara:attumen": {} }, updatedAt: 200 },
        { eventId: "eh-both-b", bosses: { "kara:attumen": {} }, updatedAt: 300 },
        // an empty plan is no use
        { eventId: "eh-sheet", bosses: {}, updatedAt: 999 },
    ] });
});

describe("stores/settingsMigration — Planung je Kategorie", () => {
    it("legt die Planung nach der bisherigen Nutzung fest und lässt eine gewählte stehen", () => {
        const lines = migrateCategoryPlanning();
        expect(config().categoryPlanning).toEqual({
            "cat-fixed": "sheet", // festes Sheet
            "cat-sheet": "sheet", // gefüllte Kopie (Raid-Helper-Event)
            "cat-plan": "raidplan", // Raidplan mit Boards
            "cat-both": "raidplan", // Raidplan jünger als die Sheet-Kopie
            "cat-none": "raidplan", // nichts benutzt
            "cat-picked": "sheet", // schon gewählt: unverändert
        });
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(/^config\.json: Planung je Raid-Kategorie nach der bisherigen Nutzung festgelegt/);
        expect(lines[0]).toContain("cat-sheet sheet");
        expect(lines[0]).not.toContain("cat-picked");
    });

    it("ist beim zweiten Start still und schreibt nichts", () => {
        migrateCategoryPlanning();
        const before = fs.__store.get(CONFIG);
        expect(migrateCategoryPlanning()).toEqual([]);
        expect(fs.__store.get(CONFIG)).toBe(before);
    });

    it("läuft im Start mit und loggt die Zeile", () => {
        const log = jest.fn();
        const { changes } = migrateSettings({ log, warn: jest.fn() });
        expect(changes.some((c) => c.startsWith("config.json: Planung je Raid-Kategorie"))).toBe(true);
        expect(log).toHaveBeenCalledWith(expect.stringContaining("Planung je Raid-Kategorie"));
    });
});
