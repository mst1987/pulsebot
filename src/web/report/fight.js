// One boss fight on the report page: the topic parts (table + chart), the DPS/HPS
// strip, the chart dialogs, the Kennzahlenzeile and the whole fight section.
const { markerChart, ribbonChart, fmtTime, lineChart, PX_PER_SEC } = require("../charts");
const { dipShare } = require("../../utils/logcheck/fightSeries");
const { esc } = require("./layout");
const { tile, badge, LINE, dlgClose, hicon, classColorOf, pctTone, classIconName, fmtK } = require("./widgets");
const { fightOutcome, deathsList, mechanicRows, debuffSub, TOPIC_META, topicTable, groupedTable } = require("./fightTopics");
const { healingParts } = require("./panels/healers");
const { buffParts } = require("./panels/buffs");

// ---- Kampfverlauf: the fight timelines (report.timeline, utils/logcheck/fightTimeline.js) ----
//
// One boss at a time, one try at a time, one topic at a time: boss tabs (with
// the WCL boss icon), try pills under them, and a segmented switch for the
// topic — the DPS strip stays on top whichever topic is open. Every topic
// container on a fight is optional and drawn only when an analyzer filled it,
// so a report from before those analyzers still renders — with the bare fight
// axis and its deaths. The shapes the panel expects:
//   debuffs[]   { key, label, icon, bands | stacks, maxStacks, uptimePct, gapCount, longestGap, firstAt, timeToMax }
//   totems[]    { name, type, rows: [{ label, icon, markers, band, downtimes, uptimePct }] }
//   cooldowns   { windows: [{ label, from, to }], players: [{ name, type, rows: [{ label, icon, markers }] }] }
//   activity[]  { name, type, bands, gaps: [{ from, to, reason }], activePct }
//   series      { step, dps, hps, bossHp }

/**
 * The totem timeline, one chart per shaman instead of one flat list of rows.
 *
 * On a flat chart nothing says whose totem a row is — the rows carry an icon
 * and a percentage, and three shamans dropping earth totems look alike. Here
 * each shaman gets a head (class tile, name in class colour, their result) and
 * their own time axis, and the segment above filters to one of them: the same
 * `.dscope` mechanism the RPB tables use (static/report.js), so a name that is
 * filtered away simply hides its block.
 *
 * @param {Array<{ name, type, rows, badge: { text, tone } }>} groups  as groupedTable takes them
 */
function totemCharts(groups, common) {
    const seg = [
        `<button type="button" class="seg-btn active" data-frole="all">Alle<span class="n">${groups.length}</span></button>`,
        ...groups.map((g) => `<button type="button" class="seg-btn" data-frole="${esc(g.name)}">${tile(classIconName(g.type), "cls")}${esc(g.name)}<span class="n">${(g.rows || []).length}</span></button>`),
    ].join("");
    const tools = `<div class="dtools"><nav class="seg sm">${seg}</nav><span class="grow"></span><label class="field">${LINE.search}<input type="search" data-fsearch placeholder="Schamane suchen …" aria-label="Schamane suchen"></label></div>`;
    const blocks = groups.map((g) => `<section class="fc-block" data-role="${esc(g.name)}" data-name="${esc(g.name)}" style="--cc:${esc(classColorOf(g.type) || "var(--text)")}">
      <div class="fc-owner">${tile(classIconName(g.type), "cls")}<span class="cn">${esc(g.name)}</span><span class="sritems">${esc(g.type || "")}</span>${g.badge ? badge(g.badge.text, g.badge.tone) : ""}</div>
      ${markerChart({ ...common, rows: g.rows })}
    </section>`).join("");
    return `<div class="dscope" data-frole="all">${tools}${blocks}</div>`;
}

/**
 * The topic parts of one fight, only those with data:
 *   { id, key, label, icon, count, tone, table, chart }
 * `table` is the compact view a card opens with, `chart` the timeline
 * figure behind "Verlauf öffnen" (null for a list-only topic). `only`
 * restricts the rows to one raider, `ns` prefixes the element ids so the
 * same fight can sit on a page more than once (the boss card and every
 * raider's own slice).
 */
function fightParts(f, linkFor, only, ns = "") {
    const common = { duration: f.duration, deaths: f.deaths, classColor: classColorOf };
    const mine = (name) => !only || name === only;
    const parts = [];
    const key = (k) => `${ns}fp-${esc(f.id)}-${k}`;
    const part = (k, o) => parts.push({ id: key(k), key: k, label: TOPIC_META[k].label, icon: TOPIC_META[k].icon, chart: null, tone: undefined, ...o });
    const worst = (rows) => (rows.some((r) => r.tone === "high") ? "bad" : rows.some((r) => r.tone === "medium") ? "mid" : "ok");

    if (!only && f.debuffs && f.debuffs.length) {
        const rows = f.debuffs.map((d) => ({
            label: d.label, icon: d.icon,
            bands: d.stacks && d.stacks.length ? d.stacks : d.bands,
            maxStacks: d.maxStacks || 0,
            value: d.missing ? "fehlte" : (Number.isFinite(d.uptimePct) ? `${d.uptimePct}%` : undefined),
            sub: debuffSub(d),
            tone: d.missing ? "high" : (Number.isFinite(d.uptimePct) ? pctTone(d.uptimePct) : undefined),
        }));
        const missing = f.debuffs.filter((d) => d.expected && (d.missing || d.uptimePct === 0)).length;
        part("debuffs", { count: rows.length, tone: worst(rows), sub: missing ? `${missing} fehlt${missing === 1 ? "" : "en"}` : "", table: topicTable(rows, f.duration, "bands"), chart: ribbonChart({ ...common, rows }) });
    }

    const totems = (f.totems || []).filter((t) => mine(t.name));
    if (totems.length) {
        const rows = totems.flatMap((t) => (t.rows || []).map((r) => ({
            ...r,
            label: only ? r.label : `${t.name} · ${r.label}`,
            value: Number.isFinite(r.uptimePct) ? `${r.uptimePct}%` : r.value,
            sub: r.sub || ((r.downtimes || []).length ? `${r.downtimes.length} Lücke${r.downtimes.length === 1 ? "" : "n"}` : ""),
            tone: Number.isFinite(r.uptimePct) ? pctTone(r.uptimePct) : r.tone,
        })));
        const twisting = totems.filter((t) => t.twisting && t.twisting.detected).length;
        const groups = totems.map((t) => {
            const own = (t.rows || []).map((r) => ({ ...r, value: Number.isFinite(r.uptimePct) ? `${r.uptimePct}%` : r.value, sub: r.sub || ((r.downtimes || []).length ? `${r.downtimes.length} Lücke${r.downtimes.length === 1 ? "" : "n"}` : ""), tone: Number.isFinite(r.uptimePct) ? pctTone(r.uptimePct) : r.tone }));
            const gaps = own.reduce((n, r) => n + ((r.downtimes || []).length), 0);
            const tw = t.twisting && t.twisting.detected;
            return { name: t.name, type: t.type, rows: own, open: gaps > 0, badge: gaps ? { text: `${gaps} Lücke${gaps === 1 ? "" : "n"}`, tone: gaps >= 3 ? "bad" : "mid" } : { text: tw ? "Twisting" : "ok", tone: "ok" } };
        }).sort((a, b) => (b.badge.tone === "ok" ? 0 : 1) - (a.badge.tone === "ok" ? 0 : 1));
        part("totems", {
            count: rows.length, tone: worst(rows), sub: twisting ? "Twisting" : "",
            table: only ? topicTable(rows, f.duration, "markers") : groupedTable(groups, f.duration, "markers"),
            // One chart per shaman rather than one long list of icons: on a flat
            // chart nothing says whose totem a row is, and with three shamans
            // the rows of the one you are looking at sit apart from each other.
            chart: only || groups.length < 2 ? markerChart({ ...common, rows }) : totemCharts(groups, common),
        });
    }

    const cdPlayers = ((f.cooldowns && f.cooldowns.players) || []).filter((p) => mine(p.name));
    if (cdPlayers.length) {
        const rows = cdPlayers.flatMap((p) => (p.rows || []).map((r) => {
            const n = (r.markers || []).length;
            return { ...r, label: only ? r.label : `${p.name} · ${r.label}`, value: r.value !== undefined ? r.value : `${n}×`, sub: r.sub };
        }));
        const possible = rows.reduce((n, r) => n + (Number.isFinite(r.possibleUses) ? r.possibleUses : 0), 0);
        const missed = rows.reduce((n, r) => n + (Number.isFinite(r.missed) ? r.missed : 0), 0);
        const usedPct = possible ? Math.round(((possible - missed) / possible) * 100) : null;
        // per player: their cooldowns under their name, the one who missed most first, nothing missed = closed
        const groups = cdPlayers.map((p) => {
            const own = (p.rows || []).map((r) => ({ ...r, value: r.value !== undefined ? r.value : `${(r.markers || []).length}×` }));
            const pos = own.reduce((n, r) => n + (Number.isFinite(r.possibleUses) ? r.possibleUses : 0), 0);
            const mis = own.reduce((n, r) => n + (Number.isFinite(r.missed) ? r.missed : 0), 0);
            const used = pos - mis;
            return { name: p.name, type: p.type, rows: own, missed: mis, open: mis > 0, badge: pos ? { text: `${used} von ${pos} genutzt`, tone: mis === 0 ? "ok" : used * 2 >= pos ? "mid" : "bad" } : { text: (() => { const u = own.reduce((n, r) => n + (r.markers || []).length, 0); return `${u} ${u === 1 ? "Einsatz" : "Einsätze"}`; })(), tone: "" } };
        }).sort((a, b) => b.missed - a.missed || a.name.localeCompare(b.name));
        part("cooldowns", { count: rows.length, tone: usedPct === null ? "ok" : usedPct >= 80 ? "ok" : usedPct >= 50 ? "mid" : "bad", sub: usedPct === null ? "" : `${usedPct} % genutzt`, table: only ? topicTable(rows, f.duration, "markers") : groupedTable(groups, f.duration, "markers"), chart: markerChart({ ...common, rows, windows: f.cooldowns.windows || [] }) });
    }

    const activity = (f.activity || []).filter((a) => mine(a.name));
    if (activity.length) {
        const rows = activity.map((a) => ({
            label: a.name, icon: a.icon || classIconName(a.type),
            bands: a.bands,
            value: Number.isFinite(a.activePct) ? `${a.activePct}%` : undefined,
            sub: (a.gaps || []).length ? `${a.gaps.length} Lücke${a.gaps.length === 1 ? "" : "n"}` : "",
            tone: Number.isFinite(a.activePct) ? pctTone(a.activePct) : undefined,
        }));
        const avg = Math.round(activity.reduce((n, a) => n + (Number(a.activePct) || 0), 0) / activity.length);
        part("activity", { count: rows.length, tone: worst(rows), sub: `Ø ${avg} %`, table: topicTable(rows, f.duration, "bands"), chart: ribbonChart({ ...common, rows }) });
    }

    const mechRows = mechanicRows(f.mechanics, only);
    if (mechRows.length) {
        const hits = mechRows.reduce((n, r) => n + r.markers.length, 0);
        // per raider: their hits under their name, the most-hit first, one hit = closed
        const groups = only ? [] : ((f.mechanics && f.mechanics.players) || []).map((p) => {
            const own = mechanicRows(f.mechanics, p.name);
            const n = own.reduce((s, r) => s + r.markers.length, 0);
            const deaths = (f.deaths || []).filter((d) => d.name === p.name);
            const avoidable = deaths.filter((d) => d.avoidable).length;
            return { name: p.name, type: p.type, rows: own, hits: n, open: n >= 2 || avoidable > 0, badge: { text: `${n} Treffer`, tone: n >= 3 ? "bad" : n === 2 ? "mid" : "" }, extra: avoidable ? badge(`${avoidable} vermeidbar${avoidable === 1 ? "er Tod" : "e Tode"}`, "bad", "ability_creature_cursed_05") : (deaths.length ? badge(`${deaths.length} ${deaths.length === 1 ? "Tod" : "Tode"}`, "", "ability_creature_cursed_05") : "") };
        }).filter((g) => g.rows.length).sort((a, b) => b.hits - a.hits || a.name.localeCompare(b.name));
        part("mechanics", { count: hits, tone: worst(mechRows), sub: `${hits} Treffer`, table: only || !groups.length ? topicTable(mechRows, f.duration, "markers") : groupedTable(groups, f.duration, "markers"), chart: markerChart({ ...common, rows: mechRows }) });
    }

    const healing = healingParts(f, only, common, key("healing"));
    if (healing) part("healing", { count: healing.count, tone: healing.tone, sub: healing.sub, table: healing.table, chart: healing.chart });

    const buffs = buffParts(f, only, common);
    if (buffs) part("buffs", { count: buffs.count, tone: buffs.count ? "bad" : "ok", sub: buffs.count ? `${buffs.count} fehlten` : "alle da", table: buffs.table, chart: buffs.chart });

    if (only) {
        const own = playerSeries(f, only);
        if (own) part("series", { count: "", tone: "ok", sub: "", table: own.table, chart: own.chart });
    } else if (f.series && (f.series.dps || f.series.hps)) {
        part("series", { count: "", tone: "ok", sub: "", table: seriesTable(f), chart: fightSeries(f) });
    }

    const deaths = only ? (f.deaths || []).filter((d) => d.name === only) : (f.deaths || []);
    if (parts.length === 0) {
        // nothing but the skeleton yet: the fight itself is the one band, so the
        // axis and the deaths are still there to look at
        const rows = [{ label: f.kill ? "Kampf (Kill)" : "Kampf (Wipe)", bands: [[0, f.duration]], tone: f.kill ? "good" : "high", value: fmtTime(f.duration) }];
        part("fight", { count: 1, tone: "ok", sub: "", table: topicTable(rows, f.duration, "bands"), chart: ribbonChart({ ...common, deaths, rows }) });
    }
    part("deaths", { count: deaths.length, tone: deaths.some((d) => d.avoidable) ? "bad" : deaths.length ? "mid" : "ok", sub: "", table: deathsList(deaths, linkFor), chart: null });
    return parts;
}

/** The compact twin of the DPS/HPS strip: means, peaks and where the boss's health ended. */
function seriesTable(f) {
    const s = f.series || {};
    const mean = (arr) => (Array.isArray(arr) && arr.length ? Math.round(arr.reduce((a, v) => a + (Number(v) || 0), 0) / arr.length) : null);
    const peak = (arr) => (Array.isArray(arr) && arr.length ? Math.max(...arr.map((v) => Number(v) || 0)) : null);
    const hp = Array.isArray(s.bossHp) && s.bossHp.length ? s.bossHp.filter((v) => v !== null && v !== undefined) : [];
    const rows = [
        s.dps ? `<tr><td>${hicon("ability_dualwield", "")}Raid-DPS</td><td class="mono">Ø ${fmtK(mean(s.dps))}</td><td class="mono">max ${fmtK(peak(s.dps))}</td></tr>` : "",
        s.hps ? `<tr><td>${hicon("spell_holy_renew", "")}Raid-HPS</td><td class="mono">Ø ${fmtK(mean(s.hps))}</td><td class="mono">max ${fmtK(peak(s.hps))}</td></tr>` : "",
        hp.length ? `<tr><td>Boss-Leben</td><td class="mono">Ende ${esc(Math.round(hp[hp.length - 1]))} %</td><td class="mono">${esc(hp.length)} Messpunkte</td></tr>` : "",
    ].filter(Boolean).join("");
    return `<table class="idx fc-table topic-table"><tr><th>Kurve</th><th>Mittel</th><th>Spitze</th></tr>${rows}</table>`;
}

/** The DPS/HPS strip above the topic switch. */
function fightSeries(f) {
    if (!f.series || !(f.series.dps || f.series.hps)) return "";
    const series = [];
    if (f.series.dps) series.push({ key: "a", label: "Raid-DPS", values: f.series.dps });
    if (f.series.hps) series.push({ key: "b", label: "Raid-HPS", values: f.series.hps });
    return `<div class="fight-series">${lineChart({ duration: f.duration, deaths: f.deaths, classColor: classColorOf, step: f.series.step, series, bossHp: f.series.bossHp })}</div>`;
}

/**
 * The player page's strip: the raider's own curve against the raid's mean
 * per player (the raid series over the number of raiders with a curve), on
 * the measure that is theirs — HPS for a healer of this fight or whoever
 * healed more than they hit, DPS otherwise. Their own death is the marker,
 * a Bloodlust window a mark at its start; the chips say how much of the
 * fight (alive) their output sat below half their own mean. Nothing without
 * a curve for this raider.
 */
function playerSeries(f, name) {
    const s = f.series;
    const mine = s && Array.isArray(s.players) ? s.players.find((p) => p && p.name === name) : null;
    if (!mine) return null;
    const sum = (arr) => (Array.isArray(arr) ? arr.reduce((a, v) => a + (Number(v) || 0), 0) : 0);
    const healer = ((f.healers && f.healers.healers) || []).some((h) => h.name === name) || sum(mine.hps) > sum(mine.dps);
    const key = healer && mine.hps ? "hps" : mine.dps ? "dps" : "hps";
    const label = key.toUpperCase();
    const own = mine[key];
    if (!Array.isArray(own) || !own.length) return null;
    const withKey = s.players.filter((p) => p && Array.isArray(p[key]) && p[key].length).length;
    const raid = Array.isArray(s[key]) && s[key].length && withKey
        ? s[key].map((v) => Math.round((Number(v) || 0) / withKey))
        : null;
    const series = [{ key: "a", label: `${label} ${name}`, values: own }];
    if (raid) series.push({ key: "b", label: `Raid-Mittel pro Spieler (${withKey})`, values: raid });
    const deaths = (f.deaths || []).filter((d) => d && d.name === name);
    const death = deaths.find((d) => Number.isFinite(d.at));
    const dips = dipShare(own, s.step, death ? death.at : null);
    const markers = ((f.cooldowns && f.cooldowns.windows) || [])
        .filter((w) => w && Number.isFinite(w.from))
        .map((w) => ({ at: w.from, label: w.label || "Bloodlust", icon: "spell_nature_bloodlust", value: `bis ${fmtTime(w.to)}` }));
    const tone = (v) => (v >= 40 ? "high" : v >= 25 ? "medium" : "good");
    const raidMean = raid ? Math.round(raid.reduce((a, v) => a + v, 0) / raid.length) : null;
    const chips = [
        dips ? `<span class="chip chip-${tone(dips.pct)}" data-tip="Anteil der Kampfzeit, in der ${esc(label)} unter der Hälfte des eigenen Schnitts lag" data-tip-sub="Bis zum eigenen Tod. Ab 25 % gelb, ab 40 % rot."><b>${esc(dips.pct)} %</b> der Zeit ${esc(label)}-Einbrüche</span>` : "",
        dips ? `<span class="chip"><b>Ø ${fmtK(dips.mean)}</b> ${esc(label)}</span>` : "",
        raidMean !== null ? `<span class="chip"><b>Ø ${fmtK(raidMean)}</b> Raid-Mittel pro Spieler</span>` : "",
    ].filter(Boolean).join("");
    return {
        table: `<div class="heal-chips">${chips}</div>`,
        chart: `<div class="fight-series player-series">${lineChart({
            title: `${label}-Verlauf ${name}`, duration: f.duration, deaths, classColor: classColorOf, step: s.step, series, bossHp: s.bossHp, markers, markersLabel: "Bloodlust",
        })}</div>`,
    };
}

/** Section buttons + panels for the parts of one fight, in `mode` "card" (table, chart behind a dialog button) or "inline" (table and chart stacked). */
function partPanels(f, parts, mode, ctx) {
    const seg = parts.map((p, i) =>
        `<button type="button" class="sec${i === 0 ? " active" : ""}" data-show="${p.id}">${hicon(p.icon, "")}${esc(p.label)}${p.count === "" ? "" : `<span class="n${p.tone === "bad" ? " bad" : p.tone === "mid" ? " mid" : ""}">${esc(p.count)}${p.sub ? ` · ${esc(p.sub)}` : ""}</span>`}</button>`).join("");
    const panels = parts.map((p, i) => {
        let chart = "";
        if (p.chart && mode === "inline") chart = `<div class="part-chart">${p.chart}</div>`;
        else if (p.chart) chart = chartDialog(p, f, ctx);
        const open = p.chart && mode !== "inline" ? `<button type="button" class="btn btn-ghost btn-sm" data-dialog="dlg-${p.id}">${hicon("inv_misc_pocketwatch_01", "")}Verlauf öffnen${LINE.expand}</button>` : "";
        const crumb = ctx && ctx.crumb ? `<span class="kicker">${esc(ctx.crumb)} › ${esc(p.label)}</span>` : "";
        return `<div id="${p.id}" class="fight-part part"${i === 0 ? "" : " hidden"}>
          <div class="part-head"><div class="part-title">${tile(p.icon, p.tone === "bad" ? "bad" : p.tone === "mid" ? "mid" : p.tone === "ok" ? "ok" : "none")}<div>${esc(p.label)}${ctx && ctx.subject ? ` · ${esc(ctx.subject)}` : ""}${crumb}</div></div>${open}</div>
          ${p.table}${chart}
        </div>`;
    }).join("");
    return `<nav class="secs">${seg}</nav>${panels}`;
}

/** The chart of one part in a modal dialog (VerlaufFenster): boss, topic, try meta, the chart, the scale note. */
function chartDialog(p, f, ctx) {
    const icon = ctx && ctx.iconUrl ? `<img class="vcard-icon" src="${esc(ctx.iconUrl)}" alt="">` : "";
    return `<dialog class="dlg chart" id="dlg-${p.id}">
      <div class="dlg-head">${icon}<div class="dlg-main"><div class="dlg-title">${hicon(p.icon, "")}${esc(f.boss)} · ${esc(p.label)}</div><div class="vcard-meta">${esc(fightOutcome(f))} · ${fmtTime(f.duration)} · ${PX_PER_SEC} px pro Sekunde, seitlich scrollen</div></div>${dlgClose()}</div>
      <div class="dlg-body">${p.chart}</div>
      <div class="dlg-foot"><span class="note">Tode als senkrechte Striche in Klassenfarbe · Tabellenansicht unter jeder Grafik aufklappbar</span><div class="btns"><button type="button" class="btn btn-ghost btn-sm" data-close>Schließen</button></div></div>
    </dialog>`;
}

/** The Kennzahlenzeile of one fight: Raid-DPS/HPS, Bloodlust, mean activity, expected/missing debuffs, deaths. */
function fightStats(f) {
    const mean = (arr) => (Array.isArray(arr) && arr.length ? Math.round(arr.reduce((a, v) => a + (Number(v) || 0), 0) / arr.length) : null);
    // every stat explains itself in the page's tooltip box: what the number is, where it comes from, when it turns yellow or red
    const stat = (icon, label, value, cls, tip, sub) => `<div class="stat"${tip ? ` data-tip="${esc(tip)}"` : ""}${sub ? ` data-tip-sub="${esc(sub)}"` : ""}><div class="kicker icons">${hicon(icon, "")}${esc(label)}</div><div class="stat-v${cls ? ` ${cls}` : ""}">${value}</div></div>`;
    const out = [];
    const s = f.series || {};
    if (s.dps) out.push(stat("ability_dualwield", "Raid-DPS", fmtK(mean(s.dps)), "", "Schaden des ganzen Raids pro Sekunde, im Mittel über den Kampf", "Aus der 5-Sekunden-Kurve von Warcraft Logs (v2-Zugang). Der Verlauf steht unter „Kampfverlauf“."));
    if (s.hps) out.push(stat("spell_holy_renew", "Raid-HPS", fmtK(mean(s.hps)), "", "Heilung des ganzen Raids pro Sekunde, im Mittel über den Kampf", "Effektive Heilung ohne Overheal, aus der 5-Sekunden-Kurve von Warcraft Logs."));
    // no Bloodlust stat: "0:08 · 13 s auseinander" told the raid lead nothing (their words); the windows stay in the Cooldowns chart
    const act = (f.activity || []).map((a) => Number(a.activePct)).filter(Number.isFinite);
    if (act.length) {
        const avg = Math.round(act.reduce((a, v) => a + v, 0) / act.length);
        out.push(stat("inv_misc_pocketwatch_02", "Aktivität Ø", `${avg} %`, avg >= 95 ? "" : avg >= 85 ? "warn" : "bad", `${avg} % der Kampfzeit war der Raid im Mittel am Wirken`, "Je Spieler der Anteil der Zeit bis zum eigenen Tod, in der ein Zauber oder Angriff lief (GCD belegt), gemittelt über alle. Ab 95 % grün, ab 85 % gelb, darunter rot. Wer wann Lücken hatte, steht unter „Aktivität“."));
    }
    if (f.debuffs && f.debuffs.length) {
        const expected = f.debuffs.filter((d) => d.expected).length;
        const missing = f.debuffs.filter((d) => d.expected && (d.missing || d.uptimePct === 0)).length;
        out.push(stat("spell_shadow_chilltouch", "Debuffs erwartet", `${expected} ${missing ? `<small class="bad">· ${missing} fehlte${missing === 1 ? "" : "n"}</small>` : ""}`, "", `${expected} Debuffs, die der Raid nach seiner Aufstellung auf den Boss bringen kann`, missing ? `${missing} davon ${missing === 1 ? "lag" : "lagen"} kein einziges Mal auf dem Boss. Die Uptimes stehen unter „Debuffs“.` : "Alle lagen mindestens zeitweise an; die Uptimes stehen unter „Debuffs“."));
    }
    const deaths = f.deaths || [];
    const first = deaths.find((d) => Number.isFinite(d.at));
    out.push(stat("ability_creature_cursed_05", "Tode", `${deaths.length} ${first ? `<small>· ${esc(first.name)} ${fmtTime(first.at)}</small>` : ""}`, deaths.some((d) => d.avoidable) ? "bad" : "", `${deaths.length} ${deaths.length === 1 ? "Tod" : "Tode"} in diesem Try${first ? `, der erste ${first.name} bei ${fmtTime(first.at)}` : ""}`, "Rot, wenn ein Tod als vermeidbar gewertet ist: durch eine Mechanik, der man ausweichen kann. Wer woran starb, steht unter „Mechaniken & Tode“."));
    return `<div class="stats">${out.join("")}</div>`;
}

/**
 * One try of a boss: the stats row (raid view), then the section buttons and
 * their panels. `mode` "card" keeps the charts behind dialogs, "inline"
 * stacks them under the tables (the player page).
 */
function renderFightSection(f, linkFor, only, tryNo, tries, active, mode, ns, ctx) {
    const parts = fightParts(f, linkFor, only, ns);
    const deaths = (f.deaths || []).length;
    const crumb = ctx && ctx.crumb ? `${ctx.crumb}${tries > 1 ? ` › Try ${tryNo}` : ""}` : "";
    return `<section class="fight${f.kill ? "" : " fight-wipe"}" id="${ns}fight-${esc(f.id)}"${active ? "" : " hidden"}>
      ${only ? `<div class="fight-head"><h3>${esc(f.boss)}</h3><span class="meta">${tries > 1 ? `Try ${tryNo}/${tries} · ` : ""}${esc(fightOutcome(f))} · ${fmtTime(f.duration)} · ${deaths} ${deaths === 1 ? "Tod" : "Tode"}</span></div>` : fightStats(f)}
      ${partPanels(f, parts, mode, { ...ctx, crumb })}
    </section>`;
}

module.exports = {
    renderFightSection,
};
