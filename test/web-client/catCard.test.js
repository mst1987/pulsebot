// Guards for Einstellungen → Kategorien (src/web-client/src/components/CategoryMatrix.tsx
// and the .cat-* rules in src/web-client/src/styles/einstellungen.css).
//
// The page used to show one card per Discord category — typically 13 of 17
// of them inactive — and kept the raider → character assignment in a separate
// section with its own category picker. What is protected here: the list with
// its tinted head, one row open at a time, the inactive categories folded away,
// unknown ids kept visible, and the assignment reachable from the row.
// The row logic itself (categoryRows / splitCategoryRows) runs in
// settingsLogic.test.js.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const css = fs.readFileSync(path.join(CLIENT, "styles", "einstellungen.css"), "utf8");
const matrix = fs.readFileSync(path.join(CLIENT, "components", "CategoryMatrix.tsx"), "utf8");
const page = fs.readFileSync(path.join(CLIENT, "pages", "SettingsPage.tsx"), "utf8");

function rule(selector) {
    const re = new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`);
    const m = css.match(re);
    if (!m) throw new Error(`no rule for ${selector}`);
    return m[1];
}

describe("Kategorien list", () => {
    it("is a list with a tinted mono head instead of a card per category", () => {
        expect(matrix).not.toContain("catcard");
        expect(matrix).toContain('className="cat-row cat-head"');
        const head = rule(".cat-row.cat-head");
        expect(head).toContain("var(--panel2)");
        expect(head).toContain("var(--font-mono)");
        expect(head).toContain("text-transform: uppercase");
        // head and rows share one grid, so the columns line up
        expect(rule(".cat-row")).toContain("grid-template-columns:");
    });

    it("opens one row at a time with the shared expand button", () => {
        expect(matrix).toContain('const [openId, setOpenId] = useState("");');
        expect(matrix).toContain("const isOpen = openId === cat.id && active;");
        expect(matrix).toContain('onToggle={() => setOpenId(isOpen ? "" : cat.id)}');
        expect(matrix).toMatch(/<Expand open=\{isOpen\}/);
    });

    it("folds the inactive categories under one line, and the part head switches to all of them", () => {
        expect(matrix).toContain("splitCategoryRows(rows, categoryIds, showAll)");
        expect(matrix).toContain("weitere Discord-");
        expect(matrix).toContain('usePersistedState("settings-categories-all", false)');
        expect(matrix).toContain("Alle Discord-Kategorien");
    });

    it("keeps an unknown category id visible with a bad badge", () => {
        expect(matrix).toMatch(/\{cat\.unknown && \(\s*<Badge tone="bad"/);
    });

    it("shows the per-category settings as badges in the row", () => {
        expect(matrix).toContain('<Badge tone="bad" icon={<WarnIcon />}>keine</Badge>');
        expect(matrix).toContain('<Badge tone="mid" icon={<WarnIcon />}>fehlt</Badge>');
        expect(matrix).toContain('icon="inv_scroll_03"');
        expect(matrix).toContain("{summary.assigned} / {summary.members}");
    });

    it("picks the loot addon with a segment and opens the character assignment for this category", () => {
        expect(matrix).toMatch(/<Segment ariaLabel=\{`Loot-Addon/);
        expect(matrix).toContain('{ value: "", label: "keins" }');
        expect(matrix).toContain('icon="ability_rogue_disguise"');
        expect(matrix).toContain("categoryId={assigning.id}");
        const modal = fs.readFileSync(path.join(CLIENT, "components", "RaiderCharactersModal.tsx"), "utf8");
        // the category is a prop now, never a second picker
        expect(modal).not.toContain("<select");
        expect(page).not.toContain("RaiderCharactersTab");
    });

    it("moves the hints into tooltips at the field names", () => {
        expect(matrix).not.toContain('className="hint"');
        for (const tip of ['tip="Raider-Rollen"', 'tip="Loot-Addon"', 'tip="Festes Raidsheet"', 'tip="Raider → Charakter"']) {
            expect(matrix).toContain(tip);
        }
    });

    it("spaces the list from the stylesheet, never inline", () => {
        expect(matrix).not.toContain("style={{");
        expect(rule(".cat-detail")).toContain("gap: 22px");
    });

    it("picks the message channel at the message segment, hidden for \"keine\" and while no channels load (#335)", () => {
        const block = matrix.slice(matrix.indexOf("{onSignupNotes && ("), matrix.indexOf("{onDiscordEvent && ("));
        expect(block).toContain('options={NOTE_MODES}');
        expect(block).toContain('signupNoteMode(categorySignupNotes, cat.id) !== "none"');
        expect(block).toContain("noteChannels.channels.length > 0");
        expect(block).toContain('<option value="">{pick.defaultLabel}</option>');
        // an own channel out of reach stays selected and is marked, never silently dropped
        expect(block).toContain("{pick.unreachable && <option value={own}>");
        expect(block).toMatch(/\{pick\.unreachable && <Badge tone="bad"[^>]*>nicht erreichbar<\/Badge>\}/);
        expect(rule(".cat-note-channel")).toContain("display: flex");
        expect(page).toContain("noteChannels={data.noteChannels}");
        expect(page).toContain("categorySignupNoteChannel: draft.categorySignupNoteChannel,");
    });
});
