// The setup proposal (#262): raid groups and a bench, built from the signups,
// the raider profiles, attendance, earlier setups and the orga's fixed places.
//
// Always a proposal — a human approves it (#263). Pure and deterministic: the
// same input gives the same output, byte for byte; there is no clock and no
// randomness, ties are broken by signup order and then by user id.
//
// How: model.js indexes the input, score.js values a state (hard rules are
// walls, soft goals weighted), and the search here runs
//   1. fixed places first,
//   2. a greedy start — scarce roles first (the role with the fewest spare
//      candidates, and within it the raider with the fewest alternatives),
//      then every free place with whoever adds the most,
//   3. a local search — add, replace, switch role, move and swap between
//      groups (and between events that run in parallel) — accepting only
//      strict improvements, until none is left or MAX_PASSES is reached.
// reasons.js then says, for every raider, why they are where they are.

const { ROLES } = require("../../config/gameVersions");
const { buildModel } = require("./model");
const { makeScorer, resolveWeights } = require("./score");
const { buildOutput } = require("./reasons");

const SETUP_PROPOSAL_VERSION = 1;
const MAX_PASSES = 40;
const EPS = 1e-6;

function search(model, scorer) {
    const { cands, events } = model;
    const n = cands.length;
    const opt = new Int32Array(n).fill(-1);
    const grp = new Int32Array(n).fill(-1);
    const lockOpt = new Uint8Array(n);
    const lockGrp = new Uint8Array(n);
    const banned = new Uint8Array(n);

    const groupLoad = () => events.map((e) => new Array(e.groupCount).fill(0));

    // 1. fixed places
    const load = groupLoad();
    const lockedLater = [];
    for (const c of cands) {
        if (!c.fixed) continue;
        if (c.fixed.bench) {
            banned[c.idx] = 1;
            continue;
        }
        const o = c.options[c.fixed.option];
        opt[c.idx] = c.fixed.option;
        lockOpt[c.idx] = 1;
        if (c.fixed.group >= 0) {
            grp[c.idx] = c.fixed.group;
            lockGrp[c.idx] = 1;
            load[o.eventIdx][c.fixed.group]++;
        } else {
            lockedLater.push(c);
        }
    }
    for (const c of lockedLater) {
        const e = c.options[opt[c.idx]].eventIdx;
        const g = load[e].indexOf(Math.min(...load[e]));
        grp[c.idx] = g;
        load[e][g]++;
    }

    let current = scorer.evaluate(opt, grp);

    /** Try a change; keep it when it is strictly better. `changes`: [c, o, g][]. */
    function attempt(changes) {
        const before = changes.map(([c]) => [c, opt[c], grp[c]]);
        for (const [c, o, g] of changes) {
            opt[c] = o;
            grp[c] = g;
        }
        const score = scorer.evaluate(opt, grp);
        if (score > current + EPS) {
            current = score;
            return true;
        }
        for (const [c, o, g] of before) {
            opt[c] = o;
            grp[c] = g;
        }
        return false;
    }

    /** The best group of an event for c on option o, or null when none fits. */
    function bestPlacement(c, o) {
        const e = cands[c].options[o].eventIdx;
        let best = null;
        for (let g = 0; g < events[e].groupCount; g++) {
            opt[c] = o;
            grp[c] = g;
            const score = scorer.evaluate(opt, grp);
            if (score > -Infinity && (!best || score > best.score + EPS)) best = { g, score };
        }
        opt[c] = -1;
        grp[c] = -1;
        return best;
    }

    const free = (c) => opt[c] < 0 && !banned[c];

    // 2a. greedy: scarce roles first
    for (const event of events) {
        const need = ROLES
            .map((role) => {
                const supply = cands.filter((c) => free(c.idx) && c.options.some((o) => o.eventIdx === event.idx && o.role === role)).length;
                return { role, min: event.limits[role].min, spare: supply - event.limits[role].min };
            })
            .filter((r) => r.min > 0)
            .sort((a, b) => a.spare - b.spare || ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
        for (const { role, min } of need) {
            const placedInRole = () => cands.filter((c) => opt[c.idx] >= 0 && c.options[opt[c.idx]].eventIdx === event.idx && c.options[opt[c.idx]].role === role).length;
            let count = placedInRole();
            const pool = cands
                .filter((c) => free(c.idx))
                .map((c) => {
                    const o = c.options.find((x) => x.eventIdx === event.idx && x.role === role);
                    if (!o) return null;
                    const flex = new Set(c.options.filter((x) => x.eventIdx === event.idx).map((x) => x.role)).size;
                    return { c: c.idx, o: o.idx, bench: o.status === "bench" ? 1 : 0, flex, value: o.static };
                })
                .filter(Boolean)
                .sort((a, b) => a.bench - b.bench || a.flex - b.flex || b.value - a.value || a.c - b.c);
            for (const p of pool) {
                if (count >= min) break;
                if (!free(p.c)) continue;
                const place = bestPlacement(p.c, p.o);
                if (!place || place.score <= current + EPS) continue;
                opt[p.c] = p.o;
                grp[p.c] = place.g;
                current = place.score;
                count++;
            }
        }
    }

    // 2b. greedy: every free place with whoever adds the most
    for (;;) {
        let best = null;
        for (let c = 0; c < n; c++) {
            if (!free(c)) continue;
            for (const o of cands[c].options) {
                const e = o.eventIdx;
                // cheap pass: the emptiest group of the event
                const sizes = new Array(events[e].groupCount).fill(0);
                for (let x = 0; x < n; x++) {
                    if (opt[x] >= 0 && cands[x].options[opt[x]].eventIdx === e) sizes[grp[x]]++;
                }
                const g = sizes.indexOf(Math.min(...sizes));
                opt[c] = o.idx;
                grp[c] = g;
                const score = scorer.evaluate(opt, grp);
                opt[c] = -1;
                grp[c] = -1;
                if (score > current + EPS && (!best || score > best.score + EPS)) best = { c, o: o.idx, score };
            }
        }
        if (!best) break;
        const place = bestPlacement(best.c, best.o);
        opt[best.c] = best.o;
        grp[best.c] = place.g;
        current = place.score;
    }

    // 3. local search
    const placedIn = (e) => {
        const out = [];
        for (let c = 0; c < n; c++) if (opt[c] >= 0 && cands[c].options[opt[c]].eventIdx === e) out.push(c);
        return out;
    };
    for (let pass = 0; pass < MAX_PASSES; pass++) {
        let improved = false;

        // add a raider to any group
        for (let c = 0; c < n; c++) {
            if (!free(c)) continue;
            for (const o of cands[c].options) {
                if (!free(c)) break;
                for (let g = 0; g < events[o.eventIdx].groupCount; g++) {
                    if (attempt([[c, o.idx, g]])) {
                        improved = true;
                        break;
                    }
                }
            }
        }

        // replace a placed raider with one who is not
        for (let c = 0; c < n; c++) {
            if (opt[c] < 0 || lockOpt[c]) continue;
            for (let d = 0; d < n && !lockOpt[c] && opt[c] >= 0; d++) {
                if (!free(d)) continue;
                const e = cands[c].options[opt[c]].eventIdx;
                for (const o of cands[d].options) {
                    if (o.eventIdx !== e) continue;
                    if (attempt([[c, -1, -1], [d, o.idx, grp[c]]])) {
                        improved = true;
                        break;
                    }
                }
                if (opt[c] < 0) break;
            }
        }

        // switch a placed raider's role (or event) — alone, or together with
        // somebody new taking the role that frees up
        for (let c = 0; c < n; c++) {
            if (opt[c] < 0 || lockOpt[c]) continue;
            const options = cands[c].options;
            for (const o of options) {
                if (o.idx === opt[c]) continue;
                const groups = events[o.eventIdx].groupCount;
                let done = false;
                for (let g = 0; g < groups && !done; g++) {
                    if (lockGrp[c] && (g !== grp[c] || o.eventIdx !== options[opt[c]].eventIdx)) continue;
                    if (attempt([[c, o.idx, g]])) done = true;
                }
                if (done) {
                    improved = true;
                    break;
                }
            }
        }
        if (events.some((e, i) => ROLES.some((r) => placedIn(i).filter((c) => cands[c].options[opt[c]].role === r).length < e.limits[r].min))) {
            for (let c = 0; c < n; c++) {
                if (opt[c] < 0 || lockOpt[c]) continue;
                let done = false;
                for (const o of cands[c].options) {
                    if (done || o.idx === opt[c] || o.eventIdx !== cands[c].options[opt[c]].eventIdx) continue;
                    for (let d = 0; d < n && !done; d++) {
                        if (!free(d)) continue;
                        for (const od of cands[d].options) {
                            if (od.eventIdx !== o.eventIdx || od.role !== cands[c].options[opt[c]].role) continue;
                            for (let g = 0; g < events[o.eventIdx].groupCount && !done; g++) {
                                if (attempt([[c, o.idx, grp[c]], [d, od.idx, g]])) done = true;
                            }
                            if (done) break;
                        }
                    }
                }
                if (done) improved = true;
            }
        }

        // move between groups, swap between groups
        for (let e = 0; e < events.length; e++) {
            for (const c of placedIn(e)) {
                if (lockGrp[c]) continue;
                for (let g = 0; g < events[e].groupCount; g++) {
                    if (g === grp[c]) continue;
                    if (attempt([[c, opt[c], g]])) {
                        improved = true;
                        break;
                    }
                }
            }
            const members = placedIn(e);
            for (let i = 0; i < members.length; i++) {
                const a = members[i];
                if (lockGrp[a]) continue;
                for (let j = i + 1; j < members.length; j++) {
                    const b = members[j];
                    if (lockGrp[b] || grp[a] === grp[b]) continue;
                    if (attempt([[a, opt[a], grp[b]], [b, opt[b], grp[a]]])) improved = true;
                }
            }
        }

        // swap two raiders between parallel events
        if (events.length > 1) {
            for (let a = 0; a < n; a++) {
                if (opt[a] < 0 || lockOpt[a]) continue;
                for (let b = a + 1; b < n; b++) {
                    if (opt[b] < 0 || lockOpt[b] || opt[a] < 0) continue;
                    const ea = cands[a].options[opt[a]].eventIdx;
                    const eb = cands[b].options[opt[b]].eventIdx;
                    if (ea === eb) continue;
                    const oa = cands[a].options.filter((o) => o.eventIdx === eb);
                    const ob = cands[b].options.filter((o) => o.eventIdx === ea);
                    let done = false;
                    for (const x of oa) {
                        for (const y of ob) {
                            if (!done && attempt([[a, x.idx, grp[b]], [b, y.idx, grp[a]]])) done = true;
                        }
                    }
                    if (done) improved = true;
                }
            }
        }

        if (!improved) break;
    }

    return { opt, grp, lockOpt, lockGrp, banned, score: current };
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
 *   checks: { ok: boolean, size: object, roles: object, buffs: object, wishes: { met: number, total: number, pairs: object[] } },
 *   events: { eventId: string, title: string, groups: object[], bench: BenchEntry[], checks: object, score: number }[],
 *   weights: object,
 *   score: { total: number, parts: object },
 *   warnings: string[],
 * }}
 * Slot = `{ userId, character, classId, spec, role, main, status, locked, reasons: string[] }`,
 * BenchEntry = `{ userId, character, classId, spec, role, status, eventIds, locked, reasons: string[] }`.
 * `groups`/`checks` are the first (usually only) event's; with parallel events each has its own
 * entry in `events`, `bench` lists who is in none, and `checks.wishes` counts across all of them.
 */
function buildSetupProposal(input = {}, options = {}) {
    const { model, effective } = prepare(input, options);
    const scorer = makeScorer(model);
    const state = search(model, scorer);
    return buildOutput(model, scorer, state, { version: SETUP_PROPOSAL_VERSION, weights: effective });
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
    return { model, effective };
}

/**
 * Value a setup the orga arranged by hand (#263). No search: every placed
 * raider stays exactly where they are, and the output — checks, reasons, score
 * — has the same shape as a proposal, so the editor reads both alike.
 *
 * `placement` = `{ groups: [{ index, slots: [{ userId, spec, role?, locked? }] }], bench: [{ userId, locked? }] }`
 * for the first event of `input`. manual.js validates it first; a placement
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
    for (const b of Array.isArray(placement.bench) ? placement.bench : []) {
        if (b && b.locked) fixed.push({ userId: String(b.userId), bench: true });
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
