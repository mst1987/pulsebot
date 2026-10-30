// Activity per player per boss fight: when was somebody doing something, and
// where are the holes.
//
// The RPB reconstructs "seconds active" from cast counts times cast time over
// the whole raid — a fair estimate with no time in it. This reads the fight's
// cast events (and the white swings the casts miss) and lays them on the
// timeline: every cast or swing covers a global cooldown's worth of time, a
// hardcast covers its own duration, the rest is a hole. Holes are labelled
// where the log knows the reason — the player was dead, or an avoidable
// debuff (a silence, a fear) sat on them — and left "unknown" otherwise.
const GCD_MS = 1500;
const MIN_GAP_MS = 3000;
const MELEE_IDS = ["1", "75"];   // Melee swing, Auto Shot

/**
 * Activity blocks of one player from their events. Pure.
 *
 * A `begincast` opens a block that its matching `cast` closes; an instant
 * `cast` or a swing covers one GCD. Blocks are merged into bands.
 *
 * @param {Array} events   this player's cast + swing events (absolute timestamps)
 * @param {number} start   fight start (absolute)
 * @param {number} judgeEnd  fight-relative end of judging (death or fight end)
 * @returns {Array<[number, number]>}  fight-relative bands
 */
function activityBands(events, start, judgeEnd) {
    const sorted = (events || []).filter((e) => e && Number.isFinite(e.timestamp)).sort((a, b) => a.timestamp - b.timestamp);
    const blocks = [];
    let open = null;   // { at, guid } of a begincast waiting for its cast
    for (const ev of sorted) {
        const at = ev.timestamp - start;
        if (at < 0 || at > judgeEnd) continue;
        const guid = ev.ability && ev.ability.guid;
        if (ev.type === "begincast") {
            if (open) blocks.push([open.at, Math.min(judgeEnd, open.at + GCD_MS)]);   // interrupted cast: at least the GCD
            open = { at, guid };
        } else if (ev.type === "cast") {
            if (open && String(open.guid) === String(guid)) {
                blocks.push([open.at, Math.max(at, open.at + 1)]);
                open = null;
            } else {
                blocks.push([at, Math.min(judgeEnd, at + GCD_MS)]);
            }
        } else if (ev.type === "damage" && MELEE_IDS.includes(String(guid))) {
            blocks.push([at, Math.min(judgeEnd, at + GCD_MS)]);
        }
    }
    if (open) blocks.push([open.at, Math.min(judgeEnd, open.at + GCD_MS)]);
    return mergeBlocks(blocks.filter(([a, z]) => z > a));
}

function mergeBlocks(blocks) {
    const sorted = blocks.sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const [a, z] of sorted) {
        const last = out[out.length - 1];
        if (last && a <= last[1]) { if (z > last[1]) last[1] = z; } else out.push([a, z]);
    }
    return out;
}

/**
 * The holes between bands from the fight start to `judgeEnd`, with a reason
 * where one is known: "mechanic" when an avoidable debuff landed on the
 * player inside the hole, else "unknown". Holes shorter than MIN_GAP_MS are
 * not holes.
 */
function findGaps(bands, judgeEnd, mechanicHits) {
    const gaps = [];
    let cursor = 0;
    const push = (from, to) => {
        if (to - from < MIN_GAP_MS) return;
        const mechanic = (mechanicHits || []).some((h) => h.at >= from - 1000 && h.at <= to);
        gaps.push({ from, to, reason: mechanic ? "mechanic" : "unknown" });
    };
    for (const [a, z] of bands) {
        if (a > cursor) push(cursor, a);
        cursor = Math.max(cursor, z);
    }
    if (cursor < judgeEnd) push(cursor, judgeEnd);
    return gaps;
}

/**
 * One fight's activity rows. Pure.
 *
 * @param {Array}  casts       cast events of the fight (all players)
 * @param {Array}  swings      damage events of the fight filtered to melee/auto shot
 * @param {object} fight       { start_time, end_time }
 * @param {object} idToPlayer  actor id → { name, type }
 * @param {Array}  [deaths]    fight-relative deaths ({ at, name })
 * @param {object} [mechanics] the fight's mechanics ({ players: [{ name, hits }] }) for hole reasons
 */
function activityForFight(casts, swings, fight, idToPlayer, deaths = [], mechanics = null) {
    const start = fight.start_time;
    const duration = fight.end_time - start;
    const byPlayer = new Map();
    for (const ev of [...(casts || []), ...(swings || [])]) {
        if (!ev || !Number.isFinite(ev.timestamp)) continue;
        const player = idToPlayer[ev.sourceID];
        if (!player) continue;
        if (!byPlayer.has(player.name)) byPlayer.set(player.name, { player, events: [] });
        byPlayer.get(player.name).events.push(ev);
    }
    const diedAt = new Map((deaths || []).map((d) => [d.name, d.at]).filter(([, at]) => Number.isFinite(at)));
    const hitsOf = (name) => {
        const p = ((mechanics && mechanics.players) || []).find((x) => x.name === name);
        return p ? p.hits.filter((h) => h.kind === "debuff") : [];
    };

    const rows = [];
    for (const { player, events } of byPlayer.values()) {
        const judgeEnd = diedAt.has(player.name) ? Math.min(duration, diedAt.get(player.name)) : duration;
        const bands = activityBands(events, start, judgeEnd);
        const active = bands.reduce((n, [a, z]) => n + (z - a), 0);
        const gaps = findGaps(bands, judgeEnd, hitsOf(player.name));
        rows.push({
            name: player.name, type: player.type,
            bands, gaps,
            activePct: judgeEnd > 0 ? Math.min(100, Math.round((active / judgeEnd) * 100)) : 0,
            judgedUntil: judgeEnd,
            diedAt: judgeEnd < duration ? judgeEnd : null,
            longestGap: gaps.reduce((m, g) => Math.max(m, g.to - g.from), 0),
            unexplainedMs: gaps.filter((g) => g.reason === "unknown").reduce((n, g) => n + (g.to - g.from), 0),
            mechanicMs: gaps.filter((g) => g.reason === "mechanic").reduce((n, g) => n + (g.to - g.from), 0),
            casts: events.filter((e) => e.type === "cast").length,
            swings: events.filter((e) => e.type === "damage").length,
        });
    }
    return rows.sort((a, b) => b.activePct - a.activePct || a.name.localeCompare(b.name));
}

/** Raid-wide summary per player. */
function summarize(fights) {
    const byName = new Map();
    for (const f of fights) {
        for (const a of f.activity || []) {
            if (!byName.has(a.name)) byName.set(a.name, { name: a.name, type: a.type, fights: 0, pctSum: 0, gaps: 0, gapMs: 0, unexplainedMs: 0, mechanicMs: 0, longestGap: 0 });
            const r = byName.get(a.name);
            r.fights++;
            r.pctSum += a.activePct;
            r.gaps += a.gaps.length;
            r.gapMs += a.gaps.reduce((n, g) => n + (g.to - g.from), 0);
            r.unexplainedMs += a.unexplainedMs;
            r.mechanicMs += a.mechanicMs;
            r.longestGap = Math.max(r.longestGap, a.longestGap);
        }
    }
    return [...byName.values()].map((r) => ({
        name: r.name, type: r.type, fights: r.fights,
        activeAvg: r.fights ? Math.round(r.pctSum / r.fights) : 0,
        gaps: r.gaps, gapMs: r.gapMs, unexplainedMs: r.unexplainedMs, mechanicMs: r.mechanicMs, longestGap: r.longestGap,
    })).sort((a, b) => b.activeAvg - a.activeAvg || a.name.localeCompare(b.name));
}

/**
 * Fill `timeline.fights[].activity` and return the raid summary. Per boss
 * fight one unfiltered cast pull and one damage pull filtered to swings.
 *
 * @returns {Promise<null | { players: Array }>}
 */
async function analyzeActivityTimeline(wcl, reportId, fights, idToPlayer, timeline) {
    if (!timeline || !Array.isArray(timeline.fights) || timeline.fights.length === 0) return null;
    const byId = new Map((fights.fights || []).map((f) => [f.id, f]));
    for (const row of timeline.fights) {
        const f = byId.get(row.id);
        if (!f) continue;
        let casts;
        let swings;
        try {
            casts = await wcl.getAllEvents(reportId, "casts", f.start_time, f.end_time, {}, { maxPages: 300 });
            swings = await wcl.getAllEvents(reportId, "damage-done", f.start_time, f.end_time, { filter: `ability.id in (${MELEE_IDS.join(",")})` }, { maxPages: 300 });
        } catch (e) {
            console.error(`activity failed on ${f.name}:`, e.message);
            row.activity = null;
            continue;
        }
        row.activity = activityForFight(casts, swings, f, idToPlayer, row.deaths, row.mechanics);
    }
    return { players: summarize(timeline.fights) };
}

module.exports = { analyzeActivityTimeline, activityForFight, activityBands, findGaps, summarize, GCD_MS, MIN_GAP_MS };
