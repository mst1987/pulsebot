// The structure of the row dialog (AssignModal.tsx) and the row container (AssignLine.tsx) and their texts; the logic of
// lib/raidplan/assignModal.ts and lib/raidplan/assignLine.ts is tested in src/web-client/src/lib/assignModal.test.ts.
const fs = require("fs");
const path = require("path");

describe("structure and texts", () => {
    const dir = path.join(__dirname, "../../../src/web-client/src/pages/raid-detail/raidplan");
    const modal = fs.readFileSync(path.join(dir, "AssignModal.tsx"), "utf8");
    const line = fs.readFileSync(path.join(dir, "AssignLine.tsx"), "utf8");
    const panel = fs.readFileSync(path.join(dir, "AssignPanel.tsx"), "utf8");
    const read = fs.readFileSync(path.join(dir, "ReadTables.tsx"), "utf8");
    it("the dialog: a tablist for the bar and the categories, chips as pressed buttons, remove / cancel / done, no scroll container", () => {
        expect(modal).toContain("role=\"tablist\" aria-label={t(\"raidBoard.amb.bar\")}");
        expect(modal).toContain("aria-orientation=\"vertical\"");
        expect(modal).toContain("aria-pressed={on}");
        expect(modal).toContain("raidBoard.amb.removeRow");
        expect(modal).toContain("className=\"rp-amb dlg-flush dlg-sheet\"");
        expect(modal).not.toMatch(/overflow(-y)?:\s*(auto|scroll)/);
    });
    it("the row: one stretched button opens the dialog, chips without + / x, Delete asks first; the panel and the sheet use it", () => {
        expect(line).toContain("rp-line-open");
        expect(line).not.toContain("rp-achip-x");
        expect(line).not.toContain("rp-achip-add");
        expect(line).toMatch(/e\.key === "Delete"/);
        expect(panel).toContain("<AssignLine");
        expect(panel).not.toContain("function AssignRow");
        expect(read).toContain("<AssignLine key={a.id} a={a} filled={a} ctx={ctx} isEvent readOnly me={me} />");
    });
    it("has every text in German and English", () => {
        const de = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../src/web-client/src/i18n/locales/de/raidBoard.json"), "utf8"));
        const en = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../src/web-client/src/i18n/locales/en/raidBoard.json"), "utf8"));
        const keys = (o, p = "") => Object.keys(o).flatMap((k) => (typeof o[k] === "object" ? keys(o[k], `${p}${k}.`) : [`${p}${k}`]));
        expect(keys(de.amb).sort()).toEqual(keys(en.amb).sort());
        expect(keys(de.aline).sort()).toEqual(keys(en.aline).sort());
        expect(de.line.arrow).toBeTruthy();
    });
});
