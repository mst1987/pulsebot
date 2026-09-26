// Mirrors src/web/renderAdmin.js's formatEventTime()/DISPLAY_TZ so dates read
// identically to the classic admin pages.
import { locale, t } from "../i18n";

/** The guild's time zone: every date and time in the menu is shown in it. */
export const DISPLAY_TZ = "Europe/Berlin";

/**
 * Any date/time part in DISPLAY_TZ, in the menu's language (`locale()`) — the
 * one door the client's date formatters go through, so no page names a locale
 * or a time zone of its own.
 */
export function formatWith(ms: number, opts: Intl.DateTimeFormatOptions): string {
    return new Date(ms).toLocaleString(locale(), { timeZone: DISPLAY_TZ, ...opts });
}

/** "19:30" (both languages). */
export function formatTime(ms: number): string {
    return ms ? formatWith(ms, { hour: "2-digit", minute: "2-digit" }) : "";
}

/** "17.09." / "17/09". */
export function formatDayMonth(ms: number): string {
    return ms ? formatWith(ms, { day: "2-digit", month: "2-digit" }) : "";
}

/** "Do" / "Thu" — a short weekday without the German abbreviation dot. */
export function formatWeekday(ms: number): string {
    return ms ? formatWith(ms, { weekday: "short" }).replace(".", "") : "";
}

/** "Do 17.09." / "Thu 17/09". */
export function formatDayDate(ms: number): string {
    return ms ? `${formatWeekday(ms)} ${formatDayMonth(ms)}` : "";
}

/** "Do 17.09. 19:30" / "Thu 17/09 19:30". */
export function formatDateTime(ms: number): string {
    return ms ? `${formatDayDate(ms)} ${formatTime(ms)}` : "";
}

/** "2026-09-17": the calendar day in DISPLAY_TZ as a key to compare or sort (never shown). */
export function isoDay(ms: number): string {
    return new Date(ms).toLocaleDateString("en-CA", { timeZone: DISPLAY_TZ });
}

export function formatEventTime(startTime: number): string {
    if (!startTime) return "";
    return new Date(startTime * 1000).toLocaleString(locale(), {
        timeZone: DISPLAY_TZ,
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

export function formatDate(ms: number): string {
    if (!ms) return "";
    return new Date(ms).toLocaleDateString(locale(), { timeZone: DISPLAY_TZ });
}

// The same event start time, but broken into its parts so the raid-detail
// header can typeset them on separate levels (a calendar-style date badge, the
// clock time in its own size) instead of one flat "So., 02.08., 19:00" string.
export type EventTimeParts = {
    weekday: string;   // "So"
    day: string;       // "02"
    month: string;     // "Aug"
    year: string;      // "2026"
    time: string;      // "19:00"
    full: string;      // "Sonntag, 2. August 2026 um 19:00"
};

export function eventTimeParts(startTime: number): EventTimeParts | null {
    if (!startTime) return null;
    const d = new Date(startTime * 1000);
    const part = (opts: Intl.DateTimeFormatOptions) =>
        d.toLocaleString(locale(), { timeZone: DISPLAY_TZ, ...opts });
    return {
        // de-DE renders short weekdays as "So." — the trailing dot is noise in a badge.
        weekday: part({ weekday: "short" }).replace(".", ""),
        day: part({ day: "2-digit" }),
        month: part({ month: "short" }).replace(".", ""),
        year: part({ year: "numeric" }),
        time: part({ hour: "2-digit", minute: "2-digit" }),
        full: part({ dateStyle: "full", timeStyle: "short" }),
    };
}

// "heute" / "morgen" / "in 5 Tagen" / "vor 3 Tagen" for the header's date badge.
// Compares calendar days in DISPLAY_TZ (not 24h spans), so a raid tonight stays
// "heute" and one tomorrow morning is "morgen" regardless of the current hour.
export function relativeDayLabel(startTime: number, now: number = Date.now()): string {
    if (!startTime) return "";
    // en-CA gives YYYY-MM-DD, which Date.parse reads back as a UTC midnight.
    const dayOf = (ms: number) => Date.parse(isoDay(ms));
    const diff = Math.round((dayOf(startTime * 1000) - dayOf(now)) / 86400000);
    if (diff === 0) return t("common.relDay.today");
    if (diff === 1) return t("common.relDay.tomorrow");
    if (diff === -1) return t("common.relDay.yesterday");
    if (diff > 1) return t("common.relDay.inDays", { count: diff });
    return t("common.relDay.daysAgo", { count: Math.abs(diff) });
}

// Mirrors renderAdmin.js's fmtMs() — an epoch-ms timestamp for loot rows (awardedAt/importedAt).
export function fmtMs(ms: number | undefined, withTime = true): string {
    const n = Number(ms);
    if (!n) return "";
    return new Date(n).toLocaleString(locale(), withTime
        ? { timeZone: DISPLAY_TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }
        : { timeZone: DISPLAY_TZ, day: "2-digit", month: "2-digit", year: "numeric" });
}
