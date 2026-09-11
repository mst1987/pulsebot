// The "Heilung" topic of the fight timeline and the "Heiler" tab of the report page.
const { renderReportPage, renderPlayerPage } = require("../../src/web/render.js");

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

describe("web/render — Heilung topic of a fight", () => {
    it("adds a Heilung topic with one block per healer: chips, mana curve with its potion, spell table", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html).toContain("data-show=\"fp-2-healing\">Heilung<span class=\"n\">2</span>");
        expect(html).toContain("<span class=\"cn\">Elun</span>");
        expect(html).toContain("<b>23 %</b> Overheal");
        expect(html).toContain("<b>155k</b> Heilung");
        expect(html).toContain("<b>20,0k</b> Absorb");
        expect(html).toContain("<b>5 %</b> Mana-Tiefstand bei 1:58");
        expect(html).toContain("<b>2</b> Dispels · Ø 1,2 s");
        expect(html).toContain("<title>Mana Elun</title>");
        expect(html).toContain("<title>1:00 · Super-Manatrank · bei 52 %</title>");
        expect(html).toContain("Regeneration (1)");
        expect(html).toContain("Greater Heal</td><td>60,0k</td><td>40 %</td><td>50 %</td>");
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
        expect(html).toContain("<title>Erdschild (Dorn): 0:02–1:02</title>");
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

describe("web/render — Heiler tab", () => {
    it("shows the tab with a row per healer and the raid's missed dispels above", () => {
        const html = renderReportPage({ ...report(), timeline: timeline(), healers: summary() });
        expect(html).toContain("data-tab=\"healers\"");
        expect(html).toContain("<span>Heiler</span><span class=\"tab-count\">2</span>");
        expect(html).toContain("3 dispelbare Debuffs hat niemand entfernt");
        expect(html).toContain("Stille (3×)");
        expect(html).toContain("gemessen auf dem aktiven Tank (Brokk)");
        expect(html).toContain("<a class=\"cn\" href=\"/r/abc123def456/p/0\">Elun</a>");
        expect(html).toContain("<td>450k</td>");
        expect(html).toContain("<td class=\"mid\">43 %</td>");
        expect(html).toContain("Greater Heal <span class=\"sritems\">40 %</span>");
        expect(html).toContain("9 % <span class=\"tag tag-high\">2× &lt; 10 %</span>");
        expect(html).toContain("3 <span class=\"tag tag-medium\">2× spät</span>");
        expect(html).toContain("0 <span class=\"tag tag-medium\">2× keiner</span>");
        expect(html).toContain("6 <span class=\"sritems\">Ø 1,2 s</span>");
        expect(html).toContain("title=\"Erdschild: Ø 92 % in 3 Kämpfen\"");
    });

    it("leaves the tab out without healer data", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html).not.toContain("data-tab=\"healers\"");
        expect(renderReportPage({ ...report(), healers: { players: [], raid: {} } })).not.toContain("data-tab=\"healers\"");
    });
});

describe("web/render — Heilung on the player page", () => {
    it("gives a healer their own block and their own tank rows, nothing of the other healer", () => {
        const html = renderPlayerPage({ ...report(), timeline: timeline(), healers: summary() }, 1); // Dorn
        expect(html).toContain("<h2>Kampfverlauf</h2>");
        expect(html).toContain("Heilung<span class=\"n\">1</span>");
        expect(html).toContain("<span class=\"cn\">Dorn</span>");
        expect(html).not.toContain("<span class=\"cn\">Elun</span>");
        expect(html).toContain("Erdschild (Dorn)");
        expect(html).not.toContain("Erneuerung (Elun)");
        expect(html).not.toContain("Nie entfernte Debuffs");
    });

    it("lists the fight for the tank too, because the shields are on them", () => {
        const html = renderPlayerPage({ ...report(), timeline: timeline() }, 2); // Brokk
        expect(html).toContain("<h2>Kampfverlauf</h2>");
        expect(html).toContain("Schilde &amp; HoTs auf Brokk");
        expect(html).toContain("Erdschild (Dorn)");
        expect(html).toContain("Erneuerung (Elun)");
        expect(html).not.toContain("<span class=\"cn\">Elun</span>");
    });
});
