// The report page /r/<id>: head, KPI cards and the three views.
const { esc, shellPage } = require("./layout");
const { LINE, hicon, kpi } = require("./widgets");
const { groupByBoss } = require("./fightTopics");
const { renderBossView } = require("./bossView");
const { reportContext } = require("./context");
const { raidGroups } = require("./raidGroups");
const { renderRaiderView } = require("./raiderView");
const { renderKeyFindings } = require("./recommendations");

// ---- the report page: head, KPI cards, „Das Wichtigste“, three views ---------------
//
// „Das Wichtigste“: the raid's findings, the heaviest first, with the page's
// one main button (send). Sicht Raid: the raid-wide areas as metric cards.
// Sicht Bosse: a table of the bosses, a row opens that boss's page
// (bossView.js). Sicht Raider: the raiders grouped by how much there is to
// talk about (raiderView.js), with a search field and a role filter. The open
// view sits in the url hash (#raid / #bosse / #raider, #boss-<key> opens a
// boss, #raider-<name> one card), so a link from Discord or the admin menu
// lands on the right place.

/**
 * Headline numbers: bosses (kills/wipes), deaths (avoidable), the
 * flask/elixir coverage and the raid buffs. Every card only when its source
 * is there.
 */
function kpiCards(report) {
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
    const cons = (report.consumables && report.consumables.players) || [];
    if (cons.length) {
        const avg = (key) => Math.round(cons.reduce((n, p) => n + (p[key] || 0), 0) / cons.length);
        const buffed = avg("buffed");
        out.push(kpi("inv_alchemy_endlessflask_05", "Flask / Elixiere", `${buffed} %`, { text: `Ø Food ${avg("food")} %` }, "good", buffed >= 90 ? "good" : buffed < 50 ? "bad" : "warn", "Anteil der Boss-Kämpfe, in denen ein Raider ein Flask oder beide Elixiere hatte, im Mittel über den Raid", "Ø Food: dasselbe für den Essensbuff. Ab 90 % grün, unter 50 % rot. Je Raider unter „Consumables“."));
    }
    const buffRows = ((report.raidBuffs && report.raidBuffs.rows) || []).filter((r) => r.expected && Number.isFinite(r.coveragePct));
    if (buffRows.length) {
        const cov = Math.round(buffRows.reduce((n, r) => n + r.coveragePct, 0) / buffRows.length);
        const short = buffRows.filter((r) => r.none > 0 || r.partial > 0 || (r.late || 0) > 0).length;
        out.push(kpi("spell_magic_greaterblessingofkings", "Raid-Buffs", `${cov} %`, short ? { text: `${short} von ${buffRows.length} lückenhaft` } : { text: "alle durchgehend" }, cov >= 95 ? "good" : "medium", cov >= 95 ? "good" : cov >= 80 ? "warn" : "bad", "Anteil der Boss-Kämpfe, in denen die erwarteten Raid-Buffs durchgehend auf den Raidern lagen, im Mittel über alle Buffs", "Lückenhaft: ein Buff, der in mindestens einem Kampf bei jemandem fehlte, spät kam oder ausging. Je Buff und Raider unter Sicht Raid › Raid-Buffs."));
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
      ${kpiCards(report)}
      ${renderKeyFindings(report, rec, reviewer)}
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
