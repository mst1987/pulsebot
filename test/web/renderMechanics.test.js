// The deaths list with its verdict badges and the "Mechaniken" topic of the fight timeline.
const { renderReportPage, renderPlayerPage } = require("../../src/web/render.js");

function report() {
    return {
        id: "abc123def456",
        title: "Test Raid",
        players: [{ name: "Alice", type: "Mage", issues: [] }, { name: "Bob", type: "Warrior", issues: [] }],
        roster: [
            { name: "Alice", type: "Mage", issues: [], potions: {}, armory: [] },
            { name: "Bob", type: "Warrior", issues: [], potions: {}, armory: [] },
        ],
    };
}

function timeline() {
    return {
        fights: [{
            id: 2, boss: "High King Maulgar", encounterId: 649, kill: true, fightPercentage: 0,
            startTime: 100000, endTime: 220000, duration: 120000,
            deaths: [
                { at: 20000, name: "Alice", type: "Mage", ability: "Whirlwind", abilityIcon: "ability_whirlwind", avoidable: true, early: true, nearEnd: false, repeat: false },
                { at: 115000, name: "Alice", type: "Mage", ability: "Arcane Explosion", avoidable: false, early: false, nearEnd: true, repeat: true },
            ],
            mechanics: {
                players: [
                    { name: "Alice", type: "Mage", hits: [
                        { at: 5000, key: "damage:Whirlwind", label: "Wirbelwind", icon: "ability_whirlwind", kind: "damage", amount: 3000 },
                        { at: 9000, key: "damage:Whirlwind", label: "Wirbelwind", icon: "ability_whirlwind", kind: "damage", amount: 2500 },
                    ], amount: 5500, byMechanic: { "damage:Whirlwind": { label: "Wirbelwind", icon: "ability_whirlwind", kind: "damage", hits: 2, amount: 5500 } } },
                    { name: "Bob", type: "Warrior", hits: [
                        { at: 30000, key: "debuff:Silence", label: "Stille", icon: "spell_holy_silence", kind: "debuff", amount: 0 },
                    ], amount: 0, byMechanic: { "debuff:Silence": { label: "Stille", icon: "spell_holy_silence", kind: "debuff", hits: 1, amount: 0 } } },
                ],
                mechanics: [
                    { key: "damage:Whirlwind", label: "Wirbelwind", icon: "ability_whirlwind", kind: "damage", hits: 2, amount: 5500, players: 1 },
                    { key: "debuff:Silence", label: "Stille", icon: "spell_holy_silence", kind: "debuff", hits: 1, amount: 0, players: 1 },
                ],
            },
            debuffs: null, totems: null, cooldowns: null, activity: null, buffs: null,
        }],
    };
}

describe("web/render — deaths with verdicts", () => {
    it("tags a death as avoidable, early, after a battle res or near the kill", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html).toContain("<span class=\"tag tag-high\">vermeidbar</span><span class=\"tag tag-medium\">früh</span>");
        expect(html).toContain("<span class=\"tag tag-medium\">nach Kampfrez</span><span class=\"tag\">kurz vor dem Kill</span>");
    });

    it("shows no tags on an unjudged death", () => {
        const tl = timeline();
        tl.fights[0].deaths = [{ at: 1000, name: "Alice", type: "Mage", ability: "x" }];
        const html = renderReportPage({ ...report(), timeline: tl });
        expect(html).not.toContain("vermeidbar</span>");
    });
});

describe("web/render — Mechaniken topic", () => {
    it("draws one marker row per mechanic with every hit, who took it and how many raiders", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        expect(html).toContain("data-show=\"fp-2-mechanics\">");
        expect(html).toMatch(/Mechaniken<span class="n(?: mid| bad)?">3 · 3 Treffer<\/span>/);
        expect(html).toContain("data-tip=\"Wirbelwind\"");
        expect(html).toContain("data-tip=\"0:05 Alice · Wirbelwind · 3.000\"");
        expect(html).toContain("data-tip=\"0:30 Bob · Stille\"");
        // the raid view tones by how many raiders a mechanic hit, not by the hit count
        expect(html).toContain("<b class=\"\">2×</b><span>1 Spieler · 6k</span>");
        expect(html).toContain("<b class=\"\">1×</b><span>1 Spieler</span>");
    });

    it("groups the hits per raider on the raid page: the most-hit first and open, a single hit closed", () => {
        const html = renderReportPage({ ...report(), timeline: timeline() });
        const alice = html.indexOf("<span class=\"cn\">Alice</span><span class=\"sritems\">Mage</span><span class=\"badge mid\">2 Treffer</span>");
        const bob = html.indexOf("<span class=\"cn\">Bob</span><span class=\"sritems\">Warrior</span><span class=\"badge\">1 Treffer</span>");
        expect(alice).toBeGreaterThan(-1);
        expect(bob).toBeGreaterThan(alice);
        expect(html).toMatch(/<details class="grp" style="--cc:#69CCF0" open>\s*<summary>[^]*?Alice/);
        const bobTag = html.lastIndexOf("<details class=\"grp\"", bob);
        expect(html.slice(bobTag, bob)).not.toContain(" open>");
    });

    it("gives the raider only their own hits, with the damage under the count", () => {
        const html = renderPlayerPage({ ...report(), timeline: timeline() }, 0); // Alice
        expect(html).toContain("data-show=\"p-fp-2-mechanics\">");
        expect(html).toMatch(/Mechaniken<span class="n(?: mid| bad)?">2 · 2 Treffer<\/span>/);
        expect(html).toContain("data-tip=\"0:05 Wirbelwind · 3.000\"");
        expect(html).not.toContain("Stille");
        expect(html).toContain("<b class=\"fc-medium\">2×</b><span>6k Schaden</span>");
        const bob = renderPlayerPage({ ...report(), timeline: timeline() }, 1);
        expect(bob).toContain("<b class=\"\">1×</b><span>Debuff</span>");
        expect(bob).not.toContain("Wirbelwind");
    });

    it("lists a raider's fight on their page even when hits are all they have there", () => {
        const tl = timeline();
        tl.fights[0].deaths = [];
        const html = renderPlayerPage({ ...report(), timeline: tl }, 1); // Bob: only a mechanic hit
        expect(html).toContain("id=\"p-fights\"");
        expect(html).toContain("id=\"p-fight-2\">");
    });

    it("skips the topic when a fight carries no mechanics", () => {
        const tl = timeline();
        tl.fights[0].mechanics = null;
        const html = renderReportPage({ ...report(), timeline: tl });
        expect(html).not.toContain("fp-2-mechanics");
    });
});
