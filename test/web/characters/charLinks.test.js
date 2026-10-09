// Die Links nach draußen. Nichts gemockt: was zählt, ist die Vorlage aus
// config/variables.js und dass ein Name darin sicher landet.
const { armoryUrlFor, wclUrlFor } = require("../../../src/web/characters/charLinks");

describe("web/characters/charLinks", () => {
    it("builds an armory and a WCL link for a character", () => {
        expect(armoryUrlFor("Devihra")).toContain("Devihra");
        expect(armoryUrlFor("Devihra")).toMatch(/^https:\/\//);
        expect(wclUrlFor("Devihra")).toContain("Devihra");
    });

    it("escapes a name instead of pasting it into the URL", () => {
        // Ein Name mit Umlaut oder Leerzeichen darf den Link nicht zerlegen.
        expect(armoryUrlFor("Bärli Bär")).toContain("B%C3%A4rli%20B%C3%A4r");
    });

    it("is empty rather than broken without a name", () => {
        // Der Aufrufer blendet den Link dann aus; "https://x/" wäre ein Link ins
        // Nichts, den jemand anklickt.
        expect(armoryUrlFor("")).toBe("");
        expect(armoryUrlFor(null)).toBe("");
    });

    it("trims a name the way the rest of the app keys them", () => {
        expect(armoryUrlFor("  Devihra  ")).toBe(armoryUrlFor("Devihra"));
    });
});

describe("web/characters/charLinks je Spielversion (#543)", () => {
    it("verlinkt jeden Charakter mit den Einstellungen seiner Version - ohne Forever-Vorlage kein Link", () => {
        expect(armoryUrlFor("Devihra", "tbc")).toContain("Devihra");
        expect(armoryUrlFor("Devi Res", "forever")).toBe("");
        expect(wclUrlFor("Devi Res", "forever")).toBe("");
    });
});
