// The tactic components are wired and have their texts; the logic of lib/raidplan/steps.ts is tested in
// src/web-client/src/lib/steps.test.ts.
const fs = require("fs");
const path = require("path");

describe("structure and texts", () => {
    const dir = path.join(__dirname, "../../../src/web-client/src/pages/raid-detail/raidplan");
    const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");
    it("the card, the dialog, the library and the sheet are wired", () => {
        expect(read("BoardWorkspace.tsx")).toContain("<StepsCard");
        expect(read("StepsCard.tsx")).toMatch(/e\.altKey && \(e\.key === "ArrowUp"/);
        expect(read("StepModal.tsx")).toContain("role=\"combobox\"");
        expect(read("StepModal.tsx")).toContain("className=\"rp-stm dlg-flush dlg-sheet\"");
        expect(read("ProfileModals.tsx")).toContain("export function LibraryModal");
        expect(fs.readFileSync(path.join(__dirname, "../../../src/web-client/src/pages/PlanPublicPage.tsx"), "utf8")).toContain("<ReadSteps");
    });
    it("has every text in German and English", () => {
        const load = (l) => JSON.parse(fs.readFileSync(path.join(__dirname, `../../../src/web-client/src/i18n/locales/${l}/raidBoard.json`), "utf8")).steps;
        const keys = (o, p = "") => Object.keys(o).flatMap((k) => (typeof o[k] === "object" ? keys(o[k], `${p}${k}.`) : [`${p}${k}`]));
        expect(keys(load("de")).sort()).toEqual(keys(load("en")).sort());
    });
});
