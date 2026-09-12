// Fight series: raid DPS, raid HPS and boss health over the course of a fight.
//
// The curve one looks at first on Warcraft Logs — where the damage collapses,
// where Bloodlust went off, when a wipe tipped. Per boss fight one array per
// measure in 5-second buckets, written into `timeline.fights[].series` as
//   { step, dps, hps, bossHp }
// (compact arrays of equal length; a ten-minute fight is 121 values each).
// render.js's fightSeries() draws it above the topic switch.
//
// The data comes from the WCL v2 API (classes/warcraftlogsV2.js): the binned
// `graph` of damage done and healing, and the enemies' damage events with
// resources for the boss health. Without a configured v2 client the series is
// simply absent (`null`) — no error, the page shows nothing where it would be.
//
// The same `graph` answer carries one series per *source* next to "Total", so
// the raiders' own curves cost no further request: `series.players` keeps
// them as `[{ name, type, dps?, hps? }]` on the very same buckets, only for
// the players of the roster (`idToPlayer`) and only where there is anything
// (a value > 0). The player page draws one against the raid's mean per
// player, and `summarizeFightSeries()` folds them into `report.fightSeries`:
// per raider the share of the fight their output sat below half their own
// mean ("Einbrüche") — buckets after their death excluded, dying is not a
// dip — which is what the recommendation `series.dips` reads.
//
// Pets: WCL's damage-done graph folds a pet into its owner by default (the
// site's "show pets separately" is off), so a warlock's series already holds
// the felguard. A series that nevertheless names an owner (`petOwner` /
// `ownerID`, which the schema leaves open) is added to that owner; one that
// belongs to no roster player and names no owner is dropped, since guessing
// whose pet it was would credit the wrong raider.
//
// Boss health is *measured*, never interpolated: a sample is what the log saw
// on the boss at that moment, a bucket without a sample holds the last one
// seen, and buckets before the first sample take the first (the boss is not
// assumed to be at 100 % — the numbers only say what the log says). On a kill
// the final bucket is 0: that the boss died is a fact of the fight, not an
// estimate. When the log carries no hit points at all (no advanced combat
// logging), `bossHp` stays null rather than a line drawn from fightPercentage.

const STEP_MS = 5000;

/** Number of buckets for a fight of `duration` ms (start and end inclusive). */
function bucketCount(duration, step = STEP_MS) {
    return Math.floor(Math.max(0, duration || 0) / step) + 1;
}

/**
 * A WCL graph series carries its points in one of two shapes: a flat list of
 * values on the `pointStart + i × pointInterval` grid, or Highcharts-style
 * `[timestamp, value]` pairs whose x is the absolute report time itself. This
 * reads either into `{ times, values }` (both absolute ms / plain numbers),
 * or null when the series is unusable. In pair form `pointStart` and
 * `pointInterval` need not be present: the start is the first x, the
 * interval the first gap between two points.
 */
function seriesPoints(s) {
    if (!s || !Array.isArray(s.data) || !s.data.length) return null;
    const pairs = s.data.some((v) => Array.isArray(v));
    if (!pairs) {
        if (!Number.isFinite(s.pointInterval) || s.pointInterval <= 0 || !Number.isFinite(s.pointStart)) return null;
        return {
            pairs: false,
            pointStart: s.pointStart,
            pointInterval: s.pointInterval,
            times: s.data.map((_, i) => s.pointStart + i * s.pointInterval),
            values: s.data.map((v) => Number(v) || 0),
        };
    }
    const times = [];
    const values = [];
    s.data.forEach((v, i) => {
        const t = Array.isArray(v) ? Number(v[0]) : (Number.isFinite(s.pointStart) && Number.isFinite(s.pointInterval) ? s.pointStart + i * s.pointInterval : NaN);
        if (!Number.isFinite(t)) return;
        times.push(t);
        values.push((Array.isArray(v) ? Number(v[1]) : Number(v)) || 0);
    });
    if (!times.length) return null;
    const interval = Number.isFinite(s.pointInterval) && s.pointInterval > 0
        ? s.pointInterval
        : (times.length > 1 && times[1] - times[0] > 0 ? times[1] - times[0] : NaN);
    if (!Number.isFinite(interval)) return null;
    return { pairs: true, pointStart: times[0], pointInterval: interval, times, values };
}

/**
 * The one series of a WCL graph JSON that stands for the whole raid: the
 * "Total" series when the graph carries one, otherwise the per-source series
 * summed on their shared grid. Returns `{ pointStart, pointInterval, total,
 * data }` — plus `times` (absolute ms per value) when the points came as
 * `[timestamp, value]` pairs, so `resample` places them where the log did
 * rather than on an assumed grid — or null when there is nothing usable.
 */
function totalSeries(graph) {
    const list = graph && graph.data && Array.isArray(graph.data.series) ? graph.data.series : null;
    if (!list || list.length === 0) return null;
    const valid = list.map((s) => ({ s, p: seriesPoints(s) })).filter((x) => x.p);
    if (valid.length === 0) return null;
    const total = valid.find(({ s }) => String(s.name || s.type || "").toLowerCase() === "total");
    if (total) {
        const { s, p } = total;
        return { pointStart: p.pointStart, pointInterval: p.pointInterval, total: Number(s.total), data: p.values, ...(p.pairs ? { times: p.times } : {}) };
    }
    // sum on the grid of the earliest series; a flat series on another interval
    // cannot be summed and is skipped, a pair series places itself by its x
    const interval = valid[0].p.pointInterval;
    const base = Math.min(...valid.map(({ p }) => p.pointStart));
    const byTime = new Map();
    let totalSum = 0;
    let anyTotal = false;
    let anyPairs = false;
    for (const { s, p } of valid) {
        if (!p.pairs && p.pointInterval !== interval) continue;
        anyPairs = anyPairs || p.pairs;
        p.times.forEach((t, i) => { byTime.set(t, (byTime.get(t) || 0) + p.values[i]); });
        if (Number.isFinite(Number(s.total))) { totalSum += Number(s.total); anyTotal = true; }
    }
    const out = { pointStart: base, pointInterval: interval, total: anyTotal ? totalSum : NaN };
    if (anyPairs) {
        const times = [...byTime.keys()].sort((a, b) => a - b);
        return { ...out, times, data: times.map((t) => byTime.get(t)) };
    }
    const sums = [];
    for (const [t, v] of byTime) sums[Math.round((t - base) / interval)] = v;
    for (let i = 0; i < sums.length; i++) if (sums[i] === undefined) sums[i] = 0;
    return { ...out, data: sums };
}

/**
 * The per-source series of a WCL graph, mapped onto the roster and resampled
 * onto the fight's buckets. Returns `Map<name, { type, values }>` — only
 * players of `idToPlayer` (matched by actor `id`, else by `name`), a pet
 * folded into its owner where the series names one (`petOwner`/`ownerID`),
 * every other source dropped (see the header). Values are a rate; a source
 * whose values are all 0 is left out.
 *
 * @param {object|null} graph        WCL graph JSON
 * @param {Object<string, { name, type }>} idToPlayer  actor id → roster entry
 * @param {{ startTime: number, duration: number }} fight
 */
function sourceSeries(graph, idToPlayer, fight, step = STEP_MS) {
    const out = new Map();
    const list = graph && graph.data && Array.isArray(graph.data.series) ? graph.data.series : null;
    if (!list || !idToPlayer) return out;
    const byName = new Map(Object.values(idToPlayer).map((p) => [p.name, p]));
    for (const s of list) {
        if (!s || !Array.isArray(s.data) || !s.data.length || !Number.isFinite(s.pointInterval) || s.pointInterval <= 0 || !Number.isFinite(s.pointStart)) continue;
        if (String(s.name || s.type || "").toLowerCase() === "total") continue;
        const ownerId = s.petOwner !== undefined && s.petOwner !== null ? s.petOwner : s.ownerID;
        const player = (ownerId !== undefined && ownerId !== null && idToPlayer[ownerId])
            || (s.id !== undefined && idToPlayer[s.id])
            || (String(s.type || "").toLowerCase() !== "pet" && s.name && byName.get(s.name))
            || null;
        if (!player) continue;
        const values = resample({ pointStart: s.pointStart, pointInterval: s.pointInterval, data: asRate({ ...s, data: s.data.map((v) => Number(v) || 0), total: Number(s.total) }) }, fight, step);
        if (!values.some((v) => v > 0)) continue;
        const prev = out.get(player.name);
        out.set(player.name, { type: player.type, values: prev ? prev.values.map((v, i) => v + values[i]) : values });
    }
    return out;
}

/**
 * The share of a series' buckets that sit below half its own mean — where
 * the raider's output broke in, for whatever reason. Buckets at or after
 * `deathAt` (ms into the fight) are left out on both sides: a dead raider
 * does no damage, and that is not a dip. Returns a whole percentage, or null
 * when nothing is left to judge.
 *
 * @param {number[]} values
 * @param {number} step
 * @param {number|null} [deathAt]
 * @returns {{ pct: number, below: number, buckets: number, mean: number } | null}
 */
function dipShare(values, step, deathAt) {
    if (!Array.isArray(values) || !values.length) return null;
    const alive = Number.isFinite(deathAt) && deathAt !== null ? values.filter((_, k) => k * (step || STEP_MS) < deathAt) : values;
    if (!alive.length) return null;
    const mean = alive.reduce((a, v) => a + (Number(v) || 0), 0) / alive.length;
    if (mean <= 0) return null;
    const below = alive.filter((v) => (Number(v) || 0) < mean / 2).length;
    return { pct: Math.round((below / alive.length) * 100), below, buckets: alive.length, mean: Math.round(mean) };
}

/**
 * The raid-wide summary of the players' series: per raider how many fights
 * carry a curve, the mean output and the dip share over all of them (dip
 * buckets over alive buckets, so a long fight weighs more than a short one).
 * `measure` says which curve the numbers rest on: "hps" for a raider whose
 * healing outweighs their damage, "dps" otherwise — the recommendation
 * leaves healers alone, the page labels the chip accordingly.
 *
 * @returns {null | { players: Array<{ name, type, measure, fights, dipPct, avgDps, avgHps }> }}
 */
function summarizeFightSeries(timeline) {
    const rows = (timeline && timeline.fights) || [];
    const byName = new Map();
    for (const f of rows) {
        const players = f && f.series && Array.isArray(f.series.players) ? f.series.players : [];
        const step = (f.series && f.series.step) || STEP_MS;
        for (const p of players) {
            if (!p || !p.name) continue;
            const death = (f.deaths || []).find((d) => d && d.name === p.name);
            const deathAt = death && Number.isFinite(death.at) ? death.at : null;
            const acc = byName.get(p.name) || { name: p.name, type: p.type, fights: 0, dpsSum: 0, dpsN: 0, hpsSum: 0, hpsN: 0, dip: { dps: [0, 0], hps: [0, 0] } };
            acc.fights++;
            for (const key of ["dps", "hps"]) {
                if (!Array.isArray(p[key]) || !p[key].length) continue;
                acc[`${key}Sum`] += p[key].reduce((a, v) => a + (Number(v) || 0), 0);
                acc[`${key}N`] += p[key].length;
                const d = dipShare(p[key], step, deathAt);
                if (d) { acc.dip[key][0] += d.below; acc.dip[key][1] += d.buckets; }
            }
            byName.set(p.name, acc);
        }
    }
    if (byName.size === 0) return null;
    const players = [...byName.values()].map((a) => {
        const avgDps = a.dpsN ? Math.round(a.dpsSum / a.dpsN) : 0;
        const avgHps = a.hpsN ? Math.round(a.hpsSum / a.hpsN) : 0;
        const measure = avgHps > avgDps ? "hps" : "dps";
        const [below, buckets] = a.dip[measure];
        return { name: a.name, type: a.type, measure, fights: a.fights, dipPct: buckets ? Math.round((below / buckets) * 100) : null, avgDps, avgHps };
    }).sort((x, y) => (y.dipPct || 0) - (x.dipPct || 0) || x.name.localeCompare(y.name));
    return { players };
}

/**
 * Turn the series' values into a rate per second. The schema does not say
 * whether `data[i]` is the throughput at that point (what the site's chart
 * shows) or the amount done in that bin; the series' own `total` decides —
 * whichever reading reproduces it is the one used. Without a total the values
 * are taken as the rate they are drawn as.
 */
function asRate(series) {
    const { data, pointInterval, total } = series;
    const binSec = pointInterval / 1000;
    if (!Number.isFinite(total) || total <= 0 || data.length === 0) return data.slice();
    const sum = data.reduce((a, v) => a + v, 0);
    const perBinErr = Math.abs(sum - total);          // values are the amount done per bin
    const rateErr = Math.abs(sum * binSec - total);   // values are a rate: mean × duration = total
    return perBinErr < rateErr ? data.map((v) => v / binSec) : data.slice();
}

/**
 * Resample a WCL series (absolute report times, its own interval) onto the
 * fight's `step` buckets. A bucket averages the source points inside it; a
 * bucket the source does not reach into (its interval is coarser than the
 * step) holds the last point before it, and a bucket before the first point
 * takes the first. The result has exactly `bucketCount(duration)` entries,
 * rounded to whole units.
 *
 * @param {{ pointStart: number, pointInterval: number, data: number[], times?: number[] }} series
 *        values already a rate; `times` (absolute ms per value) wins over the grid when present
 * @param {{ startTime: number, duration: number }} fight
 */
function resample(series, fight, step = STEP_MS) {
    const n = bucketCount(fight.duration, step);
    const out = new Array(n).fill(0);
    const times = Array.isArray(series.times) && series.times.length === series.data.length
        ? series.times.map((t) => t - fight.startTime)
        : series.data.map((_, i) => series.pointStart + i * series.pointInterval - fight.startTime);
    if (!times.length) return out;
    let last = series.data[0];
    let j = 0;
    for (let k = 0; k < n; k++) {
        const from = k * step;
        const to = from + step;
        let sum = 0;
        let count = 0;
        while (j < times.length && times[j] < to) {
            if (times[j] >= from) { sum += series.data[j]; count++; }
            last = series.data[j];
            j++;
        }
        out[k] = Math.round(count ? sum / count : last);
    }
    return out;
}

/**
 * The hit-point fraction an event reports for `actorId`, in percent, or null.
 * Reads the two shapes WCL attaches with `includeResources`: the
 * `sourceResources` / `targetResources` objects, or `hitPoints` /
 * `maxHitPoints` on the event itself (next to `classResources`), where
 * `resourceActor` says whose numbers they are — 1 = source (the default),
 * 2 = target — the same reading healers.js takes for the mana.
 */
function hpPctOf(ev, actorId) {
    if (!ev) return null;
    const from = (o) => {
        if (!o || typeof o !== "object") return null;
        const hp = Number(o.hitPoints);
        const max = Number(o.maxHitPoints);
        if (!Number.isFinite(hp) || !Number.isFinite(max) || max <= 0) return null;
        return Math.max(0, Math.min(100, (hp / max) * 100));
    };
    const isSource = ev.sourceID === actorId;
    const isTarget = ev.targetID === actorId;
    if (isSource) {
        const pct = from(ev.sourceResources);
        if (pct !== null) return pct;
    }
    if (isTarget) {
        const pct = from(ev.targetResources);
        if (pct !== null) return pct;
    }
    const actor = Number(ev.resourceActor) === 2 ? "target" : "source";
    if ((actor === "source" && isSource) || (actor === "target" && isTarget)) return from(ev);
    return null;
}

/**
 * The actors that are *the boss* of a fight: v1's enemies of type "Boss"
 * that take part in it. A fight without one yields no boss-health series.
 *
 * @returns {Array<{ id: number, name: string }>}
 */
function bossActors(fights, fightId) {
    return ((fights && fights.enemies) || [])
        .filter((e) => e && String(e.type) === "Boss" && Number.isFinite(Number(e.id)))
        .filter((e) => !Array.isArray(e.fights) || e.fights.some((f) => f && f.id === fightId))
        .map((e) => ({ id: Number(e.id), name: e.name || "" }));
}

/**
 * Boss health per bucket from events with resources. The chart draws bucket
 * `k` at the time `k × step`, so its value is the last sample the log saw *up
 * to* that time, held across buckets without one; the mean over the bosses is
 * the one line the chart draws. A council fight (several bosses) keeps each
 * boss's line in `targets` as well; a boss the events never sampled is left
 * out rather than drawn at a made-up level.
 *
 * @returns {null | { bossHp: number[], targets: Array<{ id, name, hp: number[] }> }}
 */
function bossHpSeries(events, bosses, fight, step = STEP_MS) {
    const n = bucketCount(fight.duration, step);
    const targets = [];
    for (const boss of bosses) {
        const samples = new Array(n).fill(null);
        const sampledAt = new Array(n).fill(-1);
        let any = false;
        for (const ev of events || []) {
            if (!ev || !Number.isFinite(ev.timestamp)) continue;
            const pct = hpPctOf(ev, boss.id);
            if (pct === null) continue;
            const at = ev.timestamp - fight.startTime;
            if (at < 0 || at > fight.duration) continue;
            // the first bucket time at or after the sample; the latest sample before it wins
            const k = Math.min(n - 1, Math.ceil(at / step));
            if (at < sampledAt[k]) continue;
            samples[k] = pct;
            sampledAt[k] = at;
            any = true;
        }
        if (!any) continue;
        const first = samples.find((v) => v !== null);
        let last = first;
        const hp = samples.map((v) => {
            if (v !== null) last = v;
            return Math.round(last * 10) / 10;
        });
        if (fight.kill) hp[n - 1] = 0;
        targets.push({ id: boss.id, name: boss.name, hp });
    }
    if (targets.length === 0) return null;
    const bossHp = new Array(n).fill(0).map((_, k) =>
        Math.round((targets.reduce((a, t) => a + t.hp[k], 0) / targets.length) * 10) / 10);
    return { bossHp, targets };
}

/**
 * Fill `timeline.fights[].series` from the WCL v2 API. Mutates the timeline
 * and returns a small summary, or null when there is no client, no
 * configuration or no fight — never throws for one fight's failure.
 *
 * @param {object|null} wclV2     WarcraftLogsV2 client (may be unconfigured)
 * @param {string} reportId
 * @param {object} fights         WCL v1 fights response (for the boss actors)
 * @param {object|null} timeline  from analyzeFightTimeline
 * @param {Object<string, { name, type }>} [idToPlayer]  actor id → roster entry; without it no player series
 * @returns {Promise<null | { fights: number, withSeries: number, withBossHp: number, withPlayers: number }>}
 */
async function analyzeFightSeries(wclV2, reportId, fights, timeline, idToPlayer) {
    if (!wclV2 || typeof wclV2.isConfigured !== "function" || !wclV2.isConfigured()) return null;
    const rows = (timeline && timeline.fights) || [];
    if (rows.length === 0) return null;

    let withSeries = 0;
    let withBossHp = 0;
    let withPlayers = 0;
    for (const f of rows) {
        f.series = null;
        let fetched = null;
        try {
            fetched = await wclV2.getFightSeries(reportId, f.id, f.startTime, f.endTime);
        } catch (e) {
            console.error(`fight series failed for fight ${f.id}:`, e.message);
        }
        if (!fetched) continue;
        const dmg = totalSeries(fetched.damage);
        const heal = totalSeries(fetched.healing);
        const dps = dmg ? resample({ ...dmg, data: asRate(dmg) }, f) : null;
        const hps = heal ? resample({ ...heal, data: asRate(heal) }, f) : null;
        const hp = bossHpSeries(fetched.enemyEvents, bossActors(fights, f.id), f);
        const players = playerSeries(fetched, idToPlayer, f);
        if (!dps && !hps && !hp && !players.length) continue;
        f.series = {
            step: STEP_MS,
            dps,
            hps,
            bossHp: hp ? hp.bossHp : null,
            ...(hp && hp.targets.length > 1 ? { bossHpTargets: hp.targets } : {}),
            ...(players.length ? { players } : {}),
        };
        if (dps || hps) withSeries++;
        if (hp) withBossHp++;
        if (players.length) withPlayers++;
    }
    return { fights: rows.length, withSeries, withBossHp, withPlayers };
}

/**
 * The roster's own curves of one fight from the fetched graphs:
 * `[{ name, type, dps?, hps? }]`, each key only where the player did any of
 * it, a player only where they did either. Roster order is not kept — the
 * list is sorted by name so a re-run yields the same bytes.
 */
function playerSeries(fetched, idToPlayer, fight) {
    if (!idToPlayer) return [];
    const dmg = sourceSeries(fetched.damage, idToPlayer, fight);
    const heal = sourceSeries(fetched.healing, idToPlayer, fight);
    const names = [...new Set([...dmg.keys(), ...heal.keys()])].sort((a, b) => a.localeCompare(b));
    return names.map((name) => {
        const d = dmg.get(name);
        const h = heal.get(name);
        return { name, type: (d || h).type, ...(d ? { dps: d.values } : {}), ...(h ? { hps: h.values } : {}) };
    });
}

module.exports = {
    STEP_MS,
    analyzeFightSeries,
    summarizeFightSeries,
    playerSeries,
    sourceSeries,
    dipShare,
    bucketCount,
    seriesPoints,
    totalSeries,
    asRate,
    resample,
    hpPctOf,
    bossActors,
    bossHpSeries,
};
