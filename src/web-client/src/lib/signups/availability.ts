// Ab- & Anwesenheit: the small pure rules of the signup page's section and its
// dialog — how a period reads, which spec an attendance suggests, and the
// one-line summary of what a save did (src/services/signups/availability.js
// decides everything else on the server).
import type { AvailabilityCharacter, AvailabilityKind, AvailabilityResult } from "../../api";
import { formatDayDate } from "../format";
import { t } from "../../i18n";

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Noon (UTC) of a "yyyy-MM-dd" day — the same calendar day in the guild's time zone; 0 for anything else. */
export function dayMs(day: string): number {
    const m = DAY.exec(day || "");
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : 0;
}

/** "Mo 05.10. – Fr 09.10." / one day once. */
export function periodLabel(from: string, to: string): string {
    const a = formatDayDate(dayMs(from));
    if (!to || to === from) return a;
    return `${a} – ${formatDayDate(dayMs(to))}`;
}

/** The "Bis" after "Von" moved: kept when still after it, else the new "Von". */
export function nextTo(from: string, to: string): string {
    return !to || to < from ? from : to;
}

/** The spec an attendance starts with: the first one raid-ready, else the first. */
export function firstSpec(character: AvailabilityCharacter | undefined): string {
    if (!character || !character.specs.length) return "";
    return (character.specs.find((s) => s.gear === "ready") || character.specs[0]).key;
}

/**
 * Whether the server would leave this raid alone anyway (availability.js): an
 * attendance never touches an existing signup or absence, an absence never one
 * already signed off. The dialog shows such a raid greyed out and unpicked.
 */
export function staysAsIs(kind: AvailabilityKind, status: string): boolean {
    return kind === "presence" ? !!status : status === "absence";
}

/** What a save did, counted: changed, skipped (already so), failed. */
export function countResults(results: AvailabilityResult[]): { done: number; skipped: number; failed: number } {
    return {
        done: results.filter((r) => r.ok).length,
        skipped: results.filter((r) => !r.ok && r.skipped).length,
        failed: results.filter((r) => !r.ok && !r.skipped).length,
    };
}

/** "3 Raids abgemeldet · 1 übersprungen" — the toast after saving. */
export function resultSummary(kind: AvailabilityKind, results: AvailabilityResult[], dm: boolean): string {
    const { done, skipped, failed } = countResults(results);
    const parts = [
        results.length
            ? t(kind === "absence" ? "signups.availability.result.signedOff" : "signups.availability.result.signedUp", { count: done })
            : t("signups.availability.result.noRaid"),
        skipped ? t("signups.availability.result.skipped", { count: skipped }) : "",
        failed ? t("signups.availability.result.failed", { count: failed }) : "",
        dm ? "" : t("signups.availability.result.noDm"),
    ];
    return parts.filter(Boolean).join(" · ");
}

/** Why one raid was left alone, in words. */
export function skipReason(result: AvailabilityResult): string {
    if (result.ok) return "";
    if (result.skipped) return t(`signups.availability.skip.${result.skipped}`);
    return result.error;
}
