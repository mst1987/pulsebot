// Date wording of the start page ("Übersicht") and its raid-details modal —
// always in the guild's time zone, like lib/format.ts, in the menu's language.
import { t } from "../i18n";
import { formatWith as fmt } from "./format";

/** "Montag, 14. September" */
export function longDay(ms: number): string {
    return fmt(ms, { weekday: "long", day: "numeric", month: "long" });
}

/** "10.09." */
export function shortDate(ms: number): string {
    return ms ? fmt(ms, { day: "2-digit", month: "2-digit" }) : "";
}

/** "Do 10.09." */
export function dayDate(ms: number): string {
    if (!ms) return "";
    return `${fmt(ms, { weekday: "short" }).replace(".", "")} ${shortDate(ms)}`;
}

/** "19:30" */
export function clock(ms: number): string {
    return ms ? fmt(ms, { hour: "2-digit", minute: "2-digit" }) : "";
}

/** "Donnerstag, 17.09. · 19:30" for a Raid-Helper start time (seconds). */
export function raidWhen(startTime: number): string {
    if (!startTime) return "";
    const ms = startTime * 1000;
    return `${fmt(ms, { weekday: "long" })}, ${shortDate(ms)} · ${clock(ms)}`;
}

/** "heute 18:02" / "Do 10.09. 18:02" — when something was last fetched. */
export function fetchedAt(ms: number, now = Date.now()): string {
    if (!ms) return "";
    const sameDay = fmt(ms, { day: "2-digit", month: "2-digit", year: "numeric" }) === fmt(now, { day: "2-digit", month: "2-digit", year: "numeric" });
    return `${sameDay ? t("common.relDay.today") : dayDate(ms)} ${clock(ms)}`;
}
