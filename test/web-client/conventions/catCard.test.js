// Guards for Einstellungen → Kategorien (src/web-client/src/pages/settings/categories/CategoryMatrix.tsx
// and the .cat-* rules in src/web-client/src/styles/settings.css).
//
// The page used to show one card per Discord category — typically 13 of 17
// of them inactive — and kept the raider → character assignment in a separate
// section with its own category picker. What is protected here: the list with
// its tinted head, one row open at a time, the inactive categories folded away,
// unknown ids kept visible, and the assignment reachable from the row. The open
// card (CategoryDetail.tsx, design "A · Sechs Tabs, jede Einstellung eine Karte")
// sorts its settings into six tabs, one card each: name + one line | control,
// the full explanation behind the (i).
// The row logic itself (categoryRows / splitCategoryRows) runs in
// settingsLogic.test.js.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "..", "src", "web-client", "src");
const css = fs.readFileSync(path.join(CLIENT, "styles", "settings.css"), "utf8");
const matrix = fs.readFileSync(path.join(CLIENT, "pages", "settings", "categories", "CategoryMatrix.tsx"), "utf8");
const detail = fs.readFileSync(path.join(CLIENT, "pages", "settings", "categories", "CategoryDetail.tsx"), "utf8").replace(/\r\n/g, "\n");
const field = fs.readFileSync(path.join(CLIENT, "pages", "settings", "categories", "CategoryField.tsx"), "utf8");
const page = fs.readFileSync(path.join(CLIENT, "pages", "settings", "SettingsPage.tsx"), "utf8");
// The texts live in the dictionaries since #440; the source names their keys.
const de = require("../clientSource").dictionary("de");

function rule(selector) {
    const re = new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`);
    const m = css.match(re);
    if (!m) throw new Error(`no rule for ${selector}`);
    return m[1];
}

describe("Kategorien list", () => {
    it("is a list with a tinted head instead of a card per category", () => {
        expect(matrix).not.toContain("catcard");
        expect(matrix).toContain("className=\"cat-row cat-head\"");
        const head = rule(".cat-row.cat-head");
        expect(head).toContain("var(--panel2)");
        // design pilot C: a quiet sentence-case head, no mono capitals
        expect(head).not.toContain("text-transform: uppercase");
        // head and rows share one grid, so the columns line up
        expect(rule(".cat-row")).toContain("grid-template-columns:");
    });

    it("opens one row at a time with the shared expand button", () => {
        expect(matrix).toContain("const [openId, setOpenId] = useState(\"\");");
        expect(matrix).toContain("const isOpen = openId === cat.id && active;");
        expect(matrix).toContain("onToggle={() => setOpenId(isOpen ? \"\" : cat.id)}");
        expect(matrix).toMatch(/<Expand open=\{isOpen\}/);
    });

    it("folds the inactive categories under one line, and the part head switches to all of them", () => {
        expect(matrix).toContain("splitCategoryRows(rows, categoryIds, showAll)");
        expect(matrix).toContain("t(\"settings.categories.folded\", { count: folded.length })");
        expect(de["settings.categories.folded"].other).toContain("weitere Discord-Kategorien");
        expect(matrix).toContain("usePersistedState(\"settings-categories-all\", false)");
        expect(matrix).toContain("t(\"settings.categories.allOnes\", { count: rows.length })");
        expect(de["settings.categories.allOnes"]).toContain("Alle Discord-Kategorien");
    });

    it("keeps an unknown category id visible with a bad badge", () => {
        expect(matrix).toMatch(/\{cat\.unknown && !gone && !unprovenIds\.has\(cat\.id\) && \(\s*<Badge tone="bad"/);
        // #926: an id without a proven server reads as unclear, never as unknown or deleted
        expect(matrix).toMatch(/\{cat\.unknown && !gone && unprovenIds\.has\(cat\.id\) && \(\s*<Badge tone="mid"/);
        // #744: one Discord really deleted says so and offers to close it
        expect(matrix).toMatch(/\{cat\.unknown && gone && \(\s*<Badge tone="bad"/);
        expect(matrix).toContain("t(\"settings.categoryClose.action\")");
    });

    it("shows the per-category settings as badges in the row", () => {
        expect(matrix).toContain("<Badge tone=\"bad\" icon={<WarnIcon />}>{t(\"settings.categories.noRoles\")}</Badge>");
        expect(matrix).toContain("<Badge tone=\"mid\" icon={<WarnIcon />}>{t(\"settings.categories.missing\")}</Badge>");
        expect([de["settings.categories.noRoles"], de["settings.categories.missing"]]).toEqual(["keine", "fehlt"]);
        expect(matrix).toContain("icon=\"googleSheets\"");
        expect(matrix).toContain("{summary.assigned} / {summary.members}");
    });

    it("picks the loot addon with a segment and opens the character assignment for this category", () => {
        expect(detail).toMatch(/<Segment ariaLabel=\{t\("settings\.categories\.lootAddonAria"/);
        expect(detail).toContain("[\"gargul\", \"rclc\", \"\"].map((value) => ({ value, label: lootToolLabel(value) }))");
        expect(de["settings.lootTool.none"]).toBe("keins");
        expect(detail).toContain("icon=\"profile\"");
        expect(matrix).toContain("onAssign={() => setAssigning(cat)}");
        expect(matrix).toContain("categoryId={assigning.id}");
        const modal = fs.readFileSync(path.join(CLIENT, "pages", "settings", "categories", "RaiderCharactersModal.tsx"), "utf8");
        // the category is a prop now, never a second picker
        expect(modal).not.toContain("<select");
        expect(page).not.toContain("RaiderCharactersTab");
    });

    it("gives each setting a short line under its name and the full explanation behind the (i): name + line | control", () => {
        expect(matrix + detail).not.toContain("className=\"hint\"");
        for (const key of ["raiderRoles", "lootAddon", "fixedSheet", "newEvents", "notes", "planning"]) {
            expect(detail).toContain(`label={t("settings.categories.${key}")}`);
            expect(detail).toMatch(new RegExp(`sub=\\{t\\("settings\\.categories\\.${key}Short"\\)\\} more=\\{t\\("settings\\.categories\\.${key}Sub"\\)\\}`));
            expect(de[`settings.categories.${key}Short`]).toBeTruthy();
        }
        expect(detail).toContain("label={t(\"settings.categories.chars\")} sub={t(\"settings.categories.charsShort\")} more={t(\"settings.categories.charsDetailSub\")}");
        expect(de["settings.categories.chars"]).toBe("Raider → Charakter");
        expect(field).toContain("<div className=\"cat-field-sub\">{sub}</div>");
        // the (i) is the shared tooltip, never the browser's title
        expect(field).toContain("tip={label} tipSub={more}");
        expect(field).not.toContain("title=");
        expect(rule(".cat-field")).toContain("grid-template-columns: minmax(180px, 260px) minmax(0, 1fr)");
        // below 760 px the three columns stack
        expect(css).toMatch(/@media \(max-width: 760px\) \{[^@]*\.cat-field \{ grid-template-columns: minmax\(0, 1fr\);/);
    });

    it("sorts the open card's settings into six real tabs, each opened by a line on what it covers", () => {
        const logic = fs.readFileSync(path.join(CLIENT, "lib", "settings", "settingsLogic.ts"), "utf8");
        expect(logic).toContain("export const CATEGORY_TABS = [\"raider\", \"events\", \"message\", \"hubs\", \"plan\", \"loot\"] as const;");
        expect(detail).toContain("<p className=\"cat-tab-intro\">{t(`settings.categories.tabsIntro.${shown}`)}</p>");
        for (const id of ["raider", "events", "message", "hubs", "plan", "loot"]) {
            expect(de[`settings.categories.tabs.${id}`]).toBeTruthy();
            expect(de[`settings.categories.tabsIntro.${id}`]).toBeTruthy();
        }
        // the three attendance settings share one card, the quota is a stepper, never fixed choices
        expect(detail).toContain("<div className=\"cat-subfields\">");
        expect(detail).not.toContain("ATTENDANCE_WINDOWS");
        expect(detail).toContain("<QuotaStepper ");
        expect(detail).toContain("role=\"tablist\"");
        expect(detail).toContain("role=\"tab\"");
        expect(detail).toContain("role=\"tabpanel\"");
        expect(detail).toContain("onKeyDown={onKey}");
        expect(matrix).toContain("usePersistedState<Record<string, CategoryTab>>(\"settings-category-tabs\", {})");
        expect(rule(".cat-tab.is-active")).toContain("border-bottom-color: var(--accent)");
        expect([de["settings.categories.tabs.raider"], de["settings.categories.tabs.hubs"], de["settings.categories.tabs.plan"]]).toEqual(["Raider", "Discord-Zentralen", "Setup & Planung"]);
    });

    it("spaces the list from the stylesheet, never inline", () => {
        expect(matrix + detail + field).not.toContain("style={{");
        // every setting its own card, spaced apart by the panel's gap
        expect(rule(".cat-field-wrap")).toContain("border: 1px solid var(--line)");
        expect(rule(".cat-field-wrap")).toContain("border-radius: 12px");
        expect(rule(".cat-tabpanel")).toContain("gap: 10px");
    });

    it("picks the message channel at the message segment, hidden for \"keine\" and while no channels load (#335)", () => {
        const block = detail.slice(detail.indexOf("function notesField("), detail.indexOf("function messageFields("));
        expect(block).toContain("options={noteModes()}");
        expect(block).toContain("const mode = signupNoteMode(s.categorySignupNotes, cat.id);");
        expect(block).toContain("mode !== \"none\"");
        expect(block).toContain("noteChannels.channels.length > 0");
        expect(block).toContain("<option value=\"\">{pick.defaultLabel}</option>");
        // an own channel out of reach stays selected and is marked, never silently dropped
        expect(block).toContain("{pick.unreachable && <option value={own}>");
        expect(block).toMatch(/\{pick\.unreachable && <Badge tone="bad"[^>]*>\{t\("settings\.categories\.unreachable"\)\}<\/Badge>\}/);
        expect(de["settings.categories.unreachable"]).toBe("nicht erreichbar");
        expect(rule(".cat-note-channel")).toContain("display: flex");
        expect(page).toContain("noteChannels={data.noteChannels}");
        expect(page).toContain("categorySignupNoteChannel: draft.categorySignupNoteChannel,");
    });
});
