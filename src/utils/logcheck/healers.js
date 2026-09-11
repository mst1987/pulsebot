// Healers per boss fight: what the DPS-shaped analyses cannot say about them.
//
// Activity and cast counts are made for damage dealers; a healer waits on
// purpose. What tells a healer's night apart is different: how much of the
// healing was overheal and on which spell, how the mana went over the fight
// and when the potion came (at 8 % or at 50 %), how quickly a dispellable
// debuff was taken off and which ones nobody removed, and how much of the
// time the tank carried the shields and HoTs a healer is there to keep up.
//
// Per fight this reads the summary (who healed, who tanked), each healer's
// healing table and resource events, the raid's dispel events, the debuff
// events of the auras that were dispelled somewhere in the log, and the buff
// events on the active tank. Everything stored is a derived interval or a
// number; the raw events are not kept.
const { mergeBands, gapsBetween, stackBands } = require("./fightTimeline");
const { TANK_AURAS, ABSORB_IDS, tankAuraById, manaRegenById } = require("../../config/healerSpells");

const STEP_MS = 5000;              // the mana curve's sampling step
const LOW_MANA_PCT = 20;           // "running dry": time spent below this is reported
const EMPTY_MANA_PCT = 10;         // a fight where the healer went below this counts as empty
const POTION_WORTH_MS = 150000;    // a fight at least this long is one a potion belongs in
const POTION_WORTH_PCT = 30;       // ...when the mana dipped below this and no potion came

// ---- healing --------------------------------------------------------------

/**
 * One healer's healing table folded into totals and a per-spell list. WCL's
 * `total` is the effective healing, `overheal` sits beside it, so the overheal
 * share is overheal / (total + overheal). Absorbs (Power Word: Shield) are
 * counted apart: a shield never overheals and would only dilute the share.
 *
 * @param {Array} entries  table.entries of tables/healing for one source
 */
function healingOf(entries) {
    let total = 0;
    let overheal = 0;
    let absorbs = 0;
    const spells = [];
    for (const e of entries || []) {
        if (!e || !Number.isFinite(e.total)) continue;
        const guid = e.guid !== undefined && e.guid !== null ? Number(e.guid) : null;
        const over = Number(e.overheal) || 0;
        if (guid !== null && ABSORB_IDS.has(String(guid))) {
            absorbs += e.total;
            continue;
        }
        total += e.total;
        overheal += over;
        spells.push({
            guid, name: e.name || "", icon: e.abilityIcon || "",
            total: e.total, overheal: over,
            overhealPct: e.total + over > 0 ? Math.round((over / (e.total + over)) * 100) : 0,
            casts: Number(e.hitCount) || Number(e.uses) || 0,
        });
    }
    spells.sort((a, b) => b.total + b.overheal - (a.total + a.overheal));
    const raw = total + overheal;
    for (const s of spells) s.share = raw > 0 ? Math.round(((s.total + s.overheal) / raw) * 100) : 0;
    return { total, overheal, absorbs, overhealPct: raw > 0 ? Math.round((overheal / raw) * 100) : 0, spells };
}

// ---- mana -------------------------------------------------------------------

/**
 * The mana an event reports for `actorId`, or null. WCL has carried the
 * numbers in two shapes over the years, so both are read: a `classResources`
 * list (type 0 = mana) on the event, or a `sourceResources` /
 * `targetResources` object with the resource fields.
 */
function manaOf(ev, actorId) {
    if (!ev) return null;
    const fromList = (list) => {
        const mana = (list || []).find((r) => r && Number(r.type) === 0 && Number.isFinite(r.amount) && r.max > 0);
        return mana ? { amount: mana.amount, max: mana.max } : null;
    };
    const fromObject = (o) => {
        if (!o || typeof o !== "object") return null;
        if (Array.isArray(o.classResources)) return fromList(o.classResources);
        if (Number.isFinite(o.mana) && o.maxMana > 0) return { amount: o.mana, max: o.maxMana };
        if (Number(o.resourceType) === 0 && Number.isFinite(o.resourceAmount) && o.maxResourceAmount > 0) return { amount: o.resourceAmount, max: o.maxResourceAmount };
        return null;
    };
    const isSource = ev.sourceID === actorId;
    const isTarget = ev.targetID === actorId;
    if (Array.isArray(ev.classResources)) {
        // `resourceActor` says whose numbers these are: 1 = source (default), 2 = target
        const actor = Number(ev.resourceActor) === 2 ? "target" : "source";
        if ((actor === "source" && isSource) || (actor === "target" && isTarget)) return fromList(ev.classResources);
        return null;
    }
    if (isSource) return fromObject(ev.sourceResources);
    if (isTarget) return fromObject(ev.targetResources);
    return null;
}

/** The mana percentage the samples show at `at` (the last sample before it, else the first). */
function pctAt(samples, at) {
    if (!samples.length) return null;
    let last = null;
    for (const s of samples) {
        if (s.at >= at) break;
        last = s;
    }
    return (last || samples[0]).pct;
}

/**
 * One healer's mana over a fight, from their resource events. Pure.
 *
 * @param {Array}  events   WCL resource events involving the healer (absolute timestamps)
 * @param {number} actorId  the healer's actor id
 * @param {{ start, end, judgeEnd? }} fight  absolute start/end; judgeEnd fight-relative
 * @returns {{ available, step, values, min, minAt, lowMs, empty, regen }}
 */
function manaCurve(events, actorId, { start, end, judgeEnd }) {
    const duration = end - start;
    const until = Number.isFinite(judgeEnd) ? Math.min(duration, judgeEnd) : duration;
    const samples = [];
    const regen = [];
    for (const ev of (events || []).slice().sort((a, b) => a.timestamp - b.timestamp)) {
        if (!ev || !Number.isFinite(ev.timestamp)) continue;
        const at = ev.timestamp - start;
        if (at < 0 || at > until) continue;
        const mana = manaOf(ev, actorId);
        if (mana) samples.push({ at, pct: Math.max(0, Math.min(100, Math.round((mana.amount / mana.max) * 100))) });
        const isGain = (ev.type === "energize" || ev.type === "resourcechange") && ev.targetID === actorId
            && (ev.resourceChangeType === undefined || Number(ev.resourceChangeType) === 0) && Number(ev.resourceChange) > 0;
        if (isGain) {
            const def = manaRegenById(ev.ability && ev.ability.guid);
            if (def) regen.push({ at, key: def.key, label: def.label, icon: def.icon, kind: def.kind, amount: Number(ev.resourceChange) || 0, pct: null });
        }
    }
    // a periodic gain (Mana Tide ticks, Fel Mana) is one press, not four markers
    const pressed = [];
    for (const r of regen) {
        const prev = pressed[pressed.length - 1];
        if (prev && prev.key === r.key && r.at - prev.at <= 15000) { prev.amount += r.amount; continue; }
        pressed.push({ ...r });
    }
    if (!samples.length) return { available: false, step: STEP_MS, values: [], min: null, minAt: null, lowMs: 0, empty: false, regen: pressed };

    for (const r of pressed) r.pct = pctAt(samples, r.at);
    const n = Math.floor(until / STEP_MS) + 1;
    const values = Array.from({ length: n }, (_, i) => pctAt(samples, i * STEP_MS + 1));
    let min = 101;
    let minAt = null;
    let lowMs = 0;
    for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        if (s.pct < min) { min = s.pct; minAt = s.at; }
        const next = samples[i + 1] ? samples[i + 1].at : until;
        if (s.pct < LOW_MANA_PCT) lowMs += Math.max(0, next - s.at);
    }
    return { available: true, step: STEP_MS, values, min, minAt, lowMs, empty: min < EMPTY_MANA_PCT, regen: pressed };
}

// ---- dispels ---------------------------------------------------------------

/**
 * The raid's dispels of one fight, with the reaction time per dispel and the
 * dispellable debuffs nobody removed. Pure.
 *
 * `dispellable` is the set of aura ids seen dispelled anywhere in the log —
 * the only honest definition without a per-boss table: what somebody
 * dispelled once was dispellable, so an application of it that ran its full
 * course untouched is a missed dispel.
 *
 * @param {Array} dispelEvents  events/dispels of the fight
 * @param {Array} debuffEvents  events/debuffs of the fight, filtered to `dispellable`
 * @param {{ start_time, end_time }} fight
 * @param {object} idToPlayer
 * @param {Set<string>} dispellable
 */
function dispelsForFight(dispelEvents, debuffEvents, fight, idToPlayer, dispellable = new Set()) {
    const start = fight.start_time;
    const duration = fight.end_time - start;
    const applies = [];   // { at, guid, target, removedAt, dispelled }
    const open = new Map();
    const keyOf = (ev) => `${ev.targetID}:${ev.ability && ev.ability.guid}`;
    for (const ev of (debuffEvents || []).slice().sort((a, b) => a.timestamp - b.timestamp)) {
        if (!ev || !Number.isFinite(ev.timestamp) || !ev.ability) continue;
        if (!dispellable.has(String(ev.ability.guid))) continue;
        if (!idToPlayer[ev.targetID]) continue;
        const at = ev.timestamp - start;
        if (ev.type === "applydebuff") {
            const a = { at, guid: String(ev.ability.guid), name: ev.ability.name || "", icon: ev.ability.abilityIcon || "", target: ev.targetID, removedAt: null, dispelled: false };
            applies.push(a);
            open.set(keyOf(ev), a);
        } else if (ev.type === "removedebuff") {
            const a = open.get(keyOf(ev));
            if (a) { a.removedAt = at; open.delete(keyOf(ev)); }
        }
    }
    for (const a of open.values()) a.removedAt = duration;

    const byPlayer = new Map();
    const list = [];
    for (const ev of (dispelEvents || []).slice().sort((a, b) => a.timestamp - b.timestamp)) {
        if (!ev || ev.type !== "dispel" || !Number.isFinite(ev.timestamp) || ev.isBuff) continue;
        const who = idToPlayer[ev.sourceID];
        const target = idToPlayer[ev.targetID];
        if (!who || !target) continue;
        const at = ev.timestamp - start;
        const aura = ev.extraAbility || {};
        const guid = String(aura.guid);
        const apply = applies.filter((a) => a.target === ev.targetID && a.guid === guid && a.at <= at && (a.removedAt === null || a.removedAt >= at - 50)).pop();
        if (apply) apply.dispelled = true;
        const reactionMs = apply ? at - apply.at : null;
        const row = { at, ability: aura.name || "", icon: aura.abilityIcon || "", guid, target: target.name, targetType: target.type, reactionMs };
        list.push(row);
        if (!byPlayer.has(who.name)) byPlayer.set(who.name, { name: who.name, type: who.type, count: 0, reactionSum: 0, reactionN: 0, list: [] });
        const p = byPlayer.get(who.name);
        p.count++;
        p.list.push(row);
        if (reactionMs !== null) { p.reactionSum += reactionMs; p.reactionN++; }
    }
    const players = [...byPlayer.values()].map((p) => ({
        name: p.name, type: p.type, count: p.count,
        avgReactionMs: p.reactionN ? Math.round(p.reactionSum / p.reactionN) : null,
        list: p.list,
    })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const missed = applies.filter((a) => !a.dispelled).map((a) => ({
        at: a.at, ability: a.name, icon: a.icon, guid: a.guid, target: idToPlayer[a.target].name, targetType: idToPlayer[a.target].type,
        durationMs: Math.max(0, (a.removedAt === null ? duration : a.removedAt) - a.at),
    }));
    return { total: list.length, players, missed };
}

// ---- tank shields ------------------------------------------------------------

/** Actor ids WCL's summary lists in a role ("healer", "tank", "dps"). */
function idsInRole(summary, role) {
    const ids = new Set();
    for (const m of (summary && summary.composition) || []) {
        if ((m.specs || []).some((s) => s && s.role === role)) ids.add(m.id);
    }
    return ids;
}

/**
 * The active tank of a fight: among those WCL lists as tanks, the one who took
 * the most damage; without a listed tank, whoever took the most damage at all.
 */
function tankOf(summary, damageTaken, idToPlayer) {
    const tanks = idsInRole(summary, "tank");
    const entries = ((damageTaken && damageTaken.entries) || []).filter((e) => e && idToPlayer[e.id]);
    const pick = (list) => list.slice().sort((a, b) => (b.total || 0) - (a.total || 0))[0];
    let best = pick(entries.filter((e) => tanks.has(e.id)));
    if (!best && tanks.size) best = { id: [...tanks][0], total: 0 };
    if (!best) best = pick(entries);
    if (!best) return null;
    const p = idToPlayer[best.id];
    return p ? { id: best.id, name: p.name, type: p.type, damageTaken: best.total || 0 } : null;
}

/**
 * Shield and HoT rows on the tank from the fight's buff events. One row per
 * aura and source (two druids' Lifeblooms are two rows), stacks where the
 * aura stacks, uptime judged until the tank died. Pure.
 */
function shieldsForFight(buffEvents, tank, fight, idToPlayer, judgeEnd) {
    if (!tank) return [];
    const start = fight.start_time;
    const duration = fight.end_time - start;
    const until = Number.isFinite(judgeEnd) ? Math.min(duration, judgeEnd) : duration;
    const groups = new Map();
    for (const ev of (buffEvents || []).slice().sort((a, b) => a.timestamp - b.timestamp)) {
        if (!ev || ev.targetID !== tank.id || !ev.ability) continue;
        const def = tankAuraById(ev.ability.guid);
        if (!def) continue;
        const k = `${def.key}:${ev.sourceID}`;
        if (!groups.has(k)) groups.set(k, { def, sourceId: ev.sourceID, events: [] });
        groups.get(k).events.push(ev);
    }
    const rows = [];
    for (const { def, sourceId, events } of groups.values()) {
        const source = idToPlayer[sourceId] || { name: "?", type: "" };
        const stacks = stackBands(events, { start, end: start + until, maxStacks: def.stacks });
        const bands = mergeBands(stacks.map((b) => [b.from, b.to]));
        const g = gapsBetween(bands, until);
        rows.push({
            key: def.key, label: def.label, name: def.name, icon: def.icon,
            source: source.name, sourceType: source.type,
            bands, stacks: def.stacks ? stacks : undefined, maxStacks: def.stacks,
            uptimePct: g.uptimePct, gapCount: g.gapCount, longestGap: g.longestGap, firstAt: g.firstAt,
            fullStacksPct: def.stacks
                ? Math.round((stacks.filter((b) => b.stacks >= def.stacks).reduce((n, b) => n + (b.to - b.from), 0) / Math.max(1, until)) * 100)
                : null,
        });
    }
    const order = TANK_AURAS.map((a) => a.key);
    return rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key) || a.source.localeCompare(b.source));
}

// ---- per fight ---------------------------------------------------------------

/**
 * Assemble one fight's healer block from the pieces. Pure.
 *
 * @param {object} input
 * @param {Array<{ id, name, type }>} input.healers
 * @param {object} input.healing   healer name → tables/healing entries
 * @param {object} input.resources healer name → resource events
 * @param {Array}  input.dispelEvents
 * @param {Array}  input.debuffEvents
 * @param {Set}    input.dispellable
 * @param {object|null} input.tank
 * @param {Array}  input.buffEvents
 * @param {object} input.fight     { start_time, end_time }
 * @param {object} input.idToPlayer
 * @param {Array}  [input.deaths]  fight-relative deaths ({ at, name })
 */
function healersForFight({ healers, healing, resources, dispelEvents, debuffEvents, dispellable, tank, buffEvents, fight, idToPlayer, deaths = [] }) {
    const duration = fight.end_time - fight.start_time;
    const diedAt = new Map((deaths || []).map((d) => [d.name, d.at]).filter(([, at]) => Number.isFinite(at)));
    const dispels = dispelsForFight(dispelEvents, debuffEvents, fight, idToPlayer, dispellable);
    const rows = (healers || []).map((h) => {
        const judgeEnd = diedAt.has(h.name) ? Math.min(duration, diedAt.get(h.name)) : duration;
        const heal = healingOf(healing[h.name]);
        const mana = manaCurve(resources[h.name], h.id, { start: fight.start_time, end: fight.end_time, judgeEnd });
        const own = dispels.players.find((p) => p.name === h.name) || { count: 0, avgReactionMs: null, list: [] };
        const potions = mana.regen.filter((r) => r.kind === "potion");
        return {
            name: h.name, type: h.type, id: h.id,
            judgedUntil: judgeEnd, diedAt: judgeEnd < duration ? judgeEnd : null,
            healing: heal,
            mana,
            potions: potions.length,
            // a long fight, the mana went low, and no potion came
            potionMissing: potions.length === 0 && judgeEnd >= POTION_WORTH_MS && mana.available && mana.min < POTION_WORTH_PCT,
            dispels: { count: own.count, avgReactionMs: own.avgReactionMs, list: own.list },
        };
    });
    const tankJudge = tank && diedAt.has(tank.name) ? Math.min(duration, diedAt.get(tank.name)) : duration;
    return {
        healers: rows,
        tank: tank ? { id: tank.id, name: tank.name, type: tank.type, judgedUntil: tankJudge } : null,
        shields: shieldsForFight(buffEvents, tank, fight, idToPlayer, tankJudge),
        dispels: { total: dispels.total, missed: dispels.missed, others: dispels.players.filter((p) => !rows.some((h) => h.name === p.name)) },
    };
}

// ---- raid summary ------------------------------------------------------------

/** Raid-wide numbers per healer, plus the raid's missed dispels. */
function summarize(fights) {
    const byName = new Map();
    let dispelsMissed = 0;
    const missedByAbility = new Map();
    const tanks = new Set();
    for (const f of fights) {
        const h = f.healers;
        if (!h) continue;
        if (h.tank) tanks.add(h.tank.name);
        for (const m of (h.dispels && h.dispels.missed) || []) {
            dispelsMissed++;
            const k = m.ability || m.guid;
            if (!missedByAbility.has(k)) missedByAbility.set(k, { ability: m.ability, icon: m.icon, count: 0 });
            missedByAbility.get(k).count++;
        }
        for (const r of h.healers || []) {
            if (!byName.has(r.name)) {
                byName.set(r.name, {
                    name: r.name, type: r.type, fights: 0, healingTotal: 0, overhealTotal: 0, absorbs: 0,
                    spells: new Map(), manaFights: 0, manaMinSum: 0, manaLowFights: 0, lowMs: 0,
                    potions: 0, potionPcts: [], potionMissingFights: 0, dispels: 0, reactionSum: 0, reactionN: 0, shields: new Map(),
                });
            }
            const s = byName.get(r.name);
            s.fights++;
            s.healingTotal += r.healing.total;
            s.overhealTotal += r.healing.overheal;
            s.absorbs += r.healing.absorbs;
            for (const sp of r.healing.spells) {
                const k = sp.guid !== null ? String(sp.guid) : sp.name;
                if (!s.spells.has(k)) s.spells.set(k, { name: sp.name, icon: sp.icon, total: 0, overheal: 0 });
                const t = s.spells.get(k);
                t.total += sp.total;
                t.overheal += sp.overheal;
            }
            if (r.mana.available) {
                s.manaFights++;
                s.manaMinSum += r.mana.min;
                s.lowMs += r.mana.lowMs;
                if (r.mana.empty) s.manaLowFights++;
            }
            for (const p of r.mana.regen.filter((x) => x.kind === "potion")) {
                s.potions++;
                if (p.pct !== null) s.potionPcts.push(p.pct);
            }
            if (r.potionMissing) s.potionMissingFights++;
            s.dispels += r.dispels.count;
            if (r.dispels.avgReactionMs !== null) { s.reactionSum += r.dispels.avgReactionMs * r.dispels.count; s.reactionN += r.dispels.count; }
            for (const row of (h.shields || []).filter((x) => x.source === r.name)) {
                if (!s.shields.has(row.key)) s.shields.set(row.key, { key: row.key, label: row.label, icon: row.icon, fights: 0, uptimeSum: 0 });
                const sh = s.shields.get(row.key);
                sh.fights++;
                sh.uptimeSum += row.uptimePct;
            }
        }
    }
    const players = [...byName.values()].map((s) => {
        const raw = s.healingTotal + s.overhealTotal;
        const spells = [...s.spells.values()].map((t) => ({
            ...t,
            overhealPct: t.total + t.overheal > 0 ? Math.round((t.overheal / (t.total + t.overheal)) * 100) : 0,
            overhealShare: s.overhealTotal > 0 ? Math.round((t.overheal / s.overhealTotal) * 100) : 0,
        }));
        const topOverheal = spells.slice().sort((a, b) => b.overheal - a.overheal)[0] || null;
        return {
            name: s.name, type: s.type, fights: s.fights,
            healingTotal: s.healingTotal, overhealTotal: s.overhealTotal, absorbs: s.absorbs,
            overhealPct: raw > 0 ? Math.round((s.overhealTotal / raw) * 100) : 0,
            topOverheal: topOverheal && topOverheal.overheal > 0 ? topOverheal : null,
            manaFights: s.manaFights,
            manaMinAvg: s.manaFights ? Math.round(s.manaMinSum / s.manaFights) : null,
            manaLowFights: s.manaLowFights,
            lowMs: s.lowMs,
            potions: s.potions,
            potionPcts: s.potionPcts,
            potionMissingFights: s.potionMissingFights,
            dispels: s.dispels,
            avgReactionMs: s.reactionN ? Math.round(s.reactionSum / s.reactionN) : null,
            shields: [...s.shields.values()].map((sh) => ({ key: sh.key, label: sh.label, icon: sh.icon, fights: sh.fights, uptimeAvg: Math.round(sh.uptimeSum / sh.fights) })),
        };
    }).sort((a, b) => b.healingTotal - a.healingTotal || a.name.localeCompare(b.name));
    return {
        players,
        raid: { dispelsMissed, missedByAbility: [...missedByAbility.values()].sort((a, b) => b.count - a.count), tanks: [...tanks] },
    };
}

// ---- entry ---------------------------------------------------------------------

function idFilter(ids) {
    return `ability.id in (${[...ids].join(",")})`;
}

/**
 * Fill `timeline.fights[].healers` and return the raid summary.
 *
 * Two passes over the boss fights: the first collects every fight's dispels
 * (so the log itself says which debuffs are dispellable), the second does
 * the rest — summary, damage taken, the tank's buff events, the debuff events
 * of the dispellable auras, and per healer the healing table and the resource
 * events. A fight without a healer in WCL's composition gets null.
 *
 * @returns {Promise<null | { players: Array, raid: object }>}
 */
async function analyzeHealers(wcl, reportId, fights, idToPlayer, timeline) {
    if (!timeline || !Array.isArray(timeline.fights) || timeline.fights.length === 0) return null;
    const byId = new Map((fights.fights || []).map((f) => [f.id, f]));

    const dispelsByFight = new Map();
    const dispellable = new Set();
    for (const row of timeline.fights) {
        const f = byId.get(row.id);
        if (!f) continue;
        try {
            const events = await wcl.getAllEvents(reportId, "dispels", f.start_time, f.end_time, {}, { maxPages: 20 });
            dispelsByFight.set(row.id, events);
            for (const ev of events) {
                if (ev && ev.type === "dispel" && !ev.isBuff && ev.extraAbility && ev.extraAbility.guid !== undefined) dispellable.add(String(ev.extraAbility.guid));
            }
        } catch (e) {
            console.error(`dispels failed on ${f.name}:`, e.message);
            dispelsByFight.set(row.id, []);
        }
    }

    const auraIds = TANK_AURAS.flatMap((a) => a.ids);
    let any = false;
    for (const row of timeline.fights) {
        const f = byId.get(row.id);
        if (!f) continue;
        let summary;
        try {
            summary = await wcl.getSummary(reportId, f.start_time, f.end_time);
        } catch (e) {
            console.error(`healers summary failed on ${f.name}:`, e.message);
            row.healers = null;
            continue;
        }
        const healers = [...idsInRole(summary, "healer")].filter((id) => idToPlayer[id]).map((id) => ({ id, ...idToPlayer[id] }));
        if (healers.length === 0) { row.healers = null; continue; }

        let damageTaken = null;
        try { damageTaken = await wcl.getDamageTaken(reportId, f.start_time, f.end_time); } catch (e) { console.error(`damage taken failed on ${f.name}:`, e.message); }
        const tank = tankOf(summary, damageTaken, idToPlayer);

        let buffEvents = [];
        if (tank) {
            try {
                buffEvents = await wcl.getAllEvents(reportId, "buffs", f.start_time, f.end_time, { targetid: tank.id, filter: idFilter(auraIds) }, { maxPages: 50 });
            } catch (e) { console.error(`tank buffs failed on ${f.name}:`, e.message); }
        }
        let debuffEvents = [];
        if (dispellable.size) {
            try {
                debuffEvents = await wcl.getAllEvents(reportId, "debuffs", f.start_time, f.end_time, { filter: idFilter(dispellable) }, { maxPages: 50 });
            } catch (e) { console.error(`dispellable debuffs failed on ${f.name}:`, e.message); }
        }

        const healing = {};
        const resources = {};
        for (const h of healers) {
            try {
                const table = await wcl.getHealing(reportId, f.start_time, f.end_time, { sourceid: h.id });
                healing[h.name] = (table && table.entries) || [];
            } catch (e) { console.error(`healing failed for ${h.name} on ${f.name}:`, e.message); healing[h.name] = []; }
            try {
                resources[h.name] = await wcl.getAllEvents(reportId, "resources", f.start_time, f.end_time, { sourceid: h.id }, { maxPages: 100 });
            } catch (e) { console.error(`resources failed for ${h.name} on ${f.name}:`, e.message); resources[h.name] = []; }
        }

        row.healers = healersForFight({
            healers, healing, resources,
            dispelEvents: dispelsByFight.get(row.id) || [], debuffEvents, dispellable,
            tank, buffEvents, fight: f, idToPlayer, deaths: row.deaths,
        });
        any = true;
    }
    return any ? summarize(timeline.fights) : null;
}

module.exports = {
    analyzeHealers, healersForFight, healingOf, manaOf, manaCurve, dispelsForFight, tankOf, shieldsForFight, summarize, idsInRole,
    STEP_MS, LOW_MANA_PCT, EMPTY_MANA_PCT, POTION_WORTH_MS, POTION_WORTH_PCT,
};
