// The top processes of the host (docs/system-status.md): /proc read twice, ps as the fallback, nothing off Linux,
// and never a command line.
const {
    topProcesses, parseProcStat, readProcTable, cpuFromTables, parsePs, runPs, PS_TIMEOUT_MS,
} = require("../../../src/services/system/hostProcesses");

/** A /proc/<pid>/stat line with the given name, cpu ticks and rss pages. */
const statLine = (pid, name, utime, stime, rssPages = 100) => {
    const fields = ["S", "1", "1", "1", "0", "-1", "4194560", "0", "0", "0", "0", String(utime), String(stime), "0", "0", "20", "0", "1", "0", "100", "1000000", String(rssPages)];
    return `${pid} (${name}) ${fields.join(" ")}`;
};

/** A fake /proc whose tick counts move between two reads. */
function fakeProc(rounds) {
    let round = 0;
    return {
        readdir: jest.fn(async () => ["1", "42", "self", "77"]),
        readFile: jest.fn(async (file) => {
            const pid = file.split("/")[2];
            const row = rounds[Math.min(round, rounds.length - 1)][pid];
            if (!row) throw new Error("ENOENT");
            return row;
        }),
        next() { round += 1; },
    };
}

describe("parseProcStat", () => {
    it("reads pid, name (spaces and parentheses included), ticks and rss", () => {
        expect(parseProcStat(statLine(42, "node", 300, 200, 1000))).toEqual({ pid: 42, name: "node", ticks: 500, rss: 4096000 });
        expect(parseProcStat(statLine(7, "Web (Content) x", 1, 2))).toMatchObject({ pid: 7, name: "Web (Content) x", ticks: 3 });
    });

    it("is null for junk", () => {
        expect(parseProcStat("")).toBeNull();
        expect(parseProcStat("12 nothing")).toBeNull();
        expect(parseProcStat("x (a) S")).toBeNull();
    });
});

describe("cpuFromTables", () => {
    it("turns tick deltas into a share of one core per second, marks the bot, busiest first", () => {
        const before = new Map([[1, { pid: 1, name: "systemd", ticks: 10, rss: 1000 }], [42, { pid: 42, name: "node", ticks: 100, rss: 8192 }]]);
        const after = new Map([[1, { pid: 1, name: "systemd", ticks: 11, rss: 1000 }], [42, { pid: 42, name: "node", ticks: 150, rss: 8192 }], [9, { pid: 9, name: "new", ticks: 5, rss: 0 }]]);
        expect(cpuFromTables(before, after, 1000, { totalMem: 81920, selfPid: 42 })).toEqual([
            { pid: 42, name: "node", cpu: 50, mem: 10, rss: 8192, self: true },
            { pid: 1, name: "systemd", cpu: 1, mem: 1.2, rss: 1000, self: false },
            { pid: 9, name: "new", cpu: 0, mem: 0, rss: 0, self: false },
        ]);
    });
});

describe("parsePs", () => {
    const OUT = [
        "    PID COMMAND         %CPU %MEM   RSS",
        "   1234 mysqld          87.5 12.0 491520",
        "     42 node            12.1  4.2 172032",
        "    777 Web Content      1.0  0.5  20480",
        "garbage",
        "",
    ].join("\n");

    it("reads pid, name, cpu, mem and rss (KiB -> bytes), busiest first", () => {
        expect(parsePs(OUT, { selfPid: 42 })).toEqual([
            { pid: 1234, name: "mysqld", cpu: 87.5, mem: 12, rss: 491520 * 1024, self: false },
            { pid: 42, name: "node", cpu: 12.1, mem: 4.2, rss: 172032 * 1024, self: true },
            { pid: 777, name: "Web Content", cpu: 1, mem: 0.5, rss: 20480 * 1024, self: false },
        ]);
    });

    it("keeps to the top rows and is empty for nothing", () => {
        expect(parsePs(OUT, { top: 1 })).toHaveLength(1);
        expect(parsePs("")).toEqual([]);
    });
});

describe("runPs", () => {
    it("asks ps for names only (no command line) with a timeout", async () => {
        const exec = jest.fn((cmd, args, opts, cb) => cb(null, "out"));
        expect(await runPs(exec)).toBe("out");
        expect(exec).toHaveBeenCalledWith("ps", ["-eo", "pid,comm,%cpu,%mem,rss", "--sort=-%cpu"], expect.objectContaining({ timeout: PS_TIMEOUT_MS }), expect.any(Function));
        expect(exec.mock.calls[0][1].join(" ")).not.toMatch(/args|cmd|command/);
    });

    it("answers empty on an error or a throw", async () => {
        expect(await runPs((c, a, o, cb) => cb(new Error("ENOENT")))).toBe("");
        expect(await runPs(() => { throw new Error("spawn"); })).toBe("");
    });
});

describe("topProcesses", () => {
    it("is empty off Linux", async () => {
        const exec = jest.fn();
        expect(await topProcesses({ platform: "win32", exec })).toEqual({ source: "", list: [] });
        expect(exec).not.toHaveBeenCalled();
    });

    it("measures over /proc on Linux", async () => {
        const proc = fakeProc([
            { 1: statLine(1, "systemd", 0, 0), 42: statLine(42, "node", 100, 0), 77: statLine(77, "backup", 0, 0) },
            { 1: statLine(1, "systemd", 0, 0), 42: statLine(42, "node", 120, 0), 77: statLine(77, "backup", 90, 0) },
        ]);
        const res = await topProcesses({ platform: "linux", fsApi: proc, sleep: async () => proc.next(), selfPid: 42, totalMem: 1e9 });
        expect(res.source).toBe("proc");
        expect(res.list.map((p) => [p.name, p.cpu, p.self])).toEqual([["backup", 90, false], ["node", 20, true], ["systemd", 0, false]]);
        expect(proc.readFile).toHaveBeenCalledWith("/proc/42/stat", "utf8");
    });

    it("falls back to ps without /proc, and to nothing without ps", async () => {
        const noProc = { readdir: async () => { throw new Error("ENOENT"); } };
        const exec = (c, a, o, cb) => cb(null, "PID COMMAND %CPU %MEM RSS\n5 java 99 10 1000\n");
        expect(await topProcesses({ platform: "linux", fsApi: noProc, exec, selfPid: 1 })).toEqual({
            source: "ps", list: [{ pid: 5, name: "java", cpu: 99, mem: 10, rss: 1024000, self: false }],
        });
        expect(await topProcesses({ platform: "linux", fsApi: noProc, exec: (c, a, o, cb) => cb(new Error("x")) })).toEqual({ source: "", list: [] });
    });

    it("reads the proc table with the real fs shape", async () => {
        const proc = fakeProc([{ 1: statLine(1, "init", 1, 1), 42: "broken" }]);
        const table = await readProcTable(proc);
        expect([...table.keys()]).toEqual([1]);
    });
});
