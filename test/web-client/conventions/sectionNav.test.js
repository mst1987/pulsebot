// Conventions of the Einstellungen page that a render cannot show: every
// per-category setting has one home (the category matrix), and explanations sit
// in tooltips instead of hint paragraphs, and the section chips only show where
// the main menu does not (on a wide screen the sections are the children of
// "Einstellungen" in the menu). What the sections, the chips, the menu's
// children and the save bar do is tested in src/web-client/src/lib/settingsSections.test.ts,
// components/SectionNav.test.tsx, components/Shell.test.tsx and
// pages/settings/SettingsPage.sections.test.tsx; the areas of Historie & Loot in
// pages/history/HistoryPage.areas.test.tsx.
const fs = require("fs");
const path = require("path");
const { read } = require("../clientSource");

const CLIENT = path.join(__dirname, "..", "..", "..", "src", "web-client", "src");
const readClient = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");

const settingsSrc = readClient("pages", "settings", "SettingsPage.tsx");

/** The CSS without comments, and the body of each `@media (max-width: <px>px)` block in it. */
function cssParts(source) {
    const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
    const blocks = {};
    let outside = "";
    let at = 0;
    for (;;) {
        const head = css.indexOf("@media", at);
        if (head < 0) { outside += css.slice(at); break; }
        outside += css.slice(at, head);
        const open = css.indexOf("{", head);
        let depth = 1, i = open + 1;
        while (depth && i < css.length) {
            if (css[i] === "{") depth++;
            else if (css[i] === "}") depth--;
            i++;
        }
        const query = css.slice(head, open).trim();
        blocks[query] = (blocks[query] || "") + css.slice(open + 1, i - 1);
        at = i;
    }
    return { outside, blocks };
}

describe("the section chips and the main menu", () => {
    it("hides the chips on a wide screen and shows them where the menu is a drawer", () => {
        const settings = cssParts(readClient("styles", "settings.css"));
        expect(settings.outside).toMatch(/\.settings-layout > \.section-nav \{ display: none; \}/);
        expect(settings.blocks["@media (max-width: 900px)"]).toMatch(/\.settings-layout > \.section-nav \{ display: flex; \}/);
        // the same breakpoint at which the shell's sidebar turns into the drawer
        const shell = cssParts(readClient("styles", "shared.css"));
        expect(shell.blocks["@media (max-width: 900px)"]).toMatch(/\.side \{[^}]*position: fixed/);
        // no own column left: the open section takes the whole width
        expect(settings.outside).toMatch(/\.settings-layout \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
    });

    it("keeps the page reachable on every route of the menu's section links", () => {
        // the menu links ?section=<id>; the page reads that param and remembers it
        expect(settingsSrc).toMatch(/usePersistedSearchParam\(\s*"settings-section", "section", "berechtigungen", SECTION_PARAM_IDS, true,/);
        expect(read("components/Shell.tsx")).toContain("href: `/settings?section=${s.id}`");
    });
});

describe("page width", () => {
    it("gives every page the same wide content column, without a per-page override", () => {
        const css = read("index.css").replace(/\/\*[\s\S]*?\*\//g, "");
        expect(css).toMatch(/\.content \{[^}]*max-width: 1440px/);
        expect(css).not.toMatch(/\.content:has\(/);
    });
});

describe("Einstellungen conventions", () => {
    it("configures each per-category setting in exactly one place", () => {
        // the list and its open card (CategoryDetail.tsx) together
        const matrix = readClient("pages", "settings", "CategoryMatrix.tsx") + readClient("pages", "settings", "CategoryDetail.tsx");
        for (const prop of ["categoryRoles", "categoryLootTool", "categorySheets"]) {
            expect(matrix).toContain(prop);
            const renderedElsewhere = settingsSrc.includes(`value={draft.${prop}}`);
            expect({ prop, renderedElsewhere }).toEqual({ prop, renderedElsewhere: false });
        }
        // Raider → Charakter is no longer a section with its own category picker.
        expect(settingsSrc).not.toContain("RaiderCharactersTab");
        expect(matrix).toContain("<RaiderCharactersModal");
    });

    it("turns the hint paragraphs into tooltips", () => {
        const files = {
            "SettingsPage.tsx": settingsSrc,
            "RolePermissions.tsx": readClient("pages", "settings", "RolePermissions.tsx"),
            "CategoryMatrix.tsx": readClient("pages", "settings", "CategoryMatrix.tsx"),
            "CategoryDetail.tsx": readClient("pages", "settings", "CategoryDetail.tsx"),
        };
        for (const [name, src] of Object.entries(files)) {
            expect({ name, hint: src.includes("className=\"hint\""), note: src.includes("<p className=\"note\">") })
                .toEqual({ name, hint: false, note: false });
        }
    });
});
