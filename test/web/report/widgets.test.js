// The small HTML building blocks of the report pages (src/web/report/widgets.js),
// tested on their own with hand-built inputs.
jest.mock("../../../src/web/charLinks", () => ({ armoryUrlFor: jest.fn(() => "") }));

const { armoryUrlFor } = require("../../../src/web/charLinks");
const w = require("../../../src/web/report/widgets");

const ICON = (name) => `https://wow.zamimg.com/images/wow/icons/large/${name}.jpg`;

describe("web/report/widgets", () => {
    describe("icon urls", () => {
        it("strips the file extension, lower-cases and falls back to the question mark", () => {
            expect(w.iconUrl("INV_Sword_01.JPG")).toBe(ICON("inv_sword_01"));
            expect(w.iconUrl("spell_holy_renew.png")).toBe(ICON("spell_holy_renew"));
            expect(w.iconUrl("")).toBe(ICON("inv_misc_questionmark"));
            expect(w.iconUrl(null)).toBe(ICON("inv_misc_questionmark"));
        });

        it("builds the class icon url and the class icon name", () => {
            expect(w.classIconUrl("Mage")).toBe(ICON("classicon_mage"));
            expect(w.classIconUrl(undefined)).toBe(ICON("classicon_"));
            expect(w.classIconName("Warrior")).toBe("classicon_warrior");
            expect(w.classIconName("")).toBe("");
        });
    });

    describe("classCell and playerCard", () => {
        it("renders the class icon and the name in class colour, linked when a href is given", () => {
            const p = { name: "Al<i>", type: "Mage" };
            expect(w.classCell(p, "/r/x/p/0")).toBe(`<a class="pname-cell" href="/r/x/p/0"><img src="${ICON("classicon_mage")}" alt="Mage"><span style="color:#69CCF0;font-weight:700">Al&lt;i&gt;</span></a>`);
            expect(w.classCell(p, null)).toMatch(/^<span class="pname-cell"><img/);
        });

        it("uses a neutral colour for an unknown class", () => {
            expect(w.classCell({ name: "X", type: "Bard" })).toContain("color:#ddd");
        });

        it("marks a card by its worst issue and lists every issue with its item link", () => {
            const card = w.playerCard({
                name: "Brokk", type: "Warrior",
                issues: [
                    { itemName: "Helm", itemId: 5, icon: "inv_helmet", severity: "high", label: "kein Enchant" },
                    { itemName: "Ring", icon: "", severity: "medium", label: "leerer Sockel" },
                ],
            }, "/r/a/p/1");
            expect(card).toContain("<section class=\"card sev-high\">");
            expect(card).toContain("<a class=\"player\" href=\"/r/a/p/1\">");
            expect(card).toContain("<span class=\"count\">2</span>");
            expect(card).toContain("href=\"https://www.wowhead.com/tbc/item=5\"");
            expect(card).toContain("<span class=\"tag tag-high\">kein Enchant</span>");
            // an issue without item id is not a link
            expect(card).toContain(`<span class="item"><img class="icon" src="${ICON("inv_misc_questionmark")}" loading="lazy" alt=""><span>Ring</span></span><span class="tag tag-medium">leerer Sockel</span>`);
        });

        it("renders a clean card without href as a plain div", () => {
            const card = w.playerCard({ name: "Elun", type: "Priest" });
            expect(card).toContain("<section class=\"card sev-ok\">");
            expect(card).toContain("<div class=\"player\">");
            expect(card).toContain("<span class=\"count\">0</span>");
            expect(card).toContain("<ul class=\"issues\"></ul>");
        });

        it("marks a card with only medium issues as sev-med", () => {
            expect(w.playerCard({ name: "A", type: "Mage", issues: [{ itemName: "x", severity: "medium", label: "y" }] })).toContain("card sev-med");
        });
    });

    describe("percent cells and tones", () => {
        it("tones a coverage cell full, part or none", () => {
            expect(w.pctCell(100)).toBe("<span class=\"pct pct-full\">100%</span>");
            expect(w.pctCell(40)).toBe("<span class=\"pct pct-part\">40%</span>");
            expect(w.pctCell(0)).toBe("<span class=\"pct pct-none\">0%</span>");
        });

        it("maps a percentage to good / medium / high like the fight charts", () => {
            expect(w.pctTone(95)).toBe("good");
            expect(w.pctTone(70)).toBe("medium");
            expect(w.pctTone(69)).toBe("high");
        });

        it("renders tone cells and n/a cells with an optional tooltip", () => {
            expect(w.toneCell(96)).toBe("<span class=\"pct pct-full\">96%</span>");
            expect(w.toneCell(80, "Tip")).toBe("<span class=\"pct pct-part\" data-tip=\"Tip\">80%</span>");
            expect(w.toneCell(10)).toBe("<span class=\"pct pct-none\">10%</span>");
            expect(w.naCell()).toBe("<span class=\"pct pct-na\">–</span>");
            expect(w.naCell("why", "5%")).toBe("<span class=\"pct pct-na\" data-tip=\"why\">5%</span>");
        });

        it("says ja / nein", () => {
            expect(w.yesNo(true)).toBe("<span class=\"pct pct-full\">ja</span>");
            expect(w.yesNo(0)).toBe("<span class=\"pct pct-none\">nein</span>");
        });
    });

    describe("small controls", () => {
        it("renders the expand control, a tile and a badge", () => {
            expect(w.expBtn()).toMatch(/^<span class="exp-lbl"><span class="exp-w">Details<\/span><span class="exp"><svg/);
            expect(w.tile("inv_x", "ok")).toBe(`<span class="tile ok"><img class="hicon" src="${ICON("inv_x")}" alt=""></span>`);
            expect(w.tile("inv_x")).toBe(`<span class="tile"><img class="hicon" src="${ICON("inv_x")}" alt=""></span>`);
            expect(w.badge("3 & mehr", "bad", "", true)).toBe("<span class=\"badge bad count\">3 &amp; mehr</span>");
            expect(w.badge("ok")).toBe("<span class=\"badge\">ok</span>");
            expect(w.badge("x", "", "inv_y")).toBe(`<span class="badge"><img class="hicon" src="${ICON("inv_y")}" alt="">x</span>`);
        });

        it("renders an icon button with tooltip, sub text, attributes and tone", () => {
            expect(w.ibtn("<i></i>", "Tip \"q\"", "Sub", "data-x=\"1\"", "ok")).toBe("<button type=\"button\" class=\"ibtn ok\" data-tip=\"Tip &quot;q&quot;\" data-tip-sub=\"Sub\" aria-label=\"Tip &quot;q&quot;\" data-x=\"1\"><i></i></button>");
            expect(w.ibtn("i", "T")).toBe("<button type=\"button\" class=\"ibtn\" data-tip=\"T\" aria-label=\"T\">i</button>");
        });

        it("exposes the line icons as svg strings", () => {
            for (const k of ["check", "ban", "pencil", "close", "search", "external", "back", "expand", "undo", "rows", "cols", "expandAll", "collapseAll"]) {
                expect(w.LINE[k]).toMatch(/^<svg viewBox="0 0 24 24"[^>]*aria-hidden="true">.*<\/svg>$/);
            }
        });

        it("renders the dialog close button without tooltip", () => {
            expect(w.dlgClose()).toBe(`<button type="button" class="ibtn" data-close aria-label="Schließen">${w.LINE.close}</button>`);
        });

        it("renders header icons only for a given icon, with an optional tooltip", () => {
            expect(w.hicon("", "x")).toBe("");
            expect(w.hicon("inv_a", "T<")).toBe(`<img class="hicon" src="${ICON("inv_a")}" alt="" data-tip="T&lt;">`);
            expect(w.colHead("inv_a", "Flask")).toBe(`<img class="hicon" src="${ICON("inv_a")}" alt=""><span>Flask</span>`);
            expect(w.colHead(undefined, "Food")).toBe("<span>Food</span>");
        });
    });

    describe("armory", () => {
        afterEach(() => armoryUrlFor.mockReset());

        it("renders nothing without a configured armory", () => {
            armoryUrlFor.mockReturnValue("");
            expect(w.armoryButton("Brokk")).toBe("");
            expect(w.armoryLink("Brokk", "btn")).toBe("");
        });

        it("links the armory as an icon button and as a labelled link", () => {
            armoryUrlFor.mockReturnValue("https://armory.test/c/Br%C3%B6kk");
            const btn = w.armoryButton("Brökk");
            expect(armoryUrlFor).toHaveBeenCalledWith("Brökk");
            expect(btn).toMatch(/^<a class="ibtn" href="https:\/\/armory\.test\/c\/Br%C3%B6kk" target="_blank" rel="noopener" data-tip="Armory öffnen"/);
            expect(btn).toContain("inv_shirt_guildtabard_01");
            const link = w.armoryLink("Brökk", "btn btn-ghost");
            expect(link).toMatch(/^<a class="btn btn-ghost" href="https:\/\/armory\.test\/c\/Br%C3%B6kk"/);
            expect(link).toMatch(/alt="">Armory<\/a>$/);
        });
    });

    describe("area heads, dialogs and metric cards", () => {
        it("renders a group head with crumb and action, and without crumb", () => {
            expect(w.groupHead("inv_a", "mid", "<b>T</b>", "A › B", "<button>x</button>")).toBe(`<div class="part-head gh"><span class="tile mid"><img class="hicon" src="${ICON("inv_a")}" alt=""></span><div class="gh-title"><b><b>T</b></b><span class="kicker">A › B</span></div><span class="grow"></span><button>x</button></div>`);
            expect(w.groupHead("inv_a", "", "T", "", "")).not.toContain("kicker");
        });

        it("renders a detail dialog with id, crumb, body and foot note", () => {
            const d = w.detailDialog("rs-x", "inv_a", "bad", "Titel", "Crumb", "<p>Body</p>", "Fuß & Note");
            expect(d).toContain("<dialog class=\"dlg detail\" id=\"dlg-rs-x\">");
            expect(d).toContain("<div class=\"dlg-title\">Titel</div><div class=\"kicker\">Crumb</div>");
            expect(d).toContain("<div class=\"dlg-body\"><p>Body</p></div>");
            expect(d).toContain("<span class=\"note\">Fuß &amp; Note</span>");
            const bare = w.detailDialog("y", "inv_a", "", "T", "", "b");
            expect(bare).not.toContain("class=\"kicker\"");
            expect(bare).toContain("<span class=\"note\"></span>");
        });

        it("lists up to three raiders with values and counts the rest", () => {
            expect(w.whoList("L", [])).toBe("");
            expect(w.whoList("L", null)).toBe("");
            const list = [{ name: "A", type: "Mage" }, { name: "B", type: "Bard" }, { name: "C", type: "Priest" }, { name: "D", type: "Rogue" }, { name: "E", type: "Rogue" }];
            const html = w.whoList("Fehlte", list, (p) => `${p.name}!`);
            expect(html).toMatch(/^<div class="mc-who"><span class="kicker">Fehlte<\/span>/);
            expect(html).toContain("<span class=\"cn\" style=\"--cc:#69CCF0\">A</span></span><span class=\"mono mute\">A!</span>");
            expect(html).toContain("<span class=\"cn\" style=\"--cc:var(--text)\">B</span>");
            expect(html).not.toContain(">D<");
            expect(html).toContain("<span class=\"mute\">+2</span>");
            expect(w.whoList("L", [{ name: "A", type: "Mage" }])).not.toContain("mono mute");
        });

        it("lists up to three things that are not raiders", () => {
            expect(w.whatList("Boss", [])).toBe("");
            expect(w.whatList("Boss", ["Gruul", "Maulgar"])).toBe("<div class=\"mc-who\"><span class=\"kicker\">Boss</span><span>Gruul, Maulgar</span></div>");
            expect(w.whatList("Boss", ["a", "b", "c", "d"])).toContain("<span>a, b, c +1</span>");
        });

        it("renders a metric card with value, unit, tone, badges and the dialog it opens", () => {
            const html = w.metricCard({ id: "gear", icon: "inv_a", label: "Gear", value: "3", unit: "Probleme", tone: "bad", badges: ["<b1>", "<b2>"], who: "<who>", tip: "Erklärung", extra: "<x>", wide: true });
            expect(html).toContain("<div class=\"mcard wide\" id=\"rs-gear\" role=\"button\" tabindex=\"0\" data-dialog=\"dlg-rs-gear\">");
            expect(html).toContain("<span class=\"mc-label\" data-tip=\"Gear\" data-tip-sub=\"Erklärung\">Gear</span>");
            expect(html).toContain("<div class=\"mc-val bad\">3<small>Probleme</small></div><div class=\"mc-foot\"><b1><b2></div>");
            expect(html).toContain("<x><who>");
            const plain = w.metricCard({ id: "a", icon: "i", label: "L", value: "1" });
            expect(plain).toContain("<div class=\"mcard\" id=\"rs-a\"");
            expect(plain).toContain("<div class=\"mc-val\">1</div><div class=\"mc-foot\"></div>");
            expect(plain).not.toContain("data-tip-sub");
        });

        it("renders a KPI with sub line, tones and tooltips", () => {
            const html = w.kpi("inv_a", "Tode", "4", { text: "2 vermeidbar", bad: true }, "high", "bad", "Tip", "Sub");
            expect(html).toContain("<div class=\"kpi tone-high\" data-tip=\"Tip\" data-tip-sub=\"Sub\">");
            expect(html).toContain("<div class=\"kpi-v bad\">4 <small class=\"bad\">· 2 vermeidbar</small></div>");
            const plain = w.kpi("inv_a", "Bosse", "2", { text: "1 Kill" });
            expect(plain).toContain("<div class=\"kpi\">");
            expect(plain).toContain("<div class=\"kpi-v\">2 <small>· 1 Kill</small></div>");
            expect(w.kpi("inv_a", "X", "1", null)).toContain("<div class=\"kpi-v\">1</div>");
        });
    });

    describe("bars", () => {
        it("clamps a bar to 0–100 % and escapes text and tone", () => {
            expect(w.barCell("5 %", 150, "good", "Tip", "Sub")).toBe("<span class=\"bar\" data-tip=\"Tip\" data-tip-sub=\"Sub\"><i class=\"good\" style=\"width:100%\"></i><b class=\"good\">5 %</b></span>");
            expect(w.barCell("<x>", -5)).toBe("<span class=\"bar\"><i style=\"width:0%\"></i><b>&lt;x&gt;</b></span>");
            expect(w.barCell("n", "abc", "", "T")).toBe("<span class=\"bar\" data-tip=\"T\"><i style=\"width:0%\"></i><b>n</b></span>");
        });

        it("tones a percentage bar with pctTone", () => {
            expect(w.barPct(96)).toBe("<span class=\"bar\"><i class=\"good\" style=\"width:96%\"></i><b class=\"good\">96 %</b></span>");
            expect(w.barPct(50, "T")).toContain("class=\"high\"");
        });

        it("draws healing and overheal as one bar relative to the column maximum", () => {
            const html = w.healBar(6000, 2000, 10000, 25, "Tip", "Sub");
            expect(html).toBe("<span class=\"bar bar-heal\" data-tip=\"Tip\" data-tip-sub=\"Sub\"><i class=\"main\" style=\"width:60%\"></i><i class=\"over\" style=\"left:60%;width:20%\"></i><b>6,0k</b><em class=\"\">25 %</em></span>");
            expect(w.healBar(100, 100, 100, 50)).toContain("<i class=\"main\" style=\"width:100%\"></i><i class=\"over\" style=\"left:100%;width:0%\"></i>");
            expect(w.healBar(0, 0, 0, 35)).toContain("<em class=\"medium\">35 %</em>");
            expect(w.healBar(1, 1, 1, 50)).toContain("<em class=\"high\">50 %</em>");
            expect(w.HEAL_BAR_HOW).toMatch(/Overheal/);
        });
    });

    describe("icon tiles", () => {
        it("resolves a missing icon from the RPB config by name", () => {
            expect(w.ICON_BY_NAME.Whirlwind).toBe("ability_whirlwind");
        });

        it("renders an icon tile linked to Wowhead with count and note", () => {
            const html = w.iconTile({ icon: "spell_fire_fireball", label: "Fireball", count: 12, spellId: 25306, tone: "warn", note: "Rang 12" });
            expect(html).toBe(`<a class="itile warn" href="https://www.wowhead.com/tbc/spell=25306" target="_blank" rel="noopener" data-tip="Fireball ×12" data-tip-sub="Rang 12" data-disable-wowhead-tooltip="true"><img src="${ICON("spell_fire_fireball")}" loading="lazy" alt=""><span class="n">12</span></a>`);
        });

        it("prefers the item page and falls back to the name lookup for the icon", () => {
            const html = w.iconTile({ name: "Whirlwind", label: "WW", itemId: 7, spellId: 1 });
            expect(html).toContain("href=\"https://www.wowhead.com/tbc/item=7\"");
            expect(html).toContain(ICON("ability_whirlwind"));
            expect(html).toContain("data-tip=\"WW\"");
            expect(html).not.toContain("class=\"n\"");
        });

        it("renders a label pill when no icon resolves, linked or not", () => {
            expect(w.iconTile({ label: "Kick", count: 0 })).toBe("<span class=\"ipill\" data-tip=\"Kick ×0\" data-disable-wowhead-tooltip=\"true\"><span>Kick</span><span class=\"n\">0</span></span>");
            expect(w.iconTile({ label: "Kick", spellId: 1766, tone: "good" })).toBe("<a class=\"ipill good\" href=\"https://www.wowhead.com/tbc/spell=1766\" target=\"_blank\" rel=\"noopener\" data-tip=\"Kick\" data-disable-wowhead-tooltip=\"true\"><span>Kick</span></a>");
            expect(w.iconTile({ icon: "inv_a", label: "A" })).toMatch(/^<span class="itile" data-tip="A"/);
        });

        it("wraps tiles in a row or shows a dash", () => {
            expect(w.iconRow([])).toBe("<span class=\"sritems\">–</span>");
            expect(w.iconRow(["<a>", "<b>"])).toBe("<div class=\"iconrow\"><a><b></div>");
        });
    });

    describe("number formats", () => {
        it("formats thousands with a German comma and rounds large numbers", () => {
            expect(w.fmtK(999.6)).toBe("1000");
            expect(w.fmtK(1500)).toBe("1,5k");
            expect(w.fmtK(123456)).toBe("123k");
            expect(w.fmtK("x")).toBe("0");
        });

        it("formats seconds and thousands-separated numbers", () => {
            expect(w.fmtSecs(1250)).toBe("1,3 s");
            expect(w.num(1234567.4)).toBe("1.234.567");
            expect(w.num(undefined)).toBe("0");
        });

        it("sums and averages a picked field, tolerating empty lists and junk", () => {
            const list = [{ v: 1 }, { v: "2" }, { v: "x" }];
            expect(w.sumOf(list, (x) => x.v)).toBe(3);
            expect(w.sumOf(null, (x) => x.v)).toBe(0);
            expect(w.avgOf(list, (x) => x.v)).toBe(1);
            expect(w.avgOf([], (x) => x.v)).toBe(0);
        });

        it("looks up class colours", () => {
            expect(w.classColorOf("Shaman")).toBe("#0070DE");
            expect(w.classColorOf("Nope")).toBe("");
        });
    });
});
