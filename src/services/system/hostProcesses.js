// The busiest processes on the host, for the "Systemstatus" page (docs/system-status.md): is it the bot that eats
// the server, or something else next to it (a second bot, a database, a backup)?
//
// Linux only, and only when the page asks (never in the 15-s sample). Two ways, the first that works:
//   /proc  read utime+stime of every process twice, WINDOW_MS apart: the CPU share *right now*
//   ps     `ps -eo pid,comm,%cpu,%mem,rss --sort=-%cpu` (execFile, 2 s timeout): note that ps's %cpu is the average
//          since the process started, so a long-running process that only just went wild looks harmless there
// Only the process name (comm, at most 15 characters), the pid, CPU and memory go out - never a command line, which
// can carry passwords and tokens. On Windows or on any failure the list is empty and the page leaves the part out.
const fsp = require("fs/promises");
const os = require("os");
const { execFile } = require("child_process");

const TOP = 8;
const WINDOW_MS = 1000;
const PS_TIMEOUT_MS = 2000;
/** Clock ticks per second of /proc/<pid>/stat; 100 on every common Linux build. */
const CLK_TCK = 100;
const PAGE_BYTES = 4096;

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

/** One /proc/<pid>/stat line -> { pid, name, ticks, rss } (rss in bytes); null when it does not parse. */
function parseProcStat(text) {
    const s = String(text || "");
    const open = s.indexOf("(");
    const close = s.lastIndexOf(")");
    if (open < 0 || close < open) return null;
    const pid = Number(s.slice(0, open).trim());
    const name = s.slice(open + 1, close);
    const rest = s.slice(close + 1).trim().split(/\s+/);
    // rest[0] is field 3 (state); utime is field 14, stime 15, rss 24
    const utime = Number(rest[11]);
    const stime = Number(rest[12]);
    const rssPages = Number(rest[21]);
    if (!Number.isFinite(pid) || !Number.isFinite(utime) || !Number.isFinite(stime)) return null;
    return { pid, name, ticks: utime + stime, rss: Number.isFinite(rssPages) ? rssPages * PAGE_BYTES : 0 };
}

/** Every readable /proc/<pid>/stat, by pid. */
async function readProcTable(fsApi = fsp) {
    const names = await fsApi.readdir("/proc");
    const table = new Map();
    await Promise.all(names.filter((n) => /^\d+$/.test(n)).map(async (n) => {
        try {
            const row = parseProcStat(await fsApi.readFile(`/proc/${n}/stat`, "utf8"));
            if (row) table.set(row.pid, row);
        } catch {
            // the process ended between readdir and readFile
        }
    }));
    return table;
}

/** The CPU share per process between two tables taken `ms` apart, busiest first. */
function cpuFromTables(before, after, ms, { totalMem = os.totalmem(), selfPid = process.pid, top = TOP } = {}) {
    const seconds = Math.max(0.001, ms / 1000);
    const rows = [];
    for (const [pid, cur] of after) {
        const old = before.get(pid);
        const dTicks = old ? Math.max(0, cur.ticks - old.ticks) : 0;
        rows.push({
            pid,
            name: cur.name,
            cpu: round1((dTicks / (CLK_TCK * seconds)) * 100),
            mem: totalMem ? round1((cur.rss / totalMem) * 100) : 0,
            rss: cur.rss,
            self: pid === selfPid,
        });
    }
    return rows.sort((a, b) => b.cpu - a.cpu || b.rss - a.rss).slice(0, top);
}

/** Parses the output of `ps -eo pid,comm,%cpu,%mem,rss` (rss in KiB) into rows; the header and junk lines are skipped. */
function parsePs(text, { selfPid = process.pid, top = TOP } = {}) {
    const rows = [];
    for (const line of String(text || "").split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5) continue;
        const pid = Number(parts[0]);
        const rssKb = Number(parts[parts.length - 1]);
        const mem = Number(parts[parts.length - 2]);
        const cpu = Number(parts[parts.length - 3]);
        if (!Number.isInteger(pid) || ![rssKb, mem, cpu].every(Number.isFinite)) continue;
        rows.push({ pid, name: parts.slice(1, -3).join(" "), cpu: round1(cpu), mem: round1(mem), rss: rssKb * 1024, self: pid === selfPid });
    }
    return rows.sort((a, b) => b.cpu - a.cpu).slice(0, top);
}

/** Runs ps; resolves to its stdout or "" (never rejects). */
function runPs(exec = execFile) {
    return new Promise((resolve) => {
        try {
            exec("ps", ["-eo", "pid,comm,%cpu,%mem,rss", "--sort=-%cpu"], { timeout: PS_TIMEOUT_MS, windowsHide: true }, (err, stdout) => {
                resolve(err ? "" : String(stdout || ""));
            });
        } catch {
            resolve("");
        }
    });
}

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms).unref?.(); });

/**
 * The top processes: { source: "proc" | "ps" | "", list }. Empty off Linux and on any failure.
 * `deps` lets a test swap the platform, the filesystem, ps and the wait.
 */
async function topProcesses(deps = {}) {
    const platform = deps.platform || process.platform;
    if (platform !== "linux") return { source: "", list: [] };
    const fsApi = deps.fsApi || fsp;
    const sleep = deps.sleep || wait;
    const opts = { totalMem: deps.totalMem ?? os.totalmem(), selfPid: deps.selfPid ?? process.pid };
    try {
        const before = await readProcTable(fsApi);
        if (before.size) {
            await sleep(WINDOW_MS);
            const after = await readProcTable(fsApi);
            const list = cpuFromTables(before, after, WINDOW_MS, opts);
            if (list.length) return { source: "proc", list };
        }
    } catch {
        // no /proc: try ps
    }
    const list = parsePs(await runPs(deps.exec), opts);
    return { source: list.length ? "ps" : "", list };
}

module.exports = { topProcesses, parseProcStat, readProcTable, cpuFromTables, parsePs, runPs, TOP, WINDOW_MS, PS_TIMEOUT_MS };
