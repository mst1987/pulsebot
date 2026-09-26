// RPB: avoidable damage taken, per player and per ability.
const { esc } = require("../layout");
const { iconUrl, classIconUrl, classCell, badge, barCell, ICON_BY_NAME, num } = require("../widgets");
const { sortByRole, roleAttrs, rpbTools } = require("./rpbRoles");

const DMG_SCALE_HOW = "Der Balken ist der Anteil am höchsten Wert dieser Spalte im ganzen Raid, also über alle Rollen vergleichbar. Ab 50 % gelb, ab 75 % rot.";

/**
 * A damage number as a WCL bar of fixed width: its share of the highest value
 * in the same column raid-wide (not just within the role, so a tank with two
 * rows does not paint one of them red for a harmless difference).
 */
function dmgCell(v, max) {
    if (!(v > 0)) return "<span class=\"mute mono\">·</span>";
    const share = max > 0 ? v / max : 0;
    return barCell(num(v), share * 100, share >= 0.75 ? "high" : share >= 0.5 ? "medium" : "");
}

/** Column head for one avoidable ability: its icon, the NPCs that cast it and the scale in the tooltip. */
function abilityHead(a) {
    const src = a.sources && a.sources.length ? `Quelle: ${a.sources.join(", ")}. ` : "";
    return `<th class="n" data-tip="${esc(a.label)}" data-tip-sub="${esc(src + DMG_SCALE_HOW)}">${abilityIcon(a)}${esc(a.label)}</th>`;
}

/** Small inline icon for an avoidable ability, config icon as the fallback. */
function abilityIcon(a) {
    const icon = a.icon || ICON_BY_NAME[a.name];
    return icon ? `<img class="hicon" src="${esc(iconUrl(icon))}" alt="" loading="lazy">` : "";
}

/** Highest value per ability column (and per summary column) across the whole raid. */
function damageScale(damage) {
    const abilities = damage.abilities || [];
    const players = damage.players || [];
    const perAbility = abilities.map((a, i) => Math.max(0, ...players.map((p) => p.perAbility[i] || 0)));
    return {
        perAbility,
        total: Math.max(0, ...players.map((p) => p.avoidableTotal || 0)),
        reflected: Math.max(0, ...players.map((p) => p.reflected || 0)),
        hostile: Math.max(0, ...players.map((p) => p.hostile || 0)),
    };
}

const deathBadge = (n) => badge(String(n || 0), n > 0 ? "bad" : "ok", "", true);

/** Players as rows, abilities as columns (the classic orientation). */
function damageByPlayer(abilities, list, linkFor, scale, roles) {
    const head = abilities.map(abilityHead).join("");
    const body = list.map((p) => {
        const cells = abilities.map((a, i) => `<td class="n">${dmgCell(p.perAbility[i], scale.perAbility[i])}</td>`).join("");
        return `<tr${roleAttrs(roles, p.name)}>
          <td class="pcol">${classCell(p, linkFor(p.name))}</td>
          ${cells}
          <td class="n">${dmgCell(p.avoidableTotal, scale.total)}</td>
          <td class="n">${dmgCell(p.reflected, scale.reflected)}</td>
          <td class="n">${dmgCell(p.hostile, scale.hostile)}</td>
          <td class="n">${deathBadge(p.deaths)}</td>
        </tr>`;
    }).join("");
    return `<div class="tbox scrollx"><table class="idx rpb fixed">
      <tr><th class="pcol">Spieler</th>${head}<th class="n" data-tip="Summe" data-tip-sub="${esc(`Vermeidbarer Schaden über alle Fähigkeiten. ${DMG_SCALE_HOW}`)}">Summe</th><th class="n" data-tip="Reflektiert" data-tip-sub="Auf den Raider zurückgeworfener Schaden.">Reflektiert</th><th class="n" data-tip="Auf Spieler" data-tip-sub="Schaden, den der Raider unter Gedankenkontrolle o. Ä. an Mitspielern verursacht hat.">Auf Spieler</th><th class="n">Tode</th></tr>
      ${body}
    </table></div>`;
}

/** Abilities as rows, one column per raider — the transposed view; every cell of a raider's column carries their role for the filter. */
function damageByAbility(abilities, list, linkFor, scale, roles) {
    const head = list.map((p) => {
        const href = linkFor(p.name);
        const inner = `<span class="rcol-in"><img src="${esc(classIconUrl(p.type))}" alt=""><span>${esc(p.name)}</span></span>`;
        return `<th class="rcol"${roleAttrs(roles, p.name)} data-tip="${esc(p.name)}" data-tip-sub="${esc(p.type)}">${href ? `<a href="${esc(href)}" style="text-decoration:none">${inner}</a>` : inner}</th>`;
    }).join("");
    const cell = (p, html) => `<td class="n"${roleAttrs(roles, p.name)}>${html}</td>`;

    const abilityRows = abilities.map((a, i) => {
        const cells = list.map((p) => cell(p, dmgCell(p.perAbility[i], scale.perAbility[i]))).join("");
        const sub = a.sources && a.sources.length ? ` data-tip-sub="${esc(a.sources.join(", "))}"` : "";
        return `<tr><td class="pcol" data-tip="${esc(a.label)}"${sub}>${abilityIcon(a)}${esc(a.label)}</td>${cells}</tr>`;
    }).join("");

    const sumRow = (label, pick, max) => `<tr><td class="pcol"><strong>${esc(label)}</strong></td>${list.map((p) => cell(p, dmgCell(pick(p), max))).join("")}</tr>`;
    const deathRow = `<tr><td class="pcol"><strong>Tode</strong></td>${list.map((p) => cell(p, deathBadge(p.deaths))).join("")}</tr>`;

    return `<div class="tbox scrollx"><table class="idx rpb fixed">
      <tr><th class="pcol">Fähigkeit</th>${head}</tr>
      ${abilityRows}
      ${sumRow("Summe", (p) => p.avoidableTotal, scale.total)}
      ${sumRow("Reflektiert", (p) => p.reflected, scale.reflected)}
      ${sumRow("Auf Spieler", (p) => p.hostile, scale.hostile)}
      ${deathRow}
    </table></div>`;
}

function renderRpbDamagePanel(damage, roles, linkFor) {
    if (!damage || !damage.players || damage.players.length === 0) {
        return "<div class=\"empty\">Keine Schadensdaten gefunden.</div>";
    }
    const abilities = damage.abilities || [];
    const scale = damageScale(damage);
    const list = sortByRole(damage.players, roles);
    return `<div class="dscope">${rpbTools(list, roles, true)}
      <div class="tview tview-p">${damageByPlayer(abilities, list, linkFor, scale, roles)}</div>
      <div class="tview tview-a">${damageByAbility(abilities, list, linkFor, scale, roles)}</div>
    </div>`;
}

module.exports = {
    DMG_SCALE_HOW, abilityIcon, renderRpbDamagePanel,
};
