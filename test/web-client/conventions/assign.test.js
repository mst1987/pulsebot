// The wiring of the assignments in the pages and their catalog texts; the logic of lib/raidplan/assign.ts is tested in
// src/web-client/src/lib/assign.test.ts.
const fs = require("fs");
const path = require("path");
const { readWorkspace } = require("../clientSource");

describe("wiring and texts", () => {
    const root = path.join(__dirname, "../../../src/web-client/src");
    const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
    it("the workspace shows the panel right at the board, the read view the table", () => {
        expect(readWorkspace()).toContain("<AssignPanel");
        // the stage's "Alle Aufgaben" (Oct 2026)
        expect(read("pages/raid-detail/raidplan/stage/TasksPanel.tsx")).toContain("<ReadTables");
        expect(read("pages/PlanPublicPage.tsx")).not.toContain("ByPlayerLog");
        expect(read("components/raidplan/PlanBoard.tsx")).toContain("rp-links");
    });
});

describe("the lines of the rows on the board (#507)", () => {
    const root = path.join(__dirname, "../../../src/web-client/src");
    const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
    const css = read("styles/raidplan/assign.css") + read("styles/raidplan/layout.css");
    const tokens = read("styles/tokens.css");
    const lineTypes = JSON.parse(read("lib/raidplan/assign.ts").match(/export const LINE_TYPES = (\[[^\]]*\]);/)[1]);
    const rules = css.split("}").filter((r) => r.indexOf(".rp-links") >= 0);
    it("every row type has a class that points at a colour variable defined in tokens.css", () => {
        expect(lineTypes).toEqual(expect.arrayContaining(["heal", "tank", "kick"]));
        for (const type of lineTypes) {
            const rule = type === "other" ? rules.find((r) => r.indexOf(".rp-links line {") >= 0) : rules.find((r) => r.indexOf(`.rp-link--${type} `) >= 0 || r.indexOf(`.rp-link--${type},`) >= 0);
            expect(rule).toBeDefined();
            const name = rule.match(/--lc: var\((--rp-line-[a-z]+)\)/)[1];
            expect(tokens).toMatch(new RegExp(`${name}: #[0-9a-f]{6};`));
        }
        expect(tokens).toMatch(/--rp-line-heal: #22c55e;/);
        expect(tokens).toMatch(/--rp-line-tank: #ef4444;/);
    });
    it("nothing hides the lines: they take their stroke from the type, never display: none, visibility: hidden or opacity 0", () => {
        expect(rules.join("}")).toMatch(/\.rp-links line \{[^}]*stroke: var\(--lc\)/);
        for (const r of rules) {
            expect(r).not.toMatch(/display:\s*none|visibility:\s*hidden|opacity:\s*0\s*;|opacity:\s*0?\.0\d*\s*;|!important/);
        }
        expect(read("components/raidplan/PlanBoard.tsx")).toContain("linkClass(k.type)");
        expect(read("components/raidplan/PlanBoard.tsx")).not.toContain("stroke={k.color}");
    });
});

describe("mobs and spells of the catalog", () => {
    it("has the catalog texts in both languages", () => {
        const root = path.join(__dirname, "../../../src/web-client/src/i18n/locales");
        for (const lang of ["de", "en"]) {
            const d = JSON.parse(fs.readFileSync(path.join(root, lang, "catalog.json"), "utf8"));
            for (const k of ["title", "intro", "newMob", "newSpell", "hide", "delete", "restore", "reset"]) expect(typeof d[k]).toBe("string");
            for (const k of ["default", "override", "custom", "hidden"]) expect(typeof d.source[k]).toBe("string");
            for (const k of ["boss", "add", "trash", "other"]) expect(typeof d.kind[k]).toBe("string");
            const b = JSON.parse(fs.readFileSync(path.join(root, lang, "raidBoard.json"), "utf8"));
            for (const k of ["title", "tip", "ofBoss", "ofInstance", "all", "add", "onMap"]) expect(typeof b.mobs[k]).toBe("string");
        }
    });
});
