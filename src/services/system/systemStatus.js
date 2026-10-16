// The answer of GET /api/system/status (docs/system-status.md), put together from the monitor, the request
// statistics, the disk figures and - when asked for - the top processes of the host. No HTTP here; the route in
// src/web/apiRoutes/system.js only sends it.
//
// The top processes take a second to measure (hostProcesses.js), so the page asks for them only when it opens and
// on its refresh button (`processes: true`), not on every 15-s poll. The last list is kept for PROC_KEEP_MS and goes
// out with every answer (with its time), so the assessment can still name the process that eats the CPU.
const os = require("os");
const monitor = require("./systemMonitor");
const requestStats = require("./requestStats");
const diskUsage = require("./diskUsage");
const hostProcesses = require("./hostProcesses");
const { assess } = require("./assessment");

const PROC_KEEP_MS = 5 * 60 * 1000;

/** What runs the process: pm2 sets pm_id in the environment, Docker leaves /.dockerenv behind. */
function runtimeInfo(env = process.env, exists = () => false) {
    if (env.pm_id !== undefined) return { kind: "pm2", pmId: String(env.pm_id) };
    if (exists("/.dockerenv")) return { kind: "docker" };
    return { kind: "node" };
}

function createSystemStatus(deps = {}) {
    const d = {
        monitor, requestStats, diskUsage, hostProcesses, os,
        now: Date.now,
        platform: process.platform,
        nodeVersion: process.version,
        processUptime: () => process.uptime(),
        env: process.env,
        exists: (p) => require("fs").existsSync(p),
        slowThresholdMs: () => requestStats.slowThresholdMs(),
        ...deps,
    };
    let lastProcs = null; // { at, source, list }

    async function processesFor(ask) {
        if (ask) {
            const res = await d.hostProcesses.topProcesses();
            lastProcs = { at: d.now(), source: res.source, list: res.list };
        }
        if (lastProcs && d.now() - lastProcs.at > PROC_KEEP_MS) lastProcs = null;
        return lastProcs;
    }

    /** The whole status. `processes` measures the top processes anew (one second), `forceDisk` walks data/ again. */
    async function build({ processes = false, forceDisk = false } = {}) {
        const [disk, procs] = await Promise.all([d.diskUsage.get({ force: forceDisk }), processesFor(processes)]);
        const latest = d.monitor.latest();
        const cpus = d.os.cpus() || [];
        const cores = cpus.length || 1;
        const loadSupported = d.platform !== "win32";
        const reqs = d.requestStats.snapshot();
        const samples = d.monitor.recentSamples();
        const now = d.now();
        return {
            now,
            info: {
                platform: d.platform,
                cores,
                cpuModel: (cpus[0] && String(cpus[0].model || "").trim()) || "",
                nodeVersion: d.nodeVersion,
                hostUptime: Math.round(d.os.uptime()),
                processUptime: Math.round(d.processUptime()),
                runtime: runtimeInfo(d.env, d.exists),
                loadSupported,
                sampleMs: d.monitor.SAMPLE_MS || monitor.SAMPLE_MS,
                monitoring: d.monitor.running(),
            },
            current: latest,
            history: d.monitor.history(),
            requests: { threshold: d.slowThresholdMs(), since: reqs.since, routes: reqs.routes, slow: reqs.slow },
            disk: disk ? { ...disk, history: d.diskUsage.history() } : null,
            processes: procs,
            assessment: assess({ samples, now, cores, loadSupported, disk, processes: procs, routes: reqs.routes }),
        };
    }

    return { build };
}

const shared = createSystemStatus();

module.exports = { createSystemStatus, runtimeInfo, build: shared.build, PROC_KEEP_MS };
