// The "Kampfverlauf" tab of the report page and its slice on the player page:
// boss tabs → try pills → topic switch, one of each open at a time.
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
                id: 2, boss: "High King Maulgar", encounterId: 649, contentId: "gruul", kill: false, fightPercentage: 32.5,
                startTime: 100000, endTime: 220000, duration: 120000,
                deaths: [{ at: 30000, name: "Alice", type: "Mage", ability: "Arcane Explosion", abilityIcon: "spell_nature_wispsplode" }],
                debuffs: null, totems: null, cooldowns: null, activity: null, buffs: null,
            },
            {
                id: 3, boss: "High King Maulgar", encounterId: 649, contentId: "gruul", kill: true, fightPercentage: 0,
                startTime: 300000, endTime: 480000, duration: 180000,
                deaths: [],
                debuffs: [{ key: "sunder", label: "Sunder Armor", icon: "ability_warrior_sunder", stacks: [{ from: 0, to: 180000, stacks: 5 }], maxStacks: 5, uptimePct: 100, timeToMax: 8000 }],
                totems: [{ name: "Bob", type: "Warrior", rows: [{ label: "Windfury", icon: "spell_nature_windfury", markers: [{ at: 1000 }], band: [[1000, 180000]], downtimes: [], uptimePct: 99 }] }],
                cooldowns: { windows: [{ label: "Bloodlust", from: 0, to: 40000 }], players: [{ name: "Alice", type: "Mage", rows: [{ label: "Icy Veins", icon: "spell_frost_coldhearted", markers: [{ at: 2000 }] }] }] },
                activity: [{ name: "Alice", type: "Mage", bands: [[0, 170000]], gaps: [{ from: 170000, to: 180000 }], activePct: 94 }],
                series: { step: 60000, dps: [1000, 1200, 900], hps: [300, 400, 200], bossHp: [100, 60, 10] },
            },
            {
                id: 4, boss: "Gruul the Dragonkiller", encounterId: 650, contentId: "gruul", kill: true, fightPercentage: 0,
                startTime: 500000, endTime: 700000, duration: 200000,
                deaths: [], debuffs: null, totems: null, cooldowns: null, activity: null, buffs: null,
            },
        ],
    };
}

describe("web/render — Kampfverlauf tab", () => {
    it("shows the tab with one boss tab per boss, carrying the WCL icon and the try count", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html).toContain("data-tab=\"timeline\"");
        expect(html.match(/<button type="button" class="boss-tab/g)).toHaveLength(2);
        expect(html).toContain("<img src=\"/bosses/649.jpg\" alt=\"\"><span class=\"boss-name\">High King Maulgar</span><span class=\"boss-tries boss-kill\">2 Tries</span>");
        expect(html).toContain("<img src=\"/bosses/650.jpg\" alt=\"\"><span class=\"boss-name\">Gruul the Dragonkiller</span><span class=\"boss-tries boss-kill\">1 Try</span>");
        // the first boss is open, the second hidden
        expect(html).toContain("class=\"boss-tab active\" data-show=\"fb-e649\"");
        expect(html).toContain("<div id=\"fb-e649\" class=\"fight-boss\">");
        expect(html).toContain("<div id=\"fb-e650\" class=\"fight-boss\" hidden>");
    });

    it("offers one try pill per pull of a boss and opens the first try", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html).toContain("class=\"try-pill active try-wipe\" data-show=\"fight-2\">Try 1<span class=\"s\">Wipe bei 33 % · 2:00</span>");
        expect(html).toContain("class=\"try-pill try-kill\" data-show=\"fight-3\">Try 2<span class=\"s\">Kill · 3:00</span>");
        expect(html).toContain("id=\"fight-2\">");
        expect(html).toContain("id=\"fight-3\" hidden>");
        // a boss with a single pull needs no pills
        expect(html.match(/<nav class="try-pills">/g)).toHaveLength(1);
        expect(html).toContain("Try 1/2 · Wipe bei 33 % · 2:00 · 1 Tod");
    });

    it("switches topics with a segmented control, the first topic open, the DPS strip above it", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html).toContain("class=\"seg-btn active\" data-show=\"fp-3-debuffs\">Debuffs<span class=\"n\">1</span>");
        expect(html).toContain("data-show=\"fp-3-totems\">Totems<span class=\"n\">1</span>");
        expect(html).toContain("data-show=\"fp-3-cooldowns\">Cooldowns<span class=\"n\">1</span>");
        expect(html).toContain("data-show=\"fp-3-activity\">Aktivität<span class=\"n\">1</span>");
        expect(html).toContain("data-show=\"fp-3-deaths\">Tode<span class=\"n\">0</span>");
        expect(html).toContain("<div id=\"fp-3-debuffs\" class=\"fight-part\">");
        expect(html).toContain("<div id=\"fp-3-totems\" class=\"fight-part\" hidden>");
        expect(html).toContain("<div class=\"fight-series\">");
        expect(html).toContain("Raid-DPS");
    });

    it("draws icon-only rows with the name in the tooltip and the value with a sub line", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html).toContain("title=\"Bob · Windfury\"");
        expect(html).toContain("title=\"Alice · Icy Veins\"");
        expect(html).toContain("<b class=\"fc-good\">100%</b><span>5/5 ab 0:08</span>");
        expect(html).toContain("<b class=\"fc-medium\">94%</b><span>1 Lücke</span>");
        expect(html).toContain("<b class=\"\">1×</b>");
        expect(html).toContain("Bloodlust: 0:00–0:40");
        expect(html).toContain("5/5 Stacks");
        // the activity row of a raider without an icon uses the class icon
        expect(html).toContain("<div class=\"fc-cell\" title=\"Alice\"><img src=\"https://wow.zamimg.com/images/wow/icons/medium/classicon_mage.jpg\"");
    });

    it("draws the bare fight axis with its deaths when no analyzer has filled a fight yet", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html).toContain("data-show=\"fp-2-fight\">Kampf<span class=\"n\">1</span>");
        expect(html).toContain("<title>0:30 Alice († Arcane Explosion)</title>");
        expect(html).toContain("<li style=\"--cc:#69CCF0\"><b>0:30</b><a class=\"cn\" href=\"/r/abc123def456/p/0\">Alice</a>");
        expect(html).toContain("Niemand ist gestorben.");
    });

    it("leaves the tab out for a report without a timeline", () => {
        const html = renderReportPage(report());
        expect(html).not.toContain("data-tab=\"timeline\"");
        expect(html).not.toContain("class=\"boss-tab");
    });

    it("groups by boss name when the encounter id is missing, without an icon", () => {
        const tl = timeline();
        for (const f of tl.fights) delete f.encounterId;
        const html = renderReportPage({ ...report(), timeline: tl });
        expect(html).toContain("data-show=\"fb-nHigh King Maulgar\"");
        expect(html).not.toContain("/bosses/");
        expect(html.match(/<button type="button" class="boss-tab/g)).toHaveLength(2);
    });

    it("includes the chart styles and the switch script once", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html.match(/\.fchart \.fc-band \{/g)).toHaveLength(1);
        expect(html.match(/window\.__ehShow/g).length).toBeGreaterThanOrEqual(1);
        expect(html.match(/<script>\(function\(\)\{if\(window\.__ehShow\)/g)).toHaveLength(1);
    });
});

describe("web/render — Kampfverlauf on the player page", () => {
    it("gives the raider only their own rows and deaths, with own tab ids", () => {
        const html = renderPlayerPage({ ...report(), timeline: timeline() }, 0); // Alice
        expect(html).toContain("<h2>Kampfverlauf</h2>");
        expect(html).toContain("data-show=\"fb-p-e649\"");
        expect(html).toContain("id=\"fight-2\">");   // she died there
        expect(html).toContain("id=\"fight-3\" hidden>");   // her cooldown and activity rows
        expect(html).toContain("title=\"Icy Veins\"");
        expect(html).not.toContain("Bob · Windfury");
        expect(html).not.toContain("fp-3-debuffs"); // raid-wide, not hers
        expect(html).not.toContain("<div class=\"fight-series\">");
    });

    it("lists only the fights the raider shows up in, and nothing without any", () => {
        const html = renderPlayerPage({ ...report(), timeline: timeline() }, 1); // Bob: totems on fight 3 only
        expect(html).toContain("<h2>Kampfverlauf</h2>");
        expect(html).toContain("id=\"fight-3\">");
        expect(html).not.toContain("id=\"fight-2\"");
        expect(html).not.toContain("Gruul the Dragonkiller</span>");
        expect(html).toContain("data-show=\"fp-3-totems\">Totems");
        const none = renderPlayerPage({ ...report(), timeline: { fights: [] } }, 1);
        expect(none).not.toContain("<h2>Kampfverlauf</h2>");
        const legacy = renderPlayerPage(report(), 1);
        expect(legacy).not.toContain("<h2>Kampfverlauf</h2>");
    });
});
