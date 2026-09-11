// The "Buffs" topic of the fight timeline and the "Raid-Buffs" tab of the report page.
const { renderReportPage, renderPlayerPage } = require("../../src/web/render.js");

function report() {
    return {
        id: "abc123def456",
        title: "Test Raid",
        zone: "Gruul's Lair",
        date: "2026-09-10",
        players: [{ name: "Brokk", type: "Warrior", issues: [] }, { name: "Elun", type: "Priest", issues: [] }, { name: "Dorn", type: "Shaman", issues: [] }],
        roster: [
            { name: "Brokk", type: "Warrior", issues: [], potions: {}, armory: [] },
            { name: "Elun", type: "Priest", issues: [], potions: {}, armory: [] },
            { name: "Dorn", type: "Shaman", issues: [], potions: {}, armory: [] },
        ],
    };
}

const kings = (status, uptimePct, bands, extra = {}) => ({ key: "kings", label: "Segen der Könige", icon: "spell_magic_greaterblessingofkings", status, uptimePct, expected: true, wrong: false, bands, ...extra });
const fort = (status, uptimePct, bands) => ({ key: "fortitude", label: "Machtwort: Seelenstärke", icon: "spell_holy_wordfortitude", status, uptimePct, expected: true, wrong: false, bands });

function buffsBlock() {
    return {
        paladins: 1,
        expected: ["kings", "fortitude"],
        players: [
            { name: "Brokk", type: "Warrior", role: "tank", judgedUntil: 120000, diedAt: null,
                buffs: [kings("full", 100, [[0, 120000]]), fort("partial", 50, [[0, 60000]]), { key: "wisdom", label: "Segen der Weisheit", icon: "spell_holy_sealofwisdom", status: "full", uptimePct: 100, expected: false, wrong: true, bands: [[0, 120000]] }],
                missing: [], partial: ["fortitude"], wrong: ["wisdom"] },
            { name: "Elun", type: "Priest", role: "healer", judgedUntil: 120000, diedAt: null,
                buffs: [kings("full", 100, [[0, 120000]]), fort("full", 100, [[0, 120000]])],
                missing: [], partial: [], wrong: [] },
            { name: "Dorn", type: "Shaman", role: "melee", judgedUntil: 60000, diedAt: 60000,
                buffs: [kings("none", 0, []), fort("full", 100, [[0, 60000]]), { key: "waterShield", label: "Wasserschild", icon: "ability_shaman_watershield", status: "full", uptimePct: 100, expected: false, wrong: false, bands: [[0, 60000]] }],
                missing: ["kings"], partial: [], wrong: [] },
        ],
        coverage: [
            { key: "kings", expected: 3, full: 2, partial: 0, none: 1, present: 2, wrong: 0 },
            { key: "fortitude", expected: 3, full: 2, partial: 1, none: 0, present: 3, wrong: 0 },
        ],
    };
}

function timeline() {
    return {
        fights: [
            { id: 2, boss: "High King Maulgar", encounterId: 649, contentId: "gruul", kill: true, fightPercentage: 0, startTime: 100000, endTime: 220000, duration: 120000, deaths: [{ at: 60000, name: "Dorn", type: "Shaman" }], buffs: buffsBlock() },
            { id: 4, boss: "Gruul the Dragonkiller", encounterId: 650, contentId: "gruul", kill: true, fightPercentage: 0, startTime: 500000, endTime: 700000, duration: 200000, deaths: [], buffs: null },
            { id: 6, boss: "Gruul the Dragonkiller", encounterId: 650, contentId: "gruul", kill: false, fightPercentage: 40, startTime: 800000, endTime: 900000, duration: 100000, deaths: [],
                buffs: { paladins: 1, expected: ["kings"], players: [{ name: "Elun", type: "Priest", role: "healer", judgedUntil: 100000, diedAt: null, buffs: [kings("full", 100, [[0, 100000]])], missing: [], partial: [], wrong: [] }], coverage: [{ key: "kings", expected: 1, full: 1, partial: 0, none: 0, present: 1, wrong: 0 }] } },
        ],
    };
}

function summary() {
    return {
        fights: 3,
        paladins: 1,
        players: [
            { name: "Brokk", type: "Warrior", role: "tank", fights: 3, missing: 0, partial: 3, wrong: 3, buffs: {
                kings: { expected: 3, full: 3, partial: 0, none: 0, present: 3, wrong: 0, pct: 100 },
                fortitude: { expected: 3, full: 0, partial: 3, none: 0, present: 3, wrong: 0, pct: 0 },
                wisdom: { expected: 0, full: 0, partial: 0, none: 0, present: 3, wrong: 3, pct: 100 },
            } },
            { name: "Elun", type: "Priest", role: "healer", fights: 3, missing: 0, partial: 0, wrong: 0, buffs: {
                kings: { expected: 3, full: 3, partial: 0, none: 0, present: 3, wrong: 0, pct: 100 },
                fortitude: { expected: 3, full: 3, partial: 0, none: 0, present: 3, wrong: 0, pct: 100 },
            } },
            { name: "Dorn", type: "Shaman", role: "melee", fights: 3, missing: 2, partial: 0, wrong: 0, buffs: {
                kings: { expected: 3, full: 1, partial: 0, none: 2, present: 1, wrong: 0, pct: 33 },
                fortitude: { expected: 3, full: 3, partial: 0, none: 0, present: 3, wrong: 0, pct: 100 },
                waterShield: { expected: 0, full: 0, partial: 0, none: 0, present: 3, wrong: 0, pct: 100 },
            } },
        ],
        rows: [
            { key: "kings", label: "Segen der Könige", icon: "spell_magic_greaterblessingofkings", provider: "Paladin", group: "blessing", expect: "blessing", expected: true, fights: 3, slots: 9, full: 7, partial: 0, none: 2, present: 7, wrong: 0, coveragePct: 78, missingPlayers: 1, seenPlayers: 3 },
            { key: "wisdom", label: "Segen der Weisheit", icon: "spell_holy_sealofwisdom", provider: "Paladin", group: "blessing", expect: "blessing", expected: false, fights: 0, slots: 0, full: 0, partial: 0, none: 0, present: 3, wrong: 3, coveragePct: null, missingPlayers: 0, seenPlayers: 1 },
            { key: "fortitude", label: "Machtwort: Seelenstärke", icon: "spell_holy_wordfortitude", provider: "Priest", group: "stats", expect: "class", expected: true, fights: 3, slots: 9, full: 6, partial: 3, none: 0, present: 9, wrong: 0, coveragePct: 67, missingPlayers: 1, seenPlayers: 3 },
            { key: "waterShield", label: "Wasserschild", icon: "ability_shaman_watershield", provider: "Shaman", group: "shield", expect: "never", expected: false, fights: 0, slots: 0, full: 0, partial: 0, none: 0, present: 3, wrong: 0, coveragePct: null, missingPlayers: 0, seenPlayers: 1 },
            { key: "thorns", label: "Dornen", icon: "spell_nature_thorns", provider: "Druid", group: "protection", expect: "majority", expected: false, fights: 0, slots: 0, full: 0, partial: 0, none: 0, present: 0, wrong: 0, coveragePct: null, missingPlayers: 0, seenPlayers: 0 },
        ],
    };
}

describe("web/render — Buffs topic of a fight", () => {
    it("adds a Buffs topic listing who lacked what: missing, run out, wrong role", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html).toContain("data-show=\"fp-2-buffs\">Buffs<span class=\"n\">2</span>");
        expect(html).toContain("1 Paladin · erwartet: Segen der Könige, Machtwort: Seelenstärke");
        // Brokk: Fortitude ran out, Wisdom on a warrior
        expect(html).toContain("<span class=\"cn\">Brokk</span><span class=\"sritems\">Tank</span>");
        expect(html).toContain("Machtwort: Seelenstärke ausgelaufen</span>");
        expect(html).toContain("Segen der Weisheit · falsche Rolle</span>");
        // Dorn: no Kings, judged until his death
        expect(html).toContain("<span class=\"cn\">Dorn</span><span class=\"sritems\">Nahkampf · bis 1:00</span>");
        expect(html).toContain("<span class=\"tag tag-high\"><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/spell_magic_greaterblessingofkings.jpg\" alt=\"\">Segen der Könige fehlt</span>");
        // Elun had everything: not in the list
        expect(html).not.toContain("<span class=\"cn\">Elun</span><span class=\"sritems\">Heiler");
    });

    it("says so when everybody had everything, and leaves the topic out without data", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html).toContain("data-show=\"fp-6-buffs\">Buffs<span class=\"n\">0</span>");
        expect(html).toContain("Alle erwarteten Buffs auf allen Spielern.");
        expect(html).not.toContain("fp-4-buffs");
    });
});

describe("web/render — Raid-Buffs tab", () => {
    it("shows the tab with a player × buff matrix, coverage on top, only the buffs anyone had or should have had", () => {
        const html = renderReportPage({ ...report(), timeline: timeline(), raidBuffs: summary() });
        expect(html).toContain("data-tab=\"raidbuffs\"");
        // two expected buffs fell short somewhere
        expect(html).toContain("<span>Raid-Buffs</span><span class=\"tab-count\">2</span>");
        expect(html).toContain("data-tip=\"Segen der Könige (Paladin)\"");
        expect(html).toContain("data-tip=\"Wasserschild (Shaman)\"");
        expect(html).not.toContain("data-tip=\"Dornen (Druid)\"");
        expect(html).toContain("<tr class=\"cov\"><td><b>Abdeckung</b><div class=\"sritems\">Raid</div></td><td class=\"bc\"><span class=\"pct pct-part\">78%</span></td>");
        expect(html).toContain("<a class=\"cn\" href=\"/r/abc123def456/p/2\">Dorn</a><div class=\"sritems\">Shaman · Nahkampf · 3 Kämpfe</div>");
        expect(html).toContain("title=\"Segen der Könige: 1× da, 0× ausgelaufen, 2× gefehlt\"><span class=\"pct pct-part\">33%</span>");
        expect(html).toContain("<span class=\"pct pct-none\">0%</span>");
        expect(html).toContain("<span class=\"pct pct-wrong\" title=\"Segen der Weisheit: 3× auf der falschen Rolle\">100%</span>");
        expect(html).toContain("<span class=\"pct pct-na\" title=\"Wasserschild: nicht erwartet, 3× da\">100%</span>");
        expect(html).toContain("1 Paladin heißt ein Segen pro Spieler");
    });

    it("leaves the tab out without data", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html).not.toContain("data-tab=\"raidbuffs\"");
        expect(renderReportPage({ ...report(), raidBuffs: { players: [], rows: [] } })).not.toContain("data-tab=\"raidbuffs\"");
    });
});

describe("web/render — Buffs on the player page", () => {
    it("draws the raider's own buffs as ribbons with their status, nothing of the others", () => {
        const html = renderPlayerPage({ ...report(), timeline: timeline(), raidBuffs: summary() }, 2); // Dorn
        expect(html).toContain("<h2>Kampfverlauf</h2>");
        expect(html).toContain("Buffs<span class=\"n\">1</span>");
        expect(html).toContain("<title>Machtwort: Seelenstärke: 0:00–1:00</title>");
        expect(html).toContain("<b class=\"fc-high\">0%</b><span>fehlt</span>");
        expect(html).toContain("<b class=\"fc-good\">100%</b><span>da</span>");
        expect(html).toContain("<b class=\"\">100%</b><span>nicht erwartet</span>");
        expect(html).not.toContain("Segen der Weisheit");
        expect(html).not.toContain("buff-lacking");
    });

    it("labels a blessing on the wrong role and a buff that ran out", () => {
        const html = renderPlayerPage({ ...report(), timeline: timeline() }, 0); // Brokk
        expect(html).toContain("Buffs<span class=\"n\">2</span>");
        expect(html).toContain("<b class=\"fc-medium\">50%</b><span>ausgelaufen</span>");
        expect(html).toContain("<b class=\"fc-high\">100%</b><span>falsche Rolle</span>");
        expect(html).toContain("<title>Segen der Weisheit (falsche Rolle): 0:00–2:00</title>");
    });

    it("lists a fight for a raider who only shows up in its buffs", () => {
        const html = renderPlayerPage({ ...report(), timeline: { fights: [timeline().fights[2]] } }, 1); // Elun
        expect(html).toContain("<h2>Kampfverlauf</h2>");
        expect(html).toContain("Buffs<span class=\"n\">0</span>");
    });
});
