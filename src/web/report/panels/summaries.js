// The raid-wide CLA summaries in the Raid view's dialogs (cooldowns, activity,
// totems, mechanics) and the explanation of every area card (AREA_HOW).
const { fmtTime } = require("../charts");
const { plural } = require("../../../utils/text");
const { esc } = require("../layout");
const { classCell, badge, barCell, barPct, hicon, fmtK, naCell } = require("../widgets");
const { CONS_HOW } = require("./consumables");
const { POTIONS_HOW } = require("./potions");
const { SUNDER_HOW, DEBUFFS_HOW } = require("./debuffs");
const { DMG_SCALE_HOW } = require("./damage");
const { SPELLS_HOW } = require("./rpb");

const AREA_HOW = {
    raidbuffs: "Anteil der erwarteten Buff-Zellen (Spieler × Bosskampf), in denen der Buff die ganze Zeit lag. Erwartet wird, was die Aufstellung hergibt. Klick öffnet die Matrix je Raider.",
    raiddebuffs: `${DEBUFFS_HOW} Klick öffnet die Tabelle und die Matrix je Boss.`,
    consumables: `${CONS_HOW} Ab 90 % grün, unter 50 % rot. Klick öffnet die Tabelle je Raider.`,
    potions: `${POTIONS_HOW} Klick öffnet die Tabelle je Raider.`,
    drums: "Drums-Einsätze über alle Boss-Kämpfe. Klick öffnet die Aufschlüsselung je Raider.",
    shadowresi: "Schattenwiderstand aus der Ausrüstung beim Mother-Shahraz-Kampf, im Mittel über den Raid. Klick öffnet die Quellen je Raider.",
    gear: "Fehlende oder schwache Verzauberungen, leere Sockel und inaktive Meta-Gems, aus der Ausrüstung, die Warcraft Logs beim Pull gesehen hat.",
    activity: "Anteil der Kampfzeit mit laufenden Zaubern oder Angriffen, im Mittel über alle Boss-Kämpfe bis zum eigenen Tod. Lücken über der GCD-Toleranz zählen, „durch Mechanik“ ist der Teil in Bewegungsphasen. Ab 95 % grün, unter 85 % gelb. Klick öffnet die Tabelle je Raider.",
    cooldowns: "Klassen-Cooldowns und Schmuckstücke über alle Boss-Kämpfe: Einsätze gegen die in der Kampfzeit möglichen, wann der erste Einsatz im Mittel kam und wie viele in ein Bloodlust-Fenster fielen.",
    healers: "Heilung und Overheal über alle Boss-Kämpfe, der Mana-Tiefstand je Kampf, Manatränke, Dispels und die Schilde auf dem aktiven Tank.",
    totems: "Je Schamane: wie lange Windfury auf der Gruppe lag, in wie vielen Kämpfen getwistet wurde und wie viel Zeit ein Totemplatz leer blieb.",
    rpbspells: SPELLS_HOW,
    rpbinterrupts: "Welche gegnerischen Zauber wer unterbrochen hat, und womit.",
    sunder: SUNDER_HOW,
    bosses: "Debuff-Uptime pro Boss-Kampf in % der Kampfdauer, im Mittel über alle Werte eines Bosses.",
    mechanics: "Vermeidbare Treffer über alle Boss-Kämpfe und wie die Tode zu werten sind: vermeidbar (Todesstoß von einer Mechanik, der man ausweichen kann), früh, nach Kampfrez, kurz vor dem Kill.",
    rpbdamage: `Vermeidbarer erhaltener Schaden je Fähigkeit. ${DMG_SCALE_HOW}`,
    rpbvalidate: "Ob der Log die hinterlegten Trash-Anforderungen erfüllt und wie viele Bosse gelegt wurden.",
};

/** Raid-wide cooldown summary (report.cooldowns.players): uses against the possible, how fast the first press came, stacked with Bloodlust. */
function renderCooldownSummary(cooldowns, linkFor) {
    const rows = (cooldowns.players || []).slice().sort((a, b) => (a.usedPct === null ? 101 : a.usedPct) - (b.usedPct === null ? 101 : b.usedPct));
    const body = rows.map((p) => `<tr><td>${classCell(p, linkFor(p.name))}</td><td class="mono">${esc(p.fights)}</td><td class="mono">${esc(p.uses)} / ${esc(p.possible)}</td><td>${p.usedPct === null ? naCell("", "–") : barPct(p.usedPct, "Genutzte Cooldowns gegen die in der Kampfzeit möglichen", "Ab 95 % grün, ab 70 % gelb, darunter rot.")}</td><td class="mono">${p.avgFirstAtMs === null || p.avgFirstAtMs === undefined ? "–" : fmtTime(p.avgFirstAtMs)}</td><td class="mono">${esc(p.stacked)} / ${esc(p.stacked + p.unstacked)}</td></tr>`).join("");
    return `<div class="tbox"><table class="idx"><tr><th>Spieler</th><th>Kämpfe</th><th>Einsätze / möglich</th><th data-tip="Genutzt" data-tip-sub="Einsätze gegen die in der Kampfzeit möglichen. Die Zeitpunkte je Kampf stehen in der Sicht Bosse unter „Cooldowns“.">Genutzt</th><th data-tip="Ø erster Einsatz" data-tip-sub="Wann der erste Einsatz im Mittel über die Kämpfe kam.">Ø erster Einsatz</th><th data-tip="Mit Bloodlust" data-tip-sub="Einsätze, die in ein Bloodlust-Fenster fielen, gegen alle Einsätze.">Mit Bloodlust</th></tr>${body}</table></div>`;
}

/** Raid-wide activity summary (report.activity.players): mean active share, holes and what explains them. */
function renderActivitySummary(activity, linkFor) {
    const rows = (activity.players || []).slice().sort((a, b) => a.activeAvg - b.activeAvg);
    const body = rows.map((p) => `<tr><td>${classCell(p, linkFor(p.name))}</td><td class="mono">${esc(p.fights)}</td><td>${barPct(p.activeAvg, "Anteil der Kampfzeit mit laufenden Zaubern oder Angriffen", "Im Mittel über die Kämpfe, bis zum eigenen Tod. Ab 95 % grün, ab 70 % gelb.")}</td><td class="mono">${esc(p.gaps)}</td><td class="mono">${fmtTime(p.longestGap)}</td><td class="mono">${fmtTime(p.unexplainedMs)}</td><td class="mono">${fmtTime(p.mechanicMs)}</td></tr>`).join("");
    return `<div class="tbox"><table class="idx"><tr><th>Spieler</th><th>Kämpfe</th><th data-tip="Ø aktiv" data-tip-sub="${esc(AREA_HOW.activity)}">Ø aktiv</th><th data-tip="Lücken" data-tip-sub="Lücken über der GCD-Toleranz. Die Bänder je Kampf stehen in der Sicht Bosse unter „Aktivität“.">Lücken</th><th>Längste Lücke</th><th data-tip="Unerklärt" data-tip-sub="Lückenzeit, die auf keine Bewegungsphase fällt.">Unerklärt</th><th data-tip="Durch Mechanik" data-tip-sub="Lückenzeit in einer Bewegungsphase des Bosses.">Durch Mechanik</th></tr>${body}</table></div>`;
}

const WF_DERIVED_HOW = "Der Log enthält keinen Windfury-Buff. Die Uptime ist aus den Totem-Drops gerechnet: Puls alle 5 s, jeder Buff hält 10 s, ein anderes Lufttotem beendet die Pulse.";

/** Raid-wide totem summary (report.totems.players): Windfury uptime, twisting, downtime per slot. */
function renderTotemSummary(totems, linkFor) {
    const body = (totems.players || []).map((p) => {
        const slots = Object.entries(p.slotDowntimeMs || {}).filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${fmtTime(v)}`).join(", ");
        return `<tr><td>${classCell(p, linkFor(p.name))}<div class="sritems">${esc(p.role || "")}</div></td><td class="mono">${esc(p.fights)}</td><td>${p.wfUptimeAvg === null || p.wfUptimeAvg === undefined ? naCell("", "–") : p.wfDerived ? barPct(p.wfUptimeAvg, "Aus den Drops abgeleitet", WF_DERIVED_HOW) : barPct(p.wfUptimeAvg)}</td><td class="mono">${esc(p.twistingFights)} / ${esc(p.wfFights)}</td><td class="mono">${esc(p.gapCount)}</td><td class="mono">${fmtTime(p.downtimeMs)}</td><td class="sritems">${esc(slots) || "–"}</td></tr>`;
    }).join("");
    return `<div class="tbox"><table class="idx"><tr><th>Schamane</th><th>Kämpfe</th><th data-tip="Windfury Ø" data-tip-sub="${esc(AREA_HOW.totems)}">Windfury Ø</th><th data-tip="Twisting" data-tip-sub="Kämpfe mit Windfury-Twisting gegen Kämpfe mit Windfury.">Twisting</th><th>Lücken</th><th>Downtime</th><th data-tip="Leere Plätze" data-tip-sub="Wie lange ein Totemplatz leer blieb. Die Drops je Kampf stehen in der Sicht Bosse unter „Totems“.">Leere Plätze</th></tr>${body}</table></div>`;
}

/** Raid-wide mechanics summary (report.mechanics): the mechanics that hit most, the raiders they hit, the judged deaths. */
function renderMechanicsSummary(mech, linkFor) {
    const d = mech.deaths || {};
    const deaths = `<div class="badges">${badge(plural(d.total || 0, "Tod", "Tode"), "", "ability_creature_cursed_05")}${badge(`${d.avoidable || 0} vermeidbar`, d.avoidable ? "bad" : "ok")}${badge(`${d.early || 0} früh`, d.early ? "mid" : "ok")}${badge(`${d.repeat || 0} nach Kampfrez`, "")}${badge(`${d.nearEnd || 0} kurz vor dem Kill`, "")}</div>`;
    const maxHits = Math.max(1, ...(mech.mechanics || []).map((m) => Number(m.hits) || 0));
    const mechs = (mech.mechanics || []).map((m) => `<tr><td>${hicon(m.icon, "")}${esc(m.label)}<div class="sritems">${m.kind === "debuff" ? "Debuff" : "Schaden"}</div></td><td>${barCell(String(m.hits), ((Number(m.hits) || 0) / maxHits) * 100, "")}</td><td class="mono">${m.amount ? fmtK(m.amount) : "–"}</td><td class="mono">${esc(m.fights)}</td></tr>`).join("");
    const players = (mech.players || []).map((p) => `<tr><td>${classCell(p, linkFor(p.name))}</td><td class="mono">${esc(p.hits)}</td><td class="mono">${p.amount ? fmtK(p.amount) : "–"}</td><td class="mono">${esc(p.deaths || 0)}${p.avoidableDeaths ? ` ${badge(`${p.avoidableDeaths} vermeidbar`, "bad")}` : ""}${p.earlyDeaths ? ` ${badge(`${p.earlyDeaths} früh`, "mid")}` : ""}</td><td class="sritems">${p.topMechanic ? `${hicon(p.topMechanic.icon, "")}${esc(p.topMechanic.label)} (${esc(p.topMechanic.hits)}×)` : "–"}</td></tr>`).join("");
    return `${deaths}
    ${mechs ? `<div class="tbox"><table class="idx"><tr><th>Mechanik</th><th data-tip="Treffer" data-tip-sub="Vermeidbare Treffer über alle Boss-Kämpfe. Die Treffer je Kampf stehen in der Sicht Bosse unter „Mechaniken“.">Treffer</th><th>Schaden</th><th>Kämpfe</th></tr>${mechs}</table></div>` : ""}
    ${players ? `<div class="dsub">Pro Raider</div><div class="tbox"><table class="idx"><tr><th>Spieler</th><th>Treffer</th><th>Schaden</th><th>Tode</th><th>Am häufigsten</th></tr>${players}</table></div>` : ""}`;
}

module.exports = {
    AREA_HOW, renderCooldownSummary, renderActivitySummary, renderTotemSummary, renderMechanicsSummary,
};
