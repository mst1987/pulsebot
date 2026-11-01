// The setup proposal (#262): raid groups, the pool of who is left (#517) and the
// orga's explicit bench, built from the signups,
// the raider profiles, attendance, earlier setups and the orga's fixed places.
//
// Always a proposal — a human approves it (#263). Pure and deterministic: the
// same input gives the same output, byte for byte; there is no clock and no
// randomness, ties are broken by signup order and then by user id.
//
// How: model.js indexes the input, score.js values a state (hard rules are
// walls, soft goals weighted), and the search here runs
//   1. fixed places first,
//   2. a greedy start — one leader per raid first (#1036: leaders are the
//      scarcest resource of a raid group), then scarce roles (the role with the fewest spare
//      candidates, and within it the raider with the fewest alternatives),
//      then every free place with whoever adds the most,
//   3. a local search — add, replace, switch role, move and swap between
//      groups (and between events that run in parallel) — accepting only
//      strict improvements, until none is left or MAX_PASSES is reached.
// reasons.js then says, for every raider, why they are where they are.

const { ROLES } = require("../../config/gameVersions");
const { buildModel, charKey } = require("./model");
const { makeScorer, resolveWeights } = require("./score");
const { buildOutput } = require("./reasons");

const SETUP_PROPOSAL_VERSION = 1;
const MAX_PASSES = 40;
const EPS = 1e-6;

// ---------------------------------------------------------------------------
// The search in phases (#431). Every phase works on one shared state `s`:
// `opt[c]` / `grp[c]` are the option and group of candidate c (-1 = not
// placed), `lockOpt` / `lockGrp` what the orga fixed, `banned` who is fixed on
// the bench, `current` the score of the state as it stands.
// ---------------------------------------------------------------------------

function newSearchState(model, scorer) {
    const n = model.cands.length;
    return {
        cands: model.cands,
        events: model.events,
        scorer,
        n,
        opt: new Int32Array(n).fill(-1),
        grp: new Int32Array(n).fill(-1),
        lockOpt: new Uint8Array(n),
        lockGrp: new Uint8Array(n),
        banned: new Uint8Array(n),
        current: 0,
    };
}

const isFree = (s, c) => s.opt[c] < 0 && !s.banned[c];

/** The event candidate c is placed in (c must be placed). */
const eventOf = (s, c) => s.cands[c].options[s.opt[c]].eventIdx;

/** Candidates placed in event e, by index. */
function placedIn(s, e) {
    const out = [];
    for (let c = 0; c < s.n; c++) if (s.opt[c] >= 0 && eventOf(s, c) === e) out.push(c);
    return out;
}

/**
 * Per raid what its minimum rules still lack: the places short of each role's minimum, then 1
 * when the raid has a leader rule and no leader (#1036). `[event][ROLES..., leader]`.
 */
function minimumGaps(s) {
    const counts = s.events.map(() => ({ roles: ROLES.map(() => 0), leaders: 0 }));
    for (let c = 0; c < s.n; c++) {
        if (s.opt[c] < 0) continue;
        const option = s.cands[c].options[s.opt[c]];
        const k = counts[option.eventIdx];
        k.roles[option.roleIdx]++;
        if (s.cands[c].leadsIn && s.cands[c].leadsIn.has(option.eventIdx)) k.leaders++;
    }
    return s.events.map((event, e) => [
        ...ROLES.map((r, i) => Math.max(0, event.limits[r].min - counts[e].roles[i])),
        event.leaderRule && counts[e].leaders === 0 ? 1 : 0,
    ]);
}

/** True when some raid lacks more for a minimum rule in `next` than in `prev`. */
const gapRises = (prev, next) => next.some((gaps, e) => gaps.some((v, i) => v > prev[e][i]));

/**
 * Try a change; keep it when it is strictly better. `changes`: [c, o, g][]. With `s.gaps`
 * (the loot phase, #1037) a change must also leave every raid's minimum gaps as they are or
 * smaller: loot outweighing a tank short in one raid must not hand that raid's tank to the other.
 */
function attempt(s, changes) {
    const before = changes.map(([c]) => [c, s.opt[c], s.grp[c]]);
    for (const [c, o, g] of changes) {
        s.opt[c] = o;
        s.grp[c] = g;
    }
    const score = s.scorer.evaluate(s.opt, s.grp);
    const gaps = score > s.current + EPS && s.gaps ? minimumGaps(s) : null;
    if (score > s.current + EPS && !(gaps && gapRises(s.gaps, gaps))) {
        s.current = score;
        if (gaps) s.gaps = gaps;
        return true;
    }
    for (const [c, o, g] of before) {
        s.opt[c] = o;
        s.grp[c] = g;
    }
    return false;
}

/** The best group of an event for c on option o, or null when none fits. */
function bestPlacement(s, c, o) {
    const e = s.cands[c].options[o].eventIdx;
    let best = null;
    for (let g = 0; g < s.events[e].groupCount; g++) {
        s.opt[c] = o;
        s.grp[c] = g;
        const score = s.scorer.evaluate(s.opt, s.grp);
        if (score > -Infinity && (!best || score > best.score + EPS)) best = { g, score };
    }
    s.opt[c] = -1;
    s.grp[c] = -1;
    return best;
}

// 1. fixed places ----------------------------------------------------------

/** The orga's fixed places; a fixed raider without a group goes to the emptiest one. */
function placeFixed(s) {
    const load = s.events.map((e) => new Array(e.groupCount).fill(0));
    const lockedLater = [];
    for (const c of s.cands) {
        // a shadowban (#981) keeps the raider out of every automatic placement - in the pool,
        // not on the bench; a place the orga fixed by hand stays theirs
        if (!c.fixed && c.shadowban) s.banned[c.idx] = 1;
        if (!c.fixed) continue;
        if (c.fixed.bench) {
            s.banned[c.idx] = 1;
            continue;
        }
        const o = c.options[c.fixed.option];
        s.opt[c.idx] = c.fixed.option;
        s.lockOpt[c.idx] = 1;
        if (c.fixed.group >= 0) {
            s.grp[c.idx] = c.fixed.group;
            s.lockGrp[c.idx] = 1;
            load[o.eventIdx][c.fixed.group]++;
        } else {
            lockedLater.push(c);
        }
    }
    for (const c of lockedLater) {
        const e = c.options[s.opt[c.idx]].eventIdx;
        const g = load[e].indexOf(Math.min(...load[e]));
        s.grp[c.idx] = g;
        load[e][g]++;
    }
}

// 2a. greedy: one leader per raid (#1036) -----------------------------------

/** Whether event e already has a placed raider who may lead it. */
function hasLeader(s, e) {
    for (let c = 0; c < s.n; c++) {
        if (s.opt[c] >= 0 && eventOf(s, c) === e && s.cands[c].leadsIn && s.cands[c].leadsIn.has(e)) return true;
    }
    return false;
}

/** The free candidates who may lead event e, by index. */
function freeLeaders(s, e) {
    return s.cands.filter((c) => isFree(s, c.idx) && c.leadsIn && c.leadsIn.has(e)).map((c) => c.idx);
}

/** c's best place in event e over all of c's options there, or null. */
function bestPlacementIn(s, c, e) {
    let best = null;
    for (const o of s.cands[c].options) {
        if (o.eventIdx !== e) continue;
        const place = bestPlacement(s, c, o.idx);
        if (place && (!best || place.score > best.score + EPS)) best = { o: o.idx, g: place.g, score: place.score };
    }
    return best;
}

/**
 * One leader per raid, in the raids' order (#1036): the first raid of a group
 * takes its leader first, so too few leaders leave the last raids without one.
 * Each raid takes the free leader who could lead the fewest other raids, on their
 * best place there; whoever leads stays a normal raider on a role seat.
 */
function greedyLeaders(s) {
    const open = s.events.filter((e) => e.leaderRule && !hasLeader(s, e.idx)).map((e) => e.idx);
    for (const e of open) {
        const pool = freeLeaders(s, e).sort((a, b) => s.cands[a].leadsIn.size - s.cands[b].leadsIn.size || a - b);
        for (const c of pool) {
            const best = bestPlacementIn(s, c, e);
            if (!best) continue;
            s.opt[c] = best.o;
            s.grp[c] = best.g;
            s.current = best.score;
            break;
        }
    }
}

// 2b. greedy: scarce roles first ---------------------------------------------

/** The roles an event asks a minimum of, the one with the fewest spare candidates first. */
function roleNeeds(s, event) {
    return ROLES
        .map((role) => {
            const supply = s.cands.filter((c) => isFree(s, c.idx) && c.options.some((o) => o.eventIdx === event.idx && o.role === role)).length;
            return { role, min: event.limits[role].min, spare: supply - event.limits[role].min };
        })
        .filter((r) => r.min > 0)
        .sort((a, b) => a.spare - b.spare || ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
}

/** Free candidates who can play `role` in the event, the one with the fewest alternatives first. */
function rolePool(s, event, role) {
    return s.cands
        .filter((c) => isFree(s, c.idx))
        .map((c) => {
            const o = c.options.find((x) => x.eventIdx === event.idx && x.role === role);
            if (!o) return null;
            const flex = new Set(c.options.filter((x) => x.eventIdx === event.idx).map((x) => x.role)).size;
            return { c: c.idx, o: o.idx, bench: o.status === "bench" ? 1 : 0, flex, value: o.static };
        })
        .filter(Boolean)
        .sort((a, b) => a.bench - b.bench || a.flex - b.flex || b.value - a.value || a.c - b.c);
}

function fillRole(s, event, role, min) {
    let count = s.cands.filter((c) => s.opt[c.idx] >= 0 && c.options[s.opt[c.idx]].eventIdx === event.idx && c.options[s.opt[c.idx]].role === role).length;
    for (const p of rolePool(s, event, role)) {
        if (count >= min) break;
        if (!isFree(s, p.c)) continue;
        const place = bestPlacement(s, p.c, p.o);
        if (!place || place.score <= s.current + EPS) continue;
        s.opt[p.c] = p.o;
        s.grp[p.c] = place.g;
        s.current = place.score;
        count++;
    }
}

function greedyScarceRoles(s) {
    for (const event of s.events) {
        for (const { role, min } of roleNeeds(s, event)) fillRole(s, event, role, min);
    }
}

// 2c. greedy: every free place with whoever adds the most -------------------

/** The emptiest group of event e (cheap stand-in for the best one). */
function emptiestGroup(s, e) {
    const sizes = new Array(s.events[e].groupCount).fill(0);
    for (let x = 0; x < s.n; x++) {
        if (s.opt[x] >= 0 && eventOf(s, x) === e) sizes[s.grp[x]]++;
    }
    return sizes.indexOf(Math.min(...sizes));
}

/** The free candidate and option that raise the score the most, or null. */
function bestAddition(s) {
    let best = null;
    for (let c = 0; c < s.n; c++) {
        if (!isFree(s, c)) continue;
        for (const o of s.cands[c].options) {
            const g = emptiestGroup(s, o.eventIdx);
            s.opt[c] = o.idx;
            s.grp[c] = g;
            const score = s.scorer.evaluate(s.opt, s.grp);
            s.opt[c] = -1;
            s.grp[c] = -1;
            if (score > s.current + EPS && (!best || score > best.score + EPS)) best = { c, o: o.idx, score };
        }
    }
    return best;
}

function greedyFill(s) {
    for (let best = bestAddition(s); best; best = bestAddition(s)) {
        const place = bestPlacement(s, best.c, best.o);
        s.opt[best.c] = best.o;
        s.grp[best.c] = place.g;
        s.current = place.score;
    }
}

// 3. local search moves — each returns whether it improved the state ---------

/** Add a free raider to any group. */
function tryAdd(s) {
    let improved = false;
    for (let c = 0; c < s.n; c++) {
        if (!isFree(s, c)) continue;
        for (const o of s.cands[c].options) {
            if (!isFree(s, c)) break;
            for (let g = 0; g < s.events[o.eventIdx].groupCount; g++) {
                if (attempt(s, [[c, o.idx, g]])) {
                    improved = true;
                    break;
                }
            }
        }
    }
    return improved;
}

/** Replace a placed raider with one who is not. */
function tryReplace(s) {
    let improved = false;
    for (let c = 0; c < s.n; c++) {
        if (s.opt[c] < 0 || s.lockOpt[c]) continue;
        for (let d = 0; d < s.n && !s.lockOpt[c] && s.opt[c] >= 0; d++) {
            if (!isFree(s, d)) continue;
            const e = eventOf(s, c);
            for (const o of s.cands[d].options) {
                if (o.eventIdx !== e) continue;
                if (attempt(s, [[c, -1, -1], [d, o.idx, s.grp[c]]])) {
                    improved = true;
                    break;
                }
            }
            if (s.opt[c] < 0) break;
        }
    }
    return improved;
}

/** Switch a placed raider's role (or event), alone. */
function trySwitchRole(s) {
    let improved = false;
    for (let c = 0; c < s.n; c++) {
        if (s.opt[c] < 0 || s.lockOpt[c]) continue;
        const options = s.cands[c].options;
        for (const o of options) {
            if (o.idx === s.opt[c]) continue;
            const groups = s.events[o.eventIdx].groupCount;
            let done = false;
            for (let g = 0; g < groups && !done; g++) {
                if (s.lockGrp[c] && (g !== s.grp[c] || o.eventIdx !== options[s.opt[c]].eventIdx)) continue;
                if (attempt(s, [[c, o.idx, g]])) done = true;
            }
            if (done) {
                improved = true;
                break;
            }
        }
    }
    return improved;
}

/** Whether any event still lacks the minimum of a role. */
function roleShort(s) {
    return s.events.some((e, i) => ROLES.some((r) => placedIn(s, i).filter((c) => s.cands[c].options[s.opt[c]].role === r).length < e.limits[r].min));
}

/** c switches to option o and somebody free takes the role c leaves; true once one pair works. */
function handOverRole(s, c, o) {
    const cands = s.cands;
    for (let d = 0; d < s.n; d++) {
        if (!isFree(s, d)) continue;
        for (const od of cands[d].options) {
            if (od.eventIdx !== o.eventIdx || od.role !== cands[c].options[s.opt[c]].role) continue;
            for (let g = 0; g < s.events[o.eventIdx].groupCount; g++) {
                if (attempt(s, [[c, o.idx, s.grp[c]], [d, od.idx, g]])) return true;
            }
        }
    }
    return false;
}

/** Switch a placed raider's role together with somebody new taking the role that frees up. */
function trySwitchWithHandover(s) {
    let improved = false;
    for (let c = 0; c < s.n; c++) {
        if (s.opt[c] < 0 || s.lockOpt[c]) continue;
        let done = false;
        for (const o of s.cands[c].options) {
            if (done || o.idx === s.opt[c] || o.eventIdx !== eventOf(s, c)) continue;
            done = handOverRole(s, c, o);
        }
        if (done) improved = true;
    }
    return improved;
}

/** Move raiders of event e to another group. */
function tryMoveInEvent(s, e) {
    let improved = false;
    for (const c of placedIn(s, e)) {
        if (s.lockGrp[c]) continue;
        for (let g = 0; g < s.events[e].groupCount; g++) {
            if (g === s.grp[c]) continue;
            if (attempt(s, [[c, s.opt[c], g]])) {
                improved = true;
                break;
            }
        }
    }
    return improved;
}

/** Swap two raiders of event e between their groups. */
function trySwapInEvent(s, e) {
    let improved = false;
    const members = placedIn(s, e);
    for (let i = 0; i < members.length; i++) {
        const a = members[i];
        if (s.lockGrp[a]) continue;
        for (let j = i + 1; j < members.length; j++) {
            const b = members[j];
            if (s.lockGrp[b] || s.grp[a] === s.grp[b]) continue;
            if (attempt(s, [[a, s.opt[a], s.grp[b]], [b, s.opt[b], s.grp[a]]])) improved = true;
        }
    }
    return improved;
}

/** Move and swap between groups, event by event. */
function tryGroupMoves(s) {
    let improved = false;
    for (let e = 0; e < s.events.length; e++) {
        if (tryMoveInEvent(s, e)) improved = true;
        if (trySwapInEvent(s, e)) improved = true;
    }
    return improved;
}

/** The same place as `o` - character, spec and role - in another event. */
const samePlace = (o, x) => x.role === o.role && x.spec === o.spec && charKey(x.character) === charKey(o.character);

/**
 * Swap raiders a and b between their (different) events, each on an option of the other's event.
 * `keep` (the arrange phase, #1038): each keeps the character, spec and role it plays - only the
 * event changes, so loot and balance never trade a tank for a damage dealer.
 */
function swapAcrossEvents(s, a, b, keep = false) {
    const ea = eventOf(s, a);
    const eb = eventOf(s, b);
    if (ea === eb) return false;
    const curA = s.cands[a].options[s.opt[a]];
    const curB = s.cands[b].options[s.opt[b]];
    const oa = s.cands[a].options.filter((o) => o.eventIdx === eb && (!keep || samePlace(curA, o)));
    const ob = s.cands[b].options.filter((o) => o.eventIdx === ea && (!keep || samePlace(curB, o)));
    let done = false;
    for (const x of oa) {
        for (const y of ob) {
            if (!done && attempt(s, [[a, x.idx, s.grp[b]], [b, y.idx, s.grp[a]]])) done = true;
        }
    }
    return done;
}

/** Swap two raiders between parallel events (`keep`: see swapAcrossEvents). */
function tryEventSwaps(s, keep = false) {
    let improved = false;
    for (let a = 0; a < s.n; a++) {
        if (s.opt[a] < 0 || s.lockOpt[a]) continue;
        for (let b = a + 1; b < s.n; b++) {
            if (s.opt[b] < 0 || s.lockOpt[b] || s.opt[a] < 0) continue;
            if (swapAcrossEvents(s, a, b, keep)) improved = true;
        }
    }
    return improved;
}

/** One pass of every local-search move, in a fixed order; true when any improved. */
function localSearchPass(s) {
    let improved = false;
    if (tryAdd(s)) improved = true;
    if (tryReplace(s)) improved = true;
    if (trySwitchRole(s)) improved = true;
    if (roleShort(s) && trySwitchWithHandover(s)) improved = true;
    if (tryGroupMoves(s)) improved = true;
    if (s.events.length > 1 && tryEventSwaps(s)) improved = true;
    return improved;
}

/**
 * The arrange phase - loot (#1037) and balance (#1038): only moves that keep the same people
 * placed - a swap between the parallel raids and moves between groups. Loot and balance decide
 * who plays in which raid, never who gets a place: the first phase settled that without them.
 * A swap between raids keeps everybody's character, spec and role from the first phase.
 * Both weigh in one score that has to rise strictly with every move, so they cannot trade a
 * raider back and forth, and MAX_PASSES ends it in any case.
 */
function lootPass(s) {
    let improved = false;
    if (tryEventSwaps(s, true)) improved = true;
    if (tryGroupMoves(s)) improved = true;
    return improved;
}

/**
 * The search. With loot or balance (`lootScorer`, the scorer with both) it runs twice over:
 * first without them - who is placed, who stays in the pool -, then the arrange phase on top
 * with only the moves of `lootPass`, so pool and bench come out the same with and without them.
 */
function search(model, scorer, lootScorer) {
    const s = newSearchState(model, scorer);
    placeFixed(s);
    s.current = scorer.evaluate(s.opt, s.grp);
    greedyLeaders(s);
    greedyScarceRoles(s);
    greedyFill(s);
    for (let pass = 0; pass < MAX_PASSES; pass++) {
        if (!localSearchPass(s)) break;
    }
    if (lootScorer) {
        s.scorer = lootScorer;
        s.current = lootScorer.evaluate(s.opt, s.grp);
        s.gaps = minimumGaps(s);
        for (let pass = 0; pass < MAX_PASSES; pass++) {
            if (!lootPass(s)) break;
        }
    }
    return { opt: s.opt, grp: s.grp, lockOpt: s.lockOpt, lockGrp: s.lockGrp, banned: s.banned, score: s.current };
}

/**
 * Build a setup proposal.
 *
 * @param {object} input
 * @param {string} [input.versionId]  rule set ("tbc" | "classic" | "forever")
 * @param {object[]} input.events  `{ id, title, size, composition: { tank, healer, melee, ranged },
 *   requiredBuffs, fairness, wishes }` — one event, or several that run in parallel and share the
 *   raiders; `input.event` for a single one. tank/healer are exact targets, melee/ranged a
 *   number (minimum) or `{ min, max }`.
 * @param {object[]} input.signups  `{ eventId, userId, character, spec, status, characters, canAlso, comment, at }`
 *   (signupStore shape; `eventId` may be left out with one event). `characters` are the raider's
 *   own characters in priority order (#293), each with its **own status** (#320): a first choice
 *   on "Spät" beside an alternate on "Dabei" makes the alternate the better option. An absence
 *   stays a matter for the whole person.
 * @param {object[]|object} [input.profiles]  raiderProfileStore profiles (array or by user id)
 * @param {object} [input.attendance]  `{ [userId]: pct | { pct } }`
 * @param {object} [input.rosterStatus]  `{ [userId]: "core" | "trial" | "bench" | "pause" }` — the roster of the
 *   event's category (#658); core before trial before bench, everyone else after. Empty without a roster.
 * @param {object[]} [input.history]  earlier nights: `{ eventId, startTime, placed: userId[], bench: userId[] }`
 * @param {object[]} [input.fixed]  the orga's fixed places: `{ userId, eventId?, group? (1-based), spec?, role? }`
 *   or `{ userId, bench: true }`
 * @param {object} [options]
 * @param {object} [options.weights]  overrides of DEFAULT_WEIGHTS (0 = off)
 * @param {boolean} [options.fairness]  overrides every event's fairness flag
 * @param {boolean} [options.wishes]  overrides every event's wishes flag
 * @param {boolean} [options.avoid]  keep "nicht zusammen" pairs apart — off unless true; no event flag,
 *   the orga is asked each time (`checks.avoid` counts the pairs either way, never names them)
 *
 * @returns {{
 *   version: number,
 *   versionId: string,
 *   groups: { index: number, slots: Slot[] }[],
 *   bench: BenchEntry[],
 *   pool: BenchEntry[],
 *   checks: { ok: boolean, size: object, roles: object, buffs: object, wishes: { met: number, total: number, pairs: object[] } },
 *   events: { eventId: string, title: string, groups: object[], bench: BenchEntry[], checks: object, score: number }[],
 *   weights: object,
 *   score: { total: number, parts: object },
 *   warnings: string[],
 * }}
 * Slot = `{ userId, character, classId, spec, role, main, status, locked, reasons: string[] }`,
 * BenchEntry = `{ userId, character, classId, spec, role, status, eventIds, locked, reasons: string[] }`.
 * `groups`/`checks` are the first (usually only) event's; with parallel events each has its own
 * entry in `events`, and `checks.wishes` counts across all of them. Who is in no group is split
 * (#517): `bench` only holds who the orga fixed there (`{ userId, bench: true }`), `pool` (the
 * editor's "Angemeldet") everybody else — a proposal never puts anybody on the bench by itself.
 */
function buildSetupProposal(input = {}, options = {}) {
    const { model, effective } = prepare(input, options);
    if (!(effective.loot > 0) && !(effective.balance > 0)) {
        const scorer = makeScorer(model);
        return buildOutput(model, scorer, search(model, scorer), { version: SETUP_PROPOSAL_VERSION, weights: effective });
    }
    // #1037/#1038: the places are settled without loot and balance, the full scorer only arranges the raids
    const placeScorer = makeScorer({ ...model, weights: { ...model.weights, loot: 0, balance: 0 } });
    const lootScorer = makeScorer(model);
    const state = search(model, placeScorer, lootScorer);
    return buildOutput(model, lootScorer, state, { version: SETUP_PROPOSAL_VERSION, weights: effective });
}

/** The model with the run's overrides applied, and the weights in effect. */
function prepare(input, options) {
    const weights = resolveWeights(options.weights);
    const model = buildModel(input, weights);
    if (typeof options.fairness === "boolean") model.fairnessOverride = options.fairness;
    if (typeof options.wishes === "boolean") model.wishesOverride = options.wishes;
    model.avoidOverride = options.avoid === true;
    const effective = { ...weights };
    if (!model.avoidOverride) effective.avoid = 0;
    const fairOn = model.fairnessOverride !== undefined ? model.fairnessOverride : model.events.some((e) => e.fairness);
    const wishOn = model.wishesOverride !== undefined ? model.wishesOverride : model.events.some((e) => e.wishes);
    if (!fairOn) effective.fairness = 0;
    if (!wishOn) effective.wishes = 0;
    // without a roster in the category (#658) nobody has a status: the weight does nothing
    if (!model.hasRoster) effective.roster = 0;
    // loot (#1037) only with parallel raids and loaded data of the raid's version (model.js)
    if (!model.lootOn) effective.loot = 0;
    // balance (#1038) only with parallel raids - one raid has nothing to even out
    if (!model.balanceOn) effective.balance = 0;
    return { model, effective };
}

/**
 * Value a setup the orga arranged by hand (#263). No search: every placed
 * raider stays exactly where they are, and the output — checks, reasons, score
 * — has the same shape as a proposal, so the editor reads both alike.
 *
 * `placement` = `{ groups: [{ index, slots: [{ userId, spec, role?, locked? }] }], bench: [{ userId, locked? }] }`
 * for the first event of `input`; `others` (`[{ eventId, groups }]`, #1037) places the further events
 * of `input` the same way, so a raid group is valued as a whole. Every bench entry stays on the bench (#517);
 * a signup in neither list comes back in `pool`. manual.js validates it first; a placement
 * that still breaks a hard rule throws.
 */
function evaluateSetup(input = {}, placement = {}, options = {}) {
    const events = Array.isArray(input.events) ? input.events : (input.event ? [input.event] : []);
    const eventId = events.length ? String(events[0].id || "") : "";
    const locked = new Set();
    const fixed = [];
    for (const g of Array.isArray(placement.groups) ? placement.groups : []) {
        for (const s of Array.isArray(g.slots) ? g.slots : []) {
            fixed.push({ userId: String(s.userId), eventId, group: Number(g.index), spec: s.spec || "", role: s.role || "", character: s.character || "" });
            if (s.locked) locked.add(String(s.userId));
        }
    }
    // #1037: the other raids of a raid group as they stand (`others: [{ eventId, groups }]`), after
    // this raid's places - the first fixation of a raider wins (model.applyFixed)
    for (const other of Array.isArray(placement.others) ? placement.others : []) {
        for (const g of Array.isArray(other && other.groups) ? other.groups : []) {
            for (const s of Array.isArray(g.slots) ? g.slots : []) {
                fixed.push({ userId: String(s.userId), eventId: String(other.eventId), group: Number(g.index), spec: s.spec || "", role: s.role || "", character: s.character || "" });
            }
        }
    }
    // #517: every bench entry is the orga's explicit choice; who is neither placed nor benched is the pool
    for (const b of Array.isArray(placement.bench) ? placement.bench : []) {
        if (b && b.userId) fixed.push({ userId: String(b.userId), bench: true, locked: !!b.locked, ...(b.character ? { character: String(b.character) } : {}) });
    }
    const { model, effective } = prepare({ ...input, fixed }, options);
    const n = model.cands.length;
    const state = {
        opt: new Int32Array(n).fill(-1),
        grp: new Int32Array(n).fill(-1),
        lockOpt: new Uint8Array(n),
        lockGrp: new Uint8Array(n),
        banned: new Uint8Array(n),
    };
    for (const c of model.cands) {
        if (!c.fixed) continue;
        if (c.fixed.bench) {
            state.banned[c.idx] = 1;
            continue;
        }
        if (c.fixed.group < 0) throw new Error(`Kein Platz für ${c.name || c.userId}.`);
        state.opt[c.idx] = c.fixed.option;
        state.grp[c.idx] = c.fixed.group;
        if (locked.has(c.userId)) {
            state.lockOpt[c.idx] = 1;
            state.lockGrp[c.idx] = 1;
        }
    }
    const scorer = makeScorer(model);
    state.score = scorer.evaluate(state.opt, state.grp);
    if (state.score === -Infinity) throw new Error("Die Aufstellung verletzt eine feste Regel.");
    return buildOutput(model, scorer, state, { version: SETUP_PROPOSAL_VERSION, weights: effective });
}

module.exports = { buildSetupProposal, evaluateSetup, SETUP_PROPOSAL_VERSION, MAX_PASSES };
