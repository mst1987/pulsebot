// Pure helpers of the "Systemstatus" page (pages/system/, docs/system-status.md):
// numbers with their unit, the history series of a tile, the sparkline's path
// and the tone of a figure. Texts go through `t` at call time, never at load.
import { locale, t } from "../../i18n";
import type { SystemHistory, SystemSeries, SystemStatus } from "../../api";

/** How often the page asks while visible - the monitor's own sample interval. */
export const POLL_MS = 15 * 1000;

/** A poll keeps the last measured processes when the server no longer has them. */
export function mergePoll(prev: SystemStatus | null, next: SystemStatus): SystemStatus {
    return { ...next, processes: next.processes || (prev && prev.processes) || null };
}

/**
 * When a tile turns yellow or red. Mirrors the thresholds of the verdict
 * (src/services/system/assessment.js) - the verdict judges a quarter of an
 * hour, a tile only the last sample, so a tile may colour before the verdict
 * speaks. Colour is kept for what needs a look: below `warn` a tile is plain.
 */
export const TILE_LIMITS = {
    hostCpu: { warn: 70, bad: 85 },
    procCpu: { warn: 70, bad: 85 },
    loopP99: { warn: 100, bad: 200 },
    /** available memory and free disk in %: low is bad */
    memAvailPct: { warn: 20, bad: 10 },
    diskFreePct: { warn: 15, bad: 10 },
} as const;

export type FigureTone = "" | "mid" | "bad";

/** The tone of a figure where high is bad (CPU, delay). */
export function toneHigh(value: number, limits: { warn: number; bad: number }): FigureTone {
    if (value >= limits.bad) return "bad";
    if (value >= limits.warn) return "mid";
    return "";
}

/** The tone of a figure where low is bad (free memory, free disk). */
export function toneLow(value: number, limits: { warn: number; bad: number }): FigureTone {
    if (value < limits.bad) return "bad";
    if (value < limits.warn) return "mid";
    return "";
}

/** A number in the menu's language with at most `digits` decimals. */
export function num(value: number, digits = 0): string {
    return (Number(value) || 0).toLocaleString(locale(), { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** A percentage: "42 %" (one decimal below 10). */
export function pct(value: number): string {
    const v = Number(value) || 0;
    return `${num(v, Math.abs(v) < 10 && v !== 0 ? 1 : 0)} %`;
}

const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** Bytes with a binary unit: "512 B", "1,5 GB". */
export function bytes(value: number): string {
    let v = Math.max(0, Number(value) || 0);
    let i = 0;
    while (v >= 1024 && i < UNITS.length - 1) {
        v /= 1024;
        i += 1;
    }
    return `${num(v, v < 10 && i > 0 ? 1 : 0)} ${UNITS[i]}`;
}

/** A duration in ms: "85 ms", "1,2 s", "14 s". */
export function millis(value: number): string {
    const v = Math.max(0, Number(value) || 0);
    if (v < 1000) return `${num(v, v < 10 ? 1 : 0)} ms`;
    return `${num(v / 1000, v < 10000 ? 1 : 0)} s`;
}

/** An uptime in seconds, two parts at most: "3 Tage 4 Std.", "12 Min.", "40 s". */
export function uptime(seconds: number): string {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const days = Math.floor(s / 86400);
    const hours = Math.floor((s % 86400) / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    if (days) return hours ? `${t("system.units.days", { count: days })} ${t("system.units.hours", { count: hours })}` : t("system.units.days", { count: days });
    if (hours) return minutes ? `${t("system.units.hours", { count: hours })} ${t("system.units.minutes", { count: minutes })}` : t("system.units.hours", { count: hours });
    if (minutes) return t("system.units.minutes", { count: minutes });
    return t("system.units.seconds", { count: s });
}

export type Range = "hour" | "day";
export type Point = [number, number];

/** One field of a history series as [time, value] pairs. */
export function seriesOf(history: SystemHistory | null | undefined, range: Range, field: string): Point[] {
    if (!history) return [];
    const series: SystemSeries | undefined = history[range];
    const idx = history.fields.indexOf(field);
    if (!series || idx < 1) return [];
    return series.points.map((p) => [p[0], Number(p[idx]) || 0] as Point);
}

/** Points younger than the range (the disk history is one list for both ranges). */
export function within(points: Point[], range: Range, now: number): Point[] {
    const span = range === "hour" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    return points.filter(([at]) => at > now - span);
}

/**
 * The sparkline of a series in a `width` x `height` box: the line and the
 * closed area under it. Time runs left to right over the points' own span;
 * the value axis goes from 0 to `max` (by default the largest value, at least
 * `floor`, so a calm series stays low instead of filling the box).
 */
export function sparkPath(points: Point[], { width = 100, height = 28, max, floor = 1 }: { width?: number; height?: number; max?: number; floor?: number } = {}): { line: string; area: string } {
    if (!points.length) return { line: "", area: "" };
    const top = max ?? Math.max(floor, ...points.map(([, v]) => v));
    const t0 = points[0][0];
    const t1 = points[points.length - 1][0];
    const span = t1 - t0 || 1;
    const pad = 1; // keep the stroke inside the box
    const xy = points.map(([at, v]) => {
        const x = points.length === 1 ? width : ((at - t0) / span) * width;
        const y = height - pad - (Math.min(Math.max(v, 0), top) / (top || 1)) * (height - 2 * pad);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const line = `M${xy.join(" L")}`;
    const firstX = points.length === 1 ? width : 0;
    const area = `${line} L${width.toFixed(1)},${height} L${firstX.toFixed(1)},${height} Z`;
    return { line, area };
}
