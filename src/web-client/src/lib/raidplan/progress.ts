import type { RaidplanProgress } from "../../api";

// The raid plan follows the raid (#534): the pure half of hooks/useRaidProgress.ts. The server side is
// src/services/raidplan/raidplanProgress.js (the same window, the derivation from the linked log).

/** How often a page asks while it is visible and the raid runs. */
export const PROGRESS_POLL_MS = 60_000;
const WINDOW_BEFORE_MS = 30 * 60_000;
const WINDOW_AFTER_MS = 6 * 60 * 60_000;

/** Whether `now` (ms) lies in the raid window of a start time (seconds, or ms): start - 30 min to start + 6 h. */
export function inRaidWindow(startTime: number, now: number): boolean {
    const raw = Number(startTime);
    if (!Number.isFinite(raw) || raw <= 0) return false;
    const start = raw > 1e11 ? raw : raw * 1000;
    return now >= start - WINDOW_BEFORE_MS && now <= start + WINDOW_AFTER_MS;
}

/** The section to turn to: the boss being fought, else the next one standing - only when the page has that section. */
export function followTarget(progress: RaidplanProgress | null, keys: readonly string[]): string | null {
    if (!progress || !progress.live) return null;
    const target = progress.current ?? progress.next;
    return target && keys.includes(target) ? target : null;
}
