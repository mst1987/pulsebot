// The raid-wide CLA summaries of the Raid view's dialogs (src/web/report/panels/summaries.js).
const { AREA_HOW, renderCooldownSummary, renderActivitySummary, renderTotemSummary, renderMechanicsSummary } = require("../../../../src/web/report/panels/summaries");
const { CONS_HOW } = require("../../../../src/web/report/panels/consumables");
const { SPELLS_HOW } = require("../../../../src/web/report/panels/rpb");

const linkFor = (name) => (name === "Brokk" ? "/r/x/p/0" : null);

describe("web/report/panels/summaries", () => {
    it("explains every area, reusing the panels' own explanations", () => {
        expect(Object.keys(AREA_HOW).sort()).toEqual([
            "activity", "bosses", "consumables", "cooldowns", "drums", "gear", "healers", "mechanics", "potions",
            "raidbuffs", "raiddebuffs", "rpbdamage", "rpbinterrupts", "rpbspells", "rpbvalidate", "shadowresi", "sunder", "totems",
        ]);
        expect(AREA_HOW.consumables.startsWith(CONS_HOW)).toBe(true);
        expect(AREA_HOW.rpbspells).toBe(SPELLS_HOW);
    });

    describe("renderCooldownSummary", () => {
        it("sorts the lowest used share first, raiders without a share last", () => {
            const html = renderCooldownSummary({
                players: [
                    { name: "Nox", type: "Rogue", fights: 2, uses: 0, possible: 0, usedPct: null, avgFirstAtMs: null, stacked: 0, unstacked: 0 },
                    { name: "Brokk", type: "Warrior", fights: 3, uses: 9, possible: 10, usedPct: 90, avgFirstAtMs: 12000, stacked: 2, unstacked: 7 },
                    { name: "Elun", type: "Priest", fights: 3, uses: 3, possible: 10, usedPct: 30, stacked: 1, unstacked: 2 },
                ],
            }, linkFor);
            const order = [...html.matchAll(/font-weight:700">(\w+)</g)].map((m) => m[1]);
            expect(order).toEqual(["Elun", "Brokk", "Nox"]);
            expect(html).toContain("<td class=\"mono\">9 / 10</td>");
            expect(html).toContain("<b class=\"medium\">90 %</b>");
            expect(html).toContain("<td class=\"mono\">0:12</td><td class=\"mono\">2 / 9</td>");
            expect(html).toContain("<td><span class=\"pct pct-na\">–</span></td><td class=\"mono\">–</td>");
            expect(html).toContain("<a class=\"pname-cell\" href=\"/r/x/p/0\">");
        });

        it("renders only the head for no players", () => {
            expect(renderCooldownSummary({}, linkFor)).toMatch(/<th>Mit Bloodlust<\/th>|data-tip="Mit Bloodlust"/);
        });
    });

    it("renders the activity summary, lowest first, with gap times", () => {
        const html = renderActivitySummary({
            players: [
                { name: "Brokk", type: "Warrior", fights: 3, activeAvg: 97, gaps: 1, longestGap: 4000, unexplainedMs: 2000, mechanicMs: 0 },
                { name: "Elun", type: "Priest", fights: 3, activeAvg: 80, gaps: 5, longestGap: 61000, unexplainedMs: 30000, mechanicMs: 9000 },
            ],
        }, linkFor);
        const order = [...html.matchAll(/font-weight:700">(\w+)</g)].map((m) => m[1]);
        expect(order).toEqual(["Elun", "Brokk"]);
        expect(html).toContain("<td class=\"mono\">5</td><td class=\"mono\">1:01</td><td class=\"mono\">0:30</td><td class=\"mono\">0:09</td>");
        expect(html).toContain("<b class=\"good\">97 %</b>");
    });

    it("renders the totem summary with derived Windfury, twisting and empty slots", () => {
        const html = renderTotemSummary({
            players: [
                { name: "Dorn", type: "Shaman", role: "Enhancement", fights: 3, wfUptimeAvg: 92, wfDerived: true, twistingFights: 2, wfFights: 3, gapCount: 4, downtimeMs: 15000, slotDowntimeMs: { air: 10000, fire: 0, earth: 5000 } },
                { name: "Rain", type: "Shaman", fights: 1, wfUptimeAvg: 99, twistingFights: 0, wfFights: 1, gapCount: 0, downtimeMs: 0, slotDowntimeMs: {} },
                { name: "Nowf", type: "Shaman", fights: 1, wfUptimeAvg: null, twistingFights: 0, wfFights: 0, gapCount: 0, downtimeMs: 0 },
            ],
        }, linkFor);
        expect(html).toContain("<div class=\"sritems\">Enhancement</div>");
        expect(html).toContain("data-tip=\"Aus den Drops abgeleitet\" data-tip-sub=\"Der Log enthält keinen Windfury-Buff.");
        expect(html).toContain("<b class=\"good\">99 %</b>");
        expect(html).toContain("<td class=\"mono\">2 / 3</td><td class=\"mono\">4</td><td class=\"mono\">0:15</td><td class=\"sritems\">air: 0:10, earth: 0:05</td>");
        expect(html).toContain("<td><span class=\"pct pct-na\">–</span></td>");
        expect(html).toContain("<td class=\"sritems\">–</td>");
    });

    describe("renderMechanicsSummary", () => {
        it("sums the judged deaths as badges and lists mechanics and raiders", () => {
            const html = renderMechanicsSummary({
                deaths: { total: 3, avoidable: 1, early: 1, repeat: 0, nearEnd: 1 },
                mechanics: [
                    { label: "Arcane Explosion", icon: "spell_ae", kind: "damage", hits: 8, amount: 24000, fights: 2 },
                    { label: "Fear", icon: "spell_fear", kind: "debuff", hits: 2, fights: 1 },
                ],
                players: [
                    { name: "Brokk", type: "Warrior", hits: 5, amount: 15000, deaths: 2, avoidableDeaths: 1, earlyDeaths: 1, topMechanic: { label: "Arcane Explosion", icon: "spell_ae", hits: 4 } },
                    { name: "Elun", type: "Priest", hits: 1 },
                ],
            }, linkFor);
            expect(html).toContain("3 Tode</span>");
            expect(html).toContain("<span class=\"badge bad\">1 vermeidbar</span><span class=\"badge mid\">1 früh</span><span class=\"badge\">0 nach Kampfrez</span><span class=\"badge\">1 kurz vor dem Kill</span>");
            expect(html).toContain("Arcane Explosion<div class=\"sritems\">Schaden</div>");
            expect(html).toContain("Fear<div class=\"sritems\">Debuff</div>");
            expect(html).toContain("<i style=\"width:100%\"></i><b>8</b>");
            expect(html).toContain("<i style=\"width:25%\"></i><b>2</b>");
            expect(html).toContain("<td class=\"mono\">24,0k</td><td class=\"mono\">2</td>");
            expect(html).toContain("<td class=\"mono\">–</td><td class=\"mono\">1</td>");
            expect(html).toContain("<div class=\"dsub\">Pro Raider</div>");
            expect(html).toContain("<td class=\"mono\">2 <span class=\"badge bad\">1 vermeidbar</span> <span class=\"badge mid\">1 früh</span></td>");
            expect(html).toContain("Arcane Explosion (4×)</td>");
            expect(html).toContain("<td class=\"mono\">0</td><td class=\"sritems\">–</td>");
        });

        it("shows only the death badges when nothing else is known", () => {
            const html = renderMechanicsSummary({}, linkFor);
            expect(html).toContain("0 Tode</span>");
            expect(html).toContain("<span class=\"badge ok\">0 vermeidbar</span><span class=\"badge ok\">0 früh</span>");
            expect(html).not.toContain("<table");
        });
    });
});
