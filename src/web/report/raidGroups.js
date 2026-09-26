// Sicht Raid: the findings for the raid and the three area groups (Vorbereitung,
// Leistung, Fehler), one metric card and one detail dialog per area.
const { plural } = require("../../utils/text");
const { esc } = require("./layout");
const { badge, groupHead, detailDialog, whoList, whatList, metricCard, barCell, hicon, fmtK, sumOf, avgOf } = require("./widgets");
const { renderGearPanel, renderConsumablesPanel, renderShadowResiPanel, renderDrumsPanel } = require("./panels/consumables");
const { renderPotionsPanel } = require("./panels/potions");
const { renderSunderPanel, renderBossUptimesPanel, renderRaidDebuffsPanel } = require("./panels/debuffs");
const { groupByBoss } = require("./fightTopics");
const { renderHealersPanel } = require("./panels/healers");
const { renderRaidBuffsPanel } = require("./panels/buffs");
const { renderRaidRecommendations, renderSendBox } = require("./recommendations");
const { renderRpbDamagePanel } = require("./panels/damage");
const { renderRpbActivityPanel, renderRpbSpellsPanel, renderRpbInterruptsPanel, renderRpbValidationPanel, renderRpbUsagePanel } = require("./panels/rpb");
const { AREA_HOW, renderCooldownSummary, renderActivitySummary, renderTotemSummary, renderMechanicsSummary } = require("./panels/summaries");

// ---- Sicht Raid: four groups (Empfehlungen · Vorbereitung · Leistung · Fehler) ----
//
// Every raid-wide part is a metric card: one value, one or two badges and the
// raiders who stand out; the explanation sits in the tooltip of its title and
// the full table opens as a detail dialog. The render*Summary / render*Panel
// functions are those dialogs' bodies.

/** An RPB table under its CLA counterpart in the same dialog. */
function rpbPart(title, html) {
    return `<div class="dsub">${badge("RPB", "accent")}${esc(title)}</div>${html}`;
}

/** One area: a metric card and its detail dialog. `flag` marks it as auffällig for the group head. */
function area(o) {
    return {
        id: o.id, flag: !!o.flag,
        card: metricCard({ ...o, tip: o.tip || AREA_HOW[o.id] }),
        dialog: detailDialog(`rs-${o.id}`, o.icon, o.dialogTone || (o.flag ? "mid" : ""), esc(o.label), o.crumb, o.body, o.footNote),
    };
}

/** Whether `o[key]` is a non-empty list. */
const has = (o, key) => !!(o && Array.isArray(o[key]) && o[key].length);

/** The RPB part of the report and its roles, or nulls. */
function rpbOf(report) {
    const rpb = report.rpb || null;
    return { rpb, roles: rpb && rpb.roles };
}

// --- Empfehlungen an den Raid ---

/** The findings for the raid as a group of their own; a reader sees only the approved ones, and no group when there are none. */
function recsGroup(ctx) {
    const { report, reviewer, rec } = ctx;
    if (!rec) return null;
    const raid = rec.raid || [];
    const shown = reviewer ? raid : raid.filter((i) => i.approved === true);
    if (!shown.length && !reviewer) return null;
    const open = raid.filter((i) => i.approved === null).length;
    const approved = raid.filter((i) => i.approved === true).length;
    const crumb = reviewer ? `Raid › Empfehlungen · ${open} offen · ${approved} freigegeben` : `Raid › Empfehlungen · ${plural(shown.length, "Punkt", "Punkte")} von der Raidleitung`;
    const players = (rec.players || []).filter((p) => p.items.some((i) => i.approved === true)).length;
    const action = reviewer
        ? `<button type="button" class="btn btn-sm" data-dialog="dlg-rs-send">${hicon("inv_letter_15", "")}Alle senden …</button>`
        : badge(String(shown.length), "", "", true);
    return {
        id: "recs", flagged: reviewer ? open : 0,
        html: `<section class="gcard" id="rs-rec-raid">${groupHead("inv_misc_note_01", open && reviewer ? "mid" : "", "Empfehlungen an den Raid", crumb, action)}${renderRaidRecommendations(rec, reviewer)}${reviewer ? detailDialog("rs-send", "inv_letter_15", "", "Alle senden", `Raid › Empfehlungen › Versand · ${plural(players, "Raider", "Raider")} mit freigegebenen Punkten`, renderSendBox(report), "Ein unveränderter Satz wird nie zweimal geschickt.") : ""}</section>`,
    };
}

// --- Vorbereitung: one function per area, each null when its source is missing ---

function raidBuffsArea({ report, linkFor }) {
    if (!has(report.raidBuffs, "players")) return null;
    const rows = (report.raidBuffs.rows || []).filter((r) => r.expected);
    const short = rows.filter((r) => r.none > 0 || r.partial > 0 || (r.late || 0) > 0).length;
    const cov = rows.length ? avgOf(rows, (r) => r.coveragePct) : null;
    const lacking = report.raidBuffs.players.filter((p) => (p.missing || 0) > 0).sort((a, b) => b.missing - a.missing);
    return area({ id: "raidbuffs", icon: "spell_magic_greaterblessingofkings", label: "Raid-Buffs", crumb: "Raid › Vorbereitung › Raid-Buffs · Spieler × Buff",
        value: cov === null ? "–" : `${cov} %`, unit: "durchgehend", tone: cov === null ? "" : cov >= 95 ? "ok" : cov >= 80 ? "" : "mid",
        badges: [short ? badge(`${short} ${short === 1 ? "Buff" : "Buffs"} lückenhaft`, "mid") : badge("alle da", "ok")],
        who: whoList("Fehlte", lacking), flag: short > 0, body: renderRaidBuffsPanel(report.raidBuffs, linkFor) });
}

function raidDebuffsArea({ report, fights }) {
    if (!has(report.raidDebuffs, "rows")) return null;
    const rows = report.raidDebuffs.rows.filter((r) => r.expected);
    const missing = rows.filter((r) => r.missing > 0);
    const avg = rows.length ? avgOf(rows, (r) => r.avgUptime) : 0;
    const bosses = [];
    for (const b of groupByBoss(fights)) {
        if (b.fights.some((f) => (f.debuffs || []).some((d) => d.expected && (d.missing || d.uptimePct === 0)))) bosses.push(b.name);
    }
    return area({ id: "raiddebuffs", icon: "spell_shadow_chilltouch", label: "Raid-Debuffs", crumb: "Raid › Vorbereitung › Raid-Debuffs · Boss-Kämpfe",
        value: missing.length ? String(missing.length) : String(rows.length), unit: missing.length ? `von ${rows.length} fehlten` : "erwartet, alle da", tone: missing.length ? "bad" : "ok",
        badges: [badge(`Ø ${avg} % Uptime`, avg >= 95 ? "ok" : avg >= 70 ? "mid" : "bad")],
        who: whatList("Boss", bosses), flag: missing.length > 0 || avg < 95, body: renderRaidDebuffsPanel(report.raidDebuffs, report.timeline) });
}

function consumablesArea({ report, linkFor }) {
    if (!has(report.consumables, "players")) return null;
    const list = report.consumables.players;
    const buffed = avgOf(list, (p) => p.buffed);
    const food = avgOf(list, (p) => p.food);
    return area({ id: "consumables", icon: "inv_alchemy_endlessflask_05", label: "Consumables", crumb: "Raid › Vorbereitung › Consumables · Abdeckung je Raider",
        value: `${buffed} %`, unit: "Flask / Elixiere", tone: buffed >= 90 ? "ok" : buffed < 50 ? "bad" : "mid",
        badges: [badge(`Ø Food ${food} %`, food >= 90 ? "ok" : food < 50 ? "bad" : "mid")],
        who: whoList("Unter 50 %", list.filter((p) => p.buffed < 50).sort((a, b) => a.buffed - b.buffed), (p) => `${p.buffed} %`), flag: buffed < 90, body: renderConsumablesPanel(report.consumables, linkFor) });
}

function potionsArea({ report, linkFor }) {
    if (!has(report.potions, "players")) return null;
    const list = report.potions.players;
    const total = sumOf(list, (p) => p.total);
    const drank = new Set(list.filter((p) => (p.total || 0) > 0).map((p) => p.name));
    const none = (report.roster || []).filter((p) => !drank.has(p.name));
    return area({ id: "potions", icon: "inv_potion_137", label: "Tränke", crumb: "Raid › Vorbereitung › Tränke · je Raider und Trank",
        value: String(total), unit: "im Raid", tone: "",
        badges: [(report.roster || []).length ? (none.length ? badge(`${plural(none.length, "Raider", "Raider")} ohne Trank`, "mid") : badge("jeder hat getrunken", "ok")) : badge(plural(list.length, "Raider", "Raider"), "")],
        who: none.length ? whoList("Keiner", none) : whoList("Meiste", list.slice().sort((a, b) => b.total - a.total), (p) => p.total), flag: none.length > 0, body: renderPotionsPanel(report.potions, linkFor) });
}

function drumsArea({ report, linkFor }) {
    if (!has(report.drums, "players")) return null;
    const list = report.drums.players.slice().sort((a, b) => b.total - a.total);
    return area({ id: "drums", icon: "inv_misc_drum_01", label: "Drums", crumb: "Raid › Vorbereitung › Drums",
        value: String(sumOf(list, (p) => p.total)), unit: "Einsätze", badges: [badge(plural(list.length, "Raider", "Raider"), "")],
        who: whoList("Meiste", list, (p) => p.total), body: renderDrumsPanel(report.drums, linkFor) });
}

function shadowResiArea({ report, linkFor }) {
    if (!has(report.shadowResi, "players")) return null;
    const list = report.shadowResi.players.slice().sort((a, b) => a.sr - b.sr);
    return area({ id: "shadowresi", icon: "spell_shadow_antishadow", label: "Shadow-Resi", crumb: "Raid › Vorbereitung › Shadow-Resi · Mother Shahraz",
        value: String(avgOf(list, (p) => p.sr)), unit: "Ø aus Gear", badges: [badge(plural(list.length, "Raider", "Raider"), "")],
        who: whoList("Niedrigste", list, (p) => p.sr), body: renderShadowResiPanel(report.shadowResi, linkFor) });
}

function gearArea({ report, linkFor }) {
    if (!report.players) return null;
    const withIssues = (report.players || []).filter((p) => (p.issues || []).length);
    const issues = withIssues.flatMap((p) => p.issues);
    const high = issues.filter((x) => x.severity === "high").length;
    return area({ id: "gear", icon: "inv_shield_06", label: "Gear-Probleme", crumb: "Raid › Vorbereitung › Gear-Probleme · je Raider",
        value: String(issues.length), unit: issues.length ? `bei ${plural(withIssues.length, "Raider", "Raidern")}` : "keine", tone: high ? "bad" : issues.length ? "mid" : "ok",
        badges: issues.length ? [high ? badge(`${high} schwer`, "bad") : "", issues.length - high ? badge(`${issues.length - high} leicht`, "mid") : ""].filter(Boolean) : [badge("alles verzaubert", "ok")],
        who: whoList("Meiste", withIssues.slice().sort((a, b) => b.issues.length - a.issues.length), (p) => p.issues.length), flag: issues.length > 0, body: renderGearPanel(report.players, linkFor) });
}

// --- Leistung ---

/** Activity: the CLA's mean active share, the RPB's reconstruction under it or in its place. */
function activityArea({ report, linkFor }) {
    const { rpb, roles } = rpbOf(report);
    if (!has(report.activity, "players") && !(rpb && has(rpb.activity, "players"))) return null;
    const cla = has(report.activity, "players") ? report.activity.players : null;
    const r = rpb && has(rpb.activity, "players") ? rpb.activity.players : null;
    const list = cla ? cla.slice().sort((a, b) => a.activeAvg - b.activeAvg) : r.slice().sort((a, b) => a.relativeTotal - b.relativeTotal);
    const val = (p) => (cla ? p.activeAvg : p.relativeTotal);
    const avg = avgOf(list, val);
    const low = list.filter((p) => val(p) < 85);
    const body = (cla ? renderActivitySummary(report.activity, linkFor) : "") + (r ? (cla ? rpbPart("Aktivität", renderRpbActivityPanel(rpb.activity, roles, linkFor)) : renderRpbActivityPanel(rpb.activity, roles, linkFor)) : "");
    return area({ id: "activity", icon: "inv_misc_pocketwatch_02", label: "Aktivität", crumb: `Raid › Leistung › Aktivität${cla ? "" : " · RPB"}`,
        value: `${avg} %`, unit: cla ? "Ø aktiv" : "Ø Anteil Raidzeit", tone: avg >= 95 ? "ok" : avg >= 85 ? "" : "mid",
        badges: [low.length ? badge(`${low.length} unter 85 %`, "mid") : badge("alle über 85 %", "ok"), r ? badge("RPB", "accent") : ""].filter(Boolean),
        who: whoList("Niedrigste", list, (p) => `${val(p)} %`), flag: low.length > 0, body });
}

/** The card's numbers from the CLA's cooldown summary: used share, presses in Bloodlust, the lowest raiders. */
function cooldownFigures(cla, usage) {
    const uses = sumOf(cla, (p) => p.uses);
    const possible = sumOf(cla, (p) => p.possible);
    const pct = possible ? Math.round((uses / possible) * 100) : null;
    const stacked = sumOf(cla, (p) => p.stacked);
    const all = stacked + sumOf(cla, (p) => p.unstacked);
    const ranked = cla.filter((p) => p.usedPct !== null && p.usedPct !== undefined).sort((a, b) => a.usedPct - b.usedPct);
    return {
        value: pct === null ? String(uses) : `${pct} %`,
        unit: pct === null ? "Einsätze" : "genutzt",
        tone: pct === null ? "" : pct >= 80 ? "" : "mid",
        badges: [badge(`${stacked} von ${all} im Lust`, ""), usage ? badge("RPB", "accent") : ""].filter(Boolean),
        who: whoList("Niedrigste", ranked, (p) => `${p.usedPct} %`),
        flag: pct !== null && pct < 80,
    };
}

/** The card's numbers from the RPB alone: class cooldowns pressed, raiders under half of what was possible. */
function rpbCooldownFigures(report, usage) {
    const rosterP = (name) => (report.roster || []).find((x) => x.name === name) || { name, type: "" };
    const under = usage.map((u) => ({ ...rosterP(u.name), ...u, under: (u.classCooldowns || []).filter((c) => c.possibleUses && c.total < c.possibleUses / 2).length })).filter((u) => u.under > 0).sort((a, b) => b.under - a.under);
    return {
        value: String(sumOf(usage, (u) => sumOf(u.classCooldowns, (c) => c.total))),
        unit: "Klassen-Cooldowns",
        tone: "",
        badges: [under.length ? badge(`${under.length} unter der Hälfte`, "mid") : badge("keiner unter der Hälfte", "ok"), badge("RPB", "accent")],
        who: whoList("Unter der Hälfte", under, (p) => p.under),
        flag: under.length > 0,
    };
}

function cooldownsArea({ report, linkFor }) {
    const { rpb, roles } = rpbOf(report);
    if (!has(report.cooldowns, "players") && !(rpb && has(rpb, "usage"))) return null;
    const cla = has(report.cooldowns, "players") ? report.cooldowns.players : null;
    const usage = rpb && has(rpb, "usage") ? rpb.usage : null;
    const figures = cla ? cooldownFigures(cla, usage) : rpbCooldownFigures(report, usage);
    const body = (cla ? renderCooldownSummary(report.cooldowns, linkFor) : "") + (usage ? (cla ? rpbPart("Cooldowns & Schmuckstücke", renderRpbUsagePanel(rpb.usage, roles, linkFor)) : renderRpbUsagePanel(rpb.usage, roles, linkFor)) : "");
    return area({ id: "cooldowns", icon: "ability_rogue_preparation", label: "Cooldowns", crumb: `Raid › Leistung › Cooldowns${cla ? "" : " · RPB"}`, ...figures, body });
}

function healersArea({ report, linkFor }) {
    if (!has(report.healers, "players")) return null;
    const list = report.healers.players.slice().sort((a, b) => (b.healingTotal || 0) - (a.healingTotal || 0));
    const heal = sumOf(list, (p) => p.healingTotal);
    const over = sumOf(list, (p) => p.overhealTotal);
    const overPct = heal + over > 0 && over ? Math.round((over / (heal + over)) * 100) : avgOf(list, (p) => p.overhealPct);
    const low = sumOf(list, (p) => p.manaLowFights);
    return area({ id: "healers", icon: "spell_holy_flashheal", label: "Heiler", crumb: "Raid › Leistung › Heiler · alle Boss-Kämpfe",
        value: String(list.length), unit: list.length === 1 ? "Heiler" : "Heiler",
        badges: [badge(`Ø Overheal ${overPct} %`, overPct >= 50 ? "bad" : overPct >= 35 ? "mid" : ""), low ? badge(`${low}× unter 10 % Mana`, "bad") : ""].filter(Boolean),
        who: whoList("Oben", list.slice(0, 2)), flag: low > 0 || overPct >= 35, body: renderHealersPanel(report.healers, linkFor) });
}

function totemsArea({ report, linkFor }) {
    if (!has(report.totems, "players")) return null;
    const list = report.totems.players;
    const wf = list.filter((p) => p.wfUptimeAvg !== null && p.wfUptimeAvg !== undefined);
    const avg = wf.length ? avgOf(wf, (p) => p.wfUptimeAvg) : null;
    return area({ id: "totems", icon: "spell_nature_windfury", label: "Totems", crumb: "Raid › Leistung › Totems · je Schamane",
        value: avg === null ? String(list.length) : `${avg} %`, unit: avg === null ? "Schamanen" : "Windfury Ø", tone: avg === null ? "" : avg >= 95 ? "ok" : avg >= 70 ? "" : "mid",
        badges: [badge(`Twisting ${sumOf(list, (p) => p.twistingFights)} / ${sumOf(list, (p) => p.wfFights)}`, "")],
        who: whoList("Schamanen", list), flag: avg !== null && avg < 90, body: renderTotemSummary(report.totems, linkFor) });
}

function rpbSpellsArea({ report, linkFor }) {
    const { rpb, roles } = rpbOf(report);
    if (!(rpb && has(rpb.activity, "players") && rpb.activity.players.some((p) => (p.singleTargetCasts || []).length || (p.aoeCasts || []).length))) return null;
    const down = rpb.activity.players.map((p) => ({ ...p, down: [...(p.singleTargetCasts || []), ...(p.aoeCasts || [])].filter((r) => r.mostlyLowerRank).length })).filter((p) => p.down > 0).sort((a, b) => b.down - a.down);
    const n = sumOf(down, (p) => p.down);
    return area({ id: "rpbspells", icon: "inv_misc_book_11", label: "Zauber", crumb: "Raid › Leistung › Zauber · RPB",
        value: String(n), unit: n === 1 ? "Rang-Warnung" : "Rang-Warnungen", tone: n ? "mid" : "ok", badges: [badge("RPB", "accent")],
        who: whoList("Betrifft", down, (p) => p.down), flag: n > 0, body: renderRpbSpellsPanel(rpb.activity, roles, linkFor) });
}

function rpbInterruptsArea({ report, linkFor }) {
    const { rpb } = rpbOf(report);
    if (!(rpb && has(rpb.interrupts, "players"))) return null;
    const list = rpb.interrupts.players.slice().sort((a, b) => b.count - a.count);
    return area({ id: "rpbinterrupts", icon: "spell_frost_iceshock", label: "Interrupts", crumb: "Raid › Leistung › Interrupts · RPB",
        value: String(sumOf(list, (p) => p.count)), unit: "Unterbrechungen", badges: [badge("RPB", "accent")],
        who: whoList("Meiste", list, (p) => p.count), body: renderRpbInterruptsPanel(rpb.interrupts, linkFor) });
}

function sunderArea({ report, linkFor }) {
    if (!has(report, "sunder")) return null;
    const list = report.sunder.slice().sort((a, b) => b.total - a.total);
    const below = sumOf(list, (p) => p.below5);
    return area({ id: "sunder", icon: "ability_warrior_sunder", label: "Sunder Armor", crumb: "Raid › Leistung › Sunder Armor",
        value: String(sumOf(list, (p) => p.total)), unit: "Sunder", badges: [badge(`${below} bei < 5 Stacks`, "")],
        who: whoList("Meiste", list, (p) => p.total), body: renderSunderPanel(report.sunder, linkFor) });
}

function bossUptimesArea({ report }) {
    if (!has(report.bossUptimes, "rows")) return null;
    const { rows, metrics } = report.bossUptimes;
    const meanOf = (r) => ((metrics || []).length ? avgOf(metrics, (m) => r[m.key] || 0) : 0);
    const avg = avgOf(rows, meanOf);
    const lowest = rows.slice().sort((a, b) => meanOf(a) - meanOf(b));
    return area({ id: "bosses", icon: "achievement_boss_illidan", label: "Boss-Uptimes", crumb: "Raid › Leistung › Boss-Uptimes · je Boss-Kampf",
        value: String(rows.length), unit: rows.length === 1 ? "Boss-Kampf" : "Boss-Kämpfe", badges: [badge(`Ø ${avg} % Uptime`, avg >= 95 ? "ok" : avg >= 70 ? "" : "mid")],
        who: whatList("Niedrigste", lowest.length ? [lowest[0].boss] : []), flag: avg < 70, body: renderBossUptimesPanel(report.bossUptimes) });
}

// --- Fehler ---

/** The top three mechanics as bars inside the wide Mechaniken card. */
function topMechanicsTable(m) {
    const top = (m.mechanics || []).slice().sort((a, b) => b.hits - a.hits).slice(0, 3);
    if (!top.length) return "";
    const max = Math.max(1, ...top.map((x) => Number(x.hits) || 0));
    const hitBy = (key) => (m.players || []).filter((p) => p.byMechanic && p.byMechanic[key]).length;
    return `<div class="mc-table"><table class="idx"><tr><th>Mechanik</th><th>Treffer</th><th>Getroffen</th></tr>${top.map((x) => { const share = (Number(x.hits) || 0) / max; return `<tr><td>${hicon(x.icon, "")}${esc(x.label)}</td><td>${barCell(String(x.hits), share * 100, share >= 0.75 ? "high" : share >= 0.5 ? "medium" : "")}</td><td class="mute">${esc(plural(hitBy(x.key), "Raider", "Raider"))}</td></tr>`; }).join("")}</table></div>`;
}

function mechanicsArea({ report, linkFor }) {
    if (!(report.mechanics && (has(report.mechanics, "mechanics") || has(report.mechanics, "players") || report.mechanics.deaths))) return null;
    const m = report.mechanics;
    const d = m.deaths || {};
    const avoidable = (m.players || []).filter((p) => p.avoidableDeaths > 0).sort((a, b) => b.avoidableDeaths - a.avoidableDeaths);
    return area({ id: "mechanics", icon: "ability_creature_cursed_05", label: "Mechaniken & Tode", crumb: "Raid › Fehler › Mechaniken & Tode · alle Boss-Kämpfe", wide: true,
        value: String(d.total || 0), unit: (d.total || 0) === 1 ? "Tod" : "Tode", tone: d.avoidable ? "bad" : "",
        badges: [badge(`${d.avoidable || 0} vermeidbar`, d.avoidable ? "bad" : "ok"), d.early ? badge(`${d.early} früh`, "mid") : "", d.nearEnd ? badge(`${d.nearEnd} kurz vor dem Kill`, "") : ""].filter(Boolean),
        extra: topMechanicsTable(m), who: whoList("Vermeidbar gestorben", avoidable, (p) => p.avoidableDeaths), flag: (d.avoidable || 0) > 0, dialogTone: d.avoidable ? "bad" : "", body: renderMechanicsSummary(m, linkFor) });
}

function rpbDamageArea({ report, linkFor }) {
    const { rpb, roles } = rpbOf(report);
    if (!(rpb && has(rpb.damage, "players"))) return null;
    const list = rpb.damage.players.slice().sort((a, b) => (b.avoidableTotal || 0) - (a.avoidableTotal || 0));
    const deaths = sumOf(list, (p) => p.deaths);
    return area({ id: "rpbdamage", icon: "spell_shadow_shadowwordpain", label: "Vermeidbarer Schaden", crumb: `Raid › Fehler › ${rpb.damage.heading || "Vermeidbarer Schaden"} · RPB · alle Boss-Kämpfe`,
        value: fmtK(sumOf(list, (p) => p.avoidableTotal)), unit: "im Raid", badges: [badge("RPB", "accent"), deaths ? badge(plural(deaths, "Tod", "Tode"), "bad") : ""].filter(Boolean),
        who: whoList("Meiste", list, (p) => fmtK(p.avoidableTotal)), flag: deaths > 0, dialogTone: "bad", body: renderRpbDamagePanel(rpb.damage, roles, linkFor), footNote: "Sortiert nach Rolle · Klick auf einen Raider öffnet seine Seite" });
}

function rpbValidationArea({ report }) {
    const { rpb } = rpbOf(report);
    if (!(rpb && rpb.validation)) return null;
    const v = rpb.validation;
    const unmet = (v.requirements || []).filter((r) => !r.ok);
    return area({ id: "rpbvalidate", icon: "inv_misc_note_02", label: "Log-Prüfung", crumb: "Raid › Fehler › Log-Prüfung · RPB",
        value: String(unmet.length), unit: unmet.length === 1 ? "Anforderung offen" : "Anforderungen offen", tone: unmet.length ? "mid" : "ok",
        badges: [badge(`${v.bossesKilled} / ${v.bossesTotal} Bosse gelegt`, "")],
        who: whatList("Zu wenig", unmet.map((r) => r.label)), flag: unmet.length > 0, body: renderRpbValidationPanel(v) });
}

// The three area groups in page order, each area in card order.
const AREA_GROUPS = [
    { id: "prep", icon: "trade_alchemy", tone: "mid", label: "Vorbereitung", crumb: "Raid › Buffs · Debuffs · Consumables · Gear",
        areas: [raidBuffsArea, raidDebuffsArea, consumablesArea, potionsArea, drumsArea, shadowResiArea, gearArea] },
    { id: "perf", icon: "spell_nature_bloodlust", tone: "mid", label: "Leistung", crumb: "Raid › Aktivität · Cooldowns · Heiler · Totems · Zauber",
        areas: [activityArea, cooldownsArea, healersArea, totemsArea, rpbSpellsArea, rpbInterruptsArea, sunderArea, bossUptimesArea] },
    { id: "err", icon: "spell_fire_selfdestruct", tone: "bad", label: "Fehler", crumb: "Raid › Mechaniken · Tode · vermeidbarer Schaden",
        areas: [mechanicsArea, rpbDamageArea, rpbValidationArea] },
];

/** One area group: its head counts the areas that stand out; null when none of its areas has data. */
function areaGroup(g, list) {
    if (!list.length) return null;
    const flagged = list.filter((a) => a.flag).length;
    const action = flagged ? badge(`${flagged} ${flagged === 1 ? "Bereich" : "Bereiche"} auffällig`, g.tone === "bad" ? "bad" : "mid", "", true) : badge("unauffällig", "ok", "", true);
    return {
        id: g.id, flagged,
        html: `<section class="gcard" id="rg-${g.id}">${groupHead(g.icon, flagged ? g.tone : "", g.label, g.crumb, action)}<div class="mgrid">${list.map((a) => a.card).join("")}</div>${list.map((a) => a.dialog).join("")}</section>`,
    };
}

/** The four groups of Sicht Raid, only those with something in them: { id, flagged, html }. */
function raidGroups(ctx) {
    const groups = [recsGroup(ctx)];
    for (const g of AREA_GROUPS) groups.push(areaGroup(g, g.areas.map((fn) => fn(ctx)).filter(Boolean)));
    return groups.filter(Boolean);
}

module.exports = {
    raidGroups,
};
