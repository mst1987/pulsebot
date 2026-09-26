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
        expect(read("pages/PlanPublicPage.tsx")).toContain("<ReadTables");
        expect(read("pages/PlanPublicPage.tsx")).not.toContain("ByPlayerLog");
        expect(read("components/raidplan/PlanBoard.tsx")).toContain("rp-links");
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
