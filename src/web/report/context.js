// What the three views of the report page share, computed once per request:
// links, review rights, the reviewed recommendations, roles and per-raider slices.
const { applyReview } = require("../../utils/logcheck/recommendations");
const { canReview } = require("./recommendations");

function byName(list) {
    const m = new Map();
    for (const p of list || []) if (p && p.name) m.set(p.name, p);
    return m;
}

const ROLE_LABEL = { tank: "Tank", healer: "Heiler", dps: "DPS" };

/**
 * Everything the three views share, computed once: links, review rights, the
 * reviewed recommendations, each raider's role and the per-raider slices of
 * every raid-wide summary.
 */
function reportContext(report, user) {
    const idxByName = {};
    (report.roster || []).forEach((p, i) => { if (p && p.name) idxByName[p.name] = i; });
    const linkFor = (name) => (idxByName[name] !== undefined ? `/r/${report.id}/p/${idxByName[name]}` : null);
    const reviewer = canReview(user);
    const rec = report.recommendations ? applyReview(report.recommendations, report.recommendationReview) : null;
    const recItems = rec ? [...rec.raid, ...rec.players.flatMap((p) => p.items)] : [];
    const fights = (report.timeline && report.timeline.fights) || [];
    // Role: a healer of the healers' analysis, WCL's tank of any fight, else DPS; the RPB's roles fill in for a report without the timeline analyzers.
    const healers = new Set(((report.healers && report.healers.players) || []).map((p) => p.name));
    const tanks = new Set(fights.map((f) => f.healers && f.healers.tank && f.healers.tank.name).filter(Boolean));
    for (const [name, role] of Object.entries((report.rpb && report.rpb.roles) || {})) {
        if (role === "Tank") tanks.add(name);
        else if (role === "Healer") healers.add(name);
    }
    const roleOf = (name) => (tanks.has(name) ? "tank" : healers.has(name) ? "healer" : "dps");
    const rpb = report.rpb || {};
    return {
        report, user, linkFor, reviewer, rec, recItems, roleOf, fights,
        recByName: byName(rec ? rec.players : []),
        gearByName: byName(report.players),
        consByName: byName(report.consumables && report.consumables.players),
        potByName: byName(report.potions && report.potions.players),
        buffsByName: byName(report.raidBuffs && report.raidBuffs.players),
        healByName: byName(report.healers && report.healers.players),
        actByName: byName(report.activity && report.activity.players),
        cdByName: byName(report.cooldowns && report.cooldowns.players),
        totByName: byName(report.totems && report.totems.players),
        mechByName: byName(report.mechanics && report.mechanics.players),
        drumsByName: byName(report.drums && report.drums.players),
        srByName: byName(report.shadowResi && report.shadowResi.players),
        sunderByName: byName(report.sunder),
        rpbDmgByName: byName(rpb.damage && rpb.damage.players),
        rpbActByName: byName(rpb.activity && rpb.activity.players),
        rpbUseByName: byName(rpb.usage),
        rpbIntByName: byName(rpb.interrupts && rpb.interrupts.players),
        sent: report.recommendationSent || {},
    };
}

module.exports = {
    ROLE_LABEL, reportContext,
};
