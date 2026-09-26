// Detail table of the potions per raider and potion type.
const { esc } = require("../layout");
const { classCell, barCell, hicon, colHead } = require("../widgets");

const POTIONS_HOW = "Anzahl getrunkener Tränke. „Mana“ ist die Summe aller Manaquellen; die Spalten dahinter schlüsseln auf, welche, inklusive der zoneneigenen Gratis-Items und der Runen.";

function renderPotionsPanel(potions, linkFor) {
    const rows = (potions && potions.players) || [];
    if (rows.length === 0) return "<div class=\"empty\">Keine Tränke gefunden.</div>";
    const ic = (potions && potions.icons) || {};
    // Every mana source that actually turned up in this raid gets its own column,
    // so "Mana" is not one opaque number any more; the column head names it.
    const manaTypes = ((potions && potions.types) || []).filter((t) => t.group === "mana");
    const manaHead = manaTypes.map((t) => `<th class="n" data-tip="${esc(t.label)}" data-tip-sub="Teil der Spalte „Mana“.">${hicon(t.icon, "")}</th>`).join("");
    const maxTotal = Math.max(1, ...rows.map((p) => Number(p.total) || 0));

    const body = rows.map((p) => {
        const byType = p.byType || {};
        const manaCells = manaTypes.map((t) => {
            const n = byType[t.key] || 0;
            return `<td class="n">${n ? esc(n) : "<span class=\"sritems\">·</span>"}</td>`;
        }).join("");
        return `<tr>
          <td class="pcol">${classCell(p, linkFor(p.name))}</td>
          <td class="n">${esc(p.destruction)}</td>
          <td class="n">${esc(p.haste)}</td>
          <td class="n"><strong>${esc(p.mana)}</strong></td>
          ${manaCells}
          <td>${barCell(String(p.total), ((Number(p.total) || 0) / maxTotal) * 100, "")}</td>
        </tr>`;
    }).join("");

    return `<div class="tbox scrollx"><table class="idx rpb">
      <tr>
        <th class="pcol">Spieler</th>
        <th class="n">${colHead(ic.destruction, "Zerstörung")}</th>
        <th class="n">${colHead(ic.haste, "Hast")}</th>
        <th class="n" data-tip="Mana" data-tip-sub="${esc(POTIONS_HOW)}">${colHead(ic.mana, "Mana")}</th>
        ${manaHead}
        <th data-tip="Gesamt" data-tip-sub="Der Balken ist der Anteil am höchsten Wert im Raid.">Gesamt</th>
      </tr>
      ${body}
    </table></div>`;
}

function potionCells(ic, pot) {
    const cell = (icon, n) => `<span class="potcell">${hicon(icon, "")}${esc(n || 0)}</span>`;
    return cell(ic.destruction, pot.destruction) + cell(ic.haste, pot.haste) + cell(ic.mana, pot.mana);
}

module.exports = {
    POTIONS_HOW, renderPotionsPanel, potionCells,
};
