// Fight timeline: the first part of the report that carries a time axis.
//
// Everything else in the logcheck is an aggregate — a percentage, a count. The
// timeline keeps, per boss fight, the intervals the charts need: the fight's own
// bounds, every death as a marker, and (filled by the analyzers that build on
// this) the bands of debuffs, totems, cooldowns and activity. Only derived
// intervals are stored, never raw events, so the report stays a small JSON.
//
// All times are milliseconds relative to the fight's start, clipped to the
// fight. Bands are `[from, to]` pairs.
const { contentForBoss } = require("../../config/tbcContent");

/**
 * Turn WCL aura bands (`{ startTime, endTime }`, absolute report time) or plain
 * `[from, to]` pairs into fight-relative bands, clipped to the fight and with
 * everything outside it dropped. A band that is still open when the fight ends
 * (no endTime) runs to the fight's end.
 *
 * @returns {Array<[number, number]>} sorted by start
 */
function clipBands(bands, start, end) {
    const out = [];
    for (const b of bands || []) {
        let from;
        let to;
        if (Array.isArray(b)) {
            [from, to] = b;
        } else if (b && typeof b === "object") {
            from = b.startTime;
            to = b.endTime;
        } else {
            continue;
        }
        if (!Number.isFinite(from)) continue;
        if (!Number.isFinite(to)) to = end;
        const a = Math.max(from, start) - start;
        const z = Math.min(to, end) - start;
        if (z > a) out.push([a, z]);
    }
    return out.sort((x, y) => x[0] - y[0]);
}

/**
 * Merge overlapping or touching bands so a refresh before expiry does not count
 * twice and does not show as a gap.
 */
function mergeBands(bands) {
    const sorted = (bands || []).filter((b) => Array.isArray(b) && b[1] > b[0]).sort((x, y) => x[0] - y[0]);
    const out = [];
    for (const [from, to] of sorted) {
        const last = out[out.length - 1];
        if (last && from <= last[1]) {
            if (to > last[1]) last[1] = to;
        } else {
            out.push([from, to]);
        }
    }
    return out;
}

/**
 * Uptime and gaps of a set of bands over a fight of `duration` ms.
 *
 * `firstAt` is when the first band starts (the time it took to get the debuff
 * up at all) and is null when there is none. Gaps include the lead-in before
 * the first band and the tail after the last one — a debuff that fell off for
 * the last minute is a gap like any other.
 *
 * @returns {{ uptimeMs, uptimePct, gaps: Array<[number,number]>, gapCount, longestGap, firstAt }}
 */
function gapsBetween(bands, duration) {
    const merged = mergeBands(bands);
    const total = Math.max(0, duration || 0);
    if (total === 0) {
        return { uptimeMs: 0, uptimePct: 0, gaps: [], gapCount: 0, longestGap: 0, firstAt: null };
    }
    const gaps = [];
    let cursor = 0;
    let uptimeMs = 0;
    for (const [from, to] of merged) {
        if (from > cursor) gaps.push([cursor, from]);
        uptimeMs += to - from;
        cursor = to;
    }
    if (cursor < total) gaps.push([cursor, total]);
    const longestGap = gaps.reduce((m, [a, z]) => Math.max(m, z - a), 0);
    return {
        uptimeMs,
        uptimePct: Math.min(100, Math.round((uptimeMs / total) * 100)),
        gaps,
        gapCount: gaps.length,
        longestGap,
        firstAt: merged.length ? merged[0][0] : null,
    };
}

// The event types that change a stacking aura's height. WCL reports the height
// after the event in `stack`; an apply without one is one stack.
const STACK_APPLY = new Set(["applydebuff", "applybuff"]);
const STACK_ADD = new Set(["applydebuffstack", "applybuffstack"]);
const STACK_REFRESH = new Set(["refreshdebuff", "refreshbuff"]);
const STACK_REMOVE = new Set(["removedebuff", "removebuff"]);

/**
 * Stack height over time from WCL aura events of one ability on one target.
 * Events carry absolute report timestamps; the result is fight-relative bands
 * `{ from, to, stacks }`, one per stretch of constant height, clipped to the
 * fight. An aura still up when the fight ends runs to its end. An event stream
 * that starts mid-way (the aura was applied before the window) is treated as
 * starting at one stack at that first event.
 *
 * @param {Array} events   WCL events sorted by timestamp (any types; others ignored)
 * @param {{ start: number, end: number, maxStacks?: number }} fight
 * @returns {Array<{ from: number, to: number, stacks: number }>}
 */
function stackBands(events, { start, end, maxStacks = 0 }) {
    const out = [];
    let stacks = 0;
    let since = null;
    const cap = (n) => (maxStacks > 0 ? Math.min(maxStacks, n) : n);
    const close = (at) => {
        if (since === null || stacks <= 0) return;
        const from = Math.max(since, start) - start;
        const to = Math.min(at, end) - start;
        if (to > from) out.push({ from, to, stacks });
    };
    for (const ev of events || []) {
        const type = ev && ev.type;
        const at = ev && ev.timestamp;
        if (!Number.isFinite(at)) continue;
        if (at > end) break;
        if (STACK_APPLY.has(type)) {
            close(at);
            stacks = cap(Number(ev.stack) || 1);
            since = at;
        } else if (STACK_ADD.has(type)) {
            close(at);
            stacks = cap(Number(ev.stack) || stacks + 1);
            since = at;
        } else if (STACK_REFRESH.has(type)) {
            if (stacks <= 0) {
                stacks = cap(Number(ev.stack) || 1);
                since = at;
            }
            // a refresh keeps the height: the band simply goes on
        } else if (STACK_REMOVE.has(type)) {
            close(at);
            stacks = 0;
            since = null;
        }
    }
    close(end);
    return out;
}

/** Fight-relative death markers of one fight, from the raid-wide deaths table. */
function deathsForFight(entries, fight, idToPlayer) {
    const out = [];
    for (const e of entries || []) {
        if (!e || !Number.isFinite(e.timestamp)) continue;
        // The table names the fight; fall back to the time window when it does not.
        const inFight = e.fight !== undefined && e.fight !== null
            ? e.fight === fight.id
            : e.timestamp >= fight.start_time && e.timestamp <= fight.end_time;
        if (!inFight) continue;
        const player = idToPlayer && idToPlayer[e.id];
        const blow = e.killingBlow || null;
        out.push({
            at: Math.max(0, Math.min(fight.end_time, e.timestamp) - fight.start_time),
            name: e.name || (player && player.name) || "",
            type: e.type || (player && player.type) || "",
            ability: blow ? blow.name || "" : "",
            abilityIcon: blow ? blow.abilityIcon || "" : "",
            abilityId: blow && blow.guid !== undefined && blow.guid !== null ? Number(blow.guid) : null,
        });
    }
    return out.sort((a, b) => a.at - b.at);
}

/**
 * Build the timeline skeleton for every boss fight of a report.
 *
 * One deaths call for the whole raid — the fights themselves are already in
 * hand. The per-topic containers (`debuffs`, `totems`, `cooldowns`, `activity`,
 * `buffs`) start out null and are filled by the analyzers built on top of this.
 *
 * @param {object} wcl        WarcraftLogs client
 * @param {string} reportId
 * @param {object} fights     WCL fights response
 * @param {object} [idToPlayer]  actor id -> { name, type }
 * @returns {Promise<null | { fights: Array<object> }>}  null when there is no boss fight
 */
async function analyzeFightTimeline(wcl, reportId, fights, idToPlayer = {}) {
    const bossFights = (fights.fights || []).filter((f) => f.boss && f.boss > 0 && f.end_time > f.start_time);
    if (bossFights.length === 0) return null;

    let deaths = [];
    try {
        const table = await wcl.getDeaths(reportId, 0, fights.end || 999999999999);
        deaths = (table && table.entries) || [];
    } catch (e) {
        console.error("timeline deaths failed:", e.message);
    }

    const rows = bossFights.map((f) => ({
        id: f.id,
        boss: f.name,
        // WCL's encounter id: groups the tries of one boss and names its icon
        encounterId: f.boss,
        contentId: contentForBoss(f.name) || "",
        kill: !!f.kill,
        startTime: f.start_time,
        endTime: f.end_time,
        duration: f.end_time - f.start_time,
        fightPercentage: f.kill ? 0 : (Number.isFinite(f.fightPercentage) ? f.fightPercentage / 100 : null),
        deaths: deathsForFight(deaths, f, idToPlayer),
        debuffs: null,
        totems: null,
        cooldowns: null,
        activity: null,
        buffs: null,
    }));
    return { fights: rows };
}

module.exports = {
    analyzeFightTimeline,
    clipBands,
    mergeBands,
    gapsBetween,
    stackBands,
    deathsForFight,
};
