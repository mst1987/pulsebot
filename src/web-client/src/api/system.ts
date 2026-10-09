import { get } from "./client";

// The "Systemstatus" page (docs/system-status.md): GET /api/system/status,
// full admins only. Built by src/services/system/systemStatus.js.

/** One sample of the monitor (src/services/system/systemMonitor.js). */
export type SystemSample = {
    t: number;
    hostCpu: number;
    procCpu: number;
    cores: number;
    load1: number;
    load5: number;
    load15: number;
    memTotal: number;
    memAvail: number;
    memAvailPct: number;
    swapTotal: number;
    swapUsed: number;
    swapKnown: boolean;
    swapUsedPct: number;
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
    loopP50: number;
    loopP99: number;
    loopMax: number;
    elu: number;
};

/** A history series: `points` are arrays in the order of `fields` (t first). */
export type SystemSeries = { step: number; points: number[][] };
export type SystemHistory = { fields: string[]; hour: SystemSeries; day: SystemSeries };

export type SystemRouteFigures = { count: number; avg: number; p95: number; max: number; slow: number };
export type SystemRoute = { route: string; total: SystemRouteFigures; hour: SystemRouteFigures };
export type SystemSlowRequest = { t: number; method: string; path: string; status: number; ms: number };

export type SystemDiskEntry = { name: string; dir: boolean; size: number; files: number };
export type SystemDisk = {
    at: number;
    known: boolean;
    total: number;
    free: number;
    entries: SystemDiskEntry[];
    files: { path: string; size: number }[];
    truncated: boolean;
    history: number[][];
};

export type SystemProcess = { pid: number; name: string; cpu: number; mem: number; rss: number; self: boolean };

export type SystemFindingId = "otherProcess" | "botBottleneck" | "hostBusy" | "cpuOverloaded" | "memoryLow" | "diskLow";
export type SystemFinding = {
    id: SystemFindingId;
    level: "warn" | "bad";
    values: Record<string, number | string>;
    routes?: { route: string; p95: number; count: number }[];
};

export type SystemStatus = {
    now: number;
    info: {
        platform: string;
        cores: number;
        cpuModel: string;
        nodeVersion: string;
        hostUptime: number;
        processUptime: number;
        runtime: { kind: "pm2" | "docker" | "node"; pmId?: string };
        loadSupported: boolean;
        sampleMs: number;
        monitoring: boolean;
    };
    current: SystemSample | null;
    history: SystemHistory;
    requests: { threshold: number; since: number; routes: SystemRoute[]; slow: SystemSlowRequest[] };
    disk: SystemDisk | null;
    processes: { at: number; source: string; list: SystemProcess[] } | null;
    assessment: { level: "ok" | "warn" | "bad"; warmingUp: boolean; findings: SystemFinding[] };
};

/**
 * The system status. `processes` measures the host's top processes anew (the
 * server takes a second for it), `disk` walks data/ again instead of the
 * five-minute cache — both only when the page opens or on its refresh button.
 */
export function getSystemStatus({ processes = false, disk = false }: { processes?: boolean; disk?: boolean } = {}): Promise<SystemStatus> {
    const q = new URLSearchParams();
    if (processes) q.set("processes", "1");
    if (disk) q.set("disk", "1");
    const qs = q.toString();
    return get<SystemStatus>(`/api/system/status${qs ? `?${qs}` : ""}`);
}
