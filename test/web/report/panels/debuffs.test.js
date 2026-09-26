// Debuffs on the boss (src/web/report/panels/debuffs.js): Sunder, boss uptimes,
// the raid summary and the debuff × boss matrix.
const { SUNDER_HOW, DEBUFFS_HOW, renderSunderPanel, uptimeCell, renderBossUptimesPanel, renderRaidDebuffsPanel } = require("../../../../src/web/report/panels/debuffs");

describe("web/report/panels/debuffs", () => {
    describe("renderSunderPanel", () => {
        it("says so without data", () => {
            expect(renderSunderPanel([], () => null)).toBe("<div class=\"empty\">Keine Sunder-Armor-Daten gefunden.</div>");
            expect(renderSunderPanel(null, () => null)).toBe("<div class=\"empty\">Keine Sunder-Armor-Daten gefunden.</div>");
        });

        it("lists the total and the sunders below five stacks, toned", () => {
            const html = renderSunderPanel([
                { name: "Brokk", type: "Warrior", total: 40, below5: 3 },
                { name: "Tia", type: "Warrior", total: 10, below5: 0 },
            ], (n) => `/p/${n}`);
            expect(html).toContain("<a class=\"pname-cell\" href=\"/p/Brokk\">");
            expect(html).toContain("<td class=\"srval\">40</td>\n          <td><span class=\"badge mid count\">3</span></td>");
            expect(html).toContain("<span class=\"badge ok count\">0</span>");
            expect(html).toContain(`data-tip-sub="${SUNDER_HOW.replace("<", "&lt;")}"`);
        });
    });

    it("renders an uptime cell as a toned percentage bar, 0 for junk", () => {
        expect(uptimeCell(97)).toContain("<b class=\"good\">97 %</b>");
        expect(uptimeCell("x")).toContain("<b class=\"high\">0 %</b>");
    });

    describe("renderBossUptimesPanel", () => {
        it("says so without rows", () => {
            expect(renderBossUptimesPanel(null)).toBe("<div class=\"empty\">Keine Boss-Daten gefunden.</div>");
            expect(renderBossUptimesPanel({ rows: [] })).toBe("<div class=\"empty\">Keine Boss-Daten gefunden.</div>");
        });

        it("renders one column per metric and marks wipes", () => {
            const html = renderBossUptimesPanel({
                metrics: [{ key: "sunder", label: "Sunder" }, { key: "coe", label: "CoE" }],
                rows: [{ boss: "Gruul", kill: true, sunder: 98, coe: 75 }, { boss: "Maulgar <1>", kill: false, sunder: 40 }],
            });
            expect(html).toContain("<th data-tip=\"Sunder\"");
            expect(html).toContain("<tr><td>Gruul</td><td><span class=\"bar\"><i class=\"good\" style=\"width:98%\"></i>");
            expect(html).toContain("<b class=\"medium\">75 %</b>");
            expect(html).toContain("<td>Maulgar &lt;1&gt; <span class=\"sritems\">(Wipe)</span></td>");
            expect(html).toContain("<b class=\"high\">0 %</b>");
        });
    });

    describe("renderRaidDebuffsPanel", () => {
        it("says so without rows", () => {
            expect(renderRaidDebuffsPanel(null, null)).toBe("<div class=\"empty\">Keine Raid-Debuffs im Log.</div>");
            expect(renderRaidDebuffsPanel({ rows: [] }, null)).toBe("<div class=\"empty\">Keine Raid-Debuffs im Log.</div>");
        });

        const rows = [
            { key: "sunder", label: "Sunder Armor", icon: "ability_sunder", provider: "Krieger", expected: true, avgUptime: 96, missing: 0, fights: 3, maxStacks: 5, avgBelowMax: 12 },
            { key: "coe", label: "Curse of Elements", icon: "spell_coe", provider: "Hexer", expected: true, avgUptime: 40, missing: 2, fights: 3 },
            { key: "misery", label: "Misery", icon: "spell_misery", provider: "Priester", expected: false, avgUptime: 20, maxStacks: 3 },
        ];

        it("renders the raid summary per debuff: expected, uptime, missing, stacks", () => {
            const html = renderRaidDebuffsPanel({ rows }, null);
            expect(html).toContain("Sunder Armor<div class=\"sritems\">Krieger</div></td>\n          <td><span class=\"pct pct-full\">ja</span></td>\n          <td><span class=\"pct pct-full\">96%</span></td>\n          <td><span class=\"pct pct-full\">0/3</span></td>\n          <td class=\"sritems\">12% unter 5</td>");
            expect(html).toContain("<td><span class=\"pct pct-none\">40%</span></td>\n          <td><span class=\"pct pct-none\">2/3</span></td>\n          <td class=\"sritems\">–</td>");
            expect(html).toContain("<td><span class=\"pct pct-none\">nein</span></td>\n          <td><span class=\"pct pct-na\" data-tip=\"nicht erwartet\">20%</span></td>\n          <td><span class=\"pct pct-na\">–</span></td>\n          <td class=\"sritems\">bis 3</td>");
            expect(html).toContain(`data-tip-sub="${DEBUFFS_HOW}"`);
            // no timeline, no matrix
            expect(html).not.toContain("debuff-matrix");
        });

        it("adds the debuff × boss matrix from the timeline", () => {
            const timeline = {
                fights: [
                    { id: 1, boss: "Maulgar", encounterId: 649, kill: false, fightPercentage: 40, debuffs: [
                        { key: "sunder", expected: true, uptimePct: 90, timeToMax: 10000 },
                        { key: "coe", expected: true, missing: true },
                        { key: "misery", expected: false, uptimePct: 20 },
                    ] },
                    { id: 2, boss: "Maulgar", encounterId: 649, kill: true, debuffs: [
                        { key: "sunder", expected: true, uptimePct: 100, timeToMax: 6000 },
                        { key: "coe", expected: true, uptimePct: 0 },
                    ] },
                    { id: 3, boss: "Trash", kill: false, debuffs: null },
                ],
            };
            const html = renderRaidDebuffsPanel({ rows }, timeline);
            expect(html).toContain("<table class=\"idx heal-table buff-matrix debuff-matrix\">");
            expect(html).toContain("<th class=\"bh\"><img src=\"/bosses/649.jpg\" alt=\"\"><span class=\"boss-name\">Maulgar</span><span class=\"sritems\">Kill nach 2 Tries</span></th>");
            expect(html).toContain("<th class=\"bh\"><span class=\"boss-name\">Trash</span><span class=\"sritems\">1 Wipe</span></th>");
            // sunder: mean 95 over both tries, full stacks after 8 s on average
            expect(html).toContain("<span class=\"pct pct-full\" data-tip=\"Sunder Armor auf Maulgar: Try 1 (Wipe bei 40 %): 90 % · Try 2 (Kill): 100 %\">95%</span><div class=\"sritems\">max ab 0:08</div>");
            // coe: expected and absent on every try
            expect(html).toContain("<span class=\"pct pct-none\" data-tip=\"Curse of Elements fehlte auf Maulgar · Try 1 (Wipe bei 40 %): 0 % · Try 2 (Kill): 0 %\">0%</span>");
            // misery: not expected, only seen on one try; no stack time known
            expect(html).toContain("<span class=\"pct pct-na\" data-tip=\"Misery auf Maulgar: nicht erwartet · Try 1 (Wipe bei 40 %): 20 %\">20%</span></td>");
            // nothing on the trash pull
            expect(html).toContain("<span class=\"pct pct-na\" data-tip=\"Sunder Armor auf Trash: nicht erwartet\">–</span>");
            expect(html).toContain("Misery<div class=\"sritems\">Priester · 3 Stacks</div>");
        });
    });
});
