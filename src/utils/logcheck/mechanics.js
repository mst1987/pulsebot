// Avoidable damage and deaths with a time and a cause, per boss fight.
//
// The RPB counts deaths and avoidable damage over the whole raid. This puts
// them on the fight's timeline: every hit by a mechanic the raid can step out
// of (rpbData.DAMAGE_TAKEN) and every avoidable debuff that landed on a player
// (rpbData.DEBUFFS — until now read by nobody), who took it and when, plus
// what each death was: the killing blow, whether it was avoidable, how early
// in the pull it came and how close to the end.
const rpbData = require("../../config/rpbData");

const EARLY_MS = 30000;           // a death in the first half minute is a pull mistake
const NEAR_END_SHARE = 0.1;       // a death in the last tenth of a kill cost little

/** Tracked mechanics keyed by spell id: avoidable damage and avoidable debuffs. */
function buildTracked() {
    const byId = new Map();
    const add = (entry, kind) => {
        for (const id of entry.ids || []) {
            if (byId.has(String(id))) continue;
            byId.set(String(id), { key: `${kind}:${entry.name}`, name: entry.name, label: entry.label || entry.name, icon: entry.icon, kind });
        }
    };
    for (const e of rpbData.DAMAGE_TAKEN || []) add(e, "damage");
    for (const e of rpbData.DEBUFFS || []) add(e, "debuff");
    return byId;
}

const TRACKED = buildTracked();
const DAMAGE_IDS = [...TRACKED.entries()].filter(([, d]) => d.kind === "damage").map(([id]) => id);
const DEBUFF_IDS = [...TRACKED.entries()].filter(([, d]) => d.kind === "debuff").map(([id]) => id);

function idFilter(ids) {
    return `ability.id in (${ids.join(",")})`;
}

/** Whether a killing blow came from a tracked avoidable mechanic. */
function isAvoidable(abilityId) {
    if (abilityId === undefined || abilityId === null) return false;
    const def = TRACKED.get(String(abilityId));
    return !!def && def.kind === "damage";
}

/**
 * Enrich a fight's deaths in place: avoidable, early, near the end, repeat
 * (a second death of the same raider — a battle res was spent).
 */
function judgeDeaths(deaths, fight) {
    const seen = new Set();
    for (const d of deaths || []) {
        d.avoidable = isAvoidable(d.abilityId);
        d.early = d.at < EARLY_MS;
        d.beforeEnd = Math.max(0, fight.duration - d.at);
        d.nearEnd = !!fight.kill && d.beforeEnd <= fight.duration * NEAR_END_SHARE;
        d.repeat = seen.has(d.name);
        seen.add(d.name);
    }
    return deaths || [];
}

/**
 * One fight's mechanic hits from damage-taken and debuff events. Pure.
 *
 * @param {Array}  damageEvents  WCL damage events on friendlies (absolute timestamps)
 * @param {Array}  debuffEvents  WCL aura events on friendlies
 * @param {object} fight         { start_time, end_time }
 * @param {object} idToPlayer    actor id → { name, type }
 * @returns {{ players: Array, mechanics: Array }}
 */
function mechanicsForFight(damageEvents, debuffEvents, fight, idToPlayer) {
    const start = fight.start_time;
    const duration = fight.end_time - start;
    const byPlayer = new Map();
    const byMech = new Map();

    const record = (ev, def, amount) => {
        const player = idToPlayer[ev.targetID];
        if (!player) return;
        const at = ev.timestamp - start;
        if (at < 0 || at > duration) return;
        if (!byPlayer.has(player.name)) byPlayer.set(player.name, { name: player.name, type: player.type, hits: [], amount: 0, byMechanic: {} });
        const p = byPlayer.get(player.name);
        p.hits.push({ at, key: def.key, label: def.label, icon: (ev.ability && ev.ability.abilityIcon) || def.icon, kind: def.kind, amount });
        p.amount += amount;
        if (!p.byMechanic[def.key]) p.byMechanic[def.key] = { label: def.label, icon: def.icon, kind: def.kind, hits: 0, amount: 0 };
        p.byMechanic[def.key].hits++;
        p.byMechanic[def.key].amount += amount;
        if (!byMech.has(def.key)) byMech.set(def.key, { key: def.key, label: def.label, icon: (ev.ability && ev.ability.abilityIcon) || def.icon, kind: def.kind, hits: 0, amount: 0, players: new Set() });
        const m = byMech.get(def.key);
        m.hits++;
        m.amount += amount;
        m.players.add(player.name);
    };

    for (const ev of damageEvents || []) {
        if (!ev || ev.type !== "damage" || !Number.isFinite(ev.timestamp)) continue;
        const def = TRACKED.get(String(ev.ability && ev.ability.guid));
        if (!def || def.kind !== "damage") continue;
        const amount = (Number(ev.amount) || 0) + (Number(ev.absorbed) || 0);
        if (amount <= 0) continue;
        record(ev, def, amount);
    }
    for (const ev of debuffEvents || []) {
        if (!ev || ev.type !== "applydebuff" || !Number.isFinite(ev.timestamp)) continue;
        const def = TRACKED.get(String(ev.ability && ev.ability.guid));
        if (!def || def.kind !== "debuff") continue;
        record(ev, def, 0);
    }

    const players = [...byPlayer.values()].map((p) => ({ ...p, hits: p.hits.sort((a, b) => a.at - b.at) }))
        .sort((a, b) => b.amount - a.amount || b.hits.length - a.hits.length || a.name.localeCompare(b.name));
    const mechanics = [...byMech.values()].map((m) => ({ ...m, players: m.players.size }))
        .sort((a, b) => b.amount - a.amount || b.hits - a.hits);
    return { players, mechanics };
}

/** Raid-wide summary: per player, per mechanic, and the death tally. */
function summarize(fights) {
    const byName = new Map();
    const byMech = new Map();
    const deaths = { total: 0, avoidable: 0, early: 0, nearEnd: 0, repeat: 0 };
    for (const f of fights) {
        for (const d of f.deaths || []) {
            deaths.total++;
            if (d.avoidable) deaths.avoidable++;
            if (d.early) deaths.early++;
            if (d.nearEnd) deaths.nearEnd++;
            if (d.repeat) deaths.repeat++;
            if (!byName.has(d.name)) byName.set(d.name, { name: d.name, type: d.type, hits: 0, amount: 0, deaths: 0, avoidableDeaths: 0, earlyDeaths: 0, byMechanic: {} });
            const r = byName.get(d.name);
            r.deaths++;
            if (d.avoidable) r.avoidableDeaths++;
            if (d.early) r.earlyDeaths++;
        }
        for (const p of (f.mechanics && f.mechanics.players) || []) {
            if (!byName.has(p.name)) byName.set(p.name, { name: p.name, type: p.type, hits: 0, amount: 0, deaths: 0, avoidableDeaths: 0, earlyDeaths: 0, byMechanic: {} });
            const r = byName.get(p.name);
            r.hits += p.hits.length;
            r.amount += p.amount;
            for (const [key, m] of Object.entries(p.byMechanic)) {
                if (!r.byMechanic[key]) r.byMechanic[key] = { label: m.label, icon: m.icon, kind: m.kind, hits: 0, amount: 0 };
                r.byMechanic[key].hits += m.hits;
                r.byMechanic[key].amount += m.amount;
            }
        }
        for (const m of (f.mechanics && f.mechanics.mechanics) || []) {
            if (!byMech.has(m.key)) byMech.set(m.key, { key: m.key, label: m.label, icon: m.icon, kind: m.kind, hits: 0, amount: 0, fights: 0 });
            const r = byMech.get(m.key);
            r.hits += m.hits;
            r.amount += m.amount;
            r.fights++;
        }
    }
    const players = [...byName.values()].map((r) => {
        const top = Object.entries(r.byMechanic).sort((a, b) => b[1].hits - a[1].hits)[0];
        return { ...r, topMechanic: top ? { key: top[0], ...top[1] } : null };
    }).sort((a, b) => b.amount - a.amount || b.hits - a.hits || b.deaths - a.deaths);
    const mechanics = [...byMech.values()].sort((a, b) => b.amount - a.amount || b.hits - a.hits);
    return { players, mechanics, deaths };
}

/**
 * Judge every fight's deaths, fill `timeline.fights[].mechanics` and return the
 * raid summary. Per boss fight one damage-taken event pull and one debuff
 * event pull, both filtered to the tracked ids.
 *
 * @returns {Promise<null | { players, mechanics, deaths }>}
 */
async function analyzeMechanics(wcl, reportId, fights, idToPlayer, timeline) {
    if (!timeline || !Array.isArray(timeline.fights) || timeline.fights.length === 0) return null;
    const byId = new Map((fights.fights || []).map((f) => [f.id, f]));
    for (const row of timeline.fights) {
        const f = byId.get(row.id);
        if (!f) continue;
        judgeDeaths(row.deaths, row);
        let damage;
        let debuffs;
        try {
            damage = await wcl.getAllEvents(reportId, "damage-taken", f.start_time, f.end_time, { filter: idFilter(DAMAGE_IDS) }, { maxPages: 100 });
            debuffs = await wcl.getAllEvents(reportId, "debuffs", f.start_time, f.end_time, { filter: idFilter(DEBUFF_IDS) }, { maxPages: 50 });
        } catch (e) {
            console.error(`mechanics failed on ${f.name}:`, e.message);
            row.mechanics = null;
            continue;
        }
        row.mechanics = mechanicsForFight(damage, debuffs, f, idToPlayer);
    }
    return summarize(timeline.fights);
}

module.exports = { analyzeMechanics, mechanicsForFight, judgeDeaths, summarize, isAvoidable, TRACKED };
