// The raid plan pages checked on their source: the editor, the texts, the new
// pages, the template overview, the read-only sheet and the section bar.
// The pages' structure is checked on the source here; the logic parts (raid mark
// icons, placeholders, section labels) run in Vitest (src/web-client/src/lib/raidplan.pages.test.ts).
const fs = require("fs");
const path = require("path");
const { read, stripComments, dictionary } = require("../clientSource");

describe("the pages", () => {
    const tab = read("pages/raid-detail/RaidplanTab.tsx");
    const work = read("pages/raid-detail/raidplan/BoardWorkspace.tsx");
    const tpl = read("pages/RaidplanTemplatesPage.tsx");
    const board2 = read("components/raidplan/PlanBoard.tsx");
    const detail = read("pages/RaidDetailPage.tsx");
    const app = read("App.tsx");
    const pub = read("pages/PlanPublicPage.tsx");
    const css = read("styles/raidplan.css");
    const menu = read("pages/raid-detail/raidplan/ContextMenu.tsx");
    const insp = read("pages/raid-detail/raidplan/Inspector.tsx");

    it("is a tab of an own event, and of a Raid-Helper event whose plan is switched on; after the setup", () => {
        expect(detail).toMatch(/const TABS: Tab\[\] = \["roster", "setup", "plan", "loot", "logs"\];/);
        expect(detail).toContain("const hasPlan = ownEvent || !!data.event.raidplanEnabled;");
        expect(detail).toContain("t === \"plan\" ? hasPlan");
        expect(detail).toContain("{shown === \"plan\" && <Suspense fallback={<RaidLoader />}><RaidplanTab ctx={ctx} /></Suspense>}");
        // the editor is a chunk of its own, loaded only when the tab is opened (#436)
        expect(detail).toContain("const RaidplanTab = lazy(() => import(\"./raid-detail/RaidplanTab\"));");
    });

    it("drags with Pointer Events on window, never with HTML5 drag and drop", () => {
        const src = stripComments(tab + work + board2);
        expect(src).toContain("window.addEventListener(\"pointermove\"");
        expect(src).toContain("window.addEventListener(\"pointerup\"");
        expect(src).toContain("window.addEventListener(\"pointercancel\"");
        for (const banned of ["onDragStart", "onDrop", "onDragOver", "draggable={true}", "dataTransfer"]) expect(src).not.toContain(banned);
        expect(css).toMatch(/\.rp-token\.is-editable \.rp-token-btn \{[^}]*touch-action: none/);
        expect(css).toMatch(/\.rp-zone\.is-editable \{[^}]*touch-action: none/);
        expect(css).toMatch(/\.rp-handle \{[^}]*touch-action: none/);
        expect(css).toMatch(/\.rp-pal-item \{[^}]*touch-action: none/);
        expect(css).toMatch(/\.rp-text\.is-editable \{[^}]*touch-action: none/);
    });

    it("sends the version it read, treats a conflict as a hint and writes nothing before Save", () => {
        expect(tab).toContain("version: view.plan.version");
        expect(tab).toContain("e.code === \"conflict\"");
        expect(tab).toContain("raidBoard.conflict.text");
        expect(tab.match(/saveRaidplan\(/g)).toHaveLength(1);
    });

    it("draws players with their spec icon in a role ring, not with hand-drawn circles", () => {
        expect(board2).toContain("player.iconUrl");
        expect(board2).toContain("rp-role-${roleTone(player.role)}");
        expect(css).toMatch(/\.rp-role-tank \{ --ring: var\(--rp-tank\)/);
        expect(css).toMatch(/--rp-tank: #60a5fa; --rp-healer: #35d6c4; --rp-melee: #f97316; --rp-ranged: #a78bfa; --rp-dps: #f5c542/);
        // ranged is told from melee by a double ring, not only by its colour
        expect(css).toMatch(/\.rp-role-ranged \{[^}]*border-style: double/);
    });

    it("answers the public route before the menu asks for a session", () => {
        expect(app).toMatch(/pathname\.match\(\/\^\\\/p\\\/\(\[A-Za-z0-9_-\]\+\)\\\/\?\$\/\)/);
        expect(app).toMatch(/if \(publicPlan\) return <Suspense fallback=\{<RaidLoader \/>\}><PlanPublicPage token=\{publicPlan\[1\]\} \/><\/Suspense>;\s*\n\s*return <MenuApp \/>;/);
        expect(pub).toContain("getRaidplanPublic(token)");
        expect(pub).toContain("data.me");
        expect(pub).not.toContain("csrfToken");
    });

    it("keeps to its own css namespace and the app's tokens", () => {
        const classes = [...css.matchAll(/\.([a-z]{2,4}-[\w-]+)/g)].map((m) => m[1]);
        const prefixes = new Set(classes.map((c) => c.split("-")[0]));
        expect([...prefixes].filter((p) => p !== "rp" && p !== "is" && p !== "no")).toEqual([]);
        expect(css).toContain("var(--accent)");
        expect(css).toContain("var(--panel)");
    });

    it("shares one workspace between the event plan and the template, with no second copy of the drag", () => {
        expect(tab).toContain("<BoardWorkspace");
        expect(tpl).toContain("<BoardWorkspace");
        expect(tab).toContain("mode=\"event\"");
        expect(tpl).toContain("mode=\"template\"");
        for (const src of [tab, tpl]) expect(stripComments(src)).not.toContain("addEventListener");
    });

    it("keeps the head and tabs in the normal frame and lifts the width cap only where an editor is", () => {
        expect(css).toContain(".content:has([data-rp-editor]) { max-width: none; }");
        expect(tab).not.toContain("rp-wide");
        expect(tpl).not.toContain("rp-wide");
        expect(tpl).toContain("<PageHead");
        expect(css).toMatch(/\.rp-stage \{[^}]*grid-template-columns: 124px minmax\(0, 1fr\) 236px/);
        expect(css).toMatch(/\.rp-public \{ max-width: 1800px/);
        expect(css).toMatch(/\.rp-public-body \{ display: flex; flex-direction: column/);
    });

    it("keeps everything editable in view: a sticky tool bar, the palette, the properties panel and the layers, no dialog for edits", () => {
        expect(css).toMatch(/\.rp-sticky \{ position: sticky; top: 62px/);
        for (const needle of ["<Palette", "<Inspector", "<LayerList", "<MapPanel", "rp-toolbar2", "role=\"toolbar\"", "data-rp-tray"]) expect(work).toContain(needle);
        // the edits that used to hide in dialogs are gone; only the rare things keep one
        expect(fs.existsSync(path.join(__dirname, "..", "..", "..", "src", "web-client", "src", "pages", "raid-detail", "raidplan", "ObjectModals.tsx"))).toBe(false);
        expect(fs.existsSync(path.join(__dirname, "..", "..", "..", "src", "web-client", "src", "pages", "raid-detail", "raidplan", "MapModal.tsx"))).toBe(false);
        expect(stripComments(work)).not.toContain("<Modal");
        expect(stripComments(insp)).not.toContain("<Modal");
        // rows and the players not placed are open, not folded away
        expect(stripComments(work)).not.toContain("<details");
    });

    it("has a right-click menu of its own on the board only, keyboard-operable and inside the viewport", () => {
        expect(board2).toContain("onContextMenu");
        expect(board2).toContain("e.preventDefault()");
        expect(work).toContain("<ContextMenu");
        expect(work).toContain("LONG_PRESS_MS");
        expect(work).toContain("e.pointerType === \"touch\"");
        expect(menu).toContain("role=\"menu\"");
        expect(menu).toContain("role=\"menuitem\"");
        expect(menu).toContain("role=\"separator\"");
        for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Escape"]) expect(menu).toContain(`"${key}"`);
        // portalled and moved back into the viewport by the shared Popover
        expect(menu).toContain("pointPlacement(x, y)");
        expect(menu).toContain("<Popover");
    });

    it("undoes with Ctrl+Z / Ctrl+Y and offers the buttons", () => {
        expect(work).toContain("mod && e.key.toLowerCase() === \"z\"");
        expect(work).toContain("history.undo");
        expect(work).toContain("history.redo");
        expect(read("pages/raid-detail/raidplan/useDraftHistory.ts")).toContain("historyRecord");
    });

    it("uses icon buttons with a tooltip and an accessible name instead of text buttons", () => {
        expect(work).toContain("lucide-react");
        expect(work).toContain("<IconButton");
        expect(tab).toContain("<IconButton");
        expect(tab).toContain("tip={");
        expect(read("components/ui/Button.tsx")).toContain("aria-label={rest[\"aria-label\"] || tip}");
        expect(work).not.toMatch(/<Button[^>]*>\s*\{t\("raidBoard\.bar\.save"\)/);
    });

    it("gives every kind of object an opacity control, and the map its own", () => {
        expect(insp).toContain("OpacityField");
        expect(insp).toContain("min={10} max={100} step={5} unit=\"%\"");
        expect(insp).toContain("MapOpacityField");
        expect(board2).toContain("style={{ opacity: mapOpacity }}");
        expect(board2).toContain("opacity: l.opacity");
        expect(board2).toContain("opacity: x.opacity");
        expect(board2).toContain("opacity: m.opacity");
        expect(board2).toContain("opacity: s.opacity");
        expect(board2).toContain("opacity: tok.opacity");
        expect(board2).toContain("\"--zo\": z.opacity");
    });

    it("renders zones, marks, slots, lines, texts and groups in the shared board and the read view", () => {
        for (const needle of ["zones.filter", "marks.filter", "slots.filter", "lines.filter", "texts.filter", "tokens.filter", "groupListMembers", "rp-zone-label", "ZONE_GLYPHS", "arrowHead"]) expect(board2).toContain(needle);
        expect(pub).toContain("slots={boss.slots}");
        expect(pub).toContain("lines={boss.lines}");
        expect(pub).toContain("texts={boss.texts}");
        expect(pub).toContain("mapOpacity={boss.mapOpacity}");
        expect(pub).toContain("boss.slots.some((sl) => sl.userId === data.me)");
    });

    it("fits any map: the board takes the map's aspect ratio", () => {
        expect(board2).toContain("naturalWidth / i.naturalHeight");
        expect(board2).toContain("aspectRatio: String(ar)");
        expect(board2).toContain("100vh - 420px");
    });

    it("marks a zone's type by pattern and label as well as colour", () => {
        expect(css).toMatch(/\.rp-zone-danger \{[^}]*repeating-linear-gradient/);
        expect(css).toMatch(/\.rp-zone-healthy \{[^}]*radial-gradient/);
        expect(css).toMatch(/\.rp-zone-neutral \{[^}]*dashed/);
        expect(board2).toContain("aria-label={`${t(`raidBoard.zone.${z.type}`)}: ${name}`}");
    });

    it("lets a map be reset to its default from the background tab", () => {
        const panel = read("pages/raid-detail/raidplan/MapPanel.tsx");
        expect(panel).toContain("raidBoard.board.mapReset");
        expect(tab).toContain("e/${eventId}/${boss.key}");
        expect(tpl).toContain("t/${tpl.id}/${boss.key}");
    });

    it("applies a template on the server's answer and asks first only when the plan holds something", () => {
        expect(tab).toContain("applyRaidplanTemplate({ event: eventId, templateId: tpl.id, version: view.plan.version })");
        expect(tab).toContain("planHasContent(view.plan.bosses, bossKeys)");
    });

    it("reaches the template page from the raid list and the router, inside the raids area", () => {
        expect(app).toMatch(/path="raids\/plan-templates" element=\{<Guard user=\{user\} areas=\{\["raids"\]\}><RaidplanTemplatesPage \/><\/Guard>\}/);
        // in the menu (a sub entry of Raid-Events), no longer a button in the page head
        expect(read("pages/RaidsPage.tsx")).not.toContain("/raids/plan-templates");
        expect(JSON.stringify(require("../../../src/config/menu.json"))).toContain("/raids/plan-templates");
        expect(read("components/Shell.tsx")).toContain("/raids/plan-templates");
    });
});

describe("the texts", () => {
    it("exist in German and English for every key the raid plan asks for", () => {
        const de = dictionary("de");
        const en = dictionary("en");
        const files = [
            "pages/RaidplanTemplatesPage.tsx", "pages/raid-detail/raidplan/BoardWorkspace.tsx", "pages/raid-detail/raidplan/Inspector.tsx", "pages/raid-detail/raidplan/LayerList.tsx",
            "pages/raid-detail/raidplan/Palette.tsx", "pages/raid-detail/raidplan/MapPanel.tsx", "pages/raid-detail/raidplan/BossNav.tsx", "pages/raid-detail/raidplan/Palette.tsx", "pages/raid-detail/RaidplanTab.tsx",
            "pages/raid-detail/raidplan/TargetsPanel.tsx", "pages/raid-detail/raidplan/ProfileModals.tsx", "pages/raid-detail/raidplan/ShareModal.tsx", "pages/PlanPublicPage.tsx",
            "components/raidplan/PlanBoard.tsx",
        ];
        const keys = new Set();
        for (const f of files) for (const m of read(f).matchAll(/\bt\(\s*"((?:raidBoard|planTemplates)\.[\w.]+)"/g)) keys.add(m[1]);
        expect(keys.size).toBeGreaterThan(110);
        const missing = [...keys].filter((k) => de[k] === undefined || en[k] === undefined);
        expect(missing).toEqual([]);
        // the labels that are looked up by a computed key
        for (const role of ["tank", "healer", "dps"]) expect(de[`raidBoard.role.${role}`]).toBeTruthy();
        for (const k of ["skull", "cross", "square", "moon", "triangle", "diamond", "circle", "star"]) expect([de, en].map((d) => d[`raidBoard.mark.${k}`])).not.toContain(undefined);
        for (const k of ["danger", "healthy", "neutral", "custom", "rect", "ellipse"]) expect([de, en].map((d) => d[`raidBoard.zone.${k}`])).not.toContain(undefined);
        for (const k of ["tank", "healer", "melee", "ranged", "dps", "group", "label"]) expect([de, en].map((d) => d[`raidBoard.slot.kind.${k}`])).not.toContain(undefined);
        for (const k of ["boss", "wow", "enemy", "bosspos", "label"]) expect([de, en].map((d) => d[`raidBoard.icon.${k}`])).not.toContain(undefined);
        for (const k of ["members_hide", "members_show", "split_on", "split_off", "resetpos"]) expect([de, en].map((d) => d[`raidBoard.ctx.${k}`])).not.toContain(undefined);
        for (const k of ["tank", "healer", "melee", "ranged", "dps", "group"]) expect([de, en].map((d) => d[`raidBoard.slot.${k}`])).not.toContain(undefined);
        for (const k of ["token", "slot", "mark", "icon", "member", "zone", "line", "text"]) expect([de, en].map((d) => d[`raidBoard.obj.${k}`])).not.toContain(undefined);
        for (const k of ["arrow", "line"]) expect([de, en].map((d) => d[`raidBoard.line.${k}`])).not.toContain(undefined);
        for (const k of ["properties", "duplicate", "front", "back", "lock", "unlock", "assign", "unassign", "delete", "deselect", "insertHere", "board"]) expect([de, en].map((d) => d[`raidBoard.ctx.${k}`])).not.toContain(undefined);
        expect(de["raidDetail.page.tab.plan"]).toBe("Raidplan");
        expect(en["raidDetail.page.tab.plan"]).toBe("Raid plan");
    });

    it("has no leftover file for the wrong namespace", () => {
        const dir = path.join(__dirname, "..", "..", "..", "src", "web-client", "src", "i18n", "locales");
        expect(fs.existsSync(path.join(dir, "de", "raidBoard.json"))).toBe(true);
        expect(fs.existsSync(path.join(dir, "en", "raidBoard.json"))).toBe(true);
    });
});

describe("the new pages", () => {
    const work = read("pages/raid-detail/raidplan/BoardWorkspace.tsx");
    const board2 = read("components/raidplan/PlanBoard.tsx");
    const palette = read("pages/raid-detail/raidplan/Palette.tsx");
    const insp = read("pages/raid-detail/raidplan/Inspector.tsx");
    const css = read("styles/raidplan.css");
    const pub = read("pages/PlanPublicPage.tsx");

    it("scales objects by a grip, by + / -, by Alt + wheel and by the inspector; Shift keeps a zone's proportions", () => {
        expect(board2).toContain("rp-h-size");
        expect(work).toContain("e.key === \"+\" || e.key === \"=\"");
        expect(work).toContain("e.key === \"-\"");
        expect(work).toContain("e.altKey");
        expect(work).toContain("{ passive: false }");
        expect(work).toContain("keepRatio: e.shiftKey");
        expect(insp).toContain("SizeField");
        expect(insp).toContain("ObjectScaleField");
        expect(css).toMatch(/\.rp-h-size \{/);
        expect(css).toContain("var(--rp-s, 38px)");
    });

    it("offers the encounter's icons, an enemy and a boss position, and any icon by its name", () => {
        expect(palette).toContain("iconKeyForBoss(b.iconUrl)");
        expect(palette).toContain("iconKey: \"enemy\"");
        expect(palette).toContain("iconKey: \"bosspos\"");
        expect(palette).toContain("wowIconUrl(clean, 56)");
        expect(work).toContain("bosses={allBosses}");
        for (const kind of ["tank", "healer", "melee", "ranged", "dps", "group", "label"]) expect(palette).toContain("kind: \"" + kind + "\"");
    });

    it("draws icons, split groups and the new roles on the shared board and in the read view", () => {
        for (const needle of ["icons.filter", "splitMembers", "ringOffsets", "rp-member", "hideMembers", "rp-icon-face", "sizeHandle(", "objectScale"]) expect(board2).toContain(needle);
        expect(pub).toContain("icons={boss.icons}");
        expect(pub).toContain("objectScale={boss.objectScale}");
        expect(css).toMatch(/\.rp-role-melee \{/);
    });
});

describe("template overview", () => {
    const tpl = read("pages/RaidplanTemplatesPage.tsx");
    it("has search, filters, duplicate, confirmed delete and an empty state", () => {
        expect(tpl).toContain("function TemplateList");
        expect(tpl).toContain("duplicateRaidplanTemplate");
        expect(tpl).toMatch(/tone: "danger"/);
        expect(tpl).toContain("b.updatedAt - a.updatedAt");
        expect(tpl).toContain("rp-empty");
    });

    it("has de and en texts, with plural forms for the boss progress", () => {
        for (const lang of ["de", "en"]) {
            const d = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../src/web-client/src/i18n/locales", lang, "planTemplates.json"), "utf8"));
            for (const k of ["search", "duplicate", "delete", "noMatch", "emptyTitle", "updated", "deleteText"]) expect(typeof d[k]).toBe("string");
            expect(Object.keys(d.bossesFilled).sort()).toEqual(["one", "other"]);
        }
    });
});

describe("\"All assignments\" never cuts a name (feature/raidplan-16)", () => {
    const fs = require("fs");
    const p = require("path");
    const css = fs.readFileSync(p.join(__dirname, "../../../src/web-client/src/styles/raidplan.css"), "utf8");
    it("a read-only card's columns are as wide as their longest chip (up to 320 px), a card at least 240 px", () => {
        expect(css).toContain(".rp-alist.rp-linelist.is-ro.rp-read-lines { grid-template-columns: 26px fit-content(320px) 18px fit-content(320px); }");
        expect(css).toContain(".rp-rgrid > .rp-rsec { min-width: min(100%, 240px); }");
    });

    it("a name in a table is never broken; on a phone the tank and group heal tables become blocks (no sideways scrolling)", () => {
        expect(css).toContain(".rp-rtable .rp-who .class-colored, .rp-rtable .rp-who > strong, .rp-rtable .rp-who-open { white-space: nowrap; overflow-wrap: normal; word-break: keep-all; }");
        expect(css).toMatch(/@media \(max-width: 560px\) \{[\s\S]*\.rp-gheal \.rp-rtable thead \{ display: none; \}[\s\S]*\.rp-tanktable thead \{ display: none; \}/);
        const read = fs.readFileSync(p.join(__dirname, "../../../src/web-client/src/pages/raid-detail/raidplan/ReadTables.tsx"), "utf8");
        expect(read).toContain("<td data-label={t(\"raidBoard.read.colHealedBy\")}>");
        expect(read).toContain("<table className=\"rp-rtable rp-tanktable\">");
    });

    it("the sheet's chips carry the full name in their tooltip", () => {
        const line = fs.readFileSync(p.join(__dirname, "../../../src/web-client/src/pages/raid-detail/raidplan/AssignLine.tsx"), "utf8");
        expect(line).toContain(": readOnly ? playerLabel(r.player) : undefined}");
    });
});

describe("the section bar names every section (feature/raidplan-16)", () => {
    it("editor and sheet show the name on every chip, the bar wraps instead of scrolling", () => {
        const fs = require("fs");
        const p = require("path");
        const nav = fs.readFileSync(p.join(__dirname, "../../../src/web-client/src/pages/raid-detail/raidplan/BossNav.tsx"), "utf8");
        expect(nav).toContain("<span className=\"rp-bosschip-name\">{label(b)}</span>");
        expect(nav).not.toContain("rp-bosschip-no");
        const sheet = fs.readFileSync(p.join(__dirname, "../../../src/web-client/src/pages/PlanPublicPage.tsx"), "utf8");
        expect(sheet).toContain("<span className=\"rp-bosschip-name\">{label(b)}</span>");
        expect(sheet).toContain("const label = (b: RaidplanPublicBoss) => sectionLabel(b, several);");
        const css = fs.readFileSync(p.join(__dirname, "../../../src/web-client/src/styles/raidplan.css"), "utf8");
        expect(css).toContain(".rp-bossnav { display: flex; flex-wrap: wrap;");
    });
});
