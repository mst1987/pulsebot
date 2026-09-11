// Cooldowns on the time axis, per player per boss fight.
//
// The RPB counts how often a cooldown was used against how often it could have
// been. This puts the uses on the fight's timeline: when each was pressed,
// how long the first press took, which presses fell into a Bloodlust window
// and which did not, and how many more would have fitted before the fight
// (or the player's death) ended. One cast pull per fight, filtered to every
// tracked id, then split by who cast it.
const rpbData = require("../../config/rpbData");
const { POTION_TYPES } = require("./potions");

const LUST_IDS = new Set(["2825", "32182"]);
const LUST_MS = 40000;
const POTION_COOLDOWN = 120;
// A cooldown that came back this long before the end and was not pressed
// again counts as a missed use; anything shorter is not worth pressing.
const WORTH_PRESSING_MS = 10000;

/**
 * Everything tracked, keyed by spell id: class cooldowns of every class
 * (externals like Innervate land on their caster, whatever class the RPB
 * lists them under), on-use trinkets and racials, engineering, potions.
 */
function buildTracked() {
    const byId = new Map();
    const add = (entry, kind) => {
        for (const id of entry.ids || []) {
            if (byId.has(String(id))) continue;
            byId.set(String(id), { key: entry.key || entry.name, label: entry.label || entry.name, icon: entry.icon, cooldown: entry.cooldown || 0, kind });
        }
    };
    for (const list of Object.values(rpbData.CLASS_COOLDOWNS || {})) for (const e of list) add(e, "class");
    for (const e of rpbData.TRINKETS_AND_RACIALS || []) add(e, "trinket");
    for (const e of rpbData.ENGINEERING || []) add(e, "engineering");
    for (const e of POTION_TYPES) add({ ...e, cooldown: POTION_COOLDOWN }, "potion");
    return byId;
}

const TRACKED = buildTracked();

function idFilter() {
    return `ability.id in (${[...TRACKED.keys()].join(",")})`;
}

/** How many presses fit into `judgeMs` with a cooldown of `cooldown` seconds: one at the pull, one per full cooldown after. */
function possibleUses(cooldown, judgeMs) {
    if (!cooldown || judgeMs <= 0) return 0;
    return Math.max(1, Math.ceil(judgeMs / (cooldown * 1000)));
}

/** Whether a press happened inside any window. */
function inWindows(at, windows) {
    return windows.some((w) => at >= w.from && at <= w.to);
}

/**
 * One fight's cooldown rows from its cast events. Pure.
 *
 * @param {Array}  events     WCL cast events of the fight (absolute timestamps)
 * @param {object} fight      { start_time, end_time }
 * @param {object} idToPlayer actor id → { name, type }
 * @param {Array}  [deaths]   fight-relative deaths ({ at, name })
 * @returns {{ windows, players, lust }}
 */
function cooldownRowsForFight(events, fight, idToPlayer, deaths = []) {
    const start = fight.start_time;
    const duration = fight.end_time - start;
    const diedAt = new Map((deaths || []).map((d) => [d.name, d.at]));

    // presses per player per tracked entry
    const byPlayer = new Map();
    const lustCasts = [];
    for (const ev of events || []) {
        if (!ev || ev.type !== "cast" || !Number.isFinite(ev.timestamp)) continue;
        const guid = ev.ability && ev.ability.guid;
        const def = TRACKED.get(String(guid));
        if (!def) continue;
        const player = idToPlayer[ev.sourceID];
        if (!player) continue;
        const at = ev.timestamp - start;
        if (at < 0 || at > duration) continue;
        if (LUST_IDS.has(String(guid))) lustCasts.push(at);
        if (!byPlayer.has(player.name)) byPlayer.set(player.name, { name: player.name, type: player.type, rows: new Map() });
        const p = byPlayer.get(player.name);
        if (!p.rows.has(def.key)) p.rows.set(def.key, { ...def, icon: (ev.ability && ev.ability.abilityIcon) || def.icon, presses: [] });
        p.rows.get(def.key).presses.push(at);
    }

    lustCasts.sort((a, b) => a - b);
    const windows = [];
    for (const at of lustCasts) {
        const last = windows[windows.length - 1];
        if (last && at <= last.to) { last.to = Math.max(last.to, at + LUST_MS); continue; }
        windows.push({ label: "Bloodlust", from: at, to: Math.min(duration, at + LUST_MS) });
    }

    const players = [];
    for (const p of byPlayer.values()) {
        const judgeEnd = diedAt.has(p.name) ? Math.min(duration, diedAt.get(p.name)) : duration;
        const rows = [];
        for (const r of p.rows.values()) {
            const presses = r.presses.sort((a, b) => a - b);
            const possible = r.cooldown ? possibleUses(r.cooldown, judgeEnd) : null;
            const last = presses[presses.length - 1];
            // ready again well before the end, but never pressed again
            const readyAt = r.cooldown ? last + r.cooldown * 1000 : null;
            const leftOnTable = readyAt !== null && judgeEnd - readyAt >= WORTH_PRESSING_MS;
            const stacked = windows.length ? presses.filter((at) => inWindows(at, windows)).length : null;
            rows.push({
                key: r.key, label: r.label, icon: r.icon, kind: r.kind, cooldown: r.cooldown,
                markers: presses.map((at) => ({ at, icon: r.icon, label: r.label })),
                count: presses.length,
                possibleUses: possible,
                missed: possible !== null ? Math.max(0, possible - presses.length) : 0,
                leftOnTable,
                firstAt: presses[0],
                stacked,
                sub: cooldownSub(presses.length, possible, presses[0]),
            });
        }
        rows.sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind) || a.firstAt - b.firstAt);
        players.push({ name: p.name, type: p.type, judgedUntil: judgeEnd, rows });
    }
    players.sort((a, b) => (a.type + a.name).localeCompare(b.type + b.name));

    const lust = lustCasts.length
        ? { casts: lustCasts.length, firstAt: lustCasts[0], spreadMs: lustCasts[lustCasts.length - 1] - lustCasts[0] }
        : null;
    return { windows, players, lust };
}

function kindOrder(kind) {
    return { class: 0, trinket: 1, potion: 2, engineering: 3 }[kind] ?? 4;
}

/** "2/3 · erster 0:04" — under the count in the value column. */
function cooldownSub(count, possible, firstAt) {
    const first = Number.isFinite(firstAt) ? `erster ${fmt(firstAt)}` : "";
    if (possible === null) return first;
    return `${count}/${possible}${first ? ` · ${first}` : ""}`;
}

function fmt(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Raid-wide summary per player. */
function summarize(fights) {
    const byName = new Map();
    for (const f of fights) {
        const cd = f.cooldowns;
        if (!cd) continue;
        for (const p of cd.players || []) {
            if (!byName.has(p.name)) byName.set(p.name, { name: p.name, type: p.type, fights: 0, uses: 0, possible: 0, missed: 0, firstAtSum: 0, firstAtN: 0, stacked: 0, unstacked: 0 });
            const r = byName.get(p.name);
            r.fights++;
            for (const row of p.rows) {
                r.uses += row.count;
                if (row.possibleUses !== null) { r.possible += row.possibleUses; r.missed += row.missed; }
                if (row.kind === "class" && Number.isFinite(row.firstAt)) { r.firstAtSum += row.firstAt; r.firstAtN++; }
                if (row.kind === "class" && row.stacked !== null) { r.stacked += row.stacked; r.unstacked += row.count - row.stacked; }
            }
        }
    }
    return [...byName.values()].map((r) => ({
        name: r.name, type: r.type, fights: r.fights, uses: r.uses, possible: r.possible, missed: r.missed,
        usedPct: r.possible ? Math.round(((r.possible - r.missed) / r.possible) * 100) : null,
        avgFirstAtMs: r.firstAtN ? Math.round(r.firstAtSum / r.firstAtN) : null,
        stacked: r.stacked, unstacked: r.unstacked,
    }));
}

/**
 * Fill `timeline.fights[].cooldowns` and return the raid summary. One cast
 * pull per boss fight, filtered to every tracked id.
 *
 * @returns {Promise<null | { players: Array }>}
 */
async function analyzeCooldownTimeline(wcl, reportId, fights, idToPlayer, timeline) {
    if (!timeline || !Array.isArray(timeline.fights) || timeline.fights.length === 0) return null;
    const byId = new Map((fights.fights || []).map((f) => [f.id, f]));
    const filter = idFilter();
    for (const row of timeline.fights) {
        const f = byId.get(row.id);
        if (!f) continue;
        let events;
        try {
            events = await wcl.getAllEvents(reportId, "casts", f.start_time, f.end_time, { filter }, { maxPages: 100 });
        } catch (e) {
            console.error(`cooldowns failed on ${f.name}:`, e.message);
            row.cooldowns = null;
            continue;
        }
        row.cooldowns = cooldownRowsForFight(events, f, idToPlayer, row.deaths);
    }
    return { players: summarize(timeline.fights) };
}

module.exports = { analyzeCooldownTimeline, cooldownRowsForFight, summarize, possibleUses, TRACKED };
