const { CLASSES, ROLES, ROLE_LABELS, ROLE_LABELS_EN, buildClasses } = require("../../src/config/gameVersions/classes");
const { rulesFor } = require("../../src/config/gameVersions");

// The bot speaks English to raiders; the web keeps its German labels. Both
// tables live side by side: `label` (German) and `labelEn`.
describe("config/gameVersions/classes — English labels", () => {
    it("gives every class and spec an English label and keeps the German one", () => {
        for (const c of CLASSES) {
            expect(c.labelEn).toMatch(/^[A-Z][A-Za-z ()]+$/);
            expect(c.label).toBeTruthy();
            for (const s of c.specs) {
                expect(s.labelEn).toMatch(/^[A-Z][A-Za-z ()]+$/);
                expect(s.label).toBeTruthy();
            }
        }
        const priest = CLASSES.find((c) => c.id === "Priest");
        expect([priest.label, priest.labelEn]).toEqual(["Priester", "Priest"]);
        expect(priest.specs.map((s) => s.labelEn)).toEqual(["Discipline", "Holy", "Shadow"]);
    });

    it("spells the specs whose id is not a word as players do", () => {
        const specEn = (classId, specId) => CLASSES.find((c) => c.id === classId).specs.find((s) => s.id === specId).labelEn;
        expect(specEn("Hunter", "BeastMastery")).toBe("Beast Mastery");
        expect(specEn("Druid", "Feral")).toBe("Feral (Cat)");
        expect(specEn("Druid", "Guardian")).toBe("Feral (Bear)");
        expect(specEn("Shaman", "Restoration")).toBe("Restoration");
    });

    it("carries the English labels through buildClasses and the rule sets", () => {
        const spec = buildClasses().find((c) => c.id === "Warrior").specs.find((s) => s.id === "Protection");
        expect(spec).toMatchObject({ key: "Warrior-Protection", label: "Schutz", labelEn: "Protection" });
        const tbcMage = rulesFor("tbc").classes.find((c) => c.id === "Mage");
        expect(tbcMage.labelEn).toBe("Mage");
    });

    it("has English role labels next to the German ones", () => {
        expect(ROLES.map((r) => ROLE_LABELS_EN[r])).toEqual(["Tank", "Healer", "Melee", "Ranged"]);
        expect(ROLE_LABELS.healer).toBe("Heiler");
    });
});
