// The "Raid-Debuffs" tab of the report page: the raid summary per debuff and,
// under it, the debuff × boss matrix rendered purely from the timeline's
// per-fight debuff rows.
const { renderReportPage } = require("../../src/web/render.js");

function report() {
    return {
        id: "abc123def456",
        title: "Test Raid",
        zone: "Gruul's Lair",
        date: "2026-09-10",
        players: [{ name: "Alice", type: "Warlock", issues: [] }, { name: "Bob", type: "Warrior", issues: [] }],
        roster: [
            { name: "Alice", type: "Warlock", issues: [], potions: {}, armory: [] },
            { name: "Bob", type: "Warrior", issues: [], potions: {}, armory: [] },
        ],
    };
}

function raidDebuffs() {
    return {
        expected: ["coe", "sunder", "huntersMark"],
        rows: [
            { key: "coe", label: "Fluch der Elemente", icon: "spell_shadow_chilltouch", group: "spell", provider: "Warlock", expected: true, fights: 3, missing: 0, maxStacks: 0, avgUptime: 83, avgBelowMax: null },
            { key: "sunder", label: "Rüstung zerreißen", icon: "ability_warrior_sunder", group: "armor", provider: "Warrior", expected: true, fights: 3, missing: 0, maxStacks: 5, avgUptime: 100, avgBelowMax: 7 },
            { key: "huntersMark", label: "Mal des Jägers", icon: "ability_hunter_snipershot", group: "physical", provider: "Hunter", expected: true, fights: 3, missing: 3, maxStacks: 0, avgUptime: 0, avgBelowMax: null },
            { key: "misery", label: "Elend", icon: "spell_shadow_misery", group: "spell", provider: "Priest", expected: false, fights: 1, missing: 0, maxStacks: 0, avgUptime: 40, avgBelowMax: null },
        ],
    };
}

const coe = (uptimePct) => ({ key: "coe", label: "Fluch der Elemente", icon: "spell_shadow_chilltouch", bands: [], maxStacks: 0, uptimePct, gapCount: 0, longestGap: 0, firstAt: 0, expected: true, missing: false });
const sunder = (timeToMax) => ({ key: "sunder", label: "Rüstung zerreißen", icon: "ability_warrior_sunder", bands: [], stacks: [], maxStacks: 5, uptimePct: 100, gapCount: 0, longestGap: 0, firstAt: 0, expected: true, missing: false, timeToMax, belowMaxPct: 7 });
const mark = () => ({ key: "huntersMark", label: "Mal des Jägers", icon: "ability_hunter_snipershot", bands: [], maxStacks: 0, uptimePct: 0, gapCount: 0, longestGap: 0, firstAt: null, expected: true, missing: true });
const misery = () => ({ key: "misery", label: "Elend", icon: "spell_shadow_misery", bands: [], maxStacks: 0, uptimePct: 40, gapCount: 1, longestGap: 5000, firstAt: 1000, expected: false, missing: false });

function timeline() {
    return {
        fights: [
            {
                id: 2, boss: "High King Maulgar", encounterId: 649, contentId: "gruul", kill: false, fightPercentage: 32.5,
                startTime: 100000, endTime: 220000, duration: 120000, deaths: [],
                debuffs: [sunder(8000), coe(60), mark(), misery()],
            },
            {
                id: 3, boss: "High King Maulgar", encounterId: 649, contentId: "gruul", kill: true, fightPercentage: 0,
                startTime: 300000, endTime: 480000, duration: 180000, deaths: [],
                debuffs: [sunder(12000), coe(100), mark()],
            },
            {
                id: 4, boss: "Gruul the Dragonkiller", encounterId: 650, contentId: "gruul", kill: true, fightPercentage: 0,
                startTime: 500000, endTime: 700000, duration: 200000, deaths: [],
                debuffs: [sunder(null), coe(90), mark()],
            },
        ],
    };
}

function cell(html, label, boss) {
    // the <td> whose tooltip names this debuff on this boss
    const re = new RegExp(`<td class="bc"><span class="pct [^"]*" title="${label} (auf|fehlte auf) ${boss}[^"]*">[^<]*</span>(<div class="sritems">[^<]*</div>)?</td>`);
    const m = html.match(re);
    return m ? m[0] : null;
}

describe("web/render — Raid-Debuffs tab", () => {
    it("shows the tab with the raid summary per debuff and counts the expected ones that fell short", () => {
        const html = renderReportPage({ ...report(), raidDebuffs: raidDebuffs() });
        expect(html).toContain("data-tab=\"raiddebuffs\"");
        expect(html).toContain("<span>Raid-Debuffs</span><span class=\"tab-count\">2</span>"); // coe at 83 %, Hunter's Mark missing
        expect(html).toContain("Fluch der Elemente<div class=\"sritems\">Warlock</div>");
        // the unexpected one is shown without a tone
        expect(html).toContain("<span class=\"pct pct-na\" title=\"nicht erwartet\">40%</span>");
        expect(html).toContain("<span class=\"pct pct-none\">3/3</span>");
    });

    it("renders no matrix without a timeline, the tab otherwise as before", () => {
        const html = renderReportPage({ ...report(), raidDebuffs: raidDebuffs() });
        expect(html).toContain("data-tab=\"raiddebuffs\"");
        expect(html).not.toContain("Debuff × Boss");
        expect(html).not.toContain("<table class=\"idx heal-table buff-matrix debuff-matrix\">");
        const noFights = renderReportPage({ ...report(), raidDebuffs: raidDebuffs(), timeline: { fights: [] } });
        expect(noFights).not.toContain("<table class=\"idx heal-table buff-matrix debuff-matrix\">");
    });

    it("draws one column per boss in pull order with the WCL icon and the try outcome", () => {
        const html = renderReportPage({ ...report(), raidDebuffs: raidDebuffs(), timeline: timeline() });
        expect(html).toContain("Debuff × Boss");
        const heads = html.match(/<th class="bh"><img src="\/bosses\/\d+\.jpg" alt=""><span class="boss-name">[^<]*<\/span><span class="sritems">[^<]*<\/span><\/th>/g);
        expect(heads).toEqual([
            "<th class=\"bh\"><img src=\"/bosses/649.jpg\" alt=\"\"><span class=\"boss-name\">High King Maulgar</span><span class=\"sritems\">Kill nach 2 Tries</span></th>",
            "<th class=\"bh\"><img src=\"/bosses/650.jpg\" alt=\"\"><span class=\"boss-name\">Gruul the Dragonkiller</span><span class=\"sritems\">Kill</span></th>",
        ]);
    });

    it("averages the uptime over a boss's tries and lists every try in the tooltip", () => {
        const html = renderReportPage({ ...report(), raidDebuffs: raidDebuffs(), timeline: timeline() });
        const c = cell(html, "Fluch der Elemente", "High King Maulgar");
        expect(c).toContain(">80%</span>");
        expect(c).toContain("class=\"pct pct-part\"");
        expect(c).toContain("Try 1 (Wipe bei 33 %): 60 % · Try 2 (Kill): 100 %");
        // a single kill: its own value, toned
        const g = cell(html, "Fluch der Elemente", "Gruul the Dragonkiller");
        expect(g).toContain("class=\"pct pct-part\"");
        expect(g).toContain(">90%</span>");
        expect(g).toContain("Try 1 (Kill): 90 %");
    });

    it("shows \"–\" without a tone where the debuff was not expected on that boss", () => {
        const html = renderReportPage({ ...report(), raidDebuffs: raidDebuffs(), timeline: timeline() });
        expect(html).toContain("<td class=\"bc\"><span class=\"pct pct-na\" title=\"Elend auf Gruul the Dragonkiller: nicht erwartet\">–</span></td>");
        // seen although not expected: the value, still without a tone
        const m = cell(html, "Elend", "High King Maulgar");
        expect(m).toContain("class=\"pct pct-na\"");
        expect(m).toContain(">40%</span>");
        expect(m).toContain("nicht erwartet · Try 1 (Wipe bei 33 %): 40 %");
    });

    it("marks an expected debuff that was never there as missing", () => {
        const html = renderReportPage({ ...report(), raidDebuffs: raidDebuffs(), timeline: timeline() });
        const c = cell(html, "Mal des Jägers", "High King Maulgar");
        expect(c).toContain("class=\"pct pct-none\"");
        expect(c).toContain("title=\"Mal des Jägers fehlte auf High King Maulgar · Try 1 (Wipe bei 33 %): 0 % · Try 2 (Kill): 0 %\"");
        expect(c).toContain(">0%</span>");
    });

    it("adds the mean time to full stacks under a stacking debuff's cell", () => {
        const html = renderReportPage({ ...report(), raidDebuffs: raidDebuffs(), timeline: timeline() });
        const c = cell(html, "Rüstung zerreißen", "High King Maulgar");
        expect(c).toContain("class=\"pct pct-full\"");
        expect(c).toContain("<div class=\"sritems\">max ab 0:10</div>"); // mean of 8 s and 12 s
        // no try reached full stacks: no line
        const g = cell(html, "Rüstung zerreißen", "Gruul the Dragonkiller");
        expect(g).not.toContain("max ab");
        // the row names the stack height
        expect(html).toContain("Rüstung zerreißen<div class=\"sritems\">Warrior · 5 Stacks</div>");
    });

    it("escapes what it prints", () => {
        const rd = raidDebuffs();
        rd.rows[0].label = "<b>x</b>";
        const html = renderReportPage({ ...report(), raidDebuffs: rd, timeline: timeline() });
        expect(html).not.toContain("<b>x</b>");
        expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    });
});
