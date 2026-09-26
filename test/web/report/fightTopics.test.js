// The building blocks of a fight's topics (src/web/report/fightTopics.js):
// outcome, deaths, mechanic rows, the debuff line, topic tables, grouping by boss.
const { fightOutcome, deathsList, mechanicRows, debuffSub, TOPIC_META, topicTable, groupedTable, groupByBoss } = require("../../../src/web/report/fightTopics");

describe("web/report/fightTopics", () => {
    describe("fightOutcome", () => {
        it("says Kill, or Wipe with the boss's rounded health when known", () => {
            expect(fightOutcome({ kill: true })).toBe("Kill");
            expect(fightOutcome({ kill: false, fightPercentage: 32.5 })).toBe("Wipe bei 33 %");
            expect(fightOutcome({ kill: false, fightPercentage: null })).toBe("Wipe");
            expect(fightOutcome({})).toBe("Wipe");
        });
    });

    describe("deathsList", () => {
        it("says nobody died for an empty or missing list", () => {
            const empty = "<div class=\"fc-empty\">Niemand ist gestorben.</div>";
            expect(deathsList([], null)).toBe(empty);
            expect(deathsList(undefined)).toBe(empty);
        });

        it("lists each death with time, linked name, killing blow and its judgement tags", () => {
            const html = deathsList([
                { at: 30000, name: "Alice", type: "Mage", ability: "Arcane <Explosion>", abilityIcon: "spell_x", avoidable: true, early: true, repeat: true, nearEnd: true },
                { at: 65000, name: "Bob", type: "Bard" },
            ], (n) => (n === "Alice" ? "/r/x/p/0" : null));
            expect(html).toMatch(/^<ul class="fight-deaths">/);
            expect(html).toContain("<li style=\"--cc:#69CCF0\"><b>0:30</b><a class=\"cn\" href=\"/r/x/p/0\">Alice</a> <span class=\"sritems\">· <img class=\"hicon\"");
            expect(html).toContain("Arcane &lt;Explosion&gt;</span>");
            expect(html).toContain("<span class=\"tag tag-high\">vermeidbar</span><span class=\"tag tag-medium\">früh</span><span class=\"tag tag-medium\">nach Kampfrez</span><span class=\"tag\">kurz vor dem Kill</span>");
            expect(html).toContain("<li style=\"--cc:var(--text)\"><b>1:05</b><span class=\"cn\">Bob</span></li>");
        });

        it("names without a link function", () => {
            expect(deathsList([{ at: 0, name: "X", ability: "Y" }])).toContain("<span class=\"cn\">X</span> <span class=\"sritems\">· Y</span>");
        });
    });

    describe("mechanicRows", () => {
        const mech = {
            mechanics: [
                { key: "ae", label: "Arcane Explosion", icon: "spell_ae", hits: 6, players: 5, amount: 12000 },
                { key: "ww", label: "Whirlwind", icon: "ability_ww", hits: 2, players: 2 },
                { key: "sh", label: "Shatter", icon: "spell_sh", hits: 1, players: 1 },
            ],
            players: [
                { name: "Alice", byMechanic: { ae: { label: "Arcane Explosion", icon: "spell_ae", hits: 3, amount: 4500 }, ww: { label: "Whirlwind", icon: "ability_ww", hits: 1 } },
                    hits: [{ key: "ae", at: 5000, icon: "spell_ae", amount: 1500 }, { key: "ae", at: 1000, icon: "spell_ae", amount: 1500 }, { key: "ae", at: 9000, icon: "spell_ae", amount: 1500 }, { key: "ww", at: 2000, icon: "ability_ww" }] },
                { name: "Bob", byMechanic: { ae: { label: "Arcane Explosion", icon: "spell_ae", hits: 2 } },
                    hits: [{ key: "ae", at: 3000, icon: "spell_ae", amount: 2000 }, { key: "ae", at: 4000, icon: "spell_ae" }] },
            ],
        };

        it("returns nothing without data or for a raider who was not hit", () => {
            expect(mechanicRows(null)).toEqual([]);
            expect(mechanicRows(mech, "Nobody")).toEqual([]);
            expect(mechanicRows({}, null)).toEqual([]);
        });

        it("gives the raid view one row per mechanic with every hit as a sorted marker", () => {
            const rows = mechanicRows(mech);
            expect(rows.map((r) => [r.label, r.value, r.sub, r.tone])).toEqual([
                ["Arcane Explosion", "6×", "5 Spieler · 12k", "high"],
                ["Whirlwind", "2×", "2 Spieler", "medium"],
                ["Shatter", "1×", "1 Spieler", undefined],
            ]);
            expect(rows[0].markers.map((m) => m.at)).toEqual([1000, 3000, 4000, 5000, 9000]);
            expect(rows[0].markers[0].label).toBe("Alice · Arcane Explosion · 1.500");
            expect(rows[0].markers[2].label).toBe("Bob · Arcane Explosion");
        });

        it("gives the player view the raider's own mechanics, most hits first", () => {
            const rows = mechanicRows(mech, "Alice");
            expect(rows.map((r) => [r.label, r.value, r.sub, r.tone, r.markers.length])).toEqual([
                ["Arcane Explosion", "3×", "5k Schaden", "high", 3],
                ["Whirlwind", "1×", "Debuff", undefined, 1],
            ]);
            expect(rows[0].markers[0]).toEqual({ at: 5000, icon: "spell_ae", label: "Arcane Explosion · 1.500" });
            expect(rows[1].markers[0].label).toBe("Whirlwind");
            expect(mechanicRows(mech, "Bob")[0].tone).toBe("medium");
        });
    });

    describe("debuffSub", () => {
        it("prefers full stacks, then missing, then the worst gap, then the first application", () => {
            expect(debuffSub({ maxStacks: 5, timeToMax: 8000 })).toBe("5/5 ab 0:08");
            expect(debuffSub({ maxStacks: 5, timeToMax: null, missing: true })).toBe("fehlt");
            expect(debuffSub({ longestGap: 12000 })).toBe("Lücke 0:12");
            expect(debuffSub({ longestGap: 3000, firstAt: 4000 })).toBe("ab 0:04");
            expect(debuffSub({ firstAt: null })).toBe("");
        });
    });

    it("has a label and an icon for every topic", () => {
        for (const [key, meta] of Object.entries(TOPIC_META)) {
            expect([key, typeof meta.label, typeof meta.icon]).toEqual([key, "string", "string"]);
        }
        expect(TOPIC_META.deaths).toEqual({ label: "Tode", icon: "ability_creature_cursed_05" });
    });

    describe("topicTable", () => {
        it("renders band rows with uptime, gaps and the longest gap", () => {
            const html = topicTable([
                { label: "Sunder <A>", icon: "ability_sunder", value: "90%", tone: "medium", sub: "5/5 ab 0:08", bands: [[0, 40000], { from: 60000, to: 100000 }, null, [50, 10]] },
                { label: "Leer", bands: [] },
            ], 100000, "bands");
            expect(html).toContain("<tr><th>Zeile</th><th>Uptime</th><th>Details</th><th>Lücken</th><th>Längste Lücke</th></tr>");
            expect(html).toContain("Sunder &lt;A&gt;</td><td><span class=\"tv medium\">90%</span></td><td>5/5 ab 0:08</td><td class=\"mono\">1</td><td class=\"mono\">0:20</td></tr>");
            expect(html).toContain("<tr><td>Leer</td><td>–</td><td>–</td>");
        });

        it("renders marker rows with the first eight times and the total", () => {
            const markers = Array.from({ length: 10 }, (_, i) => ({ at: i * 1000 }));
            const html = topicTable([
                { label: "Hits", value: 0, markers: [...markers, { at: NaN }, null] },
                { label: "Keine", markers: [] },
            ], 60000, "markers");
            expect(html).toContain("<tr><th>Zeile</th><th>Anzahl</th><th>Details</th><th>Zeitpunkte</th></tr>");
            expect(html).toContain("<td><span class=\"tv\">0</span></td><td>–</td><td class=\"mono\">0:00, 0:01, 0:02, 0:03, 0:04, 0:05, 0:06, 0:07, … (10)</td>");
            expect(html).toContain("<tr><td>Keine</td><td>–</td><td>–</td><td class=\"mono\">–</td></tr>");
        });
    });

    describe("groupedTable", () => {
        it("renders one foldable group per owner with class tile, badge and extra", () => {
            const html = groupedTable([
                { name: "Dorn", type: "Shaman", rows: [{ label: "Windfury", markers: [{ at: 1000 }] }], badge: { text: "2 Lücken", tone: "mid" }, open: true, extra: "<i>x</i>" },
                { name: "Nox", type: undefined, rows: [] },
            ], 60000, "markers");
            expect(html).toMatch(/^<div class="glist"><details class="grp" style="--cc:#0070DE" open>/);
            expect(html).toContain("<span class=\"cn\">Dorn</span><span class=\"sritems\">Shaman</span><span class=\"badge mid\">2 Lücken</span><i>x</i><span class=\"exp-lbl\">");
            expect(html).toContain("<details class=\"grp\" style=\"--cc:var(--text)\">");
            expect(html).toContain("<span class=\"cn\">Nox</span><span class=\"sritems\"></span><span class=\"exp-lbl\">");
            expect(html.match(/<table class="idx fc-table topic-table">/g)).toHaveLength(2);
        });
    });

    describe("groupByBoss", () => {
        it("groups by encounter id, else by name, in pull order", () => {
            const fights = [
                { id: 1, boss: "Maulgar", encounterId: 649 },
                { id: 2, boss: "Gruul", encounterId: 650 },
                { id: 3, boss: "Maulgar", encounterId: 649 },
                { id: 4, boss: "Trash" },
                { id: 5, boss: "Trash" },
            ];
            const bosses = groupByBoss(fights);
            expect(bosses.map((b) => [b.key, b.name, b.encounterId, b.fights.map((f) => f.id)])).toEqual([
                ["e649", "Maulgar", 649, [1, 3]],
                ["e650", "Gruul", 650, [2]],
                ["nTrash", "Trash", undefined, [4, 5]],
            ]);
            expect(groupByBoss([])).toEqual([]);
        });
    });
});
