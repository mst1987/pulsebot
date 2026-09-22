// How good a setup is — one number, and the parts it is made of.
//
// Hard rules are not weighed, they are walls: a state that breaks one (more
// raiders than the raid holds, a group of six, more tanks than planned) scores
// -Infinity, so the search can never accept it. Everything else is a sum:
//
//   FILL          per placed raider — a free place is always worse than a filled one
//   ROLE_MIN      per raider a role is short of its target or minimum
//   BENCH_STATUS  subtracted per placed raider who signed up as "Ersatzbank":
//                 still better than an empty place, never better than anyone else
//   weights.*     the soft goals, adjustable per run (see DEFAULT_WEIGHTS)
//
// The three constants sit orders of magnitude above the weights, so no weight
// setting can trade a missing healer for a nicer group.

const { ROLES } = require("../../config/gameVersions");
const { GROUP_SIZE, STATUS_FACTOR, GEAR_FACTOR } = require("./model");

const FILL = 10000;
const ROLE_MIN = 30000;
const BENCH_STATUS = 6000;
const MAX_WEIGHT = 500;
// A party buff everybody wants (Blood Pact, Healing Stream) is worth having, but
// it must not outbid a targeted one for the same totem slot (Mana Spring for casters).
const UNIVERSAL_FACTOR = 0.5;

/**
 * The soft goals and what one full unit of each is worth.
 *   partyBuffs     a party buff reaching five raiders who want it (Windfury on
 *                  five melee); fewer beneficiaries count proportionally
 *   raidBuffs      each raid buff of the version somebody in the raid brings
 *   requiredBuffs  each buff the template requires, once present
 *   mainSpec       a raider placed on the spec they signed up with
 *   preferredCharacter  what placing a raider on one of their "kann auch mit"
 *                  characters costs against their first choice (#293) — waived
 *                  when that character's own status makes it the more available
 *                  one (#320, moreAvailableThanFirst)
 *   gear           "ready" over "usable" (unknown counts half)
 *   status         "Dabei" over "Kommt später" (½) and "Vielleicht" (0.3), per
 *                  character since #320 — not per signup
 *   fairness       who sat on the bench last time / often (event flag `fairness`)
 *   attendance     attendance in the category, 0–100 %
 *   wishes         a wish pair in the same group (mutual 1, one-sided ½; event flag `wishes`)
 *   avoid          a penalty for an "nicht zusammen" pair in the same group (one raid)
 *                  or the same raid (parallel raids). Off unless the orga asks for it
 *                  (`options.avoid`) — it separates, it never benches anybody on its own
 */
const DEFAULT_WEIGHTS = {
    partyBuffs: 60,
    raidBuffs: 40,
    requiredBuffs: 300,
    mainSpec: 120,
    preferredCharacter: 100,
    gear: 30,
    status: 80,
    fairness: 150,
    attendance: 40,
    wishes: 60,
    avoid: 100,
};

/** Defaults overridden by whatever numbers `given` carries, each clamped to 0…MAX_WEIGHT. */
function resolveWeights(given = {}) {
    const out = {};
    for (const [key, def] of Object.entries(DEFAULT_WEIGHTS)) {
        const raw = given && given[key];
        const n = raw === undefined || raw === null || raw === "" ? def : Number(raw);
        out[key] = Number.isFinite(n) ? Math.max(0, Math.min(MAX_WEIGHT, n)) : def;
    }
    return out;
}

/**
 * Whether an alternate character is *more available* than the raider's first
 * choice — their own statuses say so (#320): "Zibbo kommt später, Zibbowar ist
 * dabei". The order of the characters is a preference, a status is a statement
 * about the evening, so the preference must not outweigh it: the
 * `preferredCharacter` cost is waived for such an option. It is never waived
 * the other way round, and a raider who gave their characters the same status
 * is unaffected.
 */
function moreAvailableThanFirst(cand, opt) {
    if (!(opt.priority > 0) || !cand.preferred) return false;
    const pref = cand.preferred.get(opt.eventIdx);
    if (!pref) return false;
    return (STATUS_FACTOR[opt.status] || 0) > (STATUS_FACTOR[pref.status] || 0);
}

/** What placing this option is worth on its own, independent of everyone else. */
function staticParts(model, cand, opt, weights) {
    const event = model.events[opt.eventIdx];
    const fairOn = model.fairnessOverride === undefined ? event.fairness : model.fairnessOverride;
    const att = cand.attendance === null ? 0.5 : cand.attendance / 100;
    return {
        fill: FILL,
        benchStatus: opt.status === "bench" ? -BENCH_STATUS : 0,
        status: weights.status * (STATUS_FACTOR[opt.status] || 0),
        mainSpec: opt.main ? weights.mainSpec : 0,
        // A cost, not a bonus: raiders with a single character score as before.
        preferredCharacter: opt.priority > 0 && !moreAvailableThanFirst(cand, opt) ? -weights.preferredCharacter : 0,
        gear: weights.gear * (GEAR_FACTOR[opt.gear] === undefined ? 0.5 : GEAR_FACTOR[opt.gear]),
        fairness: fairOn ? weights.fairness * cand.fairness.priority : 0,
        attendance: weights.attendance * att,
    };
}

/**
 * The value of the party buffs in one group: for every buff, how many members
 * want it. A buff without a slot counts once per key (a second Moonkin adds
 * nothing); a buff with a slot — a totem's element, a warrior's shout — once per
 * provider per slot, the most valuable first: a shaman drops one air totem, so
 * Windfury and Wrath of Air in one group need two shamans.
 * With `credit` it records which member is credited with which buff.
 */
function groupBuffValue(model, members, credit) {
    let value = 0;
    const partyBuffs = model.partyBuffs;
    const seen = new Set();
    for (const m of members) {
        for (const b of m.opt.data.party) {
            if (seen.has(b)) continue;
            seen.add(b);
            let n = 0;
            for (const x of members) n += x.opt.data.benefits[b];
            value += n * (partyBuffs[b].universal ? UNIVERSAL_FACTOR : 1);
            if (credit && n > 0) credit.push({ member: m, buff: partyBuffs[b], count: n });
        }
    }
    const withSlots = members.filter((m) => m.opt.data.slotted.length);
    if (withSlots.length) {
        const bySlot = new Map();
        for (const m of withSlots) {
            for (const b of m.opt.data.slotted) {
                const slot = partyBuffs[b].slot;
                if (!bySlot.has(slot)) bySlot.set(slot, new Map());
                const byBuff = bySlot.get(slot);
                if (!byBuff.has(b)) byBuff.set(b, []);
                byBuff.get(b).push(m);
            }
        }
        for (const [, byBuff] of bySlot) {
            const options = [...byBuff.entries()].map(([b, providers]) => {
                let n = 0;
                for (const x of members) n += x.opt.data.benefits[b];
                return { b, providers, n, v: n * (partyBuffs[b].universal ? UNIVERSAL_FACTOR : 1) };
            }).filter((o) => o.n > 0).sort((a, b) => b.v - a.v || a.b - b.b);
            const used = new Set();
            for (const o of options) {
                // the provider who wants the buff themselves drops it (the enhancer Windfury)
                const provider = o.providers.find((x) => !used.has(x) && x.opt.data.benefits[o.b])
                    || o.providers.find((x) => !used.has(x));
                if (!provider) continue;
                used.add(provider);
                value += o.v;
                if (credit) credit.push({ member: provider, buff: partyBuffs[o.b], count: o.n });
            }
        }
    }
    return value / GROUP_SIZE;
}

/**
 * A scorer bound to one model. `evaluate(opt, grp)` takes the two state arrays
 * (option index / group index per candidate, -1 = not placed) and returns the
 * total, or -Infinity when a hard rule is broken. `breakdown(opt, grp)` returns
 * the parts, the per-event facts and the buff credits for the output.
 */
function makeScorer(model) {
    const weights = model.weights;
    const { events, cands, pairs } = model;
    for (const c of cands) {
        for (const o of c.options) {
            o.parts = staticParts(model, c, o, weights);
            o.static = Object.values(o.parts).reduce((s, v) => s + v, 0);
        }
    }
    const wishOn = events.map((e) => (model.wishesOverride === undefined ? e.wishes : model.wishesOverride));
    const avoidPairs = model.avoidOverride === true ? model.avoidPairs || [] : [];

    function run(opt, grp, detail) {
        const parts = detail ? { fill: 0, benchStatus: 0, status: 0, mainSpec: 0, preferredCharacter: 0, gear: 0, fairness: 0, attendance: 0, roles: 0, raidBuffs: 0, requiredBuffs: 0, partyBuffs: 0, wishes: 0, avoid: 0 } : null;
        let total = 0;
        const ev = events.map((e) => ({
            count: 0,
            roles: [0, 0, 0, 0],
            groups: Array.from({ length: e.groupCount }, () => []),
            raid: new Uint8Array(model.raidBuffs.length),
            party: new Uint8Array(model.partyBuffs.length),
        }));
        for (let c = 0; c < cands.length; c++) {
            const o = opt[c];
            if (o < 0) continue;
            const option = cands[c].options[o];
            const s = ev[option.eventIdx];
            total += option.static;
            if (detail) for (const [k, v] of Object.entries(option.parts)) parts[k] += v;
            s.count++;
            s.roles[option.roleIdx]++;
            s.groups[grp[c]].push({ cand: cands[c], opt: option });
            for (const b of option.data.raid) s.raid[b] = 1;
            for (const b of option.data.party) s.party[b] = 1;
            for (const b of option.data.slotted) s.party[b] = 1;
        }
        for (let e = 0; e < events.length; e++) {
            const event = events[e];
            const s = ev[e];
            if (s.count > event.size) return detail ? null : -Infinity;
            for (const g of s.groups) if (g.length > GROUP_SIZE) return detail ? null : -Infinity;
            for (let r = 0; r < ROLES.length; r++) {
                if (s.roles[r] > event.hardMax[ROLES[r]]) return detail ? null : -Infinity;
                const short = Math.max(0, event.limits[ROLES[r]].min - s.roles[r]);
                total -= short * ROLE_MIN;
                if (detail) parts.roles -= short * ROLE_MIN;
            }
            let raid = 0;
            for (const v of s.raid) raid += v;
            total += raid * weights.raidBuffs;
            let required = 0;
            for (const b of event.requiredRaid) required += s.raid[b];
            for (const b of event.requiredParty) required += s.party[b];
            total += required * weights.requiredBuffs;
            s.credits = detail ? [] : null;
            let party = 0;
            for (const g of s.groups) party += groupBuffValue(model, g, s.credits);
            total += party * weights.partyBuffs;
            if (detail) {
                parts.raidBuffs += raid * weights.raidBuffs;
                parts.requiredBuffs += required * weights.requiredBuffs;
                parts.partyBuffs += party * weights.partyBuffs;
            }
        }
        for (const p of pairs) {
            const oa = opt[p.a];
            const ob = opt[p.b];
            if (oa < 0 || ob < 0) continue;
            const ea = cands[p.a].options[oa].eventIdx;
            if (ea !== cands[p.b].options[ob].eventIdx || !wishOn[ea]) continue;
            // same raid is most of it when raids run in parallel; same group the rest
            let v = events.length > 1 ? 0.5 : 0.2;
            if (grp[p.a] === grp[p.b]) v = 1;
            total += weights.wishes * p.factor * v;
            if (detail) parts.wishes += weights.wishes * p.factor * v;
        }
        for (const p of avoidPairs) {
            const oa = opt[p.a];
            const ob = opt[p.b];
            if (oa < 0 || ob < 0) continue;
            if (cands[p.a].options[oa].eventIdx !== cands[p.b].options[ob].eventIdx) continue;
            // one raid: another group is enough; parallel raids: another raid
            if (events.length === 1 && grp[p.a] !== grp[p.b]) continue;
            total -= weights.avoid;
            if (detail) parts.avoid -= weights.avoid;
        }
        if (!detail) return total;
        return { total, parts, events: ev };
    }

    return {
        evaluate: (opt, grp) => run(opt, grp, false),
        breakdown: (opt, grp) => run(opt, grp, true),
    };
}

module.exports = {
    DEFAULT_WEIGHTS, MAX_WEIGHT, FILL, ROLE_MIN, BENCH_STATUS,
    resolveWeights, staticParts, moreAvailableThanFirst, groupBuffValue, makeScorer,
};
