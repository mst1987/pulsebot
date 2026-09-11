// The "Kampfverlauf" tab of the report page and its slice on the player page.
const { renderReportPage, renderPlayerPage } = require("../../src/web/render.js");

function report() {
    return {
        id: "abc123def456",
        title: "Test Raid",
        zone: "Gruul's Lair",
        date: "2026-09-10",
        players: [{ name: "Alice", type: "Mage", issues: [] }, { name: "Bob", type: "Warrior", issues: [] }],
        roster: [
            { name: "Alice", type: "Mage", issues: [], potions: {}, armory: [] },
            { name: "Bob", type: "Warrior", issues: [], potions: {}, armory: [] },
        ],
    };
}

function timeline() {
    return {
        fights: [
            {
                id: 2, boss: "High King Maulgar", contentId: "gruul", kill: false, fightPercentage: 32.5,
                startTime: 100000, endTime: 220000, duration: 120000,
                deaths: [{ at: 30000, name: "Alice", type: "Mage", ability: "Arcane Explosion", abilityIcon: "spell_nature_wispsplode" }],
                debuffs: null, totems: null, cooldowns: null, activity: null, buffs: null,
            },
            {
                id: 3, boss: "Gruul the Dragonkiller", contentId: "gruul", kill: true, fightPercentage: 0,
                startTime: 300000, endTime: 480000, duration: 180000,
                deaths: [],
                debuffs: [{ key: "sunder", label: "Sunder Armor", icon: "ability_warrior_sunder", stacks: [{ from: 0, to: 180000, stacks: 5 }], maxStacks: 5, uptimePct: 100 }],
                totems: [{ name: "Bob", type: "Warrior", rows: [{ label: "Windfury", markers: [{ at: 1000 }], band: [[1000, 180000]], downtimes: [], uptimePct: 99 }] }],
                cooldowns: { windows: [{ label: "Bloodlust", from: 0, to: 40000 }], players: [{ name: "Alice", type: "Mage", rows: [{ label: "Icy Veins", markers: [{ at: 2000 }] }] }] },
                activity: [{ name: "Alice", type: "Mage", bands: [[0, 170000]], gaps: [], activePct: 94 }],
                series: { step: 60000, dps: [1000, 1200, 900], hps: [300, 400, 200], bossHp: [100, 60, 10] },
            },
        ],
    };
}

describe("web/render — Kampfverlauf tab", () => {
    it("shows the tab with one entry per boss fight when the report carries a timeline", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html).toContain("data-tab=\"timeline\"");
        expect(html).toContain("Kampfverlauf");
        expect(html).toContain("id=\"fight-2\"");
        expect(html).toContain("id=\"fight-3\"");
        expect(html).toContain("href=\"#fight-3\"");
        expect(html).toContain("Wipe bei 33 %");
        expect(html).toContain("Kill · 3:00 · 0 Tode");
    });

    it("leaves the tab out for a report without a timeline", () => {
        const html = renderReportPage(report());
        expect(html).not.toContain("data-tab=\"timeline\"");
        expect(html).not.toContain("id=\"fight-");
    });

    it("draws the bare fight axis with its deaths when no analyzer has filled a fight yet", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html).toContain("Kampf (Wipe)");
        expect(html).toContain("<title>0:30 Alice († Arcane Explosion)</title>");
        // the death list links to the raider's page, in the class colour
        expect(html).toContain("<li style=\"--cc:#69CCF0\"><b>0:30</b><a class=\"cn\" href=\"/r/abc123def456/p/0\">Alice</a>");
    });

    it("renders every filled topic of a fight as its own chart", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html).toContain("<h4>Verlauf</h4>");
        expect(html).toContain("<h4>Debuffs auf dem Boss</h4>");
        expect(html).toContain("<h4>Totems</h4>");
        expect(html).toContain("<h4>Cooldowns</h4>");
        expect(html).toContain("<h4>Aktivität</h4>");
        expect(html).toContain("Bob · Windfury");
        expect(html).toContain("Alice · Icy Veins");
        expect(html).toContain("Bloodlust: 0:00–0:40");
        expect(html).toContain("5/5 Stacks");
        expect(html).toContain("Niemand ist gestorben.");
    });

    it("opens with a deaths-per-boss overview linking into the fights", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html).toContain("Tode pro Boss");
        expect(html).toContain("<a href=\"#fight-2\">");
    });

    it("includes the chart styles once", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html.match(/\.fchart \.fc-band \{/g)).toHaveLength(1);
    });
});

describe("web/render — Kampfverlauf on the player page", () => {
    it("gives the raider only their own rows and deaths", () => {
        const html = renderPlayerPage({ ...report(), timeline: timeline() }, 0); // Alice
        expect(html).toContain("<h2>Kampfverlauf</h2>");
        expect(html).toContain("id=\"fight-2\"");   // she died there
        expect(html).toContain("id=\"fight-3\"");   // her cooldown and activity rows
        expect(html).toContain("Icy Veins");
        expect(html).not.toContain("Bob · Windfury");
        expect(html).not.toContain("<h4>Debuffs auf dem Boss</h4>"); // raid-wide, not hers
        expect(html).not.toContain("<h4>Verlauf</h4>");
    });

    it("lists only the fights the raider shows up in, and nothing without any", () => {
        const html = renderPlayerPage({ ...report(), timeline: timeline() }, 1); // Bob: totems on fight 3 only
        expect(html).toContain("<h2>Kampfverlauf</h2>");
        expect(html).toContain("id=\"fight-3\"");
        expect(html).not.toContain("id=\"fight-2\"");
        expect(html).toContain("<h4>Totems</h4>");
        const none = renderPlayerPage({ ...report(), timeline: { fights: [] } }, 1);
        expect(none).not.toContain("<h2>Kampfverlauf</h2>");
        const legacy = renderPlayerPage(report(), 1);
        expect(legacy).not.toContain("<h2>Kampfverlauf</h2>");
    });
});
