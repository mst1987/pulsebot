// The verdict at the top of the "Systemstatus" page (docs/system-status.md): where the load comes from and whether
// the server is too small. Pure - it reads the samples of systemMonitor.js, the disk figures, the top processes and
// the route statistics and returns findings; the page turns each finding's id and values into a sentence in the
// reader's language (i18n `system.findings.<id>`), with the numbers it rests on and a recommendation.
//
// "For a longer time" means: in at least SUSTAINED_SHARE of the samples of the last WINDOW_MS. A single spike is no
// finding; the charts show it anyway.

const WINDOW_MS = 15 * 60 * 1000;
/** Fewer samples than this (one minute) and only the disk is judged: the rest would be guesswork. */
const MIN_SAMPLES = 4;
const SUSTAINED_SHARE = 0.6;

/** Host CPU in % above which the server counts as busy. */
const HOST_CPU_HIGH = 85;
/** The bot's part of the host CPU below this share of the host's load = someone else causes it. */
const OWN_SHARE_LOW = 0.5;
/** The bot's CPU in % of one core above which it is its own bottleneck (Node runs JavaScript on one core). */
const PROC_CPU_HIGH = 85;
/** Event-loop delay (p99 of a sample) in ms above which requests queue up behind each other. */
const LOOP_P99_HIGH_MS = 200;
/** Share of samples above LOOP_P99_HIGH_MS that counts (blocking is felt even when it is not constant). */
const LOOP_SHARE = 0.25;
/** Event-loop p99 in ms that makes it "bad" rather than "warn". */
const LOOP_P99_BAD_MS = 1000;
/** Available memory in % of the total below which the server is short of memory. */
const MEM_AVAIL_LOW_PCT = 10;
/** Swap use in % of the swap space above which it counts as heavy. */
const SWAP_HIGH_PCT = 50;
/** Free disk space in % below which there is a warning, and below which it is critical. */
const DISK_FREE_LOW_PCT = 10;
const DISK_FREE_CRITICAL_PCT = 5;
/** Slowest routes named in a finding. */
const ROUTES_NAMED = 3;

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const avg = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const share = (values, test) => (values.length ? values.filter(test).length / values.length : 0);
const LEVELS = { ok: 0, warn: 1, bad: 2 };

/** The slowest routes of the last hour by p95 (only routes that ran), for a finding that blames the bot. */
function slowestRoutes(routes, n = ROUTES_NAMED) {
    return (routes || [])
        .filter((r) => r && r.hour && r.hour.count > 0)
        .sort((a, b) => b.hour.p95 - a.hour.p95)
        .slice(0, n)
        .map((r) => ({ route: r.route, p95: r.hour.p95, count: r.hour.count }));
}

/** The busiest process that is not the bot itself, or null. */
function topForeign(processes) {
    const list = (processes && processes.list) || [];
    return list.find((p) => !p.self) || null;
}

/** The bot itself: a core at its limit, or an event loop that blocks. Returns [finding?, procBusy]. */
function botFinding(recent, routes) {
    const proc = recent.map((s) => s.procCpu);
    const loopValues = recent.map((s) => s.loopP99);
    const loopShare = share(loopValues, (v) => v >= LOOP_P99_HIGH_MS);
    const procBusy = share(proc, (v) => v >= PROC_CPU_HIGH) >= SUSTAINED_SHARE;
    if (!procBusy && loopShare < LOOP_SHARE) return [null, false];
    return [{
        id: "botBottleneck",
        // a core at its limit or a loop blocking for seconds is "bad"; a loop that stalls now and then a warning
        level: procBusy || avg(loopValues) >= LOOP_P99_BAD_MS ? "bad" : "warn",
        values: {
            procCpu: round1(avg(proc)),
            loopP99: round1(Math.max(...loopValues)),
            loopShare: Math.round(loopShare * 100),
            cause: procBusy ? "cpu" : "loop",
        },
        routes: slowestRoutes(routes),
    }, procBusy];
}

/** The host is busy: because of something else, or (without the bot at its limit) mostly because of the bot. */
function hostFinding(recent, nCores, processes, procBusy) {
    const host = recent.map((s) => s.hostCpu);
    if (share(host, (v) => v >= HOST_CPU_HIGH) < SUSTAINED_SHARE) return null;
    const hostAvg = avg(host);
    // the bot's CPU as a share of the whole host (procCpu is per core)
    const botHostShare = avg(recent.map((s) => s.procCpu)) / nCores;
    if (botHostShare < hostAvg * OWN_SHARE_LOW) {
        const foreign = topForeign(processes);
        return {
            id: "otherProcess",
            level: "bad",
            values: {
                hostCpu: round1(hostAvg),
                botCpu: round1(botHostShare),
                process: foreign ? foreign.name : "",
                processCpu: foreign ? foreign.cpu : 0,
            },
        };
    }
    if (procBusy) return null; // botBottleneck already says it
    return { id: "hostBusy", level: "warn", values: { hostCpu: round1(hostAvg), botCpu: round1(botHostShare), cores: nCores } };
}

/** The load average: more runnable work than cores, for a longer time. */
function loadFinding(recent, nCores) {
    const last = recent[recent.length - 1];
    const loadHigh = share(recent, (s) => s.load5 > nCores) >= SUSTAINED_SHARE || last.load15 > nCores;
    if (!loadHigh) return null;
    return {
        id: "cpuOverloaded",
        level: last.load15 > 2 * nCores ? "bad" : "warn",
        values: { load5: last.load5, load15: last.load15, cores: nCores },
    };
}

/** Memory: little left (mean of the last five minutes), or a swap space more than half used. */
function memoryFinding(recent, now) {
    const last = recent[recent.length - 1];
    const memRecent = recent.filter((s) => s.t > now - 5 * 60 * 1000);
    const memAvailPct = avg(memRecent.map((s) => s.memAvailPct));
    const swapUsedPct = last.swapTotal > 0 ? last.swapUsedPct : 0;
    const memLow = memRecent.length > 0 && memAvailPct < MEM_AVAIL_LOW_PCT;
    if (!memLow && swapUsedPct < SWAP_HIGH_PCT) return null;
    return {
        id: "memoryLow",
        level: memLow ? "bad" : "warn",
        values: {
            memAvailPct: round1(memAvailPct),
            memAvail: last.memAvail || 0,
            memTotal: last.memTotal || 0,
            swapUsedPct: round1(swapUsedPct),
            cause: memLow ? "ram" : "swap",
        },
    };
}

/** The disk, judged from the first second on: it does not need a history. */
function diskFinding(disk) {
    if (!disk || !disk.known || !(disk.total > 0)) return null;
    const freePct = (disk.free / disk.total) * 100;
    if (freePct >= DISK_FREE_LOW_PCT) return null;
    return {
        id: "diskLow",
        level: freePct < DISK_FREE_CRITICAL_PCT ? "bad" : "warn",
        values: { freePct: round1(freePct), free: disk.free, total: disk.total },
    };
}

/**
 * The findings for the current state.
 * @param {object} input
 *   samples         systemMonitor's recent samples (objects, oldest first)
 *   now             the time to judge at (ms)
 *   cores           number of CPU cores
 *   loadSupported   false where the OS has no load average (Windows reports 0)
 *   disk            { known, total, free } or null
 *   processes       { list: [{ pid, name, cpu, self }] } or null
 *   routes          requestStats.snapshot().routes
 * @returns {{ level: "ok"|"warn"|"bad", warmingUp: boolean, findings: object[] }}
 */
function assess({ samples = [], now = Date.now(), cores = 1, loadSupported = true, disk = null, processes = null, routes = [] } = {}) {
    const recent = samples.filter((s) => s && s.t > now - WINDOW_MS);
    const warmingUp = recent.length < MIN_SAMPLES;
    const nCores = Math.max(1, Number(cores) || 1);
    const findings = [];
    if (!warmingUp) {
        const [bot, procBusy] = botFinding(recent, routes);
        findings.push(bot, hostFinding(recent, nCores, processes, procBusy));
        if (loadSupported) findings.push(loadFinding(recent, nCores));
        findings.push(memoryFinding(recent, now));
    }
    findings.push(diskFinding(disk));
    const found = findings.filter(Boolean);
    const level = found.reduce((worst, f) => (LEVELS[f.level] > LEVELS[worst] ? f.level : worst), "ok");
    found.sort((a, b) => LEVELS[b.level] - LEVELS[a.level]);
    return { level, warmingUp, findings: found };
}

module.exports = {
    assess, slowestRoutes,
    WINDOW_MS, MIN_SAMPLES, SUSTAINED_SHARE, HOST_CPU_HIGH, OWN_SHARE_LOW, PROC_CPU_HIGH, LOOP_P99_HIGH_MS, LOOP_SHARE,
    LOOP_P99_BAD_MS, MEM_AVAIL_LOW_PCT, SWAP_HIGH_PCT, DISK_FREE_LOW_PCT, DISK_FREE_CRITICAL_PCT,
};
