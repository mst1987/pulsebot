// The report page /r/<id>: head, KPI cards and the three views.
const { esc, shellPage } = require("./layout");
const { LINE, hicon, kpi } = require("./widgets");
const { groupByBoss } = require("./fightTopics");
const { renderBossView } = require("./bossView");
const { reportContext } = require("./context");
const { raidGroups } = require("./raidGroups");
const { renderRaiderView } = require("./raiderView");

// ---- the report page: head, KPI cards, three views -------------------------------
//
// Sicht Raid: everything raid-wide as foldable sections. Sicht Bosse: one card
// per boss (bossCard). Sicht Raider: one card per raider (raiderCard), with a
// search field and a role filter. The open view sits in the url hash
// (#raid / #bosse / #raider, #raider-<name> opens one card), so a link from
// Discord or the admin menu lands on the right place.

/**
 * Headline numbers: bosses (kills/wipes), deaths (avoidable), open
 * recommendations (for a reviewer; approved ones for everyone else) and the
 * flask/elixir coverage. Every card only when its source is there.
 */
function kpiCards(report, ctx) {
    const out = [];
    const fights = (report.timeline && report.timeline.fights) || [];
    const rows = (report.bossUptimes && report.bossUptimes.rows) || [];
    if (fights.length) {
        const bosses = groupByBoss(fights);
        const kills = fights.filter((f) => f.kill).length;
        out.push(kpi("achievement_boss_illidan", "Bosse", String(bosses.length), { text: `${kills} Kill${kills === 1 ? "" : "s"}, ${fights.length - kills} Wipe${fights.length - kills === 1 ? "" : "s"}` }, "", "", "Bosse im Log, dahinter die Tries als Kills und Wipes", "Ein Boss mit mehreren Tries zählt einmal; seine Tries stehen auf seiner Karte in der Sicht Bosse."));
    } else if (rows.length) {
        const kills = rows.filter((r) => r.kill).length;
        out.push(kpi("achievement_boss_illidan", "Bosse", String(rows.length), { text: `${kills} Kill${kills === 1 ? "" : "s"}, ${rows.length - kills} Wipe${rows.length - kills === 1 ? "" : "s"}` }));
    }
    const mech = report.mechanics && report.mechanics.deaths;
    if (mech) {
        out.push(kpi("ability_creature_cursed_05", "Tode", String(mech.total), mech.avoidable ? { text: `${mech.avoidable} vermeidbar`, bad: true } : null, "high", mech.avoidable ? "bad" : "", "Tode in allen Boss-Kämpfen", "Vermeidbar: der Todesstoß kam von einer Mechanik, der man ausweichen kann. Wer woran starb, steht unter „Mechaniken & Tode“."));
    } else if (fights.length) {
        const n = fights.reduce((s, f) => s + (f.deaths || []).length, 0);
        out.push(kpi("ability_creature_cursed_05", "Tode", String(n), null, "high"));
    } else if (report.rpb && report.rpb.damage && (report.rpb.damage.players || []).length) {
        const n = report.rpb.damage.players.reduce((s, p) => s + (p.deaths || 0), 0);
        out.push(kpi("ability_creature_cursed_05", "Tode", String(n), null, "high"));
    }
    if (ctx.rec) {
        const players = ctx.rec.players || [];
        if (ctx.reviewer) {
            const open = ctx.recItems.filter((i) => i.approved === null).length;
            const withOpen = players.filter((p) => p.items.some((i) => i.approved === null)).length;
            out.push(kpi("inv_misc_note_01", "Offene Empfehlungen", String(open), { text: `bei ${withOpen} von ${players.length} Raidern` }, "medium", open ? "" : "good", "Befunde, die noch niemand freigegeben oder verworfen hat", "Erst freigegebene Punkte gehen per Bot an die Raider. Entscheiden kannst du in der Sicht Raider und unter „Empfehlungen an den Raid“."));
        } else {
            const approved = ctx.recItems.filter((i) => i.approved === true).length;
            const withApproved = players.filter((p) => p.items.some((i) => i.approved === true)).length;
            out.push(kpi("inv_misc_note_01", "Empfehlungen", String(approved), { text: `freigegeben · bei ${withApproved} Raidern` }, "medium", "", "Vom Raidlead freigegebene Empfehlungen", "Nur freigegebene Punkte sind auf dieser Seite sichtbar."));
        }
    }
    const cons = (report.consumables && report.consumables.players) || [];
    if (cons.length) {
        const avg = (key) => Math.round(cons.reduce((n, p) => n + (p[key] || 0), 0) / cons.length);
        const buffed = avg("buffed");
        out.push(kpi("inv_alchemy_endlessflask_05", "Flask / Elixiere", `${buffed} %`, { text: `Ø Food ${avg("food")} %` }, "good", buffed >= 90 ? "good" : buffed < 50 ? "bad" : "warn", "Anteil der Boss-Kämpfe, in denen ein Raider ein Flask oder beide Elixiere hatte, im Mittel über den Raid", "Ø Food: dasselbe für den Essensbuff. Ab 90 % grün, unter 50 % rot. Je Raider unter „Consumables“."));
    }
    if (!out.length) {
        const gearIssues = (report.players || []).reduce((n, p) => n + (p.issues || []).length, 0);
        out.push(kpi("inv_shield_06", "Gear-Probleme", String(gearIssues), { text: `bei ${(report.players || []).length} Spieler(n)` }, gearIssues ? "high" : "good", gearIssues ? "bad" : "good", "Fehlende oder schwache Verzauberungen, leere Sockel und inaktive Meta-Gems", "Aus der Ausrüstung, die Warcraft Logs beim Pull gesehen hat."));
    }
    return `<div class="kpis">${out.join("")}</div>`;
}

function renderReportPage(report, user) {
    const ctx = reportContext(report, user);
    const { reviewer, rec, linkFor } = ctx;
    const dateStr = report.date ? esc(report.date) : "";
    const kicker = ["Log-Auswertung", report.zone ? `Zone: ${esc(report.zone)}` : "", dateStr].filter(Boolean).join(" · ");

    const hasTimeline = ctx.fights.length > 0;
    const bosses = hasTimeline ? groupByBoss(ctx.fights) : [];
    const groups = raidGroups(ctx);
    const flagged = groups.reduce((n, g) => n + (g.flagged ? 1 : 0), 0);
    const roster = report.roster || [];

    const isAdmin = !!(user && user.isAdmin);
    const actions = [
        report.reportUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(report.reportUrl)}" target="_blank" rel="noopener">${hicon("inv_misc_pocketwatch_01", "")}Warcraft Logs${LINE.external}</a>` : "",
        isAdmin ? `<a class="btn btn-ghost btn-sm" href="/cla">${hicon("ability_warrior_rallyingcry", "")}Alle Auswertungen</a>` : "",
    ].filter(Boolean).join("");

    const views = [
        { id: "raid", icon: "ability_warrior_rallyingcry", label: "Raid", count: groups.length, tone: flagged ? "mid" : "", html: groups.length ? groups.map((g) => g.html).join("") : "<div class=\"empty\">Keine raid-weiten Auswertungen in diesem Report.</div>" },
        { id: "bosse", icon: "achievement_boss_illidan", label: "Bosse", count: bosses.length, html: renderBossView(report.timeline, linkFor, rec ? rec.raid : [], reviewer) },
        { id: "raider", icon: "inv_misc_grouplooking", label: "Raider", count: roster.length, html: renderRaiderView(ctx, null) },
    ];
    const start = hasTimeline ? "bosse" : "raid";
    const seg = views.map((v) => `<button type="button" class="seg-btn${v.id === start ? " active" : ""}" data-show="view-${v.id}">${hicon(v.icon, "")}${esc(v.label)}<span class="n${v.tone ? ` ${v.tone}` : ""}">${esc(v.count)}</span></button>`).join("");
    const panels = views.map((v) => `<div id="view-${v.id}" class="view"${v.id === start ? "" : " hidden"}>${v.html}</div>`).join("");

    const body = `
      <div class="page-head">
        <div class="page-head-main">
          <div class="kicker">${kicker}</div>
          <h1 class="page-title">${esc(report.title || "Log-Check")}</h1>
        </div>
        ${actions ? `<div class="page-actions">${actions}</div>` : ""}
      </div>
      ${kpiCards(report, ctx)}
      <div class="view-bar"><nav class="seg views">${seg}</nav></div>
      ${panels}`;

    return shellPage(report.title ? `Log-Check: ${report.title}` : "Log-Check", {
        user,
        body,
        crumbs: [{ label: report.title || "Log-Check" }],
    });
}

module.exports = {
    renderReportPage,
};
