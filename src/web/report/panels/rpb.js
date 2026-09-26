// RPB: activity, spells, interrupts, log validation and cooldown usage.
const { esc } = require("../layout");
const { classCell, badge, barCell, iconTile, iconRow } = require("../widgets");
const { uptimeCell } = require("./debuffs");
const { sortByRole, roleAttrs, rpbTools } = require("./rpbRoles");

const RPB_ACTIVITY_HOW = "Rekonstruierte Aktivität: getrackte Zauber × Zauberzeit, abzüglich Tempo-Effekten, geteilt durch die Kampfzeit des Raids. Für Nahkämpfer ungenau, weil der Combat Log keine Autoattacks erfasst.";

function renderRpbActivityPanel(activity, roles, linkFor) {
    if (!activity || !activity.players || activity.players.length === 0) {
        return "<div class=\"empty\">Keine Aktivitätsdaten gefunden.</div>";
    }
    const list = sortByRole(activity.players, roles);
    const body = list.map((p) => {
        const haste = p.gearSpellHaste
            ? ` data-tip="${esc(p.name)}" data-tip-sub="Zaubertempo aus Ausrüstung: ${esc(p.gearSpellHaste)}"`
            : "";
        return `<tr${roleAttrs(roles, p.name)}>
          <td class="pcol"${haste}>${classCell(p, linkFor(p.name))}</td>
          <td class="n"><strong>${esc(p.secondsActive)}s</strong></td>
          <td class="n">${uptimeCell(p.relativeTotal)}</td>
          <td class="n">${esc(p.secondsActiveST)}s</td>
          <td class="n">${esc(p.secondsActiveAoe)}s</td>
          <td class="n">${esc(p.hasteSecondsSubtracted)}s</td>
        </tr>`;
    }).join("");
    return `<div class="dscope">${rpbTools(list, roles, false)}<div class="tbox scrollx"><table class="idx rpb fixed">
      <tr><th class="pcol">Spieler</th><th class="n" data-tip="Aktiv gesamt" data-tip-sub="${esc(RPB_ACTIVITY_HOW)}">Aktiv gesamt</th><th class="n" data-tip="Anteil Raidzeit" data-tip-sub="${esc(`Aktive Zeit geteilt durch die Kampfzeit des Raids (${activity.raidSeconds}s). Ab 95 % grün, ab 70 % gelb.`)}">Anteil Raidzeit</th><th class="n">Einzelziel</th><th class="n">Fläche</th><th class="n" data-tip="Tempo-Abzug" data-tip-sub="Abzug für Tempo-Effekte">Tempo-Abzug</th></tr>
      ${body}
    </table></div></div>`;
}

/**
 * Which spells each raider actually cast, as icons with their cast count.
 *
 * The data for this already fell out of the activity analysis (it has to count
 * every tracked cast to reconstruct active time) — it was simply never shown.
 * The interesting part is the rank: the config sheet knows every rank of every
 * tracked spell, so a cast on anything but the highest rank can be flagged.
 */
function spellTiles(rows) {
    return rows.filter((r) => r.amount > 0).map((r) => {
        const notes = [];
        if (r.uptimePercent !== undefined) notes.push(`Uptime ${r.uptimePercent}%`);
        if (r.lowerRankPercent) notes.push(`${r.lowerRankPercent}% niedriger Rang (${r.lowerRankCasts}×)`);
        return iconTile({
            icon: r.icon,
            name: r.name,
            spellId: r.spellId,
            label: r.label || r.name,
            count: r.amount,
            note: notes.join(" · "),
            tone: r.mostlyLowerRank ? "warn" : "",
        });
    });
}

const SPELLS_HOW = "Jedes Icon ist ein getrackter Zauber, die Zahl daran die Anzahl der Casts; ein Klick öffnet Wowhead. Rot umrandet: überwiegend in einem niedrigeren Rang gecastet.";

function renderRpbSpellsPanel(activity, roles, linkFor) {
    const players = (activity && activity.players) || [];
    const withSpells = players.filter((p) => (p.singleTargetCasts || []).length || (p.aoeCasts || []).length);
    if (withSpells.length === 0) return "<div class=\"empty\">Keine getrackten Zauber gefunden.</div>";
    const list = sortByRole(withSpells, roles);
    const body = list.map((p) => {
        const st = p.singleTargetCasts || [];
        const aoe = p.aoeCasts || [];
        const downranked = [...st, ...aoe].filter((r) => r.mostlyLowerRank);
        const rankCell = downranked.length
            ? `<span class="badge bad count" data-tip="Nicht im höchsten Rang" data-tip-sub="${esc(downranked.map((r) => r.label || r.name).join(", "))}">${downranked.length}</span>`
            : badge("0", "ok", "", true);
        return `<tr${roleAttrs(roles, p.name)}>
          <td class="pcol">${classCell(p, linkFor(p.name))}</td>
          <td>${iconRow(spellTiles(st))}</td>
          <td>${iconRow(spellTiles(aoe))}</td>
          <td class="n">${rankCell}</td>
        </tr>`;
    }).join("");
    return `<div class="dscope">${rpbTools(list, roles, false)}<div class="tbox scrollx"><table class="idx rpb">
      <tr><th class="pcol">Spieler</th><th data-tip="Einzelziel" data-tip-sub="${esc(SPELLS_HOW)}">Einzelziel</th><th data-tip="Fläche" data-tip-sub="${esc(SPELLS_HOW)}">Fläche</th><th class="n" data-tip="Rang-Warnungen" data-tip-sub="Anzahl der Zauber, die ein Raider überwiegend in einem niedrigeren Rang gecastet hat.">Rang-Warnungen</th></tr>
      ${body}
    </table></div></div>`;
}

function renderRpbInterruptsPanel(interrupts, linkFor) {
    if (!interrupts || !interrupts.players || interrupts.players.length === 0) {
        return "<div class=\"empty\">Keine Unterbrechungen gefunden.</div>";
    }
    const max = Math.max(1, ...interrupts.players.map((p) => Number(p.count) || 0));
    const body = interrupts.players.map((p) => {
        const spells = (p.spells || []).map((s) => iconTile({
            icon: s.icon, spellId: s.spellId, label: s.name, count: s.count,
        }));
        const kicks = (p.kicks || []).map((k) => `${esc(k.name)} ×${k.count}`).join(", ");
        return `<tr>
          <td class="pcol">${classCell(p, linkFor(p.name))}</td>
          <td>${barCell(String(p.count), ((Number(p.count) || 0) / max) * 100, "")}</td>
          <td>${iconRow(spells)}</td>
          <td class="sritems">${kicks || "–"}</td>
        </tr>`;
    }).join("");
    return `<div class="tbox scrollx"><table class="idx rpb">
      <tr><th class="pcol">Spieler</th><th data-tip="Unterbrechungen" data-tip-sub="Welche gegnerischen Zauber wer unterbrochen hat. Der Balken ist der Anteil am höchsten Wert im Raid.">Unterbrechungen</th><th>Unterbrochene Zauber</th><th>Eingesetzt mit</th></tr>
      ${body}
    </table></div>`;
}

function renderRpbValidationPanel(v) {
    if (!v) return "<div class=\"empty\">Keine Validierungsdaten.</div>";
    const zones = (v.zones || []).join(", ") || "unbekannt";
    const unmet = (v.requirements || []).filter((r) => !r.ok).length;
    const verdict = !v.requirements || !v.requirements.length
        ? ""
        : v.valid ? badge("Trash-Anforderungen erfüllt", "ok") : badge(`${unmet} Anforderung${unmet === 1 ? "" : "en"} nicht erfüllt`, "bad");
    const header = `<div class="badges">${badge(`Zone: ${zones}`, "")}${badge(`${v.bossesKilled} / ${v.bossesTotal} Bosse gelegt`, v.bossesKilled >= v.bossesTotal ? "ok" : "mid", "achievement_boss_illidan")}${verdict}</div>`;

    if (!v.requirements || v.requirements.length === 0) {
        return `${header}<div class="empty">${esc(v.note || "Keine Trash-Anforderungen hinterlegt.")}</div>`;
    }
    const body = v.requirements.map((r) => `<tr>
      <td class="pcol">${esc(r.label)}</td>
      <td>${esc(r.zone)}</td>
      <td class="n"><strong>${esc(r.killed)}</strong></td>
      <td class="n">${esc(r.minimum)}</td>
      <td class="n">${badge(r.ok ? "ok" : "zu wenig", r.ok ? "ok" : "bad")}</td>
    </tr>`).join("");

    return `${header}
    <div class="tbox scrollx"><table class="idx rpb">
      <tr><th class="pcol">Trash</th><th>Zone</th><th class="n">Gelegt</th><th class="n">Nötig</th><th class="n"></th></tr>
      ${body}
    </table></div>`;
}

const USAGE_HOW = "Die Zahl am Icon ist die Anzahl der Einsätze. Bei Cooldowns steht im Tooltip, wie viele in der Bosskampfzeit theoretisch möglich gewesen wären (Kampfzeit ÷ Abklingzeit, eine grobe Obergrenze). Rot: weniger als die Hälfte davon.";

function renderRpbUsagePanel(usage, roles, linkFor) {
    if (!usage || usage.length === 0) return "<div class=\"empty\">Keine Nutzungsdaten gefunden.</div>";
    const withData = usage.filter((u) => (u.classCooldowns || []).length || (u.trinketsAndRacials || []).length
        || (u.engineering || []).length || (u.absorbs || []).length);
    if (withData.length === 0) return "<div class=\"empty\">Keine Cooldowns oder Schmuckstücke erfasst.</div>";
    const list = sortByRole(withData, roles);
    const body = list.map((p) => {
        const cds = (p.classCooldowns || []).map((c) => {
            // fewer than half the theoretically possible uses reads as "sat on it"
            const under = c.possibleUses && c.total < c.possibleUses / 2;
            return iconTile({
                icon: c.icon,
                name: c.name,
                spellId: c.spellId,
                label: c.label,
                count: c.total,
                note: c.possibleUses ? `${c.total} von ~${c.possibleUses} möglichen` : "",
                tone: under ? "warn" : "good",
            });
        });
        const trinkets = (p.trinketsAndRacials || []).map((t) => iconTile({
            icon: t.icon, name: t.name, spellId: t.spellId, label: t.label, count: t.total,
        }));
        const consumables = [...(p.engineering || []), ...(p.absorbs || [])].map((t) => iconTile({
            icon: t.icon, name: t.name, spellId: t.spellId, label: t.label, count: t.total,
        }));
        return `<tr${roleAttrs(roles, p.name)}>
          <td class="pcol">${classCell(p, linkFor(p.name))}</td>
          <td>${iconRow(cds)}</td>
          <td>${iconRow(trinkets)}</td>
          <td>${iconRow(consumables)}</td>
        </tr>`;
    }).join("");
    return `<div class="dscope">${rpbTools(list, roles, false)}<div class="tbox scrollx"><table class="idx rpb">
      <tr><th class="pcol">Spieler</th><th data-tip="Klassen-Cooldowns" data-tip-sub="${esc(USAGE_HOW)}">Klassen-Cooldowns</th><th>Schmuckstücke &amp; Rassenfertigkeiten</th><th>Ingenieurskunst &amp; Schilde</th></tr>
      ${body}
    </table></div></div>`;
}

module.exports = {
    RPB_ACTIVITY_HOW, renderRpbActivityPanel, spellTiles, SPELLS_HOW, renderRpbSpellsPanel, renderRpbInterruptsPanel, renderRpbValidationPanel, renderRpbUsagePanel,
};
