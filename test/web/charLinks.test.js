// Die Links nach draußen. Nichts gemockt: was zählt, ist die Vorlage aus
// config/variables.js und dass ein Name darin sicher landet.
const { fillCharTemplate, armoryUrlFor, wclUrlFor } = require("../../src/web/charLinks");

describe("web/charLinks", () => {
    it("builds an armory and a WCL link for a character", () => {
        expect(armoryUrlFor("Devihra")).toContain("Devihra");
        expect(armoryUrlFor("Devihra")).toMatch(/^https:\/\//);
        expect(wclUrlFor("Devihra")).toContain("Devihra");
    });

    it("escapes a name instead of pasting it into the URL", () => {
        // Ein Name mit Umlaut oder Leerzeichen darf den Link nicht zerlegen.
        expect(fillCharTemplate("https://x/{char}", "Bärli Bär")).toBe("https://x/B%C3%A4rli%20B%C3%A4r");
    });

    it("is empty rather than broken without a name or a template", () => {
        // Der Aufrufer blendet den Link dann aus; "https://x/" wäre ein Link ins
        // Nichts, den jemand anklickt.
        expect(fillCharTemplate("https://x/{char}", "")).toBe("");
        expect(fillCharTemplate("", "Devihra")).toBe("");
        expect(armoryUrlFor("")).toBe("");
        expect(armoryUrlFor(null)).toBe("");
    });

    it("trims a name the way the rest of the app keys them", () => {
        expect(fillCharTemplate("https://x/{char}", "  Devihra  ")).toBe("https://x/Devihra");
    });
});
