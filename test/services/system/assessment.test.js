// The verdict of the "Systemstatus" page (docs/system-status.md): one rule per cause, each with the numbers it
// rests on, and "all good" when none fires.
const {
    assess, slowestRoutes, WINDOW_MS, HOST_CPU_HIGH, PROC_CPU_HIGH, LOOP_P99_HIGH_MS, MEM_AVAIL_LOW_PCT,
} = require("../../../src/services/system/assessment");

const NOW = 100 * 60 * 60 * 1000;
const GB = 1024 ** 3;

/** `n` samples 15 s apart up to NOW, each a calm state with `over` applied (a function gets the index). */
function samples(n, over = {}) {
    return Array.from({ length: n }, (_, i) => ({
        t: NOW - (n - 1 - i) * 15000,
        hostCpu: 20, procCpu: 10, memAvailPct: 50, memAvail: 4 * GB, memTotal: 8 * GB,
        swapTotal: 2 * GB, swapUsedPct: 0, loopP99: 20, loopMax: 40, load1: 0.5, load5: 0.5, load15: 0.5,
        ...(typeof over === "function" ? over(i) : over),
    }));
}

const routes = [
    { route: "/api/raids", hour: { count: 40, p95: 300 } },
    { route: "/r/:id", hour: { count: 3, p95: 4200 } },
    { route: "/api/cla", hour: { count: 2, p95: 1800 } },
    { route: "/api/roster", hour: { count: 10, p95: 900 } },
    { route: "/api/idle", hour: { count: 0, p95: 0 } },
];

describe("assess", () => {
    it("is all good for a calm server", () => {
        expect(assess({ samples: samples(60), now: NOW, cores: 2 })).toEqual({ level: "ok", warmingUp: false, findings: [] });
    });

    it("judges nothing but the disk while there is less than a minute of samples", () => {
        const res = assess({ samples: samples(2, { hostCpu: 100, procCpu: 100 }), now: NOW, cores: 1, disk: { known: true, total: 100, free: 50 } });
        expect(res).toEqual({ level: "ok", warmingUp: true, findings: [] });
    });

    it("blames another process when the host is busy and the bot is not", () => {
        const res = assess({
            samples: samples(60, { hostCpu: 95, procCpu: 20 }),
            now: NOW, cores: 4,
            processes: { list: [{ pid: 42, name: "node", cpu: 20, self: true }, { pid: 7, name: "mysqld", cpu: 340 }] },
        });
        expect(res.level).toBe("bad");
        expect(res.findings).toEqual([{ id: "otherProcess", level: "bad", values: { hostCpu: 95, botCpu: 5, process: "mysqld", processCpu: 340 } }]);
    });

    it("blames another process without naming one when no list was measured", () => {
        const res = assess({ samples: samples(60, { hostCpu: 90, procCpu: 5 }), now: NOW, cores: 2 });
        expect(res.findings[0]).toMatchObject({ id: "otherProcess", values: { process: "", processCpu: 0 } });
    });

    it("names the bot when it runs one core at its limit, with the slowest routes of the hour", () => {
        const res = assess({ samples: samples(60, { procCpu: PROC_CPU_HIGH + 10, hostCpu: 50 }), now: NOW, cores: 2, routes });
        expect(res.findings).toEqual([{
            id: "botBottleneck",
            level: "bad",
            values: { procCpu: 95, loopP99: 20, loopShare: 0, cause: "cpu" },
            routes: [{ route: "/r/:id", p95: 4200, count: 3 }, { route: "/api/cla", p95: 1800, count: 2 }, { route: "/api/roster", p95: 900, count: 10 }],
        }]);
    });

    it("names the bot when its event loop blocks in a quarter of the samples", () => {
        const res = assess({ samples: samples(40, (i) => ({ loopP99: i % 4 === 0 ? LOOP_P99_HIGH_MS + 50 : 10 })), now: NOW, cores: 2 });
        expect(res.findings).toEqual([expect.objectContaining({ id: "botBottleneck", level: "warn", values: { procCpu: 10, loopP99: 250, loopShare: 25, cause: "loop" } })]);
    });

    it("does not count a single spike", () => {
        const res = assess({ samples: samples(60, (i) => (i === 30 ? { loopP99: 3000, hostCpu: 100, procCpu: 100 } : {})), now: NOW, cores: 1 });
        expect(res.findings).toEqual([]);
    });

    it("ignores samples older than the window", () => {
        const old = samples(60, { hostCpu: 99, procCpu: 1 }).map((s) => ({ ...s, t: s.t - WINDOW_MS - 60000 }));
        expect(assess({ samples: [...old, ...samples(10)], now: NOW, cores: 2 }).findings).toEqual([]);
    });

    it("says the host is busy (warn) when the bot carries most of it without being at its limit", () => {
        const res = assess({ samples: samples(60, { hostCpu: HOST_CPU_HIGH + 5, procCpu: 70 }), now: NOW, cores: 1 });
        expect(res.findings).toEqual([{ id: "hostBusy", level: "warn", values: { hostCpu: 90, botCpu: 70, cores: 1 } }]);
    });

    it("reports a load above the cores, bad from twice the cores, and not where there is no load average", () => {
        const warn = assess({ samples: samples(60, { load5: 3, load15: 2.5 }), now: NOW, cores: 2 });
        expect(warn.findings).toEqual([{ id: "cpuOverloaded", level: "warn", values: { load5: 3, load15: 2.5, cores: 2 } }]);
        const bad = assess({ samples: samples(60, { load5: 6, load15: 5 }), now: NOW, cores: 2 });
        expect(bad.findings[0]).toMatchObject({ id: "cpuOverloaded", level: "bad" });
        expect(assess({ samples: samples(60, { load5: 6, load15: 5 }), now: NOW, cores: 2, loadSupported: false }).findings).toEqual([]);
    });

    it("reports too little memory (bad) and heavy swapping (warn)", () => {
        const ram = assess({ samples: samples(60, { memAvailPct: MEM_AVAIL_LOW_PCT - 4, memAvail: 0.5 * GB }), now: NOW, cores: 2 });
        expect(ram.findings).toEqual([{ id: "memoryLow", level: "bad", values: { memAvailPct: 6, memAvail: 0.5 * GB, memTotal: 8 * GB, swapUsedPct: 0, cause: "ram" } }]);
        const swap = assess({ samples: samples(60, { swapUsedPct: 70 }), now: NOW, cores: 2 });
        expect(swap.findings).toEqual([expect.objectContaining({ id: "memoryLow", level: "warn", values: expect.objectContaining({ swapUsedPct: 70, cause: "swap" }) })]);
        // no swap space at all is no swap problem
        expect(assess({ samples: samples(60, { swapUsedPct: 70, swapTotal: 0 }), now: NOW, cores: 2 }).findings).toEqual([]);
    });

    it("warns below 10 % free disk and calls it bad below 5 %", () => {
        expect(assess({ samples: [], now: NOW, disk: { known: true, total: 1000, free: 80 } }).findings)
            .toEqual([{ id: "diskLow", level: "warn", values: { freePct: 8, free: 80, total: 1000 } }]);
        expect(assess({ samples: [], now: NOW, disk: { known: true, total: 1000, free: 20 } }).level).toBe("bad");
        expect(assess({ samples: [], now: NOW, disk: { known: false, total: 0, free: 0 } }).findings).toEqual([]);
    });

    it("lists the worst finding first and takes the worst level", () => {
        const res = assess({
            samples: samples(60, { load5: 3, load15: 2.5, memAvailPct: 3 }),
            now: NOW, cores: 2, disk: { known: true, total: 1000, free: 80 },
        });
        expect(res.level).toBe("bad");
        expect(res.findings.map((f) => [f.id, f.level])).toEqual([["memoryLow", "bad"], ["cpuOverloaded", "warn"], ["diskLow", "warn"]]);
    });

    it("works with no input at all", () => {
        expect(assess()).toEqual({ level: "ok", warmingUp: true, findings: [] });
    });
});

describe("slowestRoutes", () => {
    it("takes routes that ran in the last hour, slowest p95 first", () => {
        expect(slowestRoutes(routes, 2)).toEqual([{ route: "/r/:id", p95: 4200, count: 3 }, { route: "/api/cla", p95: 1800, count: 2 }]);
        expect(slowestRoutes(undefined)).toEqual([]);
    });
});
