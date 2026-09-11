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
 * The one series of a WCL graph JSON that stands for the whole raid: the
 * "Total" series when the graph carries one, otherwise the per-source series
 * summed on their shared grid. Returns `{ pointStart, pointInterval, total,
 * data }` or null when there is nothing usable.
 */
function totalSeries(graph) {
    const list = graph && graph.data && Array.isArray(graph.data.series) ? graph.data.series : null;
    if (!list || list.length === 0) return null;
    const valid = list.filter((s) => s && Array.isArray(s.data) && s.data.length && Number.isFinite(s.pointInterval) && s.pointInterval > 0 && Number.isFinite(s.pointStart));
    if (valid.length === 0) return null;
    const total = valid.find((s) => String(s.name || s.type || "").toLowerCase() === "total");
    if (total) return { pointStart: total.pointStart, pointInterval: total.pointInterval, total: Number(total.total), data: total.data.map((v) => Number(v) || 0) };
    // sum on the grid of the earliest series; a series on another interval cannot be summed and is skipped
    const interval = valid[0].pointInterval;
    const base = Math.min(...valid.map((s) => s.pointStart));
    const sums = [];
    let totalSum = 0;
    let anyTotal = false;
    for (const s of valid) {
        if (s.pointInterval !== interval) continue;
        const offset = Math.round((s.pointStart - base) / interval);
        s.data.forEach((v, i) => { sums[offset + i] = (sums[offset + i] || 0) + (Number(v) || 0); });
        if (Number.isFinite(Number(s.total))) { totalSum += Number(s.total); anyTotal = true; }
    }
    for (let i = 0; i < sums.length; i++) if (sums[i] === undefined) sums[i] = 0;
    return { pointStart: base, pointInterval: interval, total: anyTotal ? totalSum : NaN, data: sums };
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
 * @param {{ pointStart: number, pointInterval: number, data: number[] }} series  values already a rate
 * @param {{ startTime: number, duration: number }} fight
 */
function resample(series, fight, step = STEP_MS) {
    const n = bucketCount(fight.duration, step);
    const out = new Array(n).fill(0);
    const times = series.data.map((_, i) => series.pointStart + i * series.pointInterval - fight.startTime);
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
 * Reads the resource objects WCL attaches with `includeResources`.
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
    if (ev.sourceID === actorId) return from(ev.sourceResources);
    if (ev.targetID === actorId) return from(ev.targetResources);
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
 * @returns {Promise<null | { fights: number, withSeries: number, withBossHp: number }>}
 */
async function analyzeFightSeries(wclV2, reportId, fights, timeline) {
    if (!wclV2 || typeof wclV2.isConfigured !== "function" || !wclV2.isConfigured()) return null;
    const rows = (timeline && timeline.fights) || [];
    if (rows.length === 0) return null;

    let withSeries = 0;
    let withBossHp = 0;
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
        if (!dps && !hps && !hp) continue;
        f.series = {
            step: STEP_MS,
            dps,
            hps,
            bossHp: hp ? hp.bossHp : null,
            ...(hp && hp.targets.length > 1 ? { bossHpTargets: hp.targets } : {}),
        };
        if (dps || hps) withSeries++;
        if (hp) withBossHp++;
    }
    return { fights: rows.length, withSeries, withBossHp };
}

module.exports = {
    STEP_MS,
    analyzeFightSeries,
    bucketCount,
    totalSeries,
    asRate,
    resample,
    hpPctOf,
    bossActors,
    bossHpSeries,
};
