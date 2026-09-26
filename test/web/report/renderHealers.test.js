// The "Heilung" topic of the fight timeline and the "Heiler" tab of the report page.
const { renderReportPage, renderPlayerPage } = require("../../../src/web/report/render.js");

function report() {
    return {
        id: "abc123def456",
        title: "Test Raid",
        zone: "Gruul's Lair",
        date: "2026-09-10",
        players: [{ name: "Elun", type: "Priest", issues: [] }, { name: "Dorn", type: "Shaman", issues: [] }, { name: "Brokk", type: "Warrior", issues: [] }],
        roster: [
            { name: "Elun", type: "Priest", issues: [], potions: {}, armory: [] },
            { name: "Dorn", type: "Shaman", issues: [], potions: {}, armory: [] },
            { name: "Brokk", type: "Warrior", issues: [], potions: {}, armory: [] },
        ],
    };
}

function healersBlock() {
    return {
        healers: [
            {
                name: "Elun", type: "Priest", id: 1, judgedUntil: 120000, diedAt: null,
                healing: { total: 155000, overheal: 45000, absorbs: 20000, overhealPct: 23, spells: [
                    { guid: 25314, name: "Greater Heal", icon: "spell_holy_greaterheal", total: 60000, overheal: 40000, overhealPct: 40, share: 50, casts: 30 },
                    { guid: 25235, name: "Flash Heal", icon: "spell_holy_flashheal", total: 95000, overheal: 5000, overhealPct: 5, share: 50, casts: 80 },
                ] },
                mana: { available: true, step: 5000, values: Array.from({ length: 25 }, (_, i) => Math.max(5, 100 - i * 4)), min: 5, minAt: 118000, lowMs: 12000, empty: true,
                    regen: [{ at: 60000, key: "superMana", label: "Super-Manatrank", icon: "inv_potion_137", kind: "potion", amount: 3000, pct: 52 }] },
                potions: 1, potionMissing: false,
                dispels: { count: 2, avgReactionMs: 1200, list: [] },
            },
            {
                name: "Dorn", type: "Shaman", id: 5, judgedUntil: 90000, diedAt: 90000,
                healing: { total: 80000, overheal: 60000, absorbs: 0, overhealPct: 43, spells: [{ guid: 25423, name: "Chain Heal", icon: "spell_nature_healingwavegreater", total: 80000, overheal: 60000, overhealPct: 43, share: 100, casts: 40 }] },
                mana: { available: false, step: 5000, values: [], min: null, minAt: null, lowMs: 0, empty: false, regen: [] },
                potions: 0, potionMissing: true,
                dispels: { count: 0, avgReactionMs: null, list: [] },
            },
        ],
        tank: { id: 3, name: "Brokk", type: "Warrior", judgedUntil: 120000 },
        shields: [
            { key: "earthShield", label: "Erdschild", name: "Earth Shield", icon: "spell_nature_skinofearth", source: "Dorn", sourceType: "Shaman", bands: [[2000, 62000], [70000, 120000]], maxStacks: 0, uptimePct: 92, gapCount: 2, longestGap: 8000, firstAt: 2000, fullStacksPct: null },
            { key: "renew", label: "Erneuerung", name: "Renew", icon: "spell_holy_renew", source: "Elun", sourceType: "Priest", bands: [[0, 30000]], maxStacks: 0, uptimePct: 25, gapCount: 1, longestGap: 90000, firstAt: 0, fullStacksPct: null },
        ],
        dispels: { total: 2, missed: [{ at: 50000, ability: "Stille", icon: "spell_holy_silence", guid: "30225", target: "Brokk", targetType: "Warrior", durationMs: 8000 }], others: [] },
    };
}

function timeline() {
    return {
        fights: [
            { id: 2, boss: "High King Maulgar", encounterId: 649, contentId: "gruul", kill: true, fightPercentage: 0, startTime: 100000, endTime: 220000, duration: 120000, deaths: [{ at: 90000, name: "Dorn", type: "Shaman" }], healers: healersBlock() },
            { id: 4, boss: "Gruul the Dragonkiller", encounterId: 650, contentId: "gruul", kill: true, fightPercentage: 0, startTime: 500000, endTime: 700000, duration: 200000, deaths: [], healers: null },
        ],
    };
}

function summary() {
    return {
        players: [
            { name: "Elun", type: "Priest", fights: 3, healingTotal: 450000, overhealTotal: 130000, absorbs: 60000, overhealPct: 22, topOverheal: { name: "Greater Heal", icon: "spell_holy_greaterheal", overheal: 120000, total: 180000, overhealPct: 40, overhealShare: 92 }, manaFights: 3, manaMinAvg: 9, manaLowFights: 2, lowMs: 30000, potions: 3, potionPcts: [52, 8, 12], potionMissingFights: 0, dispels: 6, avgReactionMs: 1200, shields: [{ key: "renew", label: "Erneuerung", icon: "spell_holy_renew", fights: 3, uptimeAvg: 25 }] },
            { name: "Dorn", type: "Shaman", fights: 3, healingTotal: 240000, overhealTotal: 180000, absorbs: 0, overhealPct: 43, topOverheal: { name: "Chain Heal", icon: "spell_nature_healingwavegreater", overheal: 180000, total: 240000, overhealPct: 43, overhealShare: 100 }, manaFights: 0, manaMinAvg: null, manaLowFights: 0, lowMs: 0, potions: 0, potionPcts: [], potionMissingFights: 2, dispels: 0, avgReactionMs: null, shields: [{ key: "earthShield", label: "Erdschild", icon: "spell_nature_skinofearth", fights: 3, uptimeAvg: 92 }] },
        ],
        raid: { dispelsMissed: 3, missedByAbility: [{ ability: "Stille", icon: "spell_holy_silence", count: 3 }], tanks: ["Brokk"] },
    };
}

describe("web/report/render — Heilung topic of a fight", () => {
    it("adds a Heilung topic with one block per healer: chips, mana curve with its potion, spell table", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html).toContain("data-show=\"fp-2-healing\">");
        expect(html).toMatch(/Heilung<span class="n(?: mid| bad)?">2 · 2 Heiler<\/span>/);
        expect(html).toContain("<span class=\"cn\">Elun</span>");
        expect(html).toContain("<b>23 %</b> Overheal");
        expect(html).toContain("<b>155k</b> Heilung");
        expect(html).toContain("<b>20,0k</b> Absorb");
        expect(html).toContain("<b>5 %</b> Mana-Tiefstand bei 1:58");
        expect(html).toContain("<b>2</b> Dispels · Ø 1,2 s");
        expect(html).toContain("data-tip=\"Mana Elun\"");
        expect(html).toContain("data-tip=\"1:00 · Super-Manatrank · bei 52 %\"");
        expect(html).toContain("Regeneration (1)");
        // WCL-style bars: the healing relative to the strongest spell (60k of 95k), the overheal and the share as their own length
        // one WCL-style bar per spell — the solid part landed, the hatched part is overheal, both as their share of the
        // largest healing + overheal (100k here) — ranked by what landed: Flash Heal first, Greater Heal second
        expect(html).toContain("<td class=\"rank\">1</td><td><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/spell_holy_flashheal.jpg\" alt=\"\">Flash Heal</td><td><span class=\"bar bar-heal\" data-tip=\"95.000 effektive Heilung, 5.000 Overheal (5 %) · 80 Casts\" data-tip-sub=\"Der gestreifte Teil ging über volle Lebenspunkte (Overheal). Der ganze Balken ist der Anteil am größten Wert der Spalte, Heilung und Overheal zusammen.\"><i class=\"main\" style=\"width:95%\"></i><i class=\"over\" style=\"left:95%;width:5%\"></i><b>95,0k</b><em class=\"\">5 %</em></span></td><td><span class=\"bar\"><i style=\"width:50%\"></i><b>50 %</b></span></td>");
        expect(html).toContain("<td class=\"rank\">2</td><td><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/spell_holy_greaterheal.jpg\" alt=\"\">Greater Heal</td><td><span class=\"bar bar-heal\" data-tip=\"60.000 effektive Heilung, 40.000 Overheal (40 %) · 30 Casts\"");
        expect(html).toContain("<i class=\"main\" style=\"width:60%\"></i><i class=\"over\" style=\"left:60%;width:40%\"></i><b>60,0k</b><em class=\"medium\">40 %</em></span>");
        expect(html).toContain("<th></th><th>Zauber</th><th data-tip=\"Heilung und Overheal des Zaubers in einem Balken\"");
    });

    it("lists the healers as ranked rows — one bar, mana and dispel badges, hints — with the strongest open and the block under it", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html).toContain("<div class=\"hlist\"><div class=\"hcols\"><span class=\"kicker\">#</span><span class=\"kicker\">Heiler</span>");
        // Elun: rank 1, open, 155k on the bar with 23 % overheal, mana low at 1:58 (bad), 2 dispels
        expect(html).toMatch(/<details class="hrow" style="--cc:[^"]*" open>\s*<summary><span class="rank top">1<\/span><div class="who"><img class="hicon" src="https:\/\/wow\.zamimg\.com\/images\/wow\/icons\/large\/classicon_priest\.jpg" alt=""><div><span class="cn">Elun<\/span><span class="sritems">Priest<\/span><\/div><\/div><span class="bar bar-heal"/);
        expect(html).toContain("<b>155k</b><em class=\"\">23 %</em></span><span class=\"badge bad\"><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/inv_potion_137.jpg\" alt=\"\">5 % bei 1:58</span><span class=\"badge ok\"><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/spell_holy_dispelmagic.jpg\" alt=\"\">2 · Ø 1,2 s</span>");
        expect(html).toContain("<div class=\"hints\"><span class=\"badge\"><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/inv_misc_gem_01.jpg\" alt=\"\">20,0k Absorb</span></div><span class=\"exp-lbl\">");
        // Dorn: rank 2, closed, no mana curve, died, no potion
        expect(html).toMatch(/<details class="hrow" style="--cc:[^"]*">\s*<summary><span class="rank">2<\/span>/);
        expect(html).toContain("<span class=\"badge\"><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/inv_potion_137.jpg\" alt=\"\">kein Verlauf</span>");
        expect(html).toContain("gestorben 1:30</span><span class=\"badge mid\"><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/inv_potion_137.jpg\" alt=\"\">kein Manatrank</span>");
        // the block under the row: chips, the spell table, the way to the mana curve
        expect(html).toContain("<div class=\"hrow-body\"><div class=\"heal-chips\"><span class=\"chip\"");
        expect(html).toContain("data-dialog=\"dlg-fp-2-healing\"><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/inv_misc_pocketwatch_01.jpg\" alt=\"\">Manaverlauf öffnen<svg");
        // the player page keeps the plain block
        const own = renderPlayerPage({ ...report(), timeline: timeline() }, 1); // Elun
        expect(own).not.toContain("<div class=\"hlist\">");
        expect(own).toContain("<div class=\"heal-block\"");
    });

    it("says when a healer's mana is not in the log, notes the missing potion and the death", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html).toContain("Kein Manaverlauf im Log");
        expect(html).toContain("<b>kein</b> Manatrank");
        expect(html).toContain("Shaman · gestorben 1:30");
    });

    it("draws the tank's shields and HoTs as a ribbon per aura and source, judging only the expected ones", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html).toContain("Schilde &amp; HoTs auf Brokk<span class=\"meta\">Tank · Warrior</span>");
        expect(html).toContain("data-tip=\"Erdschild (Dorn)\" data-tip-sub=\"0:02–1:02\"");
        expect(html).toContain("<b class=\"fc-medium\">92%</b>");
        // a Renew's uptime is not a verdict: no tone on its value
        expect(html).toContain("<b class=\"\">25%</b>");
        expect(html).toContain("2 Lücken");
    });

    it("lists the dispellable debuffs nobody removed", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html).toContain("Nie entfernte Debuffs<span class=\"meta\">1</span>");
        expect(html).toContain("<b>0:50</b><span class=\"cn\">Brokk</span>");
        expect(html).toContain("Stille · 0:08 lang");
    });

    it("leaves the topic out of a fight without healers", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html).not.toContain("fp-4-healing");
    });
});

describe("web/report/render — Heiler section", () => {
    it("shows the section with a row per healer and the raid's missed dispels above", () => {
        const html = renderReportPage({ ...report(), timeline: timeline(), healers: summary() });
        expect(html).toContain("id=\"rs-healers\"");
        // the metric card in Leistung, the table in its dialog
        expect(html).toContain("<div class=\"mc-val\">2<small>Heiler</small></div>");
        expect(html).toContain("<dialog class=\"dlg detail\" id=\"dlg-rs-healers\">");
        // the raid's missed dispels and the tank as badges, the details in their tooltips
        expect(html).toContain("data-tip=\"3 dispelbare Debuffs hat niemand entfernt\" data-tip-sub=\"Stille (3×)\"");
        expect(html).toContain("Tank: Brokk</span>");
        expect(html).toContain("<a class=\"cn\" href=\"/r/abc123def456/p/0\">Elun</a>");
        // ranked by healing, one bar each: Elun 450k + 130k overheal = the column's 580k, Dorn 240k + 180k
        expect(html).toMatch(/<td class="rank">1<\/td><td>(<a class="cn"[^>]*>|<span class="cn">)Elun/);
        expect(html).toContain("<td><span class=\"bar bar-heal\" data-tip=\"450.000 effektive Heilung, 130.000 Overheal (22 %) über 3 Kämpfe\" data-tip-sub=\"Der gestreifte Teil ging über volle Lebenspunkte (Overheal). Der ganze Balken ist der Anteil am größten Wert der Spalte, Heilung und Overheal zusammen.\"><i class=\"main\" style=\"width:78%\"></i><i class=\"over\" style=\"left:78%;width:22%\"></i><b>450k</b><em class=\"\">22 %</em></span></td>");
        expect(html).toMatch(/<td class="rank">2<\/td><td>(<a class="cn"[^>]*>|<span class="cn">)Dorn/);
        expect(html).toContain("<i class=\"main\" style=\"width:41%\"></i><i class=\"over\" style=\"left:41%;width:31%\"></i><b>240k</b><em class=\"medium\">43 %</em></span>");
        expect(html).toContain("<th></th><th>Heiler</th><th data-tip=\"Heilung und Overheal über alle Boss-Kämpfe in einem Balken, der stärkste Heiler zuerst\"");
        expect(html).toContain("Greater Heal <span class=\"sritems\">40 %</span>");
        expect(html).toContain("9 % <span class=\"tag tag-high\">2× &lt; 10 %</span>");
        expect(html).toContain("3 <span class=\"tag tag-medium\">2× spät</span>");
        expect(html).toContain("0 <span class=\"tag tag-medium\">2× keiner</span>");
        expect(html).toContain("6 <span class=\"sritems\">Ø 1,2 s</span>");
        expect(html).toContain("data-tip=\"Erdschild\" data-tip-sub=\"Ø 92 % Uptime auf dem aktiven Tank in 3 Kämpfen\"");
    });

    it("leaves the section out without healer data", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html).not.toContain("id=\"rs-healers\"");
        expect(renderReportPage({ ...report(), healers: { players: [], raid: {} } })).not.toContain("id=\"rs-healers\"");
    });

    it("marks the healers as such in the raider cards and gives them a Heilung section", () => {
        const html = renderReportPage({ ...report(), timeline: timeline(), healers: summary() });
        expect(html).toContain("data-name=\"Elun\" data-role=\"healer\"");
        expect(html).toContain("data-name=\"Brokk\" data-role=\"tank\""); // WCL's tank of the fight
        expect(html).toContain("spell_holy_flashheal.jpg\" alt=\"\">Overheal 43 %</span>");
        expect(html).toMatch(/Leistung<span class="n(?: mid| bad)?">\d+ % Overheal<\/span>/);
        expect(html).toContain("<b>Heilung &amp; Mana</b>");
    });
});

describe("web/report/render — Heilung on the player page", () => {
    it("gives a healer their own block and their own tank rows, nothing of the other healer", () => {
        const html = renderPlayerPage({ ...report(), timeline: timeline(), healers: summary() }, 1); // Dorn
        expect(html).toContain("id=\"p-fights\"");
        expect(html).toMatch(/Heilung<span class="n(?: mid| bad)?">1<\/span>/);
        expect(html).toContain("<span class=\"cn\">Dorn</span>");
        expect(html).not.toContain("<span class=\"cn\">Elun</span>");
        expect(html).toContain("Erdschild (Dorn)");
        expect(html).not.toContain("Erneuerung (Elun)");
        expect(html).not.toContain("Nie entfernte Debuffs");
    });

    it("lists the fight for the tank too, because the shields are on them", () => {
        const html = renderPlayerPage({ ...report(), timeline: timeline() }, 2); // Brokk
        expect(html).toContain("id=\"p-fights\"");
        expect(html).toContain("Schilde &amp; HoTs auf Brokk");
        expect(html).toContain("Erdschild (Dorn)");
        expect(html).toContain("Erneuerung (Elun)");
        expect(html).not.toContain("<span class=\"cn\">Elun</span>");
    });
});
