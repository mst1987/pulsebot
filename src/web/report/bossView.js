// Sicht Bosse: one card per boss with tries, chips and the fight section, plus a
// raider's own timeline (player page, raider card).
const { fmtTime } = require("../charts");
const { bossIconUrl } = require("../../config/bosses");
const { esc } = require("./layout");
const { expBtn, badge, hicon, fmtK } = require("./widgets");
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

/** The chips in a boss card's head: missing debuffs, players short of buffs, never-removed debuffs, raid DPS of the best try. */
function bossChips(b) {
    const chip = (n, label, tone, tip, sub, icon) => `<span class="chip chip-x${tone ? ` ${tone}` : ""}"${tip ? ` data-tip="${esc(tip)}"` : ""}${sub ? ` data-tip-sub="${esc(sub)}"` : ""}>${icon ? hicon(icon, "") : ""}<b>${esc(n)}</b> ${esc(label)}</span>`;
    const out = [];
    if (b.fights.some((f) => f.debuffs && f.debuffs.length)) {
        const missing = new Set();
        for (const f of b.fights) for (const d of f.debuffs || []) if (d.expected && (d.missing || d.uptimePct === 0)) missing.add(d.key);
        out.push(chip(missing.size, `Debuff${missing.size === 1 ? "" : "s"} fehlte${missing.size === 1 ? "" : "n"}`, missing.size ? "bad" : "ok", "Erwartete Debuffs, die in mindestens einem Try kein einziges Mal auf dem Boss lagen", "Erwartet wird, was die Aufstellung hergibt: kein Krieger, kein Sunder. Die Uptimes je Try stehen unter „Debuffs“.", "spell_shadow_chilltouch"));
    }
    if (b.fights.some((f) => f.buffs && (f.buffs.players || []).length)) {
        const lacking = new Set();
        for (const f of b.fights) for (const p of (f.buffs && f.buffs.players) || []) if (buffIssues(p) > 0) lacking.add(p.name);
        out.push(chip(lacking.size, "Buffs fehlten", lacking.size ? "warn" : "ok", "Spieler, denen in mindestens einem Try ein erwarteter Raid-Buff fehlte, spät kam, ausging oder auf der falschen Rolle saß", "Wer was nicht hatte, steht unter „Buffs“.", "spell_magic_greaterblessingofkings"));
    }
    if (b.fights.some((f) => f.healers && f.healers.dispels)) {
        const n = b.fights.reduce((s, f) => s + (((f.healers && f.healers.dispels && f.healers.dispels.missed) || []).length), 0);
        out.push(chip(n, "nie dispellt", n >= 3 ? "warn" : "", "Dispelbare Debuffs auf Spielern, die in diesem Kampf niemand entfernt hat", "Dispelbar heißt: denselben Debuff hat im Log irgendwann jemand dispellt. Ab 3 gelb.", "spell_holy_dispelmagic"));
    }
    const withDps = b.fights.filter((f) => f.series && Array.isArray(f.series.dps) && f.series.dps.length);
    if (withDps.length) {
        const best = withDps.find((f) => f.kill) || withDps[withDps.length - 1];
        const mean = Math.round(best.series.dps.reduce((a, v) => a + (Number(v) || 0), 0) / best.series.dps.length);
        out.push(chip(fmtK(mean), "Raid-DPS", "ok", `Schaden des ganzen Raids pro Sekunde im ${best.kill ? "Kill-Try" : "letzten Try"}, im Mittel über den Kampf`, "Aus der 5-Sekunden-Kurve von Warcraft Logs (v2-Zugang).", "ability_dualwield"));
    }
    return out.join("");
}

/** The meta line under a boss's name: tries, outcomes, kill time, deaths. */
function bossMeta(b) {
    const n = b.fights.length;
    const kill = b.fights.find((f) => f.kill);
    const wipes = b.fights.filter((f) => !f.kill);
    const deaths = b.fights.reduce((s, f) => s + (f.deaths || []).length, 0);
    const avoidable = b.fights.reduce((s, f) => s + (f.deaths || []).filter((d) => d.avoidable).length, 0);
    return [
        badge(`${n} ${n === 1 ? "Try" : "Tries"}`, "", "", true),
        wipes.length ? badge(wipes.length === 1 ? fightOutcome(wipes[0]) : `${wipes.length} Wipes`, "bad", "achievement_boss_illidan") : "",
        kill ? badge(`Kill ${fmtTime(kill.duration)}`, "ok", "achievement_boss_illidan") : "",
        badge(`${deaths} ${deaths === 1 ? "Tod" : "Tode"}${avoidable ? ` · ${avoidable} vermeidbar` : ""}`, avoidable ? "bad" : deaths ? "mid" : "", "ability_creature_cursed_05"),
    ].filter(Boolean).join("");
}

/** Raid recommendations that name this boss in their title, text or evidence. */
function bossRecommendations(b, raidRecs, reviewer) {
    const name = String(b.name || "").toLowerCase();
    if (!name) return "";
    const hit = (s) => String(s || "").toLowerCase().includes(name);
    const items = (raidRecs || []).filter((i) => reviewer || i.approved === true)
        .filter((i) => hit(i.title) || hit(i.text) || hit(i.custom) || hit(i.ai) || (i.evidence || []).some((e) => hit(e.label) || hit(e.value)));
    if (!items.length) return "";
    return `<div class="boss-recs"><div class="kicker icons">${hicon("inv_misc_note_01", "")}Empfehlungen zu diesem Boss</div><ul class="rec-list">${items.map((i) => recItem(i, "raid", "", reviewer)).join("")}</ul></div>`;
}

/** One boss card (Sicht Bosse): head with icon, meta and chips; body with try pills, stats, sections and the boss's recommendations. */
function bossCard(b, i, linkFor, raidRecs, reviewer) {
    const icon = bossIconUrl(b.encounterId);
    const ctx = { iconUrl: icon, crumb: `Bosse › ${b.name}`, subject: `auf ${b.name}` };
    const sections = b.fights.map((f, j) => renderFightSection(f, linkFor, null, j + 1, b.fights.length, j === 0, "card", "", ctx)).join("");
    return `<details class="vcard boss-card" id="boss-${esc(b.key)}"${i === 0 ? " open" : ""}>
      <summary>${icon ? `<img class="vcard-icon" src="${esc(icon)}" alt="">` : "<span class=\"vcard-icon\"></span>"}<div class="vcard-main"><div class="vcard-title">${esc(b.name)}</div><div class="vcard-meta">${bossMeta(b)}</div></div><div class="vcard-chips">${bossChips(b)}</div>${expBtn()}</summary>
      <div class="vcard-body">${tryPills(b, "")}${sections}${bossRecommendations(b, raidRecs, reviewer)}</div>
    </details>`;
}

/** Sicht Bosse: one card per boss, the first open. */
function renderBossView(timeline, linkFor, raidRecs, reviewer) {
    const fights = (timeline && timeline.fights) || [];
    if (fights.length === 0) return "<div class=\"empty\">Keine Boss-Kämpfe im Log.</div>";
    const bosses = groupByBoss(fights);
    // No fight carries a DPS/HPS strip: the v2 client is not set up (or the
    // report predates it). Said once, here, instead of an empty gap per fight.
    const noSeries = fights.some((f) => f.series && (f.series.dps || f.series.hps))
        ? ""
        : "<p class=\"note\">Raid-DPS/HPS und Boss-Leben brauchen den Warcraft-Logs-v2-Zugang (Einstellungen → Verbindungen → Warcraft Logs); bei einer neuen Auswertung erscheinen sie dann in der Kennzahlenzeile und als Bereich „Kampfverlauf“.</p>";
    return `${noSeries}${bosses.map((b, i) => bossCard(b, i, linkFor, raidRecs, reviewer)).join("")}`;
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
 * apart from the boss cards' and from the other raiders' slices on the
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
        const sections = b.fights.map((f, j) => renderFightSection(f, null, name, j + 1, b.fights.length, j === 0, "inline", ns, { crumb: "" })).join("");
        return `<div id="${ns}fb-${esc(b.key)}" class="fight-boss"${i === 0 ? "" : " hidden"}>${tryPills(b, ns)}${sections}</div>`;
    }).join("");
    return `<h2>Kampfverlauf</h2><nav class="boss-tabs">${tabs}</nav>${panels}`;
}

module.exports = {
    tryPills, renderBossView, playerFights, renderPlayerTimeline,
};
