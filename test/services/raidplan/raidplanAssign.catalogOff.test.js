// The raid plan catalog switched off for a version (#761, Einstellungen → Spielversion → "Funktionen je Version"):
// a plan of that version gets no mobs and no spells, and the suggestions pick classes by the built in rules alone.
const configStore = require("../../../src/stores/configStore");
const catalogStore = require("../../../src/stores/raidplanCatalogStore");
const assign = require("../../../src/services/raidplan/raidplanAssign");
const raidplan = require("../../../src/web/raidplan/raidplan");
const { tempStoreFile } = require("../../helpers/tempStore");

beforeAll(() => {
    configStore.useFile(tempStoreFile("config.json"));
    catalogStore.useFile(tempStoreFile("catalog-off.json"));
    // an own "kick" spell of the warlock only: with the catalog on, it decides who kicks
    catalogStore.save("spells", { name: "Zauberschloss", type: "kick", classes: ["Warlock"], versions: ["tbc"] });
});
afterAll(() => {
    configStore.useFile(null);
    catalogStore.useFile(null);
});

const setCatalog = (on) => configStore.saveConfig({ versionSettings: { tbc: { disabled: on ? [] : ["raidplanCatalog"] } } });

describe("raid plan catalog per version (#761)", () => {
    it("lets the catalog's spells decide while it is on", () => {
        setCatalog(true);
        expect(assign._internal.classesFor("kick", [], false, "tbc")).toContain("Warlock");
    });

    it("falls back to the built in rules while it is off, and only for that version", () => {
        setCatalog(false);
        const off = assign._internal.classesFor("kick", [], false, "tbc");
        expect(off).not.toContain("Warlock");
        expect(off.length).toBeGreaterThan(0);
        // a plan without a version keeps the whole catalog
        expect(assign._internal.classesFor("kick", [], false, "")).toContain("Warlock");
        setCatalog(true);
    });

    it("hands a template of that version an empty catalog while it is off", () => {
        const template = { id: "t1", name: "T", versionId: "tbc", instanceIds: [], size: 25, counts: {} };
        setCatalog(true);
        expect(raidplan.templateView(template).catalog.spells.length).toBeGreaterThan(0);
        setCatalog(false);
        const off = raidplan.templateView(template).catalog;
        expect(off.mobs).toEqual([]);
        expect(off.spells).toEqual([]);
        // the assignment types and classes of the version stay
        expect(off.types).toContain("kick");
        expect(off.classes.length).toBe(9);
        setCatalog(true);
    });
});
