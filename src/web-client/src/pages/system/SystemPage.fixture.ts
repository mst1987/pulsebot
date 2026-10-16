// A system status for the page's tests (SystemPage.test.tsx): a calm server
// with a little history, two routes and a data directory; `over` changes a part.
import type { SystemStatus } from "../../api";

export const NOW = Date.UTC(2026, 9, 9, 18, 0, 0);
const GB = 1024 ** 3;
const FIELDS = ["t", "hostCpu", "procCpu", "memAvailPct", "loopP99", "loopMax", "elu", "load1", "swapUsedPct", "rss"];

export function systemStatus(over: Partial<SystemStatus> = {}): SystemStatus {
    const points = Array.from({ length: 8 }, (_, i) => [NOW - (7 - i) * 15000, 20 + i, 5 + i, 60, 12, 30, 8, 0.4, 0, 300e6]);
    return {
        now: NOW,
        info: {
            platform: "linux", cores: 4, cpuModel: "Fake CPU", nodeVersion: "v22.3.0", hostUptime: 3 * 86400 + 4 * 3600,
            processUptime: 2 * 3600 + 5 * 60, runtime: { kind: "pm2", pmId: "0" }, loadSupported: true, sampleMs: 15000, monitoring: true,
        },
        current: {
            t: NOW, hostCpu: 27, procCpu: 12, cores: 4, load1: 0.42, load5: 0.5, load15: 0.6,
            memTotal: 8 * GB, memAvail: 4.5 * GB, memAvailPct: 56.3, swapTotal: 2 * GB, swapUsed: 0, swapKnown: true, swapUsedPct: 0,
            rss: 300e6, heapUsed: 120e6, heapTotal: 160e6, external: 6e6, loopP50: 3, loopP99: 14, loopMax: 40, elu: 9,
        },
        history: { fields: FIELDS, hour: { step: 15000, points }, day: { step: 60000, points: points.slice(0, 2) } },
        requests: {
            threshold: 1000,
            since: NOW - 2 * 3600 * 1000,
            routes: [
                { route: "/api/raids", total: { count: 120, avg: 80, p95: 200, max: 900, slow: 0 }, hour: { count: 40, avg: 70, p95: 150, max: 400, slow: 0 } },
                { route: "/r/:id", total: { count: 6, avg: 2400, p95: 5200, max: 6100, slow: 4 }, hour: { count: 2, avg: 3100, p95: 5200, max: 5200, slow: 2 } },
                { route: "/api/cla", total: { count: 3, avg: 300, p95: 500, max: 500, slow: 0 }, hour: { count: 0, avg: 0, p95: 0, max: 0, slow: 0 } },
            ],
            slow: [{ t: NOW - 60000, method: "GET", path: "/r/:id", status: 200, ms: 5200 }],
        },
        disk: {
            at: NOW, known: true, total: 50 * GB, free: 30 * GB, truncated: false,
            entries: [{ name: "reports", dir: true, size: 900e6, files: 340 }, { name: "settings", dir: true, size: 2e6, files: 20 }],
            files: [{ path: "reports/abc.json", size: 16e6 }],
            history: [[NOW - 60000, 60]],
        },
        processes: {
            at: NOW, source: "proc",
            list: [{ pid: 811, name: "mysqld", cpu: 64, mem: 12, rss: 1 * GB, self: false }, { pid: 42, name: "node", cpu: 12, mem: 4, rss: 300e6, self: true }],
        },
        assessment: { level: "ok", warmingUp: false, findings: [] },
        ...over,
    };
}
