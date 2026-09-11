// Totems per shaman per boss fight, on the timeline.
//
// What a shaman's totems did over a fight: when each was dropped (cast
// markers), how long its party buff was actually up (bands from the buffs
// table, sourced by that shaman), where it fell off (downtimes), and — for the
// enhancement shaman — whether Windfury and Grace of Air were twisted and how
// much Windfury uptime the twisting cost. Nothing here is estimated from
// rotation theory: the buff bands are what the log saw on the party.
const { TOTEMS, SLOTS, totemByCast, totemByBuff } = require("../../config/totems");
const { clipBands, mergeBands, gapsBetween } = require("./fightTimeline");

const MIN_GAP_MS = 1000;   // a sub-second flicker between refreshes is not a gap

function idFilter(ids) {
    return `ability.id in (${ids.join(",")})`;
}

/** Sort key so rows read air (Windfury first), earth, fire, water. */
function rowOrder(def) {
    const slot = SLOTS.indexOf(def.slot);
    const wf = def.key === "windfury" ? 0 : def.key === "graceOfAir" ? 1 : 2;
    return slot * 10 + wf;
}

/** Which role the totem choice reveals: Windfury means melee, Wrath means caster, water only means healer. */
function roleFor(keys) {
    if (keys.has("windfury")) return "melee";
    if (keys.has("totemOfWrath") || keys.has("wrathOfAir")) return "caster";
    if (keys.has("manaSpring") || keys.has("manaTide") || keys.has("healingStream")) return "healer";
    return "";
}

/**
 * Presence bands of a totem without a party buff (Tremor, Searing, …): from
 * each drop until the next drop in the same slot, its own duration or the end
 * of judging, whichever comes first.
 */
function presenceBands(casts, slotCasts, def, judgeEnd) {
    return casts.map((c) => {
        const next = slotCasts.find((t) => t > c);
        const to = Math.min(judgeEnd, c + def.duration * 1000, next === undefined ? Infinity : next);
        return to > c ? [c, to] : null;
    }).filter(Boolean);
}

/** Gaps in `bands` between `from` and `to`, ignoring sub-second flickers. */
function downtimesBetween(bands, from, to) {
    if (to - from <= 0) return { gaps: [], uptimePct: 0, longestGap: 0 };
    // clipBands makes the bands relative to `from`; the gaps come back the same way
    const g = gapsBetween(clipBands(bands, from, to), to - from);
    const gaps = g.gaps.filter(([a, z]) => z - a >= MIN_GAP_MS).map(([a, z]) => [a + from, z + from]);
    return { gaps, uptimePct: g.uptimePct, longestGap: gaps.reduce((m, [a, z]) => Math.max(m, z - a), 0) };
}

/**
 * Twisting: consecutive Windfury drops with another air totem dropped in
 * between. The cycle is the time from one Windfury drop to the next.
 */
function twistCycles(wfCasts, otherAirCasts) {
    const cycles = [];
    for (let i = 1; i < wfCasts.length; i++) {
        const a = wfCasts[i - 1];
        const b = wfCasts[i];
        if (otherAirCasts.some((t) => t > a && t < b)) cycles.push(b - a);
    }
    return cycles;
}

/**
 * One shaman's totems over one fight. Pure.
 *
 * @param {object} input
 * @param {string} input.name
 * @param {Array}  input.casts     WCL cast events of the shaman (absolute timestamps)
 * @param {Array}  input.auras     table.auras of the buffs table sourced by the shaman
 * @param {number} input.start     fight start (absolute)
 * @param {number} input.end       fight end (absolute)
 * @param {number|null} [input.deathAt]  fight-relative death of the shaman, or null
 * @returns {null | object}  null when the shaman dropped no totem
 */
function analyzeShamanFight({ name, type, casts, auras, start, end, deathAt }) {
    const duration = end - start;
    const judgeEnd = Number.isFinite(deathAt) && deathAt !== null ? Math.min(duration, deathAt) : duration;

    // drops per totem, fight-relative
    const dropsByKey = new Map();
    for (const ev of casts || []) {
        if (!ev || ev.type !== "cast" || !Number.isFinite(ev.timestamp)) continue;
        const def = totemByCast(ev.ability && ev.ability.guid);
        if (!def) continue;
        const at = ev.timestamp - start;
        if (at < 0 || at > duration) continue;
        if (!dropsByKey.has(def.key)) dropsByKey.set(def.key, []);
        dropsByKey.get(def.key).push(at);
    }
    if (dropsByKey.size === 0) return null;
    for (const list of dropsByKey.values()) list.sort((a, b) => a - b);

    // party buff bands per totem, fight-relative
    const buffByKey = new Map();
    for (const a of auras || []) {
        const def = totemByBuff(a && a.guid);
        if (!def) continue;
        if (!buffByKey.has(def.key)) buffByKey.set(def.key, []);
        buffByKey.get(def.key).push(...clipBands(a.bands || [], start, end));
    }

    const slotCasts = {};
    for (const [key, drops] of dropsByKey) {
        const def = TOTEMS.find((d) => d.key === key);
        slotCasts[def.slot] = [...(slotCasts[def.slot] || []), ...drops].sort((a, b) => a - b);
    }

    const rows = [];
    const slotPresence = {};
    for (const [key, drops] of dropsByKey) {
        const def = TOTEMS.find((d) => d.key === key);
        const buffed = def.buffIds.length > 0;
        const band = mergeBands(buffed ? (buffByKey.get(key) || []) : presenceBands(drops, slotCasts[def.slot], def, judgeEnd));
        const firstAt = drops[0];
        const down = downtimesBetween(band, firstAt, judgeEnd);
        slotPresence[def.slot] = [...(slotPresence[def.slot] || []), ...band];
        rows.push({
            key, label: def.label, icon: def.icon, slot: def.slot, buffed,
            markers: drops.map((at) => ({ at, icon: def.icon, label: def.label })),
            band,
            downtimes: buffed ? down.gaps : [],
            uptimePct: buffed ? down.uptimePct : null,
            longestGap: buffed ? down.longestGap : 0,
            firstAt,
            drops: drops.length,
        });
    }
    rows.sort((a, b) => rowOrder(TOTEMS.find((d) => d.key === a.key)) - rowOrder(TOTEMS.find((d) => d.key === b.key)));

    // slot coverage from the first drop in that slot to the end of judging
    const slots = {};
    for (const slot of SLOTS) {
        const bands = slotPresence[slot];
        if (!bands || !bands.length) continue;
        const first = Math.min(...(slotCasts[slot] || [0]));
        const down = downtimesBetween(mergeBands(bands), first, judgeEnd);
        slots[slot] = { uptimePct: down.uptimePct, gapCount: down.gaps.length, longestGap: down.longestGap, downtimeMs: down.gaps.reduce((n, [a, z]) => n + (z - a), 0) };
    }

    // twisting
    const wf = dropsByKey.get("windfury") || [];
    const otherAir = TOTEMS.filter((d) => d.slot === "air" && d.key !== "windfury").flatMap((d) => dropsByKey.get(d.key) || []);
    const cycles = twistCycles(wf, otherAir);
    const wfRow = rows.find((r) => r.key === "windfury");
    const twisting = wf.length
        ? {
            detected: cycles.length >= 2,
            cycles: cycles.length,
            avgCycleMs: cycles.length ? Math.round(cycles.reduce((n, c) => n + c, 0) / cycles.length) : null,
            wfUptimePct: wfRow ? wfRow.uptimePct : null,
            gapCount: wfRow ? wfRow.downtimes.length : 0,
            downtimeMs: wfRow ? wfRow.downtimes.reduce((n, [a, z]) => n + (z - a), 0) : 0,
            longestGap: wfRow ? wfRow.longestGap : 0,
        }
        : null;

    return {
        name, type: type || "Shaman",
        role: roleFor(new Set(dropsByKey.keys())),
        judgedUntil: judgeEnd,
        diedAt: judgeEnd < duration ? judgeEnd : null,
        rows, slots, twisting,
    };
}

/** Raid-wide summary per shaman. */
function summarize(fights) {
    const byName = new Map();
    for (const f of fights) {
        for (const s of f.totems || []) {
            if (!byName.has(s.name)) {
                byName.set(s.name, { name: s.name, type: s.type, roles: {}, fights: 0, wfFights: 0, wfUptimeSum: 0, twistingFights: 0, downtimeMs: 0, gapCount: 0, slotDowntimeMs: {} });
            }
            const r = byName.get(s.name);
            r.fights++;
            if (s.role) r.roles[s.role] = (r.roles[s.role] || 0) + 1;
            if (s.twisting) {
                r.wfFights++;
                r.wfUptimeSum += s.twisting.wfUptimePct || 0;
                if (s.twisting.detected) r.twistingFights++;
                r.downtimeMs += s.twisting.downtimeMs;
                r.gapCount += s.twisting.gapCount;
            }
            for (const [slot, v] of Object.entries(s.slots || {})) r.slotDowntimeMs[slot] = (r.slotDowntimeMs[slot] || 0) + v.downtimeMs;
        }
    }
    return [...byName.values()].map((r) => ({
        name: r.name, type: r.type,
        role: Object.entries(r.roles).sort((a, b) => b[1] - a[1]).map(([k]) => k)[0] || "",
        fights: r.fights,
        wfFights: r.wfFights,
        wfUptimeAvg: r.wfFights ? Math.round(r.wfUptimeSum / r.wfFights) : null,
        twistingFights: r.twistingFights,
        downtimeMs: r.downtimeMs,
        gapCount: r.gapCount,
        slotDowntimeMs: r.slotDowntimeMs,
    }));
}

/**
 * Fill `timeline.fights[].totems` for every shaman and return the raid summary.
 * Per shaman and boss fight: one cast-event pull (filtered to totem ids) and
 * one buffs table sourced by the shaman.
 *
 * @returns {Promise<null | { players: Array }>}  null without shamans or timeline
 */
async function analyzeTotems(wcl, reportId, fights, players, timeline) {
    if (!timeline || !Array.isArray(timeline.fights) || timeline.fights.length === 0) return null;
    const shamans = (players || []).filter((p) => p && p.type === "Shaman");
    if (shamans.length === 0) return null;
    const byId = new Map((fights.fights || []).map((f) => [f.id, f]));
    const castIds = TOTEMS.flatMap((d) => d.castIds);

    for (const row of timeline.fights) {
        const f = byId.get(row.id);
        if (!f) continue;
        const out = [];
        for (const s of shamans) {
            let casts;
            let table;
            try {
                casts = await wcl.getAllEvents(reportId, "casts", f.start_time, f.end_time, { sourceid: s.id, filter: idFilter(castIds) }, { maxPages: 50 });
                table = await wcl.getBuffs(reportId, f.start_time, f.end_time, { sourceid: s.id });
            } catch (e) {
                console.error(`totems failed for ${s.name} on ${f.name}:`, e.message);
                continue;
            }
            const death = (row.deaths || []).find((d) => d.name === s.name);
            const result = analyzeShamanFight({
                name: s.name, type: s.type, casts, auras: (table && table.auras) || [],
                start: f.start_time, end: f.end_time, deathAt: death ? death.at : null,
            });
            if (result) out.push(result);
        }
        row.totems = out;
    }
    return { players: summarize(timeline.fights) };
}

module.exports = { analyzeTotems, analyzeShamanFight, summarize, twistCycles, presenceBands, downtimesBetween, roleFor };
