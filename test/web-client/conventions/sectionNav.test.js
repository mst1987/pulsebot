// Conventions of the pages with sub sections that a render cannot show: the
// icon rail (components/ui/SectionRail.tsx) turns into the chip row exactly where
// the main menu becomes the drawer, it stands outside the page's width budget,
// and the main menu folds nothing out any more (design "C · Schmale
// Icon-Leiste"). On the Einstellungen page every per-category setting has one
// home (the category matrix), and explanations sit in tooltips instead of hint
// paragraphs. What the rail, the sections and the save bar do is tested in
// src/web-client/src/components/ui/SectionRail.test.tsx, components/shell/Shell.test.tsx,
// lib/settingsSections.test.ts and pages/settings/SettingsPage.sections.test.tsx;
// the areas of Historie & Loot in pages/history/HistoryPage.areas.test.tsx.
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

describe("the section rail and the main menu", () => {
    const shell = cssParts(readClient("styles", "shared.css"));
    const narrow = shell.blocks["@media (max-width: 900px)"];

    it("is a 64px icon column on a wide screen and the chip row with labels where the menu is a drawer", () => {
        expect(shell.outside).toMatch(/\.srail-layout \{[^}]*grid-template-columns: 64px minmax\(0, 1fr\)/);
        expect(shell.outside).toMatch(/\.srail-item \{[^}]*width: 44px; height: 44px;/);
        expect(shell.outside).toMatch(/\.srail-label, \.srail-text \{ display: none; \}/);
        // the same breakpoint at which the shell's sidebar turns into the drawer
        expect(narrow).toMatch(/\.side \{[^}]*position: fixed/);
        expect(narrow).toMatch(/\.srail-layout \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
        expect(narrow).toMatch(/\.srail-list \{[^}]*flex-direction: row; flex-wrap: wrap;/);
        expect(narrow).toMatch(/\.srail-text \{ display: inline; \}/);
        expect(narrow).toMatch(/\.srail-label \{ display: block;/);
    });

    it("stands outside the page's width budget: it reaches into the content's padding, never into --page-narrow", () => {
        expect(shell.outside).toMatch(/\.content \{ padding: 24px;/);
        expect(shell.outside).toMatch(/\.srail-layout \{[^}]*margin-left: -24px;/);
        expect(narrow).toMatch(/\.srail-layout \{[^}]*margin-left: 0;/);
        const capped = shell.outside.match(/([^{}]*)\{\s*max-width: var\(--page-narrow\);\s*\}/)[1];
        expect(capped).not.toMatch(/srail/);
    });

    it("leaves the main menu flat: no children, no chevron, no remembered groups", () => {
        const shellSrc = read("components/shell/Shell.tsx");
        for (const gone of ["nav-kid", "nav-chev", "menu-groups", "?section=", "settingsNav"]) {
            expect({ gone, found: shellSrc.includes(gone) }).toEqual({ gone, found: false });
        }
        expect(read("index.css")).not.toMatch(/\.nav-(kid|chev|kids|node|row)\b/);
    });

    it("switches the settings section inside the page and keeps ?section= links working", () => {
        // a hint elsewhere links ?section=<id>; the page reads that param and remembers it
        expect(settingsSrc).toMatch(/usePersistedSearchParam\(\s*"settings-section", "section", "berechtigungen", SECTION_PARAM_IDS, true,/);
        expect(settingsSrc).toContain("<SectionRail groups={navGroups} active={active} onSelect={setSection}");
    });

    it("puts the rail on the raid list and the raid plan's list pages, not on the raid detail or the plan editor", () => {
        for (const page of ["pages/raids/RaidsPage.tsx", "pages/raidplan/RaidplanTemplatesPage.tsx", "pages/raidplan/RaidplanCatalogPage.tsx"]) {
            expect({ page, rail: read(page).includes("<MenuRailPage user={user} parent=\"raids\">") }).toEqual({ page, rail: true });
        }
        expect(read("pages/raid-detail/RaidDetailPage.tsx")).not.toContain("SectionRail");
        // the template editor returns before the list is wrapped
        const tpl = read("pages/raidplan/RaidplanTemplatesPage.tsx");
        expect(tpl.indexOf("if (current) {")).toBeLessThan(tpl.indexOf("return inRail(\n"));
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

describe("the two page widths", () => {
    const shared = cssParts(readClient("styles", "shared.css")).outside;
    const narrow = shared.match(/([^{}]*)\{\s*max-width: var\(--page-narrow\);\s*\}/);

    it("caps .content at 1440px and defines the narrow width once", () => {
        expect(shared).toMatch(/\.content \{[^}]*max-width: 1440px/);
        expect(shared).toMatch(/:root \{ --page-narrow: 1200px; \}/);
        expect(shared.match(/--page-narrow:/g)).toHaveLength(1);
    });

    it("lists the sparse pages in one rule and keeps the dense ones out", () => {
        expect(narrow).not.toBeNull();
        const list = narrow[1];
        for (const root of [".ov-page", ".re-page", ".rt-page", ".sr-page", ".an-page", ".pf-page", ".rc-page", ".kn-page", ".la-page", ".hc-page"]) {
            expect(list).toContain(root);
        }
        for (const dense of [".kp-page", ".rd-page", ".rp-templates"]) expect(list).not.toContain(dense);
    });

    it("narrows the settings panel by its open section, except Berechtigungen and Kategorien", () => {
        const list = narrow[1];
        expect(list).toContain(".settings-panel:not([data-section=\"berechtigungen\"]):not([data-section=\"kategorien\"])");
        expect(settingsSrc).toContain("data-section={active}");
    });

    it("lets Historie & Loot join from its own file, which a convention keeps the hl- prefix in", () => {
        expect(readClient("styles", "historie-loot.css")).toContain(".hl-page, .hl-page ~ :not(dialog) { max-width: var(--page-narrow); }");
    });

    it("has no :has() special case and no other fixed page cap in the shared layer", () => {
        expect(shared).not.toMatch(/\.content:has\(/);
    });
});
