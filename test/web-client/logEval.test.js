// The Log-Auswertung page (design issue #217): one list, one action per row, the
// link form, the assignment and the "raid still running" question as modals.
// Source scans, since the client has no React test renderer.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8");

const page = read("pages", "ClaPage.tsx");

/** The source of one top-level function of the page. */
function fn(name) {
    const start = page.indexOf(`function ${name}(`);
    expect(start).toBeGreaterThan(-1);
    const next = page.slice(start + 10).search(/\n(export default )?function /);
    return next === -1 ? page.slice(start) : page.slice(start, start + 10 + next);
}

describe("Log-Auswertung: finding it", () => {
    it("is what the menu calls the page, in the SPA and in the SSR chrome", () => {
        // One list for both menus (src/config/menu.json), rendered by Shell.tsx and adminChrome.js.
        const menu = require("../../src/config/menu.json");
        expect(menu.find((e) => e.id === "cla")).toMatchObject({ label: "Log-Auswertung", href: "/cla" });
        const chrome = fs.readFileSync(path.join(__dirname, "..", "..", "src", "web", "adminChrome.js"), "utf8");
        expect(chrome).toContain("require(\"../config/menu\")");
    });

    it("has a page head with the area tile and exactly one primary action, which opens the dialog", () => {
        expect(page).toContain("icon=\"inv_misc_pocketwatch_01\"");
        expect(page).toContain("tone=\"cla\"");
        expect(page).toContain("kicker=\"Warcraft Logs · CLA & RPB\"");
        expect(page).toContain("title=\"Log-Auswertung\"");
        expect(page).toContain("action={<Button icon=\"inv_misc_spyglass_02\" onClick={() => setNewOpen(true)}>Neue Auswertung</Button>}");
        // the fixed form and the two tabs are gone
        expect(page).not.toContain("NewEvaluationCard");
        expect(page).not.toContain("className=\"subnav\"");
        expect(page).not.toContain("eval-card");
    });

    it("is one click from the dashboard", () => {
        // The "Letzte Auswertung" tile leads to the report, or — before the
        // first evaluation — to the page that makes one.
        const dashboard = read("pages", "DashboardPage.tsx");
        expect(dashboard).toContain("href=\"/cla\"");
        expect(dashboard).toContain("<Badge tone=\"accent\">Log auswerten</Badge>");
    });
});

describe("Log-Auswertung: one list", () => {
    it("filters by Alle · Offen · Ohne Raid-Event · Ausgewertet, remembered, with a count each", () => {
        expect(page).toContain("const FILTERS: ClaFilter[] = [\"all\", \"open\", \"unlinked\", \"done\"];");
        expect(page).toContain("usePersistedSearchParam<ClaFilter>(\"cla-filter\", \"filter\", \"all\", FILTERS)");
        for (const label of ["Alle", "Offen", "Ohne Raid-Event", "Ausgewertet"]) expect(page).toContain(`label: "${label}"`);
        expect(fn("FilterSegment")).toContain("<Badge count tone={warn ? \"mid\" : undefined}>{counts[f] ?? 0}</Badge>");
        // the explanation paragraphs became tooltips on the options
        expect(page).not.toContain("className=\"note\"");
        expect(fn("FilterSegment")).toContain("data-tip-sub={FILTER_META[f].sub}");
    });

    it("sends old ?view= links to the full list", () => {
        expect(page).toContain("if (!searchParams.has(\"view\")) return;");
        expect(page).toContain("next.delete(\"view\");");
    });

    it("does not trust a sort remembered by the old two-tab page", () => {
        expect(page).toContain("typeof sorting.sort === \"string\" && SORT_DEFAULTS[sorting.sort] ? sorting : SORTING_DEFAULT");
    });

    it("has five columns with a tooltip on each head", () => {
        for (const label of ["Log", "Inhalt", "Auswertung", "Raid-Event"]) expect(page).toContain(`label: "${label}", tip: "${label}"`);
        expect(page).toContain("<SortLabel sortKey={c.key} label={c.label} sort={list.sort} dir={list.dir} onSort={sortBy} tip={c.tip} tipSub={c.sub} />");
        // Erstellt / Spieler / Probleme moved into the evaluation badge's tooltip
        expect(fn("EvalBadges")).toContain("${r.playerCount} Spieler · ${r.issueCount} Probleme");
    });

    it("shows each raid as a badge, yellow while the final boss stands", () => {
        const badges = fn("RaidBadges");
        expect(badges).toContain("tone={r.finalKilled ? \"ok\" : \"mid\"} icon={raidIcon(r.contentId)}");
        const icons = read("lib", "raidIcons.ts");
        expect(icons).toContain("hyjal: \"achievement_boss_archimonde-\"");
        expect(icons).toContain("tk: \"spell_fire_burnout\"");
        expect(icons).toContain("head: \"Raid nicht abgeschlossen\"");
    });
});

describe("Log-Auswertung: one action per row", () => {
    const row = fn("ListRow");

    it("offers Auswerten, the missing half, or the report — never several buttons", () => {
        expect(row).toContain("icon=\"inv_misc_pocketwatch_01\"");
        expect(row).toContain("onClick={() => onEvaluate(\"both\")}");
        expect(row).toContain("onClick={() => onEvaluate(a.key)}");
        expect(row).toContain("<WowIcon name=\"inv_scroll_03\" size={18} />Report</a>");
        // exactly one `action` is rendered next to the row menu
        expect(row.match(/\{action\}/g)).toHaveLength(1);
        expect(row).not.toContain("CLA + RPB</");
    });

    it("keeps everything rare in the row menu, with discard and delete there", () => {
        for (const label of ["Report öffnen", "Log bei Warcraft Logs", "Nachricht im Log-Channel", "Zuordnung ändern", "Aus der Liste löschen"]) {
            expect(row).toContain(label);
        }
        expect(row).toContain("label: `${a.label}-Auswertung verwerfen`");
        expect(row).toContain("danger: true");
        // the tiny × inside the status pill is gone
        expect(page).not.toContain("pill-x");
    });

    it("evaluates a detected log as CLA + RPB in one job, CLA first, the force answer reused", () => {
        expect(page).toContain("const evaluateBoth = (row: ClaRow) => {");
        expect(page).toMatch(/evalLog\(csrfToken, row\.logId, "cla", \{ force: f \}\)[\s\S]*evalLog\(csrfToken, row\.logId, "rpb", \{ force \}\)/);
    });

    it("asks through the page's confirm dialog before discarding, deleting or unlinking", () => {
        expect(page).toContain("title: `${label}-Auswertung verwerfen?`");
        expect(page).toContain("title: \"Log aus der Liste löschen?\"");
        expect(page).toContain("title: \"Auswertung löschen?\"");
        expect(page).toContain("title: \"Zuordnung entfernen?\"");
    });
});

describe("Log-Auswertung: modals", () => {
    it("builds a report from a link in the Neue Auswertung dialog with three option cards", () => {
        const dlg = fn("NewEvaluationDialog");
        expect(dlg).toContain("<Modal");
        expect(dlg).toContain("title=\"Neue Auswertung\"");
        expect(page).toMatch(/\{ key: "both", label: "CLA \+ RPB"[^}]*icon: "inv_misc_book_09"[^}]*sections: \["cla", "rpb"\] \}/);
        expect(page).toMatch(/\{ key: "cla", label: "nur CLA"[^}]*icon: "inv_chest_cloth_43"[^}]*sections: \["cla"\] \}/);
        expect(page).toMatch(/\{ key: "rpb", label: "nur RPB"[^}]*icon: "ability_warrior_offensivestance"[^}]*sections: \["rpb"\] \}/);
        // the draft survives closing the dialog
        expect(dlg).toContain("useDraftState(\"cla-report-link\", { link: \"\", sections: \"both\" as SectionChoice })");
        expect(dlg).toContain("createReport(csrfToken, target, { force, sections: choice.sections })");
        // the hint is a tooltip on the "?" now
        expect(dlg).toContain("className=\"la-qm\"");
    });

    it("assigns a raid event in a dialog with candidate rows, the first preselected", () => {
        const dlg = fn("AssignDialog");
        expect(dlg).toContain("title=\"Raid-Event zuordnen\"");
        expect(dlg).toContain("setPicked(current ? current.eventId : (cands[0]?.eventId || \"\"))");
        expect(dlg).toContain("{cands.length} Events passen");
        expect(dlg).toContain("gleiche Kategorie");
        // no dropdown in the cell any more
        expect(page).not.toContain("<select");
    });

    it("asks about an unfinished raid with the boss grid", () => {
        const lib = read("lib", "confirmIncomplete.ts");
        expect(lib).toContain("createElement(IncompleteRaid, { raids: refusal.raids, message })");
        const grid = read("components", "IncompleteRaid.tsx");
        expect(grid).toContain("className={`la-boss ${b.killed ? \"ok\" : \"miss\"}`}");
        // the raids reach the client with the refusal
        const api = read("api.ts");
        expect(api).toContain("throw { code, message: state.error || failMessage, raids: state.raids } as IncompleteRaidError;");
    });

    it("keeps its styles in its own file", () => {
        expect(page).toContain("import \"../styles/log-auswertung.css\";");
        const css = read("styles", "log-auswertung.css");
        expect(css).toContain(".la-row.running { box-shadow: inset 3px 0 0 var(--accent); }");
        expect(css).toContain(".la-boss.miss { border-style: dashed;");
        expect(css).not.toMatch(/gold|#d4af37|#ffd700/i);
    });
});
