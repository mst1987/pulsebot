// The Vorbereitung detail tables (src/web/report/panels/consumables.js): gear
// problems, consumables, shadow resistance and drums.
const { renderGearPanel, CONS_HOW, renderConsumablesPanel, renderShadowResiPanel, renderDrumsPanel } = require("../../../../src/web/report/panels/consumables");

const linkFor = (name) => (name === "Brokk" ? "/r/x/p/0" : null);

describe("web/report/panels/consumables", () => {
    describe("renderGearPanel", () => {
        it("says so without players", () => {
            expect(renderGearPanel([], linkFor)).toBe("<div class=\"empty\">Keine Gear-Probleme gefunden.</div>");
            expect(renderGearPanel(null, linkFor)).toBe("<div class=\"empty\">Keine Gear-Probleme gefunden.</div>");
        });

        it("counts players and problems and renders one card each", () => {
            const html = renderGearPanel([
                { name: "Brokk", type: "Warrior", issues: [{ itemName: "Helm", severity: "high", label: "fehlt" }] },
                { name: "Elun", type: "Priest" },
            ], linkFor);
            expect(html).toContain("2 Spieler</span>");
            expect(html).toContain("<span class=\"badge mid\">1 Problem</span>");
            expect(html.match(/<section class="card /g)).toHaveLength(2);
            expect(html).toContain("<a class=\"player\" href=\"/r/x/p/0\">");
        });

        it("tones zero problems ok and pluralises", () => {
            expect(renderGearPanel([{ name: "A", type: "Mage", issues: [] }], linkFor)).toContain("<span class=\"badge ok\">0 Probleme</span>");
        });
    });

    describe("renderConsumablesPanel", () => {
        it("says so without data", () => {
            expect(renderConsumablesPanel(null, linkFor)).toBe("<div class=\"empty\">Keine Daten.</div>");
            expect(renderConsumablesPanel({ players: [] }, linkFor)).toBe("<div class=\"empty\">Keine Daten.</div>");
        });

        it("renders one row per raider with coverage cells, bars and the oil", () => {
            const html = renderConsumablesPanel({
                players: [{ name: "Brokk", type: "Warrior", flask: 100, elixir: 0, buffed: 100, food: 50, weaponOiled: true }],
                icons: { flask: "inv_flask", battle: "inv_elixir", food: "inv_food" },
            }, linkFor);
            expect(html).toContain("<td><span class=\"pct pct-full\">100%</span></td>");
            expect(html).toContain("<td><span class=\"pct pct-none\">0%</span></td>");
            expect(html).toContain("<b class=\"high\">50 %</b>");
            expect(html).toContain("<span class=\"pct pct-full\">ja</span>");
            expect(html).toContain("inv_flask.jpg");
            expect(html).toContain("<span>Elixiere</span>");
            expect(html).toContain(`data-tip-sub="${CONS_HOW}"`);
            expect(html).toContain("href=\"/r/x/p/0\"");
        });

        it("works without icons", () => {
            const html = renderConsumablesPanel({ players: [{ name: "X", type: "Mage", flask: 0, elixir: 50, buffed: 50, food: 0, weaponOiled: false }] }, linkFor);
            expect(html).toContain("<th><span>Flask</span></th>");
            expect(html).toContain("<span class=\"pct pct-none\">nein</span>");
        });
    });

    describe("renderShadowResiPanel", () => {
        it("says so without a Shahraz fight", () => {
            const empty = "<div class=\"empty\">Kein Mother-Shahraz-Kampf im Report.</div>";
            expect(renderShadowResiPanel(null, linkFor)).toBe(empty);
            expect(renderShadowResiPanel({ players: [] }, linkFor)).toBe(empty);
        });

        it("lists the resistance and its item sources, with the note as tooltip", () => {
            const html = renderShadowResiPanel({
                note: "nur Gear",
                players: [
                    { name: "Brokk", type: "Warrior", sr: 85, items: [{ itemId: 9, itemName: "Umhang <SR>", sr: 20 }] },
                    { name: "Elun", type: "Priest", sr: 0, items: [] },
                ],
            }, linkFor);
            expect(html).toContain("data-tip=\"Schattenwiderstand aus Gear\" data-tip-sub=\"nur Gear\"");
            expect(html).toContain("<td class=\"srval\">85</td><td class=\"sritems\"><a href=\"https://www.wowhead.com/tbc/item=9\" target=\"_blank\" rel=\"noopener\">Umhang &lt;SR&gt; (+20)</a></td>");
            expect(html).toContain("<td class=\"srval\">0</td><td class=\"sritems\">–</td>");
            expect(renderShadowResiPanel({ players: [{ name: "A", type: "Mage", sr: 1, items: [] }] }, linkFor)).toContain("<th data-tip=\"Schattenwiderstand aus Gear\">SR (Gear)</th>");
        });
    });

    describe("renderDrumsPanel", () => {
        it("says so without drums", () => {
            expect(renderDrumsPanel(undefined, linkFor)).toBe("<div class=\"empty\">Keine Drums gefunden.</div>");
        });

        it("lists the total and the breakdown per drum type", () => {
            const html = renderDrumsPanel({ icon: "inv_misc_drum_01", players: [{ name: "Brokk", type: "Warrior", total: 5, byType: { Battle: 3, Restoration: 2 } }] }, linkFor);
            expect(html).toContain("<td class=\"srval\">5</td><td class=\"sritems\">Battle: 3, Restoration: 2</td>");
            expect(html).toContain("inv_misc_drum_01.jpg");
            expect(html).toContain("<span>Drums gesamt</span>");
        });
    });
});
