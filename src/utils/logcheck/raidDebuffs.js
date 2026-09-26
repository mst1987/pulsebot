// Raid debuffs on the boss, per fight, on the timeline.
//
// The old bossUptimes analyzer answers "how much of the fight did Faerie Fire
// sit on the boss" with one number. This one keeps the intervals (so the page
// can draw when it was there and when it fell off), follows the stack height
// of the stacking debuffs (Sunder, Shadow Weaving, Improved Scorch …) and says
// which debuffs the raid should have had — judged by who was there, never by
// the encounter: a missing Curse of the Elements is only a finding when a
// warlock raided.
const { DEBUFFS, expectedDebuffs, debuffByGuid } = require("../../config/raidDebuffs");
const { clipBands, mergeBands, gapsBetween, stackBands } = require("./fightTimeline");

/** Per-class headcount of the roster. */
function classCounts(players) {
    const counts = {};
    for (const p of players || []) {
        if (!p || !p.type) continue;
        counts[p.type] = (counts[p.type] || 0) + 1;
    }
    return counts;
}

/** WCL filter expression selecting the aura events of the given spell ids. */
function idFilter(ids) {
    return `ability.id in (${ids.join(",")})`;
}

/**
 * Group aura events by target and pick the target with the most of them — on a
 * single-boss fight that is the boss; on a council fight it is the one the
 * tanks held longest, which is the one the raid's debuffs were meant for.
 */
function mainTargetEvents(events) {
    const byTarget = new Map();
    for (const ev of events || []) {
        const key = `${ev.targetID}:${ev.targetInstance || 0}`;
        if (!byTarget.has(key)) byTarget.set(key, []);
        byTarget.get(key).push(ev);
    }
    let best = [];
    for (const list of byTarget.values()) {
        if (list.length > best.length) best = list;
    }
    return { events: best, targets: byTarget.size };
}

/** Time until the stack height first reached the maximum, or null. */
function timeToMax(stacks, maxStacks) {
    const first = (stacks || []).find((b) => b.stacks >= maxStacks);
    return first ? first.from : null;
}

/**
 * One fight's debuff rows from its debuffs table (and, for the stacking ones,
 * its aura events). Pure: the API calls happen in analyzeRaidDebuffs.
 *
 * @param {object} fight        WCL fight (start_time, end_time)
 * @param {Array}  auras        table.auras from tables/debuffs (hostility 1)
 * @param {Object<string, Array>} eventsByKey  aura events per stacking debuff key
 * @param {Set<string>} expected  debuff keys the roster should have delivered
 */
function debuffRowsForFight(fight, auras, eventsByKey, expected) {
    const start = fight.start_time;
    const end = fight.end_time;
    const duration = end - start;
    const bandsByKey = {};
    const iconByKey = {};
    for (const a of auras || []) {
        const def = debuffByGuid(a.guid);
        if (!def) continue;
        if (!bandsByKey[def.key]) bandsByKey[def.key] = [];
        bandsByKey[def.key].push(...clipBands(a.bands || [], start, end));
        if (a.abilityIcon && !iconByKey[def.key]) iconByKey[def.key] = a.abilityIcon;
    }

    // An exclusive group (Sunder/Expose, the judgements, Shout/Roar) is covered
    // by any one member: the absent ones are then not missing and not shown. A
    // group nobody covered is reported once, on its first expected member.
    const skip = new Set();
    const groups = new Map();
    for (const def of DEBUFFS) {
        if (!def.exclusive) continue;
        if (!groups.has(def.group)) groups.set(def.group, []);
        groups.get(def.group).push(def);
    }
    for (const members of groups.values()) {
        const present = members.some((d) => (bandsByKey[d.key] || []).length > 0);
        const wanted = members.filter((d) => expected.has(d.key));
        for (const d of members) {
            const has = (bandsByKey[d.key] || []).length > 0;
            if (has) continue;
            if (present || wanted.length === 0 || d !== wanted[0]) skip.add(d.key);
        }
    }

    const rows = [];
    for (const def of DEBUFFS) {
        if (skip.has(def.key)) continue;
        const bands = bandsByKey[def.key] || [];
        const isExpected = expected.has(def.key);
        if (bands.length === 0 && !isExpected) continue;
        const gaps = gapsBetween(bands, duration);
        const row = {
            key: def.key,
            label: def.label,
            icon: iconByKey[def.key] || def.icon,
            group: def.group,
            provider: def.provider,
            bands: mergeBands(bands),
            maxStacks: def.stacks || 0,
            uptimePct: gaps.uptimePct,
            gapCount: gaps.gapCount,
            longestGap: gaps.longestGap,
            firstAt: gaps.firstAt,
            expected: isExpected,
            missing: isExpected && gaps.uptimeMs === 0,
        };
        if (def.stacks > 0) {
            const picked = mainTargetEvents(eventsByKey[def.key]);
            const stacks = stackBands(picked.events, { start, end, maxStacks: def.stacks });
            row.stacks = stacks;
            row.targets = picked.targets;
            row.timeToMax = timeToMax(stacks, def.stacks);
            // share of the uptime spent below full stacks — a Sunder that sits at 3 all night is a finding too
            const belowMax = stacks.filter((b) => b.stacks < def.stacks).reduce((n, b) => n + (b.to - b.from), 0);
            row.belowMaxPct = gaps.uptimeMs ? Math.round((belowMax / gaps.uptimeMs) * 100) : 0;
        }
        rows.push(row);
    }
    return rows;
}

/**
 * Raid-wide summary over the fights: per debuff, whether it was expected, its
 * average uptime, and on how many fights it was missing entirely.
 */
function summarize(fights) {
    const byKey = new Map();
    for (const f of fights) {
        for (const row of f.debuffs || []) {
            if (!byKey.has(row.key)) {
                byKey.set(row.key, { key: row.key, label: row.label, icon: row.icon, group: row.group, provider: row.provider, expected: row.expected, fights: 0, missing: 0, uptimeSum: 0, maxStacks: row.maxStacks || 0, belowMaxSum: 0 });
            }
            const s = byKey.get(row.key);
            s.fights++;
            s.uptimeSum += row.uptimePct;
            if (row.missing) s.missing++;
            if (row.belowMaxPct !== undefined) s.belowMaxSum += row.belowMaxPct;
        }
    }
    return [...byKey.values()].map((s) => ({
        key: s.key, label: s.label, icon: s.icon, group: s.group, provider: s.provider, expected: s.expected,
        fights: s.fights, missing: s.missing, maxStacks: s.maxStacks,
        avgUptime: s.fights ? Math.round(s.uptimeSum / s.fights) : 0,
        avgBelowMax: s.maxStacks && s.fights ? Math.round(s.belowMaxSum / s.fights) : null,
    }));
}

/**
 * Fill `timeline.fights[].debuffs` and return the raid-wide summary.
 *
 * Per boss fight one debuffs table (bands of every hostile aura, as bossUptimes
 * already fetched) plus one aura-event pull filtered to the stacking debuffs.
 * A fight whose calls fail keeps `debuffs: null` rather than aborting the rest.
 *
 * @param {object} wcl
 * @param {string} reportId
 * @param {object} fights     WCL fights response
 * @param {Array}  players    selected roster entries ({ name, type })
 * @param {object} timeline   the report's timeline (from analyzeFightTimeline); mutated
 * @returns {Promise<null | { expected: string[], rows: Array }>}
 */
async function analyzeRaidDebuffs(wcl, reportId, fights, players, timeline) {
    if (!timeline || !Array.isArray(timeline.fights) || timeline.fights.length === 0) return null;
    const byId = new Map((fights.fights || []).map((f) => [f.id, f]));
    const stacking = DEBUFFS.filter((d) => d.stacks > 0);
    const stackIds = stacking.flatMap((d) => d.ids);

    // First pass: what landed anywhere in the raid decides the spec-gated
    // expectations (a Misery on one boss proves the shadow priest was there).
    const tables = new Map();
    const seen = new Set();
    for (const row of timeline.fights) {
        const f = byId.get(row.id);
        if (!f) continue;
        let table;
        try {
            table = await wcl.getDebuffs(reportId, f.start_time, f.end_time, { hostility: 1 });
        } catch {
            continue;
        }
        tables.set(row.id, table);
        for (const a of (table && table.auras) || []) {
            const def = debuffByGuid(a.guid);
            if (def && (a.totalUptime || 0) > 0) seen.add(def.key);
        }
    }
    const expected = expectedDebuffs(classCounts(players), seen);

    for (const row of timeline.fights) {
        const f = byId.get(row.id);
        const table = tables.get(row.id);
        if (!f || !table) {
            row.debuffs = null;
            continue;
        }
        const eventsByKey = {};
        if (stackIds.length) {
            let events;
            try {
                events = await wcl.getAllEvents(reportId, "debuffs", f.start_time, f.end_time, { hostility: 1, filter: idFilter(stackIds) }, { maxPages: 200 });
            } catch {
                events = [];
            }
            for (const ev of events) {
                const def = debuffByGuid(ev && ev.ability && ev.ability.guid);
                if (!def) continue;
                if (!eventsByKey[def.key]) eventsByKey[def.key] = [];
                eventsByKey[def.key].push(ev);
            }
        }
        row.debuffs = debuffRowsForFight(f, table.auras, eventsByKey, expected);
    }

    return { expected: [...expected], rows: summarize(timeline.fights) };
}

module.exports = { analyzeRaidDebuffs, debuffRowsForFight, classCounts, mainTargetEvents, summarize };
