// The system monitor behind the "Systemstatus" page (docs/system-status.md).
//
// Every SAMPLE_MS (15 s) it takes one sample of the host and of this process and keeps 24 hours of them in memory:
//   fine    the raw 15-s samples of the last hour (at most 240)
//   coarse  one point per minute for the last 24 hours (at most 1440): the mean of that minute's samples, the
//           maximum for the event-loop figures (a spike must not be averaged away)
// That is under 2000 small arrays - a few hundred KB at most. Nothing is written to disk; a restart starts empty.
//
// A sample:
//   host     CPU in % (deltas of os.cpus() times), load average, memory available (Linux: MemAvailable from
//            /proc/meminfo, else os.freemem()), swap used (Linux only)
//   process  CPU in % of one core (process.cpuUsage delta / wall time), RSS, heap, external,
//            event-loop delay p50/p99/max of the interval (perf_hooks.monitorEventLoopDelay, reset per sample)
//            and event-loop utilisation (performance.eventLoopUtilization delta)
//
// Started as a background job (src/web/http/jobs.js), never by requiring the module: the timer is unref'd and stop()
// disables the histogram again. Everything the monitor touches comes in through `deps`, so a test drives it with a
// fake os, a fake /proc and a fake clock (test/services/system/systemMonitor.test.js).
const os = require("os");
const fs = require("fs");
const perfHooks = require("perf_hooks");

const SAMPLE_MS = 15 * 1000;
const FINE_MS = 60 * 60 * 1000;
const COARSE_STEP_MS = 60 * 1000;
const HISTORY_MS = 24 * 60 * 60 * 1000;
/** Histogram resolution of the event-loop delay in ms. */
const LOOP_RESOLUTION_MS = 20;

/**
 * The fields of a history point, in this order. The status route sends points as plain arrays with this list once,
 * which keeps 24 h of history small on the wire.
 */
const FIELDS = ["t", "hostCpu", "procCpu", "memAvailPct", "loopP99", "loopMax", "elu", "load1", "swapUsedPct", "rss"];
/** Fields whose minute value is the maximum of its samples instead of the mean. */
const MAX_FIELDS = new Set(["loopP99", "loopMax"]);

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
/**
 * A histogram value as the delay in ms. The histogram records the whole time between two runs of its timer, the
 * resolution included (an idle loop reads ~20 ms with a 20-ms resolution, ~31 ms on Windows with its 15.6-ms clock
 * ticks), so the resolution comes off. An empty histogram reports min/max as huge sentinels: 0.
 */
const loopMs = (ns) => {
    const n = Number(ns);
    if (!(Number.isFinite(n) && n >= 0 && n < 1e12)) return 0;
    return Math.max(0, n / 1e6 - LOOP_RESOLUTION_MS);
};

/** Sums the times of all cores: { idle, total } in ms. */
function cpuTimes(cpus) {
    let idle = 0;
    let total = 0;
    for (const c of cpus || []) {
        const tm = (c && c.times) || {};
        idle += tm.idle || 0;
        total += (tm.user || 0) + (tm.nice || 0) + (tm.sys || 0) + (tm.idle || 0) + (tm.irq || 0);
    }
    return { idle, total };
}

/** Busy share in % between two cpuTimes() readings; 0 when nothing moved. */
function cpuPercent(prev, cur) {
    const dTotal = cur.total - prev.total;
    const dIdle = cur.idle - prev.idle;
    if (!(dTotal > 0)) return 0;
    return Math.min(100, Math.max(0, ((dTotal - dIdle) / dTotal) * 100));
}

/** Parses /proc/meminfo into bytes: { total, available, swapTotal, swapFree } (missing keys stay undefined). */
function parseMeminfo(text) {
    const kb = {};
    for (const line of String(text || "").split("\n")) {
        const m = /^(\w+):\s+(\d+)\s*kB/.exec(line.trim());
        if (m) kb[m[1]] = Number(m[2]) * 1024;
    }
    return { total: kb.MemTotal, available: kb.MemAvailable, swapTotal: kb.SwapTotal, swapFree: kb.SwapFree };
}

/** Folds the samples of one minute into one point: mean, or maximum for the event-loop figures. */
function foldMinute(samples, minuteStart) {
    const point = { t: minuteStart };
    for (const f of FIELDS) {
        if (f === "t") continue;
        const values = samples.map((s) => s[f]).filter((v) => typeof v === "number" && Number.isFinite(v));
        if (!values.length) { point[f] = 0; continue; }
        point[f] = MAX_FIELDS.has(f)
            ? Math.max(...values)
            : round1(values.reduce((a, b) => a + b, 0) / values.length);
    }
    return point;
}

/** A sample as the array FIELDS describes. */
const toRow = (s) => FIELDS.map((f) => s[f] ?? 0);

function defaultDeps() {
    return {
        os,
        now: Date.now,
        hrtimeMs: () => Number(process.hrtime.bigint()) / 1e6,
        cpuUsage: (prev) => process.cpuUsage(prev),
        memoryUsage: () => process.memoryUsage(),
        readMeminfo: () => fs.readFileSync("/proc/meminfo", "utf8"),
        createLoopHistogram: () => perfHooks.monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS }),
        eventLoopUtilization: (a, b) => perfHooks.performance.eventLoopUtilization(a, b),
        setInterval: (fn, ms) => setInterval(fn, ms),
        clearInterval: (t) => clearInterval(t),
    };
}

/**
 * A monitor. The module exports one (`start`, `stop`, `sampleNow`, `history`, `latest`) for the job list and the
 * status route; tests build their own with fake deps.
 */
function createMonitor(overrides = {}) {
    const deps = { ...defaultDeps(), ...overrides };
    let timer = null;
    let histogram = null;
    let prev = null; // { cpu, usage, wallMs, elu }
    const fine = [];
    const coarse = [];
    let pendingMinute = null; // { minute, samples }
    let last = null;

    /** Host memory and swap in bytes; /proc/meminfo where there is one, else what os knows. */
    function memory() {
        const total = deps.os.totalmem();
        let available = deps.os.freemem();
        let swapTotal = 0;
        let swapUsed = 0;
        let swapKnown = false;
        try {
            const mi = parseMeminfo(deps.readMeminfo());
            if (mi.available !== undefined) available = mi.available;
            if (mi.swapTotal !== undefined && mi.swapFree !== undefined) {
                swapTotal = mi.swapTotal;
                swapUsed = Math.max(0, mi.swapTotal - mi.swapFree);
                swapKnown = true;
            }
        } catch {
            // not Linux (or /proc not readable): os.freemem() it is, swap unknown
        }
        return { total, available, swapTotal, swapUsed, swapKnown };
    }

    function baseline() {
        return {
            cpu: cpuTimes(deps.os.cpus()),
            usage: deps.cpuUsage(),
            wallMs: deps.hrtimeMs(),
            elu: deps.eventLoopUtilization(),
        };
    }

    function addToHistory(sample) {
        fine.push(sample);
        const fineFrom = sample.t - FINE_MS;
        while (fine.length && fine[0].t <= fineFrom) fine.shift();
        const minute = Math.floor(sample.t / COARSE_STEP_MS);
        if (pendingMinute && pendingMinute.minute !== minute) {
            coarse.push(foldMinute(pendingMinute.samples, pendingMinute.minute * COARSE_STEP_MS));
            pendingMinute = null;
        }
        if (!pendingMinute) pendingMinute = { minute, samples: [] };
        pendingMinute.samples.push(sample);
        const coarseFrom = sample.t - HISTORY_MS;
        while (coarse.length && coarse[0].t <= coarseFrom) coarse.shift();
    }

    /** Takes one sample now, keeps it and returns it. The first call only sets the baseline for the deltas. */
    function sampleNow() {
        if (!prev) {
            prev = baseline();
            return null;
        }
        const cur = baseline();
        const cores = (deps.os.cpus() || []).length || 1;
        const wallMs = Math.max(1, cur.wallMs - prev.wallMs);
        const used = deps.cpuUsage(prev.usage);
        const procCpu = (((used.user || 0) + (used.system || 0)) / 1000 / wallMs) * 100;
        const eluDelta = deps.eventLoopUtilization(cur.elu, prev.elu);
        const mem = memory();
        const pm = deps.memoryUsage();
        const load = deps.os.loadavg() || [0, 0, 0];
        let loopP50 = 0;
        let loopP99 = 0;
        let loopMax = 0;
        if (histogram) {
            const count = histogram.count === undefined ? 1 : histogram.count;
            if (count > 0) {
                loopP50 = loopMs(histogram.percentile(50));
                loopP99 = loopMs(histogram.percentile(99));
                loopMax = loopMs(histogram.max);
            }
            histogram.reset();
        }
        const sample = {
            t: deps.now(),
            hostCpu: round1(cpuPercent(prev.cpu, cur.cpu)),
            procCpu: round1(procCpu),
            cores,
            load1: round2(load[0]),
            load5: round2(load[1]),
            load15: round2(load[2]),
            memTotal: mem.total,
            memAvail: mem.available,
            memAvailPct: mem.total ? round1((mem.available / mem.total) * 100) : 0,
            swapTotal: mem.swapTotal,
            swapUsed: mem.swapUsed,
            swapKnown: mem.swapKnown,
            swapUsedPct: mem.swapTotal ? round1((mem.swapUsed / mem.swapTotal) * 100) : 0,
            rss: pm.rss || 0,
            heapUsed: pm.heapUsed || 0,
            heapTotal: pm.heapTotal || 0,
            external: pm.external || 0,
            loopP50: round1(loopP50),
            loopP99: round1(loopP99),
            loopMax: round1(loopMax),
            elu: round1(((eluDelta && eluDelta.utilization) || 0) * 100),
        };
        prev = cur;
        last = sample;
        addToHistory(sample);
        return sample;
    }

    /** Starts sampling every SAMPLE_MS (idempotent). The first real sample comes one interval after the start. */
    function start() {
        if (timer) return;
        try {
            histogram = deps.createLoopHistogram();
            if (histogram) histogram.enable();
        } catch {
            histogram = null;
        }
        sampleNow();
        timer = deps.setInterval(() => {
            try { sampleNow(); } catch { /* a failed sample is skipped, the next one tries again */ }
        }, SAMPLE_MS);
        if (timer && typeof timer.unref === "function") timer.unref();
    }

    /** Stops sampling and the histogram; the history is kept (idempotent). */
    function stop() {
        if (timer) deps.clearInterval(timer);
        timer = null;
        if (histogram) {
            try { histogram.disable(); } catch { /* already off */ }
        }
        histogram = null;
        prev = null;
    }

    /**
     * The history for the charts: the last hour in 15-s steps and the last 24 hours in minute steps (the minute in
     * progress included), each point an array in FIELDS order.
     */
    function history() {
        const day = [...coarse];
        if (pendingMinute && pendingMinute.samples.length) {
            day.push(foldMinute(pendingMinute.samples, pendingMinute.minute * COARSE_STEP_MS));
        }
        return {
            fields: FIELDS,
            hour: { step: SAMPLE_MS, points: fine.map(toRow) },
            day: { step: COARSE_STEP_MS, points: day.map(toRow) },
        };
    }

    /** The raw samples of the last hour (objects), for the assessment. */
    const recentSamples = () => fine.map((s) => ({ ...s }));

    return {
        start, stop, sampleNow, history, recentSamples,
        latest: () => (last ? { ...last } : null),
        running: () => !!timer,
    };
}

const shared = createMonitor();

module.exports = {
    createMonitor, cpuTimes, cpuPercent, parseMeminfo, foldMinute,
    start: shared.start, stop: shared.stop, sampleNow: shared.sampleNow, history: shared.history,
    recentSamples: shared.recentSamples, latest: shared.latest, running: shared.running,
    SAMPLE_MS, FINE_MS, COARSE_STEP_MS, HISTORY_MS, FIELDS,
};
