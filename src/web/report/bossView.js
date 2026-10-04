// Sicht Bosse: a table of every boss (one row each, worst news per column) and,
// behind a click on a row, the boss itself: its head, the tries and the fight
// section with the topics as a list on the left. Plus a raider's own timeline
// (player page, raider card).
const { fmtTime } = require("./charts");
const { bossIconUrl } = require("../../config/bosses");
const { esc } = require("./layout");
const { badge, LINE } = require("./widgets");
const { fightOutcome, groupByBoss } = require("./fightTopics");
const { renderFightSection } = require("./fight");
const { buffIssues } = require("./panels/buffs");
const { recItem } = require("./recommendations");

/** The try pills of a boss (one per pull; none for a single pull). */
function tryPills(b, ns) {
    if (b.fights.length < 2) return "";
    const pills = b.fights.map((f, j) =>
        `<button type="button" class="try-pill${j === 0 ? " active" : ""}${f.kill ? " try-kill" : " try-wipe"}" data-show="${ns}fight-${esc(f.id)}">Try ${j + 1}<span class="s">${esc(fightOutcome(f))} · ${fmtTime(f.duration)}</span></button>`).join("");
    return `<nav class="try-pills">${pills}</nav>`;
}

/**
 * What a boss comes down to, over all its tries: the outcome, deaths, missing
 * debuffs, raiders short of buffs, undispelled debuffs and the mean activity.
 * A figure whose source no try carries is null, so its cell says "–".
 */
function bossFacts(b) {
    const fights = b.fights;
    const kill = fights.find((f) => f.kill);
    const wipes = fights.filter((f) => !f.kill);
    const deaths = fights.reduce((s, f) => s + (f.deaths || []).length, 0);
    const avoidable = fights.reduce((s, f) => s + (f.deaths || []).filter((d) => d.avoidable).length, 0);
    let debuffs = null;
    if (fights.some((f) => f.debuffs && f.debuffs.length)) {
        const expected = new Set();
        const missing = new Set();
        for (const f of fights) {
            for (const d of f.debuffs || []) {
                if (!d.expected) continue;
                expected.add(d.key);
                if (d.missing || d.uptimePct === 0) missing.add(d.key);
            }
        }
        debuffs = { expected: expected.size, missing: missing.size };
    }
    let lacking = null;
    if (fights.some((f) => f.buffs && (f.buffs.players || []).length)) {
        const names = new Set();
        for (const f of fights) for (const p of (f.buffs && f.buffs.players) || []) if (buffIssues(p) > 0) names.add(p.name);
        lacking = names.size;
    }
    const undispelled = fights.some((f) => f.healers && f.healers.dispels)
        ? fights.reduce((s, f) => s + (((f.healers && f.healers.dispels && f.healers.dispels.missed) || []).length), 0)
        : null;
    const act = fights.flatMap((f) => (f.activity || []).map((a) => Number(a.activePct))).filter(Number.isFinite);
    const activity = act.length ? Math.round(act.reduce((a, v) => a + v, 0) / act.length) : null;
    return { tries: fights.length, kill, wipes, deaths, avoidable, debuffs, lacking, undispelled, activity };
}

const triesWord = (n) => `${n} ${n === 1 ? "Try" : "Tries"}`;

/** The outcome in words: the kill with its time, else the one wipe or how many there were. */
function outcomeText(x) {
    if (x.kill) return `Kill ${fmtTime(x.kill.duration)}`;
    return x.wipes.length === 1 ? fightOutcome(x.wipes[0]) : `${x.wipes.length} Wipes`;
}

/** Deaths in words: "0 Tode", "1 Tod · vermeidbar", "3 Tode · 1 vermeidbar", "2 Tode · alle vermeidbar". */
function deathsText(x) {
    const head = `${x.deaths} ${x.deaths === 1 ? "Tod" : "Tode"}`;
    if (!x.avoidable) return head;
    if (x.deaths === 1) return `${head} · vermeidbar`;
    return `${head} · ${x.avoidable === x.deaths ? "alle" : x.avoidable} vermeidbar`;
}

/** One row of the boss table; the whole row opens the boss. */
function bossRow(b) {
    const x = bossFacts(b);
    const icon = bossIconUrl(b.encounterId);
    const dash = "<span class=\"mute\">–</span>";
    const cells = [
        `<td><button type="button" class="boss-open" data-boss-open="${esc(b.key)}">${icon ? `<img class="boss-ico" src="${esc(icon)}" alt="">` : "<span class=\"boss-ico\"></span>"}<b>${esc(b.name)}</b></button></td>`,
        `<td>${badge(outcomeText(x), x.kill ? "ok" : "bad")}${x.tries > 1 ? ` <span class="mute">${triesWord(x.tries)}</span>` : ""}</td>`,
        `<td>${badge(deathsText(x), x.avoidable ? "bad" : x.deaths ? "mid" : "ok")}</td>`,
        `<td>${x.debuffs === null ? dash : x.debuffs.missing ? badge(`${x.debuffs.missing} von ${x.debuffs.expected} fehlten`, "bad") : badge("alle da", "ok")}</td>`,
        `<td>${x.lacking === null ? dash : x.lacking ? badge(`${x.lacking} Raider ohne`, "mid") : badge("alle da", "ok")}</td>`,
        `<td>${x.undispelled === null ? dash : x.undispelled ? badge(`${x.undispelled} nie dispellt`, x.undispelled >= 3 ? "mid" : "") : badge("alles dispellt", "ok")}</td>`,
        "<td class=\"boss-go\">Öffnen ›</td>",
    ];
    return `<tr data-boss-open="${esc(b.key)}">${cells.join("")}</tr>`;
}

/** Raid recommendations that name this boss in their title, text or evidence. */
function bossRecommendations(b, raidRecs, reviewer) {
    const name = String(b.name || "").toLowerCase();
    if (!name) return "";
    const hit = (s) => String(s || "").toLowerCase().includes(name);
    const items = (raidRecs || []).filter((i) => reviewer || i.approved === true)
        .filter((i) => hit(i.title) || hit(i.text) || hit(i.custom) || hit(i.ai) || (i.evidence || []).some((e) => hit(e.label) || hit(e.value)));
    if (!items.length) return "";
    return `<div class="boss-recs"><h3>Empfehlungen zu diesem Boss</h3><ul class="rec-list">${items.map((i) => recItem(i, "raid", "", reviewer)).join("")}</ul></div>`;
}

/** One figure in a boss's head: a small label over a big value. */
function headFact(label, value, sub, tone) {
    return `<div class="bfact"><span class="kicker">${esc(label)}</span><b${tone ? ` class="${tone}"` : ""}>${esc(value)}${sub ? ` <small>· ${esc(sub)}</small>` : ""}</b></div>`;
}

/** One boss behind its table row: back button, head with its figures, try pills, the fight sections, its recommendations. Hidden until opened. */
function bossDetail(b, i, n, linkFor, raidRecs, reviewer) {
    const x = bossFacts(b);
    const icon = bossIconUrl(b.encounterId);
    const ctx = { iconUrl: icon };
    const sections = b.fights.map((f, j) => renderFightSection(f, linkFor, null, j + 1, b.fights.length, j === 0, "card", "", ctx)).join("");
    const facts = [
        headFact("Kampf", outcomeText(x), triesWord(x.tries), x.kill ? "" : "bad"),
        x.activity === null ? "" : headFact("Aktivität", `Ø ${x.activity} %`, "", x.activity >= 95 ? "" : x.activity >= 85 ? "warn" : "bad"),
        headFact("Tode", deathsText(x), "", x.avoidable ? "bad" : ""),
    ].join("");
    return `<section class="boss-detail" id="boss-${esc(b.key)}" data-boss="${esc(b.key)}" hidden>
      <div class="boss-head"><button type="button" class="btn btn-ghost btn-sm btn-back" data-boss-back>${LINE.back}Alle Bosse</button>${icon ? `<img class="boss-head-ico" src="${esc(icon)}" alt="">` : ""}<div class="boss-head-main"><span class="kicker">Boss ${i + 1} von ${n}</span><h2>${esc(b.name)}</h2></div><span class="grow"></span><div class="bfacts">${facts}</div></div>
      ${tryPills(b, "")}${sections}${bossRecommendations(b, raidRecs, reviewer)}
    </section>`;
}

/** Sicht Bosse: the table of all bosses, each boss's own page hidden behind its row. */
function renderBossView(timeline, linkFor, raidRecs, reviewer) {
    const fights = (timeline && timeline.fights) || [];
    if (fights.length === 0) return "<div class=\"empty\">Keine Boss-Kämpfe im Log.</div>";
    const bosses = groupByBoss(fights);
    // No fight carries a DPS/HPS strip: the v2 client is not set up (or the
    // report predates it). Said once, here, instead of an empty gap per fight.
    const noSeries = fights.some((f) => f.series && (f.series.dps || f.series.hps))
        ? ""
        : "<p class=\"note\">Raid-DPS/HPS und Boss-Leben brauchen den Warcraft-Logs-v2-Zugang (Einstellungen → Verbindungen → Warcraft Logs); bei einer neuen Auswertung erscheinen sie dann als Bereich „Kampfverlauf“.</p>";
    const table = `<div class="boss-index" id="bossIndex">${noSeries}<div class="tbl-wrap"><table class="idx boss-table"><thead><tr><th>Boss</th><th>Kampf</th><th>Tode</th><th>Debuffs</th><th>Buffs</th><th>Dispel</th><th></th></tr></thead><tbody>${bosses.map(bossRow).join("")}</tbody></table></div></div>`;
    return `${table}${bosses.map((b, i) => bossDetail(b, i, bosses.length, linkFor, raidRecs, reviewer)).join("")}`;
}

/** The fights a raider shows up in. */
function playerFights(timeline, name) {
    return ((timeline && timeline.fights) || []).filter((f) =>
        (f.deaths || []).some((d) => d.name === name)
        || (f.totems || []).some((t) => t.name === name)
        || ((f.cooldowns && f.cooldowns.players) || []).some((p) => p.name === name)
        || (f.activity || []).some((a) => a.name === name)
        || ((f.mechanics && f.mechanics.players) || []).some((p) => p.name === name)
        || ((f.healers && f.healers.healers) || []).some((h) => h.name === name)
        || ((f.healers && f.healers.shields) || []).some((r) => r.source === name)
        || !!(f.healers && f.healers.tank && f.healers.tank.name === name)
        || ((f.buffs && f.buffs.players) || []).some((p) => p.name === name)
        || ((f.series && f.series.players) || []).some((p) => p && p.name === name));
}

/**
 * The player's slice of the timeline: only the fights this raider shows up
 * in, boss tabs → try pills → sections, charts inline. `ns` keeps the ids
 * apart from the boss pages' and from the other raiders' slices on the
 * report page.
 */
function renderPlayerTimeline(timeline, name, ns = "p-") {
    const fights = playerFights(timeline, name);
    if (fights.length === 0) return "";
    const bosses = groupByBoss(fights);
    const tabs = bosses.map((b, i) => {
        const icon = bossIconUrl(b.encounterId);
        const kills = b.fights.filter((f) => f.kill).length;
        return `<button type="button" class="boss-tab${i === 0 ? " active" : ""}" data-show="${ns}fb-${esc(b.key)}">`
            + (icon ? `<img src="${esc(icon)}" alt="">` : "")
            + `<span class="boss-name">${esc(b.name)}</span>`
            + `<span class="boss-tries boss-${kills ? "kill" : "wipe"}">${b.fights.length} ${b.fights.length === 1 ? "Try" : "Tries"}</span></button>`;
    }).join("");
    const panels = bosses.map((b, i) => {
        const sections = b.fights.map((f, j) => renderFightSection(f, null, name, j + 1, b.fights.length, j === 0, "inline", ns, {})).join("");
        return `<div id="${ns}fb-${esc(b.key)}" class="fight-boss"${i === 0 ? "" : " hidden"}>${tryPills(b, ns)}${sections}</div>`;
    }).join("");
    return `<h2>Kampfverlauf</h2><nav class="boss-tabs">${tabs}</nav>${panels}`;
}

module.exports = {
    tryPills, bossFacts, renderBossView, playerFights, renderPlayerTimeline,
};
