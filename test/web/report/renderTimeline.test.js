// The "Kampfverlauf" tab of the report page and its slice on the player page:
// boss tabs → try pills → topic switch, one of each open at a time.
const { renderReportPage, renderPlayerPage } = require("../../../src/web/report/render.js");

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

describe("web/report/render — Kampfverlauf tab", () => {
    it("shows the tab with one table row per boss, carrying the WCL icon and the try count", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html).toContain("class=\"seg-btn active\" data-show=\"view-bosse\"");
        expect(html).toMatch(/Bosse<span class="n(?: mid| bad)?">2<\/span>/);
        expect(html).not.toContain("boss-card");
        expect(html.match(/<tr data-boss-open="/g)).toHaveLength(2);
        expect(html).toContain("<button type=\"button\" class=\"boss-open\" data-boss-open=\"e649\"><img class=\"boss-ico\" src=\"/bosses/649.jpg\" alt=\"\"><b>High King Maulgar</b></button>");
        expect(html).toContain("<button type=\"button\" class=\"boss-open\" data-boss-open=\"e650\"><img class=\"boss-ico\" src=\"/bosses/650.jpg\" alt=\"\"><b>Gruul the Dragonkiller</b></button>");
        expect(html).toContain("<span class=\"badge ok\">Kill 3:00</span> <span class=\"mute\">2 Tries</span>");
        // a boss pulled once carries no tries note
        expect(html).toContain("<td><span class=\"badge ok\">Kill 3:20</span></td>");
        // every boss has its page, hidden until its row is clicked
        expect(html).toContain("<section class=\"boss-detail\" id=\"boss-e649\" data-boss=\"e649\" hidden>");
        expect(html).toContain("<section class=\"boss-detail\" id=\"boss-e650\" data-boss=\"e650\" hidden>");
    });

    it("sums a boss up in the row: deaths, debuffs and buffs, and has no Raid-DPS chip", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        const row = html.slice(html.indexOf("<tr data-boss-open=\"e649\">"), html.indexOf("</tr>", html.indexOf("<tr data-boss-open=\"e649\">")));
        expect(row).toContain("<td><span class=\"badge mid\">1 Tod</span></td><td><span class=\"badge ok\">alle da</span></td><td><span class=\"mute\">–</span></td><td><span class=\"mute\">–</span></td>");
        expect(html).not.toContain("Raid-DPS</span>");
        expect(html).not.toContain("chip-x");
    });

    it("keeps the fight's numbers out of a stats row: the topic list carries them", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html).not.toContain("class=\"stats\"");
        expect(html).not.toContain("Raid-HPS</div>");
        expect(html).not.toContain("Bloodlust</div><div class=\"stat-v\">");
        expect(html).toContain("<b>Aktivität</b><small>Ø 94 % aktiv</small></span><span class=\"dot mid\"></span>");
        expect(html).toContain("<b>Tode</b><small>1 Tod</small></span><span class=\"dot mid\"></span>");
        // the boss page's head carries the mean activity and the deaths instead
        expect(html).toContain("<div class=\"bfact\"><span class=\"kicker\">Aktivität</span><b class=\"warn\">Ø 94 %</b></div>");
        expect(html).toContain("<div class=\"bfact\"><span class=\"kicker\">Tode</span><b>1 Tod</b></div>");
    });

    it("offers one try pill per pull of a boss and opens the first try", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html).toContain("class=\"try-pill active try-wipe\" data-show=\"fight-2\">Try 1<span class=\"s\">Wipe bei 33 % · 2:00</span>");
        expect(html).toContain("class=\"try-pill try-kill\" data-show=\"fight-3\">Try 2<span class=\"s\">Kill · 3:00</span>");
        expect(html).toContain("id=\"fight-2\">");
        expect(html).toContain("id=\"fight-3\" hidden>");
        // a boss with a single pull needs no pills (the raider cards' dialogs carry their own)
        const bosse = html.slice(html.indexOf("<div id=\"view-bosse\""), html.indexOf("<div id=\"view-raider\""));
        expect(bosse.match(/<nav class="try-pills">/g)).toHaveLength(1);
    });

    it("groups cooldowns and totems under the player they belong to, with a result badge and the expand control", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        // Alice's Icy Veins under Alice: class tile, name in class colour, the badge, "Details" + the chevron button
        expect(html).toContain("<div class=\"glist\"><details class=\"grp\" style=\"--cc:#69CCF0\">");
        expect(html).toContain("<summary><span class=\"tile cls\"><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/classicon_mage.jpg\" alt=\"\"></span><span class=\"cn\">Alice</span><span class=\"sritems\">Mage</span><span class=\"badge\">1 Einsatz</span><span class=\"exp-lbl\"><span class=\"exp-w\">Details</span><span class=\"exp\"><svg");
        // the row itself keeps the bare cooldown name; the chart row keeps "Alice · Icy Veins"
        expect(html).toMatch(/<details class="grp"[^>]*>\s*<summary>[^]*?Alice[^]*?<\/summary>\s*<table class="idx fc-table topic-table">[^]*?Icy Veins<\/td>/);
        // Bob's Windfury: nothing missing, so the group is closed and says ok
        expect(html).toContain("<span class=\"cn\">Bob</span><span class=\"sritems\">Warrior</span><span class=\"badge ok\">ok</span>");
        const bob = html.indexOf("<span class=\"cn\">Bob</span><span class=\"sritems\">Warrior</span><span class=\"badge ok\">ok</span>");
        expect(html.slice(html.lastIndexOf("<details class=\"grp\"", bob), bob)).not.toContain(" open>");
        // the player page stays a flat table of the raider's own rows
        const own = renderPlayerPage({ ...report(), timeline: timeline() }, 0);
        expect(own).not.toContain("<details class=\"grp\"");
    });

    it("switches topics with the topic list, the worst topic open, the table first and the chart in a dialog", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        const fight = html.slice(html.indexOf("id=\"fight-3\""), html.indexOf("</section>", html.indexOf("id=\"fight-3\"")));
        const nav = fight.slice(fight.indexOf("<nav class=\"topic-nav\""), fight.indexOf("</nav>"));
        // Aktivität (mid) before the ok topics, the neutral Kampfverlauf last
        expect(nav).toContain("<button type=\"button\" class=\"topic active\" data-show=\"fp-3-activity\">");
        expect(nav).toContain("<b>Debuffs</b><small>0 erwartet, alle da</small></span><span class=\"dot ok\"></span>");
        expect(nav).toContain("<b>Totems</b><small>1 Schamane</small></span><span class=\"dot ok\"></span>");
        expect(nav).toContain("<b>Cooldowns</b><small>1 Cooldown</small></span><span class=\"dot ok\"></span>"); // no possibleUses on the row: no "genutzt" share
        expect(nav).toContain("<b>Tode</b><small>niemand gestorben</small></span><span class=\"dot ok\"></span>");
        expect(nav).toContain("<b>Kampfverlauf</b><small>DPS und HPS</small></span><span class=\"dot none\"></span>");
        expect([...nav.matchAll(/data-show="fp-3-(\w+)"/g)].map((m) => m[1])).toEqual(["activity", "debuffs", "totems", "cooldowns", "deaths", "series"]);
        expect(html).toContain("<div id=\"fp-3-activity\" class=\"fight-part part\">");
        expect(html).toContain("<div id=\"fp-3-totems\" class=\"fight-part part\" hidden>");
        // the compact table sits in the card, the chart behind "Verlauf öffnen" in a <dialog>
        expect(html).toContain("<table class=\"idx fc-table topic-table\"><tr><th>Debuff</th><th>Uptime</th><th>Details</th><th>Lücken</th><th>Längste Lücke</th></tr><tr><td><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/ability_warrior_sunder.jpg\" alt=\"\">Sunder Armor</td><td><span class=\"tv good\">100%</span></td><td>5/5 ab 0:08</td><td class=\"mono\">0</td><td class=\"mono\">–</td></tr></table>");
        expect(html).toContain("data-dialog=\"dlg-fp-3-debuffs\"");
        expect(html).toContain("Verlauf öffnen<svg");
        expect(html).toContain("<dialog class=\"dlg chart\" id=\"dlg-fp-3-debuffs\">");
        expect(html).toContain("High King Maulgar · Debuffs</div>");
        expect(html).toContain("<script src=\"/r-assets/report.js?v=");
        // the DPS/HPS strip is the Kampfverlauf topic of the try
        expect(html).toContain("data-show=\"fp-3-series\">");
        expect(html).toContain("<dialog class=\"dlg chart\" id=\"dlg-fp-3-series\">");
        expect(html).toContain("<div class=\"fight-series\">");
        expect(html).toContain("Raid-DPS");
    });
    it("draws icon-only rows with the name in the tooltip and the value with a sub line", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html).toContain("data-tip=\"Bob · Windfury\"");
        expect(html).toContain("data-tip=\"Alice · Icy Veins\"");
        expect(html).toContain("<b class=\"fc-good\">100%</b><span>5/5 ab 0:08</span>");
        expect(html).toContain("<b class=\"fc-medium\">94%</b><span>1 Lücke</span>");
        expect(html).toContain("<b class=\"\">1×</b>");
        expect(html).toContain("data-tip=\"Bloodlust\" data-tip-sub=\"0:00–0:40\"");
        expect(html).toContain("5/5 Stacks");
        // the activity row of a raider without an icon uses the class icon
        expect(html).toContain("<div class=\"fc-cell\" data-tip=\"Alice\"><img src=\"https://wow.zamimg.com/images/wow/icons/medium/classicon_mage.jpg\"");
    });

    it("draws the bare fight axis with its deaths when no analyzer has filled a fight yet", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html).toContain("data-show=\"fp-2-fight\">");
        expect(html).toContain("<b>Kampf</b><small>2:00</small></span><span class=\"dot none\"></span>");
        expect(html).toContain("data-tip=\"0:30 Alice\" data-tip-sub=\"† Arcane Explosion\"");
        expect(html).toContain("<li style=\"--cc:#69CCF0\"><b>0:30</b><a class=\"cn\" href=\"/r/abc123def456/p/0\">Alice</a>");
        expect(html).toContain("Niemand ist gestorben.");
    });

    it("draws the boss-health line beside the DPS/HPS strip when a fight carries one", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html).toContain("data-tip=\"Boss-Leben (%)\"");
        expect(html).toContain("<th>Boss-Leben</th>");
        const none = timeline();
        none.fights[1].series.bossHp = null;
        const without = renderReportPage({ ...report(), timeline: none });
        expect(without).toContain("<div class=\"fight-series\">");
        expect(without).not.toContain("data-tip=\"Boss-Leben (%)\"");
    });

    it("says what is missing when no fight has a DPS/HPS strip, and stays quiet when one has", () => {
        const hint = "brauchen den Warcraft-Logs-v2-Zugang (Einstellungen → Verbindungen → Warcraft Logs)";
        expect(renderReportPage({ ...report(), timeline: timeline() })).not.toContain(hint);
        const bare = timeline();
        for (const f of bare.fights) delete f.series;
        expect(renderReportPage({ ...report(), timeline: bare })).toContain(hint);
        // a series without any curve counts as none
        bare.fights[1].series = { step: 5000, dps: null, hps: null, bossHp: null };
        expect(renderReportPage({ ...report(), timeline: bare })).toContain(hint);
    });

    it("opens the Raid view first and says so in the Bosse view for a report without a timeline", () => {
        const html = renderReportPage(report());
        expect(html).toContain("class=\"seg-btn active\" data-show=\"view-raid\"");
        expect(html).toContain("Keine Boss-Kämpfe im Log.");
        expect(html).not.toContain("boss-card");
        expect(html).not.toContain("boss-table");
    });

    it("groups by boss name when the encounter id is missing, without an icon", () => {
        const tl = timeline();
        for (const f of tl.fights) delete f.encounterId;
        const html = renderReportPage({ ...report(), timeline: tl });
        expect(html).toContain("id=\"boss-nHigh King Maulgar\"");
        expect(html).not.toContain("/bosses/");
        expect(html.match(/<tr data-boss-open="/g)).toHaveLength(2);
        expect(html).toContain("<span class=\"boss-ico\"></span><b>High King Maulgar</b>");
    });

    it("includes the chart styles and the switch script once", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(require("fs").readFileSync(require("path").join(__dirname, "..", "..", "..", "src", "web", "static", "report.css"), "utf8").match(/\.fchart \.fc-band \{/g)).toHaveLength(1);
        expect(html).not.toContain(".fchart .fc-band {");
        expect(html.match(/<script src="\/r-assets\/report\.js\?v=/g)).toHaveLength(1);
    });
});

describe("web/report/render — Kampfverlauf on the player page", () => {
    it("gives the raider only their own rows and deaths, with own tab ids", () => {
        const html = renderPlayerPage({ ...report(), timeline: timeline() }, 0); // Alice
        // one row per boss in "Deine Kämpfe", the charts of that boss in its dialog
        expect(html).toContain("id=\"p-fights\"");
        expect(html).toContain("data-dialog=\"dlg-pf-0\"");
        expect(html).toContain("<dialog class=\"dlg chart\" id=\"dlg-pf-0\">");
        expect(html).toContain("id=\"p-fight-2\">");   // she died there
        expect(html).toContain("id=\"p-fight-3\" hidden>");   // her cooldown and activity rows
        expect(html).toContain("data-tip=\"Icy Veins\"");
        expect(html).not.toContain("Bob · Windfury");
        expect(html).not.toContain("fp-3-debuffs"); // raid-wide, not hers
        expect(html).not.toContain("<div class=\"fight-series\">");
        // inside the boss dialog the chart is stacked under its table
        expect(html).toContain("<div class=\"part-chart\">");
        expect(html).not.toContain("Verlauf öffnen");
    });

    it("lists only the fights the raider shows up in, and nothing without any", () => {
        const html = renderPlayerPage({ ...report(), timeline: timeline() }, 1); // Bob: totems on fight 3 only
        expect(html).toContain("id=\"p-fights\"");
        expect(html).toContain("id=\"p-fight-3\">");
        expect(html).not.toContain("id=\"p-fight-2\"");
        expect(html).not.toContain("Gruul the Dragonkiller</span>");
        expect(html).toContain("data-show=\"p-fp-3-totems\">");
        expect(html).toMatch(/Totems<span class="n(?: mid| bad)?">1<\/span>/);
        const none = renderPlayerPage({ ...report(), timeline: { fights: [] } }, 1);
        expect(none).not.toContain("id=\"p-fights\"");
        const legacy = renderPlayerPage(report(), 1);
        expect(legacy).not.toContain("id=\"p-fights\"");
    });
});
