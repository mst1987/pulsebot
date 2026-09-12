// The player page's own DPS/HPS curve against the raid mean (issue #203):
// drawn from timeline.fights[].series.players, the dip chips beside it, the
// hero chip from report.fightSeries — and nothing at all without a curve.
const { renderPlayerPage, renderReportPage } = require("../../src/web/render.js");

function report(over = {}) {
    return {
        id: "abc123def456",
        title: "Test Raid",
        zone: "Gruul's Lair",
        date: "2026-09-10",
        players: [{ name: "Alice", type: "Mage", issues: [] }, { name: "Heal", type: "Priest", issues: [] }],
        roster: [
            { name: "Alice", type: "Mage", issues: [], potions: {}, armory: [] },
            { name: "Heal", type: "Priest", issues: [], potions: {}, armory: [] },
        ],
        ...over,
    };
}

/** One kill with a raid series and five raiders' curves, one of them dead at 10 s. */
function fight(over = {}) {
    const flat = (v) => [v, v, v, v, v];
    return {
        id: 3, boss: "Gruul the Dragonkiller", encounterId: 650, contentId: "gruul", kill: true, fightPercentage: 0,
        startTime: 100000, endTime: 120000, duration: 20000,
        deaths: [{ at: 10000, name: "Alice", type: "Mage", ability: "Cave In" }, { at: 15000, name: "Bob", type: "Warlock" }],
        debuffs: null, totems: null, activity: null, buffs: null,
        cooldowns: { windows: [{ label: "Bloodlust", from: 5000, to: 45000 }], players: [] },
        healers: { healers: [{ name: "Heal", type: "Priest", heal: { total: 1, overhealPct: 0, spells: [] }, mana: { available: false }, dispels: null }], shields: [], tank: null },
        series: {
            step: 5000,
            dps: [1000, 1000, 1000, 1000, 1000],
            hps: [400, 400, 400, 400, 400],
            bossHp: [100, 80, 60, 40, 0],
            players: [
                { name: "Alice", type: "Mage", dps: [300, 60, 0, 0, 0] },
                { name: "Bob", type: "Warlock", dps: flat(200) },
                { name: "Cid", type: "Rogue", dps: flat(200) },
                { name: "Dee", type: "Hunter", dps: flat(200) },
                { name: "Eve", type: "Warrior", dps: flat(100) },
                { name: "Heal", type: "Priest", dps: flat(20), hps: [400, 400, 400, 400, 400] },
            ],
        },
        ...over,
    };
}

describe("web/render — the player's own curve (issue #203)", () => {
    it("draws the raider's DPS against the raid mean per player = raid series over the raiders with a DPS curve", () => {
        const html = renderPlayerPage(report({ timeline: { fights: [fight()] } }), 0);
        expect(html).toContain("player-series");
        expect(html).toContain("<title>DPS Alice</title>");
        // six raiders carry a DPS curve (the priest too), so the mean is 1000 / 6 ≈ 167 per bucket
        expect(html).toContain("<title>Raid-Mittel pro Spieler (6)</title>");
        expect(html).toContain("<th>Raid-Mittel pro Spieler (6)</th>");
        expect(html).toMatch(/<td>0:00<\/td><td>300<\/td><td>167<\/td>/);
        // the raid strip of the report page is not on the player page, and the other way round
        expect(html).not.toContain("<title>Raid-DPS</title>");
        const raid = renderReportPage(report({ timeline: { fights: [fight()] } }));
        expect(raid).toContain("<title>Raid-DPS</title>");
        expect(raid).not.toContain("player-series");
    });

    it("divides by exactly the raiders with a curve: five raiders → raid series / 5", () => {
        const f = fight();
        f.series.players = f.series.players.filter((p) => p.name !== "Heal");
        const html = renderPlayerPage(report({ timeline: { fights: [f] } }), 0);
        expect(html).toContain("Raid-Mittel pro Spieler (5)");
        expect(html).toMatch(/<td>0:05<\/td><td>60<\/td><td>200<\/td>/);
    });

    it("marks only the raider's own death and the Bloodlust window, and counts dips up to the death", () => {
        const html = renderPlayerPage(report({ timeline: { fights: [fight()] } }), 0);
        // Alice died at 0:10; Bob's death at 0:15 is not her marker
        expect(html).toContain("0:10 Alice († Cave In)");
        expect(html).not.toContain("0:15 Bob");
        expect(html).toContain("0:05 · Bloodlust · bis 0:45");
        expect(html).toContain("spell_nature_bloodlust");
        // alive buckets: 300, 60 → mean 180, one of two below 90 → 50 %; the zeros after the death do not count
        expect(html).toContain("<b>50 %</b> der Zeit DPS-Einbrüche");
        expect(html).toContain("<b>Ø 180</b> DPS");
        expect(html).toContain("<b>Ø 167</b> Raid-Mittel pro Spieler");
    });

    it("draws HPS for a healer of the fight, against the raid HPS over the raiders with an HPS curve", () => {
        const html = renderPlayerPage(report({ timeline: { fights: [fight()] } }), 1);
        expect(html).toContain("<title>HPS Heal</title>");
        expect(html).toContain("Raid-Mittel pro Spieler (1)");
        expect(html).toMatch(/<td>0:00<\/td><td>400<\/td><td>400<\/td>/);
        expect(html).toContain("<b>0 %</b> der Zeit HPS-Einbrüche");
        expect(html).not.toContain("DPS-Einbrüche");
    });

    it("shows the dip share over the raid as a hero chip from report.fightSeries", () => {
        const base = report({ timeline: { fights: [fight()] } });
        const html = renderPlayerPage({ ...base, fightSeries: { players: [
            { name: "Alice", type: "Mage", measure: "dps", fights: 3, dipPct: 42, avgDps: 500, avgHps: 0 },
            { name: "Heal", type: "Priest", measure: "hps", fights: 3, dipPct: 4, avgDps: 20, avgHps: 800 },
        ] } }, 0);
        expect(html).toContain("<b>42 %</b> DPS-Einbrüche");
        expect(html).toContain("über 3 Kämpfe");
        const healer = renderPlayerPage({ ...base, fightSeries: { players: [{ name: "Heal", type: "Priest", measure: "hps", fights: 1, dipPct: 4, avgDps: 20, avgHps: 800 }] } }, 1);
        expect(healer).toContain("chip chip-ok");
        expect(healer).toContain("<b>4 %</b> HPS-Einbrüche");
        expect(healer).toContain("über 1 Kampf\"");
        // no summary, no hero chip (the per-fight chip under the curve says "der Zeit")
        expect(renderPlayerPage(base, 0)).not.toContain("</b> DPS-Einbrüche</span>");
    });

    it("renders nothing for a raider without a curve and no timeline at all, without an error", () => {
        const f = fight({ deaths: [] });
        f.series.players = f.series.players.filter((p) => p.name !== "Alice");
        const none = renderPlayerPage(report({ timeline: { fights: [f] } }), 0);
        expect(none).not.toContain("player-series");
        expect(none).not.toContain("<h2>Kampfverlauf</h2>");
        const noSeries = renderPlayerPage(report({ timeline: { fights: [fight({ series: null, deaths: [{ at: 1000, name: "Alice", type: "Mage" }] })] } }), 0);
        expect(noSeries).toContain("<h2>Kampfverlauf</h2>");
        expect(noSeries).not.toContain("player-series");
        expect(renderPlayerPage(report(), 0)).toContain("Alice");
    });

    it("lists a raider on the timeline for their curve alone", () => {
        const f = fight({ deaths: [], cooldowns: null, healers: null });
        f.series.players = [{ name: "Alice", type: "Mage", dps: [1, 2, 3, 4, 5] }];
        const html = renderPlayerPage(report({ timeline: { fights: [f] } }), 0);
        expect(html).toContain("Kampfverlauf");
        expect(html).toContain("<title>DPS Alice</title>");
        expect(html).toContain("Raid-Mittel pro Spieler (1)");
    });
});
