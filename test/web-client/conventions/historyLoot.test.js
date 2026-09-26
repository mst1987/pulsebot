// Guards for the redesigned "Historie & Loot" module (design issue #225).
//
// No React renderer here, so what is checked are the source invariants the
// design rests on and that would regress silently:
//   * no native title= tooltips and no window.confirm in the loot components,
//   * no hover panels left where the item dialog took over,
//   * the import is a dialog that keeps its draft and shows a preview,
//   * the addon inbox is its own page with the cards and the linked list,
//   * the shared building blocks are used, the module CSS is its own file.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8");

const MODULE_FILES = [
    "pages/HistoryPage.tsx",
    "pages/HistoryEventPage.tsx",
    "pages/HistoryInboxPage.tsx",
    "components/LatestLootTab.tsx",
    "components/LootItemsTab.tsx",
    "components/LootReasonsTab.tsx",
    "components/LootInboxTab.tsx",
    "components/LootBadges.tsx",
    "components/LootTable.tsx",
    "components/LootFilters.tsx",
    "components/ItemAwardsDialog.tsx",
    "components/ImportLootDialog.tsx",
    "components/ManualLootForm.tsx",
];
const src = Object.fromEntries(MODULE_FILES.map((f) => [f, read(...f.split("/"))]));

describe("Historie & Loot module", () => {
    it("uses the tooltip box, never a native title, and never window.confirm", () => {
        for (const [file, code] of Object.entries(src)) {
            // on an HTML element; a component's own `title` prop (Modal) is not the native box
            expect({ file, title: /<[a-z][\w-]*\s[^<>]*?\btitle=["{]/.test(code) }).toEqual({ file, title: false });
            expect({ file, confirm: /window\.confirm|(^|[^\w.])confirm\(/.test(code) }).toEqual({ file, confirm: false });
        }
    });

    it("opens every award of an item in one dialog instead of a hover panel per recipient", () => {
        for (const file of ["components/LootItemsTab.tsx", "components/LootReasonsTab.tsx", "components/LootBadges.tsx"]) {
            expect({ file, hover: src[file].includes("HoverPanel") }).toEqual({ file, hover: false });
        }
        expect(src["components/LootItemsTab.tsx"]).toContain("<ItemAwardsDialog");
        expect(src["components/LootReasonsTab.tsx"]).toContain("<RaiderReasonDialog");
        // the whole row opens it, and a square icon button does too
        expect(src["components/LootItemsTab.tsx"]).toMatch(/className="hl-grid items hl-row"[\s\S]*?onClick=\{open\}/);
        expect(src["components/LootItemsTab.tsx"]).toContain("tip=\"Details\"");
    });

    it("deletes a single award from the dialog only with write access and behind the confirm dialog", () => {
        const dlg = src["components/ItemAwardsDialog.tsx"];
        expect(dlg).toContain("const ask = useConfirm();");
        expect(dlg.match(/if \(!\(await ask\(\{ title: /g)).toHaveLength(1);
        expect(dlg).toContain("deleteLootItems([awardId])");
        expect(dlg).toMatch(/\{canEdit && a\.id\s*\?/);
        expect(src["pages/HistoryPage.tsx"]).toContain("canEdit={canWrite}");
    });

    it("draws reasons as a stacked bar in the reason colours and counts as WCL bars", () => {
        expect(src["components/LootBadges.tsx"]).toContain("export function StackBar(");
        expect(src["components/LootBadges.tsx"]).toContain("`var(--reason-${tone})`");
        for (const file of ["components/LootItemsTab.tsx", "components/LootReasonsTab.tsx"]) {
            expect(src[file]).toContain("<StackBar");
            expect(src[file]).toContain("<Bar ");
        }
    });

    it("names the raid by boss icon and label instead of the Content/Boss columns", () => {
        const items = src["components/LootItemsTab.tsx"];
        expect(items).not.toMatch(/label="Content"|label="Boss"/);
        expect(items).toContain("contentIcon(it.contentId)");
        expect(items).not.toContain("Hover zeigt");
    });

    it("keeps the rare filters behind one Filter button and lists them as removable badges", () => {
        const items = src["components/LootItemsTab.tsx"];
        expect(items).toContain("<RaidChips");
        expect(items).toContain("<FilterPopover");
        expect(items).toContain("<ActiveFilters");
        // removable through the shared Badge (ui/Badge onRemove, #439)
        expect(src["components/LootFilters.tsx"]).toContain("onRemove={f.onRemove} removeLabel={`Filter „${f.label}\" entfernen`}");
    });

    it("imports in a dialog that keeps the draft and previews before saving", () => {
        const dlg = src["components/ImportLootDialog.tsx"];
        expect(dlg).toContain("useDraftState<ImportDraft>(\"history-import\", IMPORT_DRAFT_DEFAULT)");
        expect(dlg).toContain("previewLootImport({ data: text, tool, event: eventId })");
        expect(dlg).toContain("importLoot({ data: text, tool, event: eventId, manualLabel, categoryId })");
        // the six help paragraphs went into tooltips
        expect(dlg).not.toContain("className=\"hint\"");
        expect(src["pages/HistoryPage.tsx"]).not.toContain("function ImportForm(");
    });

    it("routes the addon inbox to its own page with cards and the linked list", () => {
        const page = src["pages/HistoryInboxPage.tsx"];
        expect(page).toContain("<InboxSessionCard");
        expect(page).toContain("<LinkedSessions linked={linked} />");
        expect(read("App.tsx")).toContain("<Route path=\"history/inbox\" element={<Guard user={user} areas={[\"history\"]}><HistoryInboxPage /></Guard>} />");
        const card = src["components/LootInboxTab.tsx"];
        // no "btn ghost" typo class, no star option, dismiss behind the dialog
        expect(card).not.toContain("className=\"btn ghost\"");
        expect(card).not.toContain("★");
        expect(card.match(/if \(!\(await ask\(\{ title: /g)).toHaveLength(1);
        // an ambiguous day preselects nothing
        expect(card).toContain("useState(match?.ambiguous ? \"\" : (match?.suggested?.eventId || \"\"))");
    });

    it("builds on the shared UI blocks and keeps its CSS in the module file", () => {
        expect(src["pages/HistoryPage.tsx"]).toContain("<PageHead");
        expect(src["pages/HistoryPage.tsx"]).toContain("<Segment<AreaId>");
        for (const file of ["pages/HistoryPage.tsx", "pages/HistoryEventPage.tsx", "pages/HistoryInboxPage.tsx"]) {
            expect(src[file]).toContain("import \"../styles/historie-loot.css\";");
        }
        expect(fs.existsSync(path.join(CLIENT, "styles", "historie-loot.css"))).toBe(true);
        expect(read("index.css")).not.toContain(".hl-");
    });

    // The Raids view used to stack both lists with the coming raids on top —
    // the list nobody opens this page for above the one they do.
    it("opens the Raids view on the past raids and switches to the coming ones", () => {
        const page = src["pages/HistoryPage.tsx"].replace(/\r\n/g, "\n");
        expect(page).toContain("usePersistedState<RaidWhen>(\"history-raids-when\", \"past\")");
        expect(page).toContain("<Segment<RaidWhen>");
        const view = page.match(/\{tab === "raids" && \(\n[\s\S]*?\n {12}\)\}/)[0];
        expect((view.match(/<RaidTable/g) || []).length).toBe(2);
        expect(view).toContain("raidWhen === \"past\"");
        // One card with one table at a time, not two cards under each other.
        expect((view.match(/dash-card hl-card/g) || []).length).toBe(1);
        expect((view.match(/<PartHead/g) || []).length).toBe(1);
    });

    // Every search on this page is the module's own field (icon, tokens, focus
    // ring). The Charaktere view held the one bare <input> that was left, and
    // it wore the browser's own look next to controls that did not.
    it("searches with the module's own field, never a bare input", () => {
        const page = src["pages/HistoryPage.tsx"].replace(/\r\n/g, "\n");
        expect(page).toContain("<SearchBox id=\"chars-search\"");
        expect(page).toContain("import { SearchBox } from \"../components/LootFilters\";");
        for (const [file, code] of Object.entries(src)) {
            // the box itself is where that one input belongs
            if (file === "components/LootFilters.tsx") continue;
            expect({ file, bare: /<input[^>]*type="search"/.test(code) }).toEqual({ file, bare: false });
        }
    });

    it("checks only verified WoW icon names for the raids", () => {
        const icons = src["components/LootBadges.tsx"].match(/export const CONTENT_ICONS[\s\S]*?\};/)[0];
        // Archimonde exists only with the trailing dash; Prince with the underscore.
        expect(icons).toContain("hyjal: \"achievement_boss_archimonde-\"");
        expect(icons).toContain("kara: \"achievement_boss_prince_malchezaar\"");
    });
});
