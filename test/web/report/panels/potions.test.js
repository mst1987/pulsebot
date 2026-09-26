// The potions table (src/web/report/panels/potions.js) and the compact potion cells.
const { POTIONS_HOW, renderPotionsPanel, potionCells } = require("../../../../src/web/report/panels/potions");

const linkFor = () => null;

describe("web/report/panels/potions", () => {
    it("says so without potions", () => {
        expect(renderPotionsPanel(null, linkFor)).toBe("<div class=\"empty\">Keine Tränke gefunden.</div>");
        expect(renderPotionsPanel({ players: [] }, linkFor)).toBe("<div class=\"empty\">Keine Tränke gefunden.</div>");
    });

    it("adds one column per mana source and scales the total bar to the raid's best", () => {
        const html = renderPotionsPanel({
            icons: { destruction: "inv_d", haste: "inv_h", mana: "inv_m" },
            types: [
                { key: "superMana", group: "mana", label: "Super-Manatrank", icon: "inv_potion_137" },
                { key: "rune", group: "mana", label: "Dunkle Rune", icon: "inv_rune" },
                { key: "haste", group: "haste", label: "Hast", icon: "inv_h" },
            ],
            players: [
                { name: "Dorn", type: "Shaman", destruction: 1, haste: 0, mana: 3, total: 4, byType: { superMana: 2, rune: 1 } },
                { name: "Elun", type: "Priest", destruction: 0, haste: 0, mana: 0, total: 2 },
            ],
        }, linkFor);
        expect(html).toContain("<th class=\"n\" data-tip=\"Super-Manatrank\" data-tip-sub=\"Teil der Spalte „Mana“.\"><img class=\"hicon\"");
        expect(html).toContain("data-tip=\"Dunkle Rune\"");
        expect(html).not.toContain("data-tip=\"Hast\"");
        expect(html).toContain("<td class=\"n\"><strong>3</strong></td>");
        expect(html).toContain("<td class=\"n\">2</td>");
        expect(html).toContain("<td class=\"n\"><span class=\"sritems\">·</span></td>");
        expect(html).toContain("<i style=\"width:100%\"></i><b>4</b>");
        expect(html).toContain("<i style=\"width:50%\"></i><b>2</b>");
        expect(html).toContain("<span class=\"pname-cell\">");
        expect(html).toContain(`data-tip-sub="${POTIONS_HOW}"`);
    });

    it("keeps a zero-total raid at a zero-width bar", () => {
        const html = renderPotionsPanel({ players: [{ name: "A", type: "Mage", destruction: 0, haste: 0, mana: 0, total: 0 }] }, linkFor);
        expect(html).toContain("<i style=\"width:0%\"></i><b>0</b>");
    });

    it("renders three icon cells with zero for a missing count", () => {
        expect(potionCells({ destruction: "inv_d", haste: "", mana: "inv_m" }, { destruction: 2, mana: 1 })).toBe(
            "<span class=\"potcell\"><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/inv_d.jpg\" alt=\"\">2</span>"
            + "<span class=\"potcell\">0</span>"
            + "<span class=\"potcell\"><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/inv_m.jpg\" alt=\"\">1</span>",
        );
    });
});
