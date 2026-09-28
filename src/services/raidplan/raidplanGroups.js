// Which raiders of the setup the raid plan works with (#529): "Gruppen im Plan". The plan stores the setup groups it takes
// (`includedGroups`, a list of group numbers plus optionally "bench"); `null` = the default, the groups up to the raid's size
// (25 = groups 1..5) without the bench. The pool ("Angemeldet", #517) is never part of a lineup the plan reads, so it never comes in.
//
// Every reader that PICKS raiders goes through `planRoster` - the Besetzung, the class references and priorities (expandClassRefs),
// the suggestions, the auto tokens, "Nicht platziert", the read view. The whole lineup stays what a save may name (a bench raider
// the orga put into a row by name keeps his place, the editor marks him "nicht im Plan"). The client twin is
// src/web-client/src/lib/raidplan/planGroups.ts (the same cases in test/services/raidplan/raidplanGroups.test.js and planGroups.test.ts).

const { fillSlots } = require("./raidplanBoard");

const BENCH = "bench";
// 40 players = 8 groups: no raid has more
const MAX_GROUPS = 8;

/** The groups a raid of `groupCount` groups plans with by default: 1..groupCount, no bench. */
function defaultIncludedGroups(groupCount) {
    const n = Math.max(1, Math.min(MAX_GROUPS, Math.floor(Number(groupCount) || 0) || 1));
    return Array.from({ length: n }, (_, i) => i + 1);
}

/**
 * A stored or sent value, cleaned: group numbers 1..8 (each once, ascending) and "bench"; anything else is dropped. `null` (not a list)
 * = the default. An empty list stays empty (the orga switched every group off).
 */
function cleanIncludedGroups(raw) {
    if (!Array.isArray(raw)) return null;
    const nums = new Set();
    let bench = false;
    for (const v of raw.slice(0, 20)) {
        if (v === BENCH) { bench = true; continue; }
        const n = typeof v === "number" || (typeof v === "string" && /^\d{1,2}$/.test(v)) ? Number(v) : NaN;
        if (Number.isInteger(n) && n >= 1 && n <= MAX_GROUPS) nums.add(n);
    }
    const out = [...nums].sort((a, b) => a - b);
    return bench ? [...out, BENCH] : out;
}

/** The groups a plan works with: what it stores, else the default for its size. */
function includedGroups(stored, groupCount) {
    const clean = cleanIncludedGroups(stored);
    return clean === null ? defaultIncludedGroups(groupCount) : clean;
}

/** The group numbers of a selection (without "bench"): what a heal row of the suggestions spreads over. */
function groupNumbers(included) {
    return (included || []).filter((v) => typeof v === "number");
}

/**
 * Whether a raider of the lineup is part of the plan: a bench raider only with "bench", a raider of a group only when that group is on.
 * A raider Raid-Helper no longer lists (`gone`) and one without a group of his own (group 0, not bench) stay: they are marked otherwise.
 */
function inPlan(player, included) {
    if (!player) return false;
    if (player.gone) return true;
    const list = included || [];
    if (player.bench) return list.includes(BENCH);
    const g = Number(player.group) || 0;
    return g === 0 || list.includes(g);
}

/** The raiders the plan picks from, in setup order. */
function planRoster(roster, included) {
    return (roster || []).filter((p) => inPlan(p, included));
}

/** The raiders of the lineup outside the plan, marked `outOfPlan` (a row that names one keeps him, with a warning). */
function outOfPlanRoster(roster, included) {
    return (roster || []).filter((p) => !inPlan(p, included)).map((p) => ({ ...p, outOfPlan: true }));
}

/**
 * The role slots of a board with everybody outside the plan taken out and ONLY those places filled again from the plan's raiders
 * (raidplanBoard.fillSlots: the slot's classes first, then the role; a flex role of this board counts). A slot the orga left open stays
 * open, a slot with a raider of the plan keeps him. The editor does the same (lib/raidplan/besetzung.ts ensureBesetzung), so the read
 * view shows what the editor shows before anybody saves. Returns the same list when nobody is outside.
 */
function refillSlots(slots, roster, roles = {}, busy = []) {
    const list = Array.isArray(slots) ? slots : [];
    const ids = new Set((roster || []).map((p) => p.userId));
    const vacated = new Set();
    const cleared = list.map((s, i) => {
        if (!s || !s.userId || ids.has(s.userId)) return s;
        vacated.add(i);
        return { ...s, userId: "" };
    });
    if (vacated.size === 0) return list;
    // only the vacated places and the taken ones go into the fill: an open place the orga left open is not touched
    const idx = cleared.map((s, i) => i).filter((i) => vacated.has(i) || (cleared[i] && cleared[i].userId));
    const flex = roles && typeof roles === "object" ? roles : {};
    const away = new Set(busy || []);
    const players = (roster || []).filter((p) => !away.has(p.userId)).map((p) => (flex[p.userId] ? { ...p, role: flex[p.userId] } : p));
    const filled = fillSlots(idx.map((i) => cleared[i]), players);
    const out = cleared.slice();
    idx.forEach((i, k) => { out[i] = filled[k]; });
    return out;
}

module.exports = { BENCH, MAX_GROUPS, defaultIncludedGroups, cleanIncludedGroups, includedGroups, groupNumbers, inPlan, planRoster, outOfPlanRoster, refillSlots };
