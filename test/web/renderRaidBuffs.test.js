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
        expect(html).toContain("data-show=\"fp-2-buffs\">");
        expect(html).toContain("Buffs<span class=\"n\">2 · 2 fehlten</span>");
        expect(html).toContain("1 Paladin · erwartet: Segen der Könige, Machtwort: Seelenstärke");
        // Brokk: Fortitude ran out, Wisdom on a warrior
        expect(html).toContain("<span class=\"cn\">Brokk</span><span class=\"sritems\">Tank</span>");
        expect(html).toContain("Machtwort: Seelenstärke nicht durchgehend</span>");
        expect(html).toContain("Segen der Weisheit · falsche Rolle</span>");
        // Dorn: no Kings, judged until his death
        expect(html).toContain("<span class=\"cn\">Dorn</span><span class=\"sritems\">Nahkampf · bis 1:00</span>");
        expect(html).toContain("<span class=\"tag tag-high\"><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/spell_magic_greaterblessingofkings.jpg\" alt=\"\">Segen der Könige fehlt</span>");
        // Elun had everything: not in the list
        expect(html).not.toContain("<span class=\"cn\">Elun</span><span class=\"sritems\">Heiler");
    });

    it("says so when everybody had everything, and leaves the topic out without data", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html).toContain("data-show=\"fp-6-buffs\">");
        expect(html).toContain("Buffs<span class=\"n\">0 · alle da</span>");
        expect(html).toContain("Alle erwarteten Buffs auf allen Spielern.");
        expect(html).not.toContain("fp-4-buffs");
    });
});

describe("web/render — Raid-Buffs section", () => {
    it("shows the section with a player × buff matrix, coverage on top, only the buffs anyone had or should have had", () => {
        const html = renderReportPage({ ...report(), timeline: timeline(), raidBuffs: summary() });
        expect(html).toContain("id=\"rs-raidbuffs\"");
        // two expected buffs fell short somewhere
        expect(html).toContain("<span>Raid-Buffs</span><span class=\"rec-count hot\">2</span>");
        expect(html).toContain("data-tip=\"Segen der Könige (Paladin)\"");
        expect(html).toContain("data-tip=\"Wasserschild (Shaman)\"");
        expect(html).not.toContain("data-tip=\"Dornen (Druid)\"");
        expect(html).toContain("<tr class=\"cov\"><td><b>Abdeckung</b><div class=\"sritems\">Raid</div></td><td class=\"bc\"><span class=\"pct pct-part\">78%</span></td>");
        expect(html).toContain("<a class=\"cn\" href=\"/r/abc123def456/p/2\">Dorn</a><div class=\"sritems\">Shaman · Nahkampf · 3 Kämpfe</div>");
        // a summary from before the `late` counter existed: read as 0, not as "undefined×"
        expect(html).toContain("title=\"Segen der Könige: 1× da, 0× spät gesetzt, 0× nicht durchgehend, 2× gefehlt\"><span class=\"pct pct-part\">33%</span>");
        expect(html).toContain("<span class=\"pct pct-none\">0%</span>");
        expect(html).toContain("<span class=\"pct pct-wrong\" title=\"Segen der Weisheit: 3× auf der falschen Rolle\">100%</span>");
        expect(html).toContain("<span class=\"pct pct-na\" title=\"Wasserschild: nicht erwartet, 3× da\">100%</span>");
        expect(html).toContain("1 Paladin heißt ein Segen pro Spieler");
    });

    it("leaves the section out without data", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html).not.toContain("id=\"rs-raidbuffs\"");
        expect(renderReportPage({ ...report(), raidBuffs: { players: [], rows: [] } })).not.toContain("id=\"rs-raidbuffs\"");
    });

    it("gives every raider their own buff row: the chip in the head, the table in the Buffs section", () => {
        const html = renderReportPage({ ...report(), timeline: timeline(), raidBuffs: summary() });
        // Dorn lacked Kings twice
        expect(html).toContain("<b>2</b> Buffs fehlten</span>");
        expect(html).toContain("<b>0</b> Buffs fehlten</span>");
        expect(html).toContain("Buffs<span class=\"n\">2 fehlten</span>");
        expect(html).toContain("Nahkampf · 3 Kämpfe · fehlte 2×");
        expect(html).toContain("<table class=\"mini\"><tr><th>Buff</th><th>Anteil</th><th>Da</th><th>Spät</th><th>Nicht durchgehend</th><th>Gefehlt</th><th></th></tr>");
    });
});

describe("web/render — Buffs on the player page", () => {
    it("draws the raider's own buffs as ribbons with their status, nothing of the others", () => {
        const html = renderPlayerPage({ ...report(), timeline: timeline(), raidBuffs: summary() }, 2); // Dorn
        expect(html).toContain("<h2>Kampfverlauf</h2>");
        expect(html).toContain("Buffs<span class=\"n\">1 · 1 fehlten</span>");
        expect(html).toContain("<title>Machtwort: Seelenstärke: 0:00–1:00</title>");
        expect(html).toContain("<b class=\"fc-high\">0%</b><span>fehlt</span>");
        expect(html).toContain("<b class=\"fc-good\">100%</b><span>da</span>");
        expect(html).toContain("<b class=\"\">100%</b><span>nicht erwartet</span>");
        expect(html).not.toContain("Segen der Weisheit");
        expect(html).not.toContain("buff-lacking");
    });

    it("labels a blessing on the wrong role and a buff that was not there throughout", () => {
        const html = renderPlayerPage({ ...report(), timeline: timeline() }, 0); // Brokk
        expect(html).toContain("Buffs<span class=\"n\">2 · 2 fehlten</span>");
        expect(html).toContain("<b class=\"fc-medium\">50%</b><span>nicht durchgehend</span>");
        expect(html).toContain("<b class=\"fc-high\">100%</b><span>falsche Rolle</span>");
        expect(html).toContain("<title>Segen der Weisheit (falsche Rolle): 0:00–2:00</title>");
    });

    // A buff set after the pull and then kept is its own status, not "ran out".
    it("tells a buff set after the pull apart from one that ran out", () => {
        const tl = timeline();
        const f = tl.fights[0];
        f.buffs.players[1] = {
            name: "Elun", type: "Priest", role: "healer", judgedUntil: 120000, diedAt: null,
            buffs: [kings("late", 92, [[10000, 120000]]), fort("full", 100, [[0, 120000]])],
            missing: [], late: ["kings"], partial: [], wrong: [],
        };
        f.buffs.coverage[0] = { key: "kings", expected: 3, full: 1, late: 1, partial: 0, none: 1, present: 2, wrong: 0 };
        const raid = renderReportPage({ ...report(), timeline: tl });
        // the raid page lists her now, with the late chip
        expect(raid).toContain("data-show=\"fp-2-buffs\">");
        expect(raid).toContain("Buffs<span class=\"n\">3 · 3 fehlten</span>");
        expect(raid).toContain("<span class=\"cn\">Elun</span><span class=\"sritems\">Heiler</span>");
        expect(raid).toContain("Segen der Könige spät gesetzt</span>");
        expect(raid).not.toContain("ausgelaufen");
        // the player page draws it as a medium ribbon with the neutral word
        const player = renderPlayerPage({ ...report(), timeline: tl }, 1); // Elun
        expect(player).toContain("Buffs<span class=\"n\">1 · 1 fehlten</span>");
        expect(player).toContain("<b class=\"fc-medium\">92%</b><span>spät gesetzt</span>");
        expect(player).toContain("<title>Segen der Könige: 0:10–2:00</title>");
    });

    it("lists a fight for a raider who only shows up in its buffs", () => {
        const html = renderPlayerPage({ ...report(), timeline: { fights: [timeline().fights[2]] } }, 1); // Elun
        expect(html).toContain("<h2>Kampfverlauf</h2>");
        expect(html).toContain("Buffs<span class=\"n\">0 · alle da</span>");
    });
});

describe("web/render — buffs read off the events", () => {
    const { renderReportPage } = require("../../src/web/render.js");
    it("explains the inferred buffs above the matrix, keeps their columns and shows an open cell as a question mark", () => {
        const report = {
            id: "abc123def456", title: "T", players: [], roster: [{ name: "Brokk", type: "Warrior", issues: [], potions: {}, armory: [] }],
            raidBuffs: {
                fights: 2, paladins: 1,
                players: [{ name: "Brokk", type: "Warrior", role: "tank", fights: 2, unknown: 3, buffs: {
                    kings: { expected: 2, full: 2, late: 0, partial: 0, none: 0, unknown: 0, present: 2, wrong: 0, pct: 100 },
                    fortitude: { expected: 1, full: 1, late: 0, partial: 0, none: 0, unknown: 1, present: 1, wrong: 0, pct: 100 },
                    motw: { expected: 0, full: 0, late: 0, partial: 0, none: 0, unknown: 2, present: 0, wrong: 0, pct: 0 },
                }, missing: 0, late: 0, partial: 0, wrong: 0 }],
                rows: [
                    { key: "kings", label: "Segen der Könige", icon: "spell_magic_greaterblessingofkings", provider: "Paladin", expected: true, untracked: false, inferred: false, unknown: 0, coveragePct: 100, seenPlayers: 1, missingPlayers: 0 },
                    { key: "fortitude", label: "Machtwort: Seelenstärke", groupLabel: "Gebet der Seelenstärke", icon: "spell_holy_wordfortitude", provider: "Priest", expected: true, untracked: false, inferred: true, unknown: 1, coveragePct: 100, seenPlayers: 1, missingPlayers: 0 },
                    { key: "motw", label: "Mal der Wildnis", groupLabel: "Gabe der Wildnis", icon: "spell_nature_regeneration", provider: "Druid", expected: false, untracked: false, inferred: true, unknown: 2, coveragePct: null, seenPlayers: 0, missingPlayers: 0 },
                ],
                untracked: [],
                inferred: [
                    { key: "fortitude", label: "Machtwort: Seelenstärke", groupLabel: "Gebet der Seelenstärke", icon: "spell_holy_wordfortitude", provider: "Priest" },
                    { key: "motw", label: "Mal der Wildnis", groupLabel: "Gabe der Wildnis", icon: "spell_nature_regeneration", provider: "Druid" },
                ],
                unknownCells: 3,
            },
        };
        const html = renderReportPage(report);
        expect(html).toContain("<b>Aus dem Verlauf abgeleitet:</b>");
        expect(html).toContain("Machtwort: Seelenstärke / Gebet der Seelenstärke");
        expect(html).toContain("Mal der Wildnis / Gabe der Wildnis. Der Client loggt diesen Buff beim Pull nicht.");
        expect(html).toContain("3 Zellen bleiben ohne Nachweis.");
        expect(html).not.toContain("Im Log nicht nachweisbar");
        // both inferred buffs are columns, the one nobody was judged on included, and the header says where they come from
        expect(html).toMatch(/<th class="bh">[^<]*<img[^>]*spell_holy_wordfortitude[^>]*data-tip="Machtwort: Seelenstärke \/ Gebet der Seelenstärke \(Priest\) · aus dem Verlauf abgeleitet"/);
        expect(html).toMatch(/<th class="bh">[^<]*<img[^>]*spell_nature_regeneration/);
        expect(html).toContain("<td class=\"bc\"><span class=\"pct pct-na\" title=\"Mal der Wildnis: 2× nicht nachweisbar\">?</span></td>");
        expect(html).toContain("title=\"Machtwort: Seelenstärke: 1× da, 0× spät gesetzt, 0× nicht durchgehend, 0× gefehlt, 1× nicht nachweisbar\"");
        // the raider's own table says the same
        expect(html).toContain("Machtwort: Seelenstärke und Mal der Wildnis aus dem Verlauf abgeleitet, 3× ohne Nachweis.</span>");
        expect(html).toContain("<td><span class=\"pct pct-na\">?</span></td><td class=\"mono\">0</td><td class=\"mono\">0</td><td class=\"mono\">0</td><td class=\"mono\">0</td><td class=\"sritems\">2× nicht nachweisbar</td>");
    });

    it("names the inferred buffs and the open cells on a fight's Buffs topic and draws an open cell as a neutral ribbon row", () => {
        const { renderPlayerPage } = require("../../src/web/render.js");
        const tl = timeline();
        const f = tl.fights[0];
        f.buffs.inferred = ["fortitude"];
        f.buffs.players[2].buffs.push({ key: "fortitude", label: "Machtwort: Seelenstärke", icon: "spell_holy_wordfortitude", status: "unknown", uptimePct: 0, expected: true, wrong: false, inferred: true, bands: [] });
        const raid = renderReportPage({ ...report(), timeline: { fights: [f] } });
        expect(raid).toContain("aus dem Verlauf abgeleitet: Machtwort: Seelenstärke (1 ohne Nachweis)</span></p>");
        expect(raid).toContain("data-tip=\"Der Client loggt diesen Buff beim Pull nicht.");
        const player = renderPlayerPage({ ...report(), timeline: { fights: [f] } }, 2); // Dorn
        expect(player).toContain("<b class=\"\">0%</b><span>nicht nachweisbar</span>");
    });
});

describe("web/render — buffs the log cannot show", () => {
    it("names the blind spot on the Raid-Buffs panel and drops its column instead of showing a raid without Fortitude", () => {
        const report = {
            id: "abc123def456", title: "T", players: [], roster: [{ name: "Brokk", type: "Warrior", issues: [], potions: {}, armory: [] }],
            raidBuffs: {
                fights: 1, paladins: 1,
                players: [{ name: "Brokk", type: "Warrior", role: "tank", fights: 1, buffs: { kings: { expected: 1, full: 1, late: 0, partial: 0, none: 0, present: 1, wrong: 0, pct: 100 }, fortitude: { expected: 0, full: 0, late: 0, partial: 1, none: 0, present: 1, wrong: 0, pct: 100 } }, missing: 0, late: 0, partial: 0, wrong: 0 }],
                rows: [
                    { key: "kings", label: "Segen der Könige", icon: "spell_magic_greaterblessingofkings", provider: "Paladin", expected: true, untracked: false, coveragePct: 100, seenPlayers: 1, missingPlayers: 0 },
                    { key: "fortitude", label: "Machtwort: Seelenstärke", icon: "spell_holy_wordfortitude", provider: "Priest", expected: false, untracked: true, coveragePct: null, seenPlayers: 1, missingPlayers: 0 },
                ],
                untracked: [{ key: "fortitude", label: "Machtwort: Seelenstärke", groupLabel: "Gebet der Seelenstärke", icon: "spell_holy_wordfortitude", provider: "Priest" }],
            },
        };
        const html = renderReportPage(report);
        expect(html).toContain("Im Log nicht nachweisbar:");
        expect(html).toContain("Machtwort: Seelenstärke / Gebet der Seelenstärke");
        expect(html).toContain("beim Pull nicht");
        // the blind buff is no column, the blessing still is
        expect(html).toContain("spell_magic_greaterblessingofkings");
        expect(html).not.toMatch(/<th class="bh">[^<]*<img[^>]*spell_holy_wordfortitude/);
    });
});
