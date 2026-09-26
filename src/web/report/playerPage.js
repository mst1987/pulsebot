// The player page /r/<id>/p/<n>: head, personal KPIs, the raider's points, the
// fights per boss and the folded detail sections.
const { plural } = require("../../utils/text");
const { bossIconUrl } = require("../../config/bosses");
const { PX_PER_SEC } = require("../charts");
const { esc, shellPage, renderNotFound } = require("./layout");
const { classIconUrl, expBtn, badge, LINE, armoryLink, dlgClose, groupHead, barCell, barPct, hicon, classColorOf, fmtK, kpi, avgOf } = require("./widgets");
const { groupByBoss } = require("./fightTopics");
const { renderFightSection } = require("./fight");
const { tryPills, playerFights } = require("./bossView");
const { ROLE_LABEL, reportContext } = require("./context");
const { sendDialog, raiderSections } = require("./raiderView");

/**
 * The player page: the same raider card as in Sicht Raider, opened, with the
 * Kampfverlauf inline under it (charts stacked under their tables) — no
 * second layout to keep in step.
 */
/**
 * A raider's own output in one fight against the raid's mean per player, on
 * the measure that is theirs (HPS for a healer, DPS otherwise, as
 * playerSeries decides): { key, own, raid } or null without a curve.
 */
function fightMeasure(f, name) {
    const s = f.series;
    const mine = s && Array.isArray(s.players) ? s.players.find((p) => p && p.name === name) : null;
    if (!mine) return null;
    const sum = (arr) => (Array.isArray(arr) ? arr.reduce((a, v) => a + (Number(v) || 0), 0) : 0);
    const healer = ((f.healers && f.healers.healers) || []).some((h) => h.name === name) || sum(mine.hps) > sum(mine.dps);
    const key = healer && mine.hps ? "hps" : mine.dps ? "dps" : "hps";
    const own = mine[key];
    if (!Array.isArray(own) || !own.length) return null;
    const withKey = s.players.filter((p) => p && Array.isArray(p[key]) && p[key].length).length;
    const raidArr = Array.isArray(s[key]) && s[key].length && withKey ? s[key] : null;
    return {
        key,
        own: Math.round(sum(own) / own.length),
        raid: raidArr ? Math.round(sum(raidArr) / raidArr.length / withKey) : null,
    };
}

/** The player page's four KPIs: activity against the raid, DPS/HPS against the raid, deaths, preparation. */
function playerKpis(ctx, p) {
    const { report } = ctx;
    const name = p.name;
    const out = [];
    const act = ctx.actByName.get(name);
    const heal = ctx.healByName.get(name);
    if (act) {
        const raidAvg = avgOf((report.activity && report.activity.players) || [], (x) => x.activeAvg);
        out.push(kpi("inv_misc_pocketwatch_02", "Aktivität", `${act.activeAvg} %`, { text: `Raid Ø ${raidAvg} %` }, act.activeAvg >= raidAvg ? "good" : act.activeAvg >= 85 ? "" : "medium", "", "Anteil der Kampfzeit mit laufenden Zaubern oder Angriffen", "Im Mittel über die Boss-Kämpfe bis zum eigenen Tod, gegen den Schnitt des Raids."));
    } else if (heal) {
        out.push(kpi("spell_holy_flashheal", "Overheal", `${heal.overhealPct} %`, { text: `${fmtK(heal.healingTotal)} Heilung` }, heal.overhealPct >= 50 ? "high" : heal.overhealPct >= 35 ? "medium" : "good", "", "Anteil der Heilung über volle Lebenspunkte", "Ab 35 % gelb, ab 50 % rot."));
    }
    const measures = playerFights(report.timeline, name).map((f) => fightMeasure(f, name)).filter((m) => m && m.raid);
    if (measures.length) {
        const key = measures.filter((m) => m.key === "hps").length > measures.length / 2 ? "hps" : "dps";
        const same = measures.filter((m) => m.key === key);
        const diff = Math.round((same.reduce((n, m) => n + (m.own / m.raid - 1), 0) / same.length) * 100);
        const label = key.toUpperCase();
        out.push(kpi("spell_nature_bloodlust", label, `${diff >= 0 ? "+" : ""}${diff} %`, { text: diff >= 0 ? "über Raid-Schnitt" : "unter Raid-Schnitt" }, diff >= 0 ? "good" : diff >= -15 ? "medium" : "high", diff >= 0 ? "good" : "", `Eigener ${label} gegen den Raid-Schnitt pro Spieler`, `Im Mittel über ${plural(same.length, "Kampf", "Kämpfe")} mit eigener Kurve von Warcraft Logs.`));
    }
    const deaths = ctx.fights.reduce((n, f) => n + (f.deaths || []).filter((d) => d.name === name).length, 0);
    const mech = ctx.mechByName.get(name);
    const avoidable = mech ? mech.avoidableDeaths || 0 : ctx.fights.reduce((n, f) => n + (f.deaths || []).filter((d) => d.name === name && d.avoidable).length, 0);
    if (ctx.fights.length || mech) {
        out.push(kpi("ability_creature_cursed_05", "Tode", String(mech ? mech.deaths || 0 : deaths), avoidable ? { text: `${avoidable} vermeidbar`, bad: true } : null, avoidable ? "high" : deaths ? "medium" : "good", "", "Tode in allen Boss-Kämpfen", "Vermeidbar: der Todesstoß kam von einer Mechanik, der man ausweichen kann."));
    }
    const cons = ctx.consByName.get(name);
    const issues = ((ctx.gearByName.get(name) || {}).issues || p.issues || []);
    if (cons) {
        out.push(kpi("inv_alchemy_endlessflask_05", "Vorbereitung", `${cons.buffed} %`, { text: issues.length ? plural(issues.length, "Gear-Problem", "Gear-Probleme") : "Gear ok" }, cons.buffed >= 90 && !issues.length ? "good" : cons.buffed < 50 ? "high" : "medium", cons.buffed >= 90 ? "good" : "", "Flask oder beide Elixiere, Anteil der Boss-Kämpfe", "Dahinter die Gear-Probleme aus der Ausrüstung beim Pull."));
    }
    return out.length ? `<div class="kpis">${out.join("")}</div>` : "";
}

/**
 * "Deine Kämpfe": one row per boss the raider was in — WCL boss icon, tries,
 * the own DPS/HPS as a bar against the raid mean per player, the activity bar
 * and a hint badge; "Verlauf" opens that boss's charts in a dialog. The
 * segment shows only the rows with a hint, or all.
 */
function playerFightTable(ctx, p) {
    const name = p.name;
    const bosses = groupByBoss(playerFights(ctx.report.timeline, name));
    if (!bosses.length) return { html: "", dialogs: "" };
    const rows = bosses.map((b, bi) => {
        const ms = b.fights.map((f) => fightMeasure(f, name)).filter(Boolean);
        const key = ms.length ? ms[0].key : "dps";
        const own = ms.length ? Math.round(ms.reduce((n, m) => n + m.own, 0) / ms.length) : null;
        const raidMs = ms.filter((m) => m.raid);
        const raid = raidMs.length ? Math.round(raidMs.reduce((n, m) => n + m.raid, 0) / raidMs.length) : null;
        const acts = b.fights.map((f) => (f.activity || []).find((a) => a.name === name)).filter((a) => a && Number.isFinite(a.activePct));
        const act = acts.length ? Math.round(acts.reduce((n, a) => n + a.activePct, 0) / acts.length) : null;
        const deaths = b.fights.flatMap((f) => (f.deaths || []).filter((d) => d.name === name));
        const avoidable = deaths.filter((d) => d.avoidable).length;
        const hints = [];
        if (deaths.length) hints.push(badge(avoidable ? `${avoidable} vermeidbar` : plural(deaths.length, "Tod", "Tode"), avoidable ? "bad" : "mid", "ability_creature_cursed_05"));
        if (own !== null && raid && own < raid * 0.9) hints.push(badge("unter Schnitt", "mid"));
        if (act !== null && act < 85) hints.push(badge(`${act} % aktiv`, "mid"));
        return { b, bi, key, own, raid, act, hints };
    });
    const maxOwn = Math.max(1, ...rows.map((r) => r.own || 0));
    const flagged = rows.filter((r) => r.hints.length).length;
    const onlyFlagged = flagged > 0 && flagged < rows.length;
    const body = rows.map((r) => {
        const icon = bossIconUrl(r.b.encounterId);
        const label = r.key.toUpperCase();
        const ownCell = r.own === null ? "<span class=\"mute\">–</span>" : barCell(fmtK(r.own), (r.own / maxOwn) * 100, r.raid ? (r.own >= r.raid ? "good" : r.own < r.raid * 0.9 ? "medium" : "") : "", `${label} ${name}`, r.raid ? `Raid-Schnitt pro Spieler: ${fmtK(r.raid)}. Grün ab dem Schnitt, gelb unter 90 % davon.` : "");
        return `<tr data-flag="${r.hints.length ? 1 : 0}"${onlyFlagged && !r.hints.length ? " hidden" : ""}>
          <td><span class="who">${icon ? `<img class="hicon" src="${esc(icon)}" alt="">` : ""}<span>${esc(r.b.name)}</span></span></td>
          <td>${badge(String(r.b.fights.length), "", "", true)}</td>
          <td>${ownCell}</td>
          <td class="mono mute">${r.raid ? fmtK(r.raid) : "–"}</td>
          <td class="act">${r.act === null ? "<span class=\"mute\">–</span>" : barPct(r.act)}</td>
          <td><div class="badges">${r.hints.join("")}</div></td>
          <td style="text-align:right"><button type="button" class="btn btn-ghost btn-sm" data-dialog="dlg-pf-${r.bi}">${LINE.expand}Verlauf</button></td>
        </tr>`;
    }).join("");
    const dialogs = rows.map((r) => {
        const ns = "p-"; // fight ids are unique across bosses, so every boss dialog can share the page prefix
        const icon = bossIconUrl(r.b.encounterId);
        const sections = r.b.fights.map((f, j) => renderFightSection(f, null, name, j + 1, r.b.fights.length, j === 0, "inline", ns, { crumb: "" })).join("");
        return `<dialog class="dlg chart" id="dlg-pf-${r.bi}">
          <div class="dlg-head">${icon ? `<img class="vcard-icon" src="${esc(icon)}" alt="">` : ""}<div class="dlg-main"><div class="dlg-title">${hicon("inv_misc_pocketwatch_01", "")}${esc(r.b.name)} · ${esc(name)}</div><div class="vcard-meta">${plural(r.b.fights.length, "Try", "Tries")} · ${PX_PER_SEC} px pro Sekunde, seitlich scrollen</div></div>${dlgClose()}</div>
          <div class="dlg-body">${tryPills(r.b, ns)}${sections}</div>
          <div class="dlg-foot"><span class="note">Tode als senkrechte Striche in Klassenfarbe · Tabellenansicht unter jeder Grafik aufklappbar</span><div class="btns"><button type="button" class="btn btn-sm" data-close>Schließen</button></div></div>
        </dialog>`;
    }).join("");
    const seg = flagged && flagged < rows.length
        ? `<nav class="seg sm pf-seg"><button type="button" class="seg-btn active" data-pfilter="flag">Auffällige<span class="n mid">${flagged}</span></button><button type="button" class="seg-btn" data-pfilter="all">Alle ${rows.length}</button></nav>`
        : "";
    const shown = onlyFlagged ? flagged : rows.length;
    const html = `<section class="gcard" id="p-fights">${groupHead("inv_misc_pocketwatch_01", "", "Deine Kämpfe", `${name} › Kampfverlauf · ${shown} von ${plural(rows.length, "Boss", "Bossen")} gezeigt`, seg)}
      <div class="tbox"><table class="idx pfights"><tr><th>Boss</th><th data-tip="Tries" data-tip-sub="Pulls dieses Bosses, in denen der Raider dabei war.">Tries</th><th data-tip="Dein DPS / HPS" data-tip-sub="Im Mittel über die Tries, aus der eigenen 5-Sekunden-Kurve von Warcraft Logs. Der Balken ist der Anteil am besten eigenen Boss.">Dein ${rows.some((r) => r.key === "hps") && rows.every((r) => r.key === "hps") ? "HPS" : "DPS"}</th><th data-tip="Raid Ø" data-tip-sub="Raid-Kurve geteilt durch die Zahl der Spieler mit einer Kurve.">Raid Ø</th><th data-tip="Aktiv" data-tip-sub="Anteil der Kampfzeit mit laufenden Zaubern oder Angriffen, bis zum eigenen Tod.">Aktiv</th><th>Hinweis</th><th></th></tr>${body}</table></div>
    </section>`;
    return { html, dialogs };
}

/**
 * The player page, focused: head with the class icon, name and badges; four
 * personal KPIs; "Deine Punkte für den nächsten Raid" first (a reader sees
 * only the approved ones, the first opened with its text); "Deine Kämpfe" per
 * boss with the chart in a dialog; Vorbereitung / Leistung / Fehler as
 * collapsed area heads with one badge each.
 */
function renderPlayerPage(report, idx, user) {
    const p = (report.roster || [])[idx];
    if (!p) return renderNotFound();
    const ctx = reportContext(report, user);
    const { reviewer } = ctx;
    const name = p.name;
    const color = classColorOf(p.type) || "var(--text)";
    const role = ctx.roleOf(name);
    const recP = ctx.recByName.get(name);
    const items = recP ? (reviewer ? recP.items : recP.items.filter((x) => x.approved === true)) : [];
    const open = items.filter((x) => x.approved === null).length;
    const approved = items.filter((x) => x.approved === true).length;
    const fights = playerFights(report.timeline, name);
    const { secs, dialogs } = raiderSections(ctx, p, idx, items, { openFirst: true });

    const roleIcon = { tank: "inv_shield_06", healer: "spell_holy_flashheal", dps: "ability_dualwield" }[role];
    const meta = [
        badge(p.type, ""),
        ROLE_LABEL[role] ? badge(ROLE_LABEL[role], "accent", roleIcon) : "",
        fights.length ? badge(plural(fights.length, "Kampf", "Kämpfe"), "", "", true) : "",
    ].filter(Boolean).join("");
    const sendBtn = reviewer && recP ? `<button type="button" class="btn btn-sm" data-dialog="send-${idx}"${approved ? "" : " disabled"}>${hicon("inv_letter_15", "")}Vorschau &amp; senden</button>` : "";
    const kicker = [report.title, report.date].filter(Boolean).map(esc).join(" · ");

    const recs = secs.find((s) => s.key === "recs");
    const points = `<section class="gcard" id="p-points">${groupHead("inv_misc_note_01", open ? "mid" : "", reviewer ? "Punkte für den nächsten Raid" : "Deine Punkte für den nächsten Raid", `${name} › Empfehlungen · ${reviewer ? `${approved} freigegeben · ${open} offen` : "von der Raidleitung geprüft"}`, badge(String(items.length), "", "", true))}${recs ? recs.html : "<div class=\"rlist\"><div class=\"rec-empty\">Noch keine freigegebenen Punkte.</div></div>"}${reviewer && recP ? `<div class="raider-foot" data-report="${esc(report.id)}" data-name="${esc(name)}"><span class="note">${approved} freigegeben · ${open} offen · zuletzt gesendet: ${ctx.sent[name] ? esc(new Date(ctx.sent[name].at).toLocaleString("de-DE")) : "nie"}</span><span class="rec-send-result" hidden></span><div class="btns"><button type="button" class="btn btn-run btn-sm" data-phrase="player" data-tip="Claude formuliert die Befunde dieses Raiders in Klartext" data-tip-sub="Deine Freigabe bleibt nötig; der Regeltext bleibt erhalten.">${hicon("inv_scroll_03", "")}KI-Formulierung</button></div></div>` : ""}</section>`;
    const fightTable = playerFightTable(ctx, p);
    const detail = secs.filter((s) => s.key !== "recs").map((s) => {
        const tone = s.tone === "bad" ? "bad" : s.tone === "mid" ? "mid" : "";
        return `<details class="pgrp" id="p-${s.key}"><summary>${groupHead(s.icon, tone, s.label, `${name} › ${s.crumb}`, `${s.badge || ""}${expBtn()}`)}</summary><div class="pgrp-body">${s.html}</div></details>`;
    }).join("");

    const body = `
      <div class="page-head phead" style="--cc:${esc(color)}">
        <img class="phead-icon" src="${esc(classIconUrl(p.type))}" alt="${esc(p.type)}">
        <div class="page-head-main">
          <div class="kicker">${kicker}</div>
          <h1 class="page-title ptitle-cn">${esc(name)}</h1>
          <div class="vcard-meta">${meta}</div>
        </div>
        <div class="page-actions">${armoryLink(name, "btn btn-ghost btn-sm")}<a class="btn btn-ghost btn-sm" href="/r/${esc(report.id)}#raider">${LINE.back}Zum Report</a>${sendBtn}</div>
      </div>
      ${playerKpis(ctx, p)}
      <div class="pstack">${points}${fightTable.html}${detail}</div>
      ${fightTable.dialogs}${dialogs}${reviewer && recP ? sendDialog(ctx, p, idx, items) : ""}`;

    return shellPage(`${name} — ${report.title || ""}`, {
        user,
        body,
        crumbs: [
            { label: report.title || "Log-Check", href: `/r/${report.id}` },
            { label: name },
        ],
    });
}

module.exports = {
    renderPlayerPage,
};
