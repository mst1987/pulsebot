// German labels of the item classes and subclasses the guild bank groups by
// (item names are English, the group labels stay German).
const { ITEM_CLASSES, classLabel, subclassLabel } = require("../../src/config/itemClassLabels");

describe("config/itemClassLabels", () => {
    it("labels the classes the guild bank sees in German", () => {
        expect(classLabel(0)).toBe("Verbrauchbar");
        expect(classLabel(3)).toBe("Edelsteine");
        expect(classLabel(7)).toBe("Handwerkswaren");
        expect(classLabel(9)).toBe("Rezepte");
        expect(classLabel(12)).toBe("Quest");
        expect(classLabel(15)).toBe("Verschiedenes");
        expect(classLabel(2)).toBe("Waffe");
        expect(classLabel(4)).toBe("Rüstung");
        expect(classLabel(1)).toBe("Behälter");
        expect(classLabel("7")).toBe("Handwerkswaren");
    });

    it("labels the subclasses: consumables, trade goods and gem colours", () => {
        expect(subclassLabel(0, 1)).toBe("Tränke");
        expect(subclassLabel(0, 2)).toBe("Elixiere");
        expect(subclassLabel(0, 3)).toBe("Fläschchen");
        expect(subclassLabel(7, 5)).toBe("Stoff");
        expect(subclassLabel(7, 6)).toBe("Leder");
        expect(subclassLabel(7, 7)).toBe("Metall & Stein");
        expect(subclassLabel(7, 9)).toBe("Kräuter");
        expect(subclassLabel(7, 10)).toBe("Elementar");
        expect(subclassLabel(7, 12)).toBe("Verzauberkunst");
        expect(subclassLabel(3, 0)).toBe("Rote Edelsteine");
        expect(subclassLabel(3, 2)).toBe("Gelbe Edelsteine");
        expect(subclassLabel(3, 1)).toBe("Blaue Edelsteine");
        expect(subclassLabel(3, 6)).toBe("Meta-Edelsteine");
    });

    it("gives \"\" for unknown or missing ids", () => {
        expect(classLabel(99)).toBe("");
        expect(classLabel(null)).toBe("");
        expect(classLabel(undefined)).toBe("");
        expect(classLabel("")).toBe("");
        expect(classLabel("x")).toBe("");
        expect(subclassLabel(7, 99)).toBe("");
        expect(subclassLabel(99, 0)).toBe("");
        expect(subclassLabel(7, null)).toBe("");
        expect(subclassLabel(null, 5)).toBe("");
    });

    it("has a German label for every class and only non-empty subclass labels", () => {
        for (const entry of Object.values(ITEM_CLASSES)) {
            expect(entry.label).toMatch(/\S/);
            for (const label of Object.values(entry.sub)) expect(label).toMatch(/\S/);
        }
    });
});
