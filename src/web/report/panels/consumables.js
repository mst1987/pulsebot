// Detail tables of the Vorbereitung group: gear problems, consumables, drums and
// shadow resistance.
const { itemLink: wowheadItemLink } = require("../../../utils/wowhead");
const { esc } = require("../layout");
const { classCell, playerCard, pctCell, badge, barPct, yesNo, colHead } = require("../widgets");

function renderGearPanel(players, linkFor) {
    if (!players || players.length === 0) {
        return "<div class=\"empty\">Keine Gear-Probleme gefunden.</div>";
    }
    const total = players.reduce((n, p) => n + (p.issues || []).length, 0);
    return `<div class="badges">${badge(`${players.length} Spieler`, "", "inv_shield_06")}${badge(`${total} ${total === 1 ? "Problem" : "Probleme"}`, total ? "mid" : "ok")}</div>
      <div class="grid">${players.map((p) => playerCard(p, linkFor(p.name))).join("")}</div>`;
}

const CONS_HOW = "Abdeckung in % der Boss-Kämpfe. Flask und Elixiere schließen sich aus: „Flask/Elixiere“ heißt Flask oder beide Elixiere aktiv.";

function renderConsumablesPanel(consumables, linkFor) {
    const rows = (consumables && consumables.players) || [];
    if (rows.length === 0) return "<div class=\"empty\">Keine Daten.</div>";
    const ic = (consumables && consumables.icons) || {};
    const body = rows.map((p) => `<tr>
      <td>${classCell(p, linkFor(p.name))}</td>
      <td>${pctCell(p.flask)}</td>
      <td>${pctCell(p.elixir)}</td>
      <td>${barPct(p.buffed)}</td>
      <td>${barPct(p.food)}</td>
      <td>${yesNo(p.weaponOiled)}</td>
    </tr>`).join("");
    return `<div class="tbox"><table class="idx">
      <tr><th>Spieler</th><th>${colHead(ic.flask, "Flask")}</th><th>${colHead(ic.battle, "Elixiere")}</th><th data-tip="Flask oder beide Elixiere" data-tip-sub="${esc(CONS_HOW)}">Flask/Elixiere</th><th data-tip="Food" data-tip-sub="Anteil der Boss-Kämpfe mit Essensbuff.">${colHead(ic.food, "Food")}</th><th>Waffe geölt</th></tr>
      ${body}
    </table></div>`;
}

function renderShadowResiPanel(sr, linkFor) {
    if (!sr || !sr.players || sr.players.length === 0) return "<div class=\"empty\">Kein Mother-Shahraz-Kampf im Report.</div>";
    const body = sr.players.map((p) => {
        const items = p.items.map((it) =>
            `<a href="${esc(wowheadItemLink(it.itemId))}" target="_blank" rel="noopener">${esc(it.itemName)} (+${esc(it.sr)})</a>`
        ).join(", ");
        return `<tr><td>${classCell(p, linkFor(p.name))}</td><td class="srval">${esc(p.sr)}</td><td class="sritems">${items || "–"}</td></tr>`;
    }).join("");
    return `<div class="tbox"><table class="idx">
      <tr><th>Spieler</th><th data-tip="Schattenwiderstand aus Gear"${sr.note ? ` data-tip-sub="${esc(sr.note)}"` : ""}>SR (Gear)</th><th>Quellen</th></tr>
      ${body}
    </table></div>`;
}

function renderDrumsPanel(drums, linkFor) {
    const rows = (drums && drums.players) || [];
    if (rows.length === 0) return "<div class=\"empty\">Keine Drums gefunden.</div>";
    const body = rows.map((p) => {
        const parts = Object.entries(p.byType).map(([k, v]) => `${k}: ${v}`).join(", ");
        return `<tr><td>${classCell(p, linkFor(p.name))}</td><td class="srval">${esc(p.total)}</td><td class="sritems">${esc(parts)}</td></tr>`;
    }).join("");
    return `<div class="tbox"><table class="idx">
      <tr><th>Spieler</th><th>${colHead(drums && drums.icon, "Drums gesamt")}</th><th>Aufschlüsselung</th></tr>
      ${body}
    </table></div>`;
}

module.exports = {
    renderGearPanel, CONS_HOW, renderConsumablesPanel, renderShadowResiPanel, renderDrumsPanel,
};
