// Guards for the redesigned loot council (design issue #223): a filter bar
// instead of three boxes, one compact line per raider, the details in a dialog
// opened from ?raider=, the drop check as its own route, tooltips instead of
// paragraphs and native titles.
const { files, fn, rule, text } = require("./councilHelpers");

const { page, council, parts, filterBar, roster, dialog, drop, css, app } = files;

describe("loot council — page structure", () => {
    it("heads the page with the shared page head and one primary action to the drop check", () => {
        expect(page).toMatch(/<PageHead\s+icon="inv_misc_coin_02"/);
        expect(page).toMatch(/<Button icon="inv_misc_bag_10" onClick=\{\(\) => navigate\(dropHref\(\)\)\}>\{t\("lootcouncil\.page\.dropCheck"\)\}<\/Button>/);
        expect(text("page.dropCheck")).toBe("Drop prüfen");
    });

    it("replaces the Filter, Gear-Stand and Simulation boxes with one filter bar", () => {
        expect(page).toMatch(/<FilterBar\s/);
        expect(page).not.toMatch(/title="Filter"|title="Gear-Stand"|title="Simulation"/);
        expect(page).not.toMatch(/function Section\b/);
        // The explanations are tooltips on the controls now.
        expect(filterBar).toContain("data-tip-sub={t(\"lootcouncil.filter.contentTipSub\")}");
        expect(text("filter.contentTipSub")).toMatch(/Ohne Auswahl zählt aller Loot/);
        expect(filterBar).toContain("t(\"lootcouncil.filter.derivedTip\", ");
        expect(text("filter.derivedTip")).toMatch(/Aus dem neuesten Loot abgeleitet/);
        expect(filterBar).toContain("t(\"lootcouncil.filter.gearEnchants\")");
        expect(text("filter.gearEnchants")).toMatch(/Blizzards Verzauberungs-IDs/);
        // Role segment with WoW icons, two badges on the right.
        expect(filterBar).toMatch(/<Segment\s+ariaLabel=\{t\("lootcouncil\.filter\.role"\)\}/);
        expect(text("filter.role")).toBe("Rolle");
        expect(council).toMatch(/caster: "spell_holy_magicalsentry", healer: "spell_holy_guardianspirit"/);
        expect(filterBar).toMatch(/icon="inv_shield_06"/);
        expect(filterBar).toMatch(/Sim \{simulated\}\/\{simulatable\}/);
    });

    it("keeps the content choices in a popover with the raid hues", () => {
        const content = fn(filterBar, "ContentFilter");
        expect(content).toMatch(/aria-expanded=\{open\}/);
        expect(content).toMatch(/lc-filter lc-h-\$\{c\.id\}/);
        expect(content).toMatch(/className=\{`lc-cbadge lc-h-\$\{tier\.id\}`\}/);
    });

    it("explains a shortened roster in a badge tooltip instead of a paragraph", () => {
        const note = fn(council, "categoryNote");
        expect(note).toMatch(/t\("lootcouncil\.category\.nothingFound"\)/);
        expect(text("category.nothingFound")).toMatch(/Für diese Kategorie ist niemand zuzuordnen/);
        expect(filterBar).toMatch(/const note = categoryNote\(data\);/);
    });

    it("has four tabs; the drop check left the tab row", () => {
        for (const t of ["roster", "bis", "bislists", "compare"]) {
            expect(page).toContain(`onClick={() => patch({ tab: "${t}" })}`);
        }
        expect(page).not.toContain("patch({ tab: \"drop\" })");
        expect(page).not.toMatch(/function DropPanel/);
    });

    it("falls back to the Raider tab for a stored tab: \"drop\"", () => {
        expect(page).toMatch(/const tab = view\.tab === "drop" \? "roster" : view\.tab;/);
        // The persisted view no longer carries the picked drop.
        expect(page).not.toMatch(/dropItem/);
    });

    it("moves the full BiS run into the head of the open BiS items tab", () => {
        expect(page).toMatch(/tParts\("lootcouncil\.gaps\.runAll", \{ count: gaps\.length \}\)/);
        expect(text("gaps.runAll")).toBe("Alle BiS-Items durchrechnen ({count})");
        expect(page).toMatch(/onClick=\{\(\) => runSim\(gaps\.map\(\(g\) => g\.id\), simulatable\)\}/);
        // And each card links to the drop check.
        expect(fn(page, "GapCard")).toMatch(/to=\{dropHref\(gap\.id\)\}/);
    });

    it("imports its own stylesheet instead of appending to index.css", () => {
        expect(page).toContain("import \"../../styles/loot-council.css\";");
        expect(drop).toContain("import \"../../styles/loot-council.css\";");
    });
});

describe("loot council — the raider list", () => {
    it("renders one compact row per raider with rank, identity, need, days, items, BiS, DPS, hints and details", () => {
        const list = fn(roster, "RosterList");
        expect(list).toMatch(/className=\{`lc-rank\$\{i === 0 \? " top" : ""\}`\}/);
        expect(list).toMatch(/<RaiderIdent/);
        expect(list).toMatch(/<NeedBar subject=/);
        expect(list).toMatch(/<LootCount items=\{r\.items\}/);
        expect(list).toMatch(/<BisBar raider=\{r\} \/>/);
        expect(list).toMatch(/<RaiderHints raider=\{r\} \/>/);
        expect(list).toMatch(/onClick=\{\(\) => onOpen\(r\.character\)\}/);
        // The gear band and its icons are gone from the list.
        expect(roster).not.toMatch(/WornIcon|GearBand|lc-gear-band/);
    });

    it("gives the head and every row the same columns (one grid, rows as subgrid)", () => {
        // each row as its own grid sized its auto/fr columns from its own content:
        // the head with its empty action cell stood ~50px right of the rows
        expect(rule(css, ".lc-list")).toMatch(/grid-template-columns: 28px minmax\(170px, 1\.2fr\)/);
        expect(rule(css, ".lc-lrow")).toMatch(/grid-template-columns: subgrid;/);
        expect(rule(css, ".lc-lrow")).not.toMatch(/grid-template-columns: 28px/);
    });

    it("keeps every column sortable, with its meaning as a tooltip", () => {
        for (const key of ["character", "need", "last", "loot", "bis", "dps"]) {
            expect(roster).toContain(`<Head sortKey="${key}"`);
        }
        expect(fn(roster, "Head")).toMatch(/aria-sort=\{ariaSort\(sortKey, sort\.sort, sort\.dir\)\}/);
    });

    it("draws the need as a bar stacked 50 / 40 / 10 with the reasoning in the tooltip", () => {
        const bar = fn(parts, "NeedBar");
        expect(bar).toMatch(/w: p\.drought \* 50/);
        expect(bar).toMatch(/w: p\.share \* 40/);
        expect(bar).toMatch(/w: p\.need \* 10/);
        for (const icon of ["inv_misc_pocketwatch_02", "inv_misc_bag_10", "inv_misc_gem_variety_02"]) expect(bar).toContain(icon);
        expect(bar).toMatch(/t\("lootcouncil\.need\.score", \{ score \}\)/);
        expect(text("need.score")).toBe("Bedarf {score} von 100");
        expect(bar).toMatch(/t\("lootcouncil\.need\.weighted"\)/);
        expect(text("need.weighted")).toMatch(/Gewichtet 50 \/ 40 \/ 10/);
        expect(rule(css, ".lc-needbar")).toMatch(/height: 24px/);
    });

    it("folds the raiders set aside into one line that can take them back", () => {
        expect(page).toMatch(/<FoldRow\s+icon="ability_rogue_feigndeath"\s+title=\{t\("lootcouncil\.roster\.excludedTitle"\)\}/);
        expect(text("roster.excludedTitle")).toBe("Nicht eingeplant");
        expect(page).toContain("onClick={() => setExcluded(e.character, false)}");
    });
});

describe("loot council — the raider dialog", () => {
    it("opens from the url, so a link leads straight to a raider", () => {
        expect(page).toMatch(/const openName = \(params\.get\("raider"\) \|\| ""\)\.toLowerCase\(\);/);
        expect(page).toMatch(/next\.set\("raider", character\);/);
        expect(page).toMatch(/next\.delete\("raider"\);/);
        expect(council).toMatch(/export const raiderHref = \(character: string\) => `\/lootcouncil\?raider=\$\{encodeURIComponent\(character\)\}`;/);
        expect(page).toMatch(/\{openRaider \? \(\s*<RaiderDialog/);
    });

    it("is a native dialog with the shared classes and the rank in the kicker", () => {
        const d = fn(dialog, "RaiderDialog");
        expect(d).toMatch(/<dialog\s+ref=\{ref\}\s+className="dlg lc-dlg"/);
        expect(d).toMatch(/dlg\.showModal\(\)/);
        expect(d).toMatch(/onCancel=\{\(e\) => \{ e\.preventDefault\(\); onClose\(\); \}\}/);
        expect(d).toMatch(/tParts\("lootcouncil\.dialog\.kicker", \{ rank, total \}\)/);
        expect(text("dialog.kicker")).toBe("Loot-Council › Raider · Rang {rank} von {total}");
        // No tooltip layer of its own and no focus trick any more: the shell's
        // box rises into the top layer and ignores the focus showModal() sets.
        expect(d).not.toMatch(/<TipLayer \/>/);
        expect(d).not.toContain("dlg.focus()");
    });

    it("offers the role switch only where there is a choice", () => {
        expect(fn(dialog, "RaiderDialog")).toMatch(/canWrite && r\.roleOptions\.length > 1 \? \(\s*<Segment/);
    });

    it("has three sections: gear, BiS gaps, loot received", () => {
        const d = fn(dialog, "RaiderDialog");
        const sections = { gear: ["Gear", "inv_chest_cloth_49"], bis: ["BiS-Lücken", "inv_misc_gem_variety_02"], loot: ["Erhaltener Loot", "inv_misc_bag_10"] };
        for (const [id, [label, icon]] of Object.entries(sections)) {
            expect(d).toContain(`{ id: "${id}", label: t("lootcouncil.dialog.section.${id}"), icon: "${icon}"`);
            expect(text(`dialog.section.${id}`)).toBe(label);
        }
        expect(d).toMatch(/to=\{dropHref\(item\.id\)\}/);
    });

    it("shows the set as a character sheet in armour, jewellery and weapons", () => {
        expect(dialog).toMatch(/\{ id: "armour", slots: \[0, 1, 2, 14, 4, 8, 9, 5, 6, 7\] \}/);
        expect(dialog).toMatch(/\{ id: "jewellery", slots: \[10, 11, 12, 13\] \}/);
        expect(dialog).toMatch(/\{ id: "weapons", slots: \[15, 16, 17\] \}/);
        expect(fn(dialog, "GearSheet")).toContain("t(`lootcouncil.dialog.sheet.${g.id}`)");
        expect([text("dialog.sheet.armour"), text("dialog.sheet.jewellery"), text("dialog.sheet.weapons")]).toEqual(["Rüstung", "Ringe & Schmuck", "Waffen"]);
        expect(fn(dialog, "GearSheet")).toMatch(/<WornIcon item=\{item\} \/>/);
    });

    it("says what is wrong with the set as badges — the stamp and the legend are gone", () => {
        const b = fn(parts, "GearBadges");
        expect(b).toContain("Hit {g.spellHit}/{g.hitCap}");
        const badges = { noEnchCount: "ohne VZ", socketsCount: "Sockel leer", pvpGear: "PvP-Gear", armoryPvpTip: "Armory: PvP-Gear", logPvpTip: "Log: PvP-Gear" };
        for (const [key, words] of Object.entries(badges)) {
            expect(b).toMatch(new RegExp(`\\bt(Parts)?\\("lootcouncil\\.gear\\.${key}"`));
            expect(text(`gear.${key}`)).toContain(words);
        }
        expect(b).toMatch(/g\.source === "wcl"/);
        expect(b).toMatch(/g\.logRejected/);
        expect(b).toMatch(/g\.armoryRejected/);
        expect(dialog + parts + roster).not.toMatch(/function GearStamp|function GearLegend/);
    });

    it("picks the gear source in a segment with WoW icons, the log panel opening at \"Log\"", () => {
        const d = fn(dialog, "RaiderDialog");
        expect(d).toMatch(/ariaLabel=\{t\("lootcouncil\.dialog\.sourceAria", \{ character: r\.character \}\)\}/);
        expect(text("dialog.sourceAria")).toBe("Gear-Quelle für {character}");
        expect(d).toMatch(/label: t\("lootcouncil\.gear\.evaluation"\), icon: "inv_misc_pocketwatch_01"/);
        expect(text("gear.evaluation")).toBe("Auswertung");
        expect(d).toMatch(/label: "Log", icon: "inv_scroll_03"/);
        expect(d).toMatch(/label: "Armory", icon: "inv_shield_06"/);
        expect(d).toMatch(/if \(value === "wcl"\) \{ setLogOpen\(\(o\) => !o\); return; \}/);
        expect(d).toMatch(/else if \(source !== "log"\) onEvaluation\(r\.character\);/);
        expect(d).toMatch(/\{logOpen \? \(\s*<LogPanel/);
    });

    it("keeps the actions in the foot: exclude, sim export, close, armory", () => {
        const d = fn(dialog, "RaiderDialog");
        expect(d).toMatch(/variant="danger"[\s\S]{0,120}onClick=\{\(\) => onExclude\(r\.character\)\}/);
        expect(d).toMatch(/icon="inv_gizmo_02"[\s\S]{0,120}onClick=\{\(\) => onExport\(r\.character\)\}/);
        expect(d).toMatch(/variant="run" icon="inv_shield_06"[\s\S]{0,120}onClick=\{\(\) => onArmory\(r\.character\)\}/);
    });

    it("opens the sim export as a second, shared modal", () => {
        expect(fn(dialog, "ExportDialog")).toMatch(/<Modal\s+open=\{!!data\}/);
        expect(page).toMatch(/<ExportDialog data=\{exportData\} onClose=\{\(\) => setExportData\(null\)\} \/>/);
    });

    it("asks before setting a raider aside from the details", () => {
        expect(fn(page, "LootCouncilPage")).toMatch(/const excludeFromDialog = async \(character: string\) => \{\s*const ok = await ask\(\{/);
    });
});

describe("loot council — the drop check page", () => {
    it("is its own route under the same guard", () => {
        expect(app).toContain("const DropCheckPage = lazy(() => import(\"./pages/lootcouncil/DropCheckPage\"));");
        expect(app).toMatch(/<Route path="lootcouncil\/drop\/:itemId\?" element=\{<Guard user=\{user\} areas=\{\["lootcouncil"\]\}><DropCheckPage \/><\/Guard>\} \/>/);
        expect(council).toMatch(/export const dropHref = \(itemId\?: number\) => \(itemId \? `\/lootcouncil\/drop\/\$\{itemId\}` : "\/lootcouncil\/drop"\);/);
        expect(drop).toMatch(/const \{ itemId: param \} = useParams\(\);/);
    });

    it("reads the council's filters without writing them", () => {
        expect(drop).toMatch(/const \[view\] = usePersistedState<FilterView>\(VIEW_KEY, FILTER_DEFAULT\);/);
        expect(page).toMatch(/usePersistedState<View>\(VIEW_KEY, VIEW_DEFAULT\)/);
        expect(council).toMatch(/export const VIEW_KEY = "lootcouncil\.view";/);
    });

    it("has the search in the head, the item card, the recommendation and the candidates", () => {
        expect(drop).toMatch(/<div className="ph-act lc-dropsearch">\s*<ItemSearchPicker/);
        expect(drop).toMatch(/onPick=\{\(item: ItemSearchResult\) => navigate\(dropHref\(item\.id\)\)\}/);
        expect(drop).toMatch(/<BisSpecs specs=\{focus\.item\.bisSpecs\} \/>/);
        expect(drop).toMatch(/icon="inv_misc_coin_02"\s+crumb=\{t\("lootcouncil\.drop\.verdictCrumb"\)\}/);
        expect(drop).toMatch(/icon="inv_misc_grouplooking"\s+crumb=\{t\("lootcouncil\.drop\.candidatesCrumb"\)\}/);
        expect(text("drop.verdictCrumb")).toBe("Drop prüfen › Empfehlung");
        expect(text("drop.candidatesCrumb")).toBe("Drop prüfen › Kandidaten");
        const heads = { need: "Bedarf", last: "Zuletzt", items: "Items", replaces: "Ersetzt" };
        for (const [key, label] of Object.entries(heads)) {
            expect(drop).toContain(`<span className="lc-th">{t("lootcouncil.word.${key}")}</span>`);
            expect(text(`word.${key}`)).toBe(label);
        }
        expect(drop).toMatch(/<SlotOptions candidate=\{best\} \/>/);
    });

    it("folds who cannot wear the item into one line with the reasons", () => {
        expect(drop).toMatch(/title=\{t\("lootcouncil\.drop\.unwearable"\)\}/);
        expect(text("drop.unwearable")).toBe("Können es nicht tragen");
        expect(drop).toMatch(/focus\.unwearable\.map\(\(u\) => \(/);
        expect(drop).toMatch(/\{u\.note\}/);
    });

    it("draws the gain as a bar relative to the best candidate, hatched when not BiS", () => {
        const gain = fn(parts, "GainCell");
        expect(gain).toMatch(/<Bar\s+value=\{Math\.max\(0, gain\)\}\s+max=\{gainMax\}/);
        expect(gain).toMatch(/const half = candidate\.bisWeight < 1;/);
        expect(rule(css, ".lc-gain.half .bar i")).toMatch(/repeating-linear-gradient/);
        expect(rule(css, ".lc-gain .bar")).toMatch(/width: 180px/);
        expect(fn(parts, "CandidateTable")).toMatch(/tipSub=\{t\("lootcouncil\.candidates\.gainTipSub"\)\}/);
        expect(text("candidates.gainTipSub")).toMatch(/Geschätzt wird nichts/);
    });

    it("marks a two-hander with a 2H badge", () => {
        expect(fn(parts, "SlotOptions")).toMatch(/candidate\.twoHanded \? \(\s*<Badge count tip=\{t\("lootcouncil\.gear\.twoHandTip"\)\}/);
        expect(text("gear.twoHandTip")).toBe("Zweihandwaffe");
    });
});

describe("loot council — icons, buttons, tooltips", () => {
    const all = [page, parts, filterBar, roster, dialog, drop].join("\n");

    it("sets no native title attribute anywhere in the module", () => {
        // Component props named title (PartHead, FoldRow, Modal) are fine; an
        // HTML element carrying one is not.
        expect(all).not.toMatch(/<[a-z][a-z0-9]*\b[^<>]*\stitle=/);
    });

    it("dropped the page's own line icons, pills and icon buttons", () => {
        for (const gone of ["EvalIcon", "LogIcon", "ArmoryIcon", "ExportIcon", "ExcludeIcon", "ClockIcon", "LootBagIcon", "lc-pill-bis", "lc-pill-nobis", "lc-gchip", "lc-stat\"", "lc-ibtn", "HoverPanel"]) {
            expect(all).not.toContain(gone);
        }
    });

    it("uses the shared building blocks", () => {
        for (const src of [page, parts, filterBar, roster, dialog, drop]) expect(src).toMatch(/from "\.\.\/\.\.\/components\/ui";/);
    });

    it("draws the rich tooltips in the shared tooltip box", () => {
        const tip = fn(parts, "RichTip");
        expect(tip).toMatch(/className="tip on lc-rtip"/);
        // Inside an open dialog, or it would sit behind the backdrop.
        expect(tip).toMatch(/host="dialog"/);
    });

    it("keeps the worn-item marks in their corners, each explained by a tooltip", () => {
        const worn = fn(parts, "WornIcon");
        expect(worn).toMatch(/<a\s+className=\{`lc-worn \$\{marks\}`\}\s+href=\{wornWowheadUrl\(item\)\}/);
        expect(worn).toMatch(/lc-worn-tag-bis" data-tip="BiS"/);
        expect(worn).toMatch(/lc-worn-tag-noench" data-tip=\{t\("lootcouncil\.gear\.wornNoEnchTip"\)\}/);
        expect(worn).toMatch(/lc-worn-tag lc-worn-tag-socket" data-tip=/);
        expect(worn).toMatch(/lc-worn-mark-sit" data-tip=\{t\("lootcouncil\.gear\.sitMarkTip"\)\}/);
        expect(text("gear.wornNoEnchTip")).toBe("Keine Verzauberung");
        expect(text("gear.sitMarkTip")).toBe("Zählt im Vergleich nicht");
        const url = fn(council, "wornWowheadUrl");
        expect(url).toMatch(/ench=\$\{item\.enchantId\}/);
        expect(url).toMatch(/gems=\$\{item\.gemIds\.join\(":"\)\}/);
    });

    it("re-scans for the Wowhead widget after renders with new gear", () => {
        expect(page).toMatch(/useEffect\(\(\) => \{ refreshWowheadLinks\(\); \}, \[data, view\.tab\]\);/);
        expect(dialog).toMatch(/useEffect\(\(\) => \{ refreshWowheadLinks\(\); \}, \[r, section\]\);/);
    });
});
