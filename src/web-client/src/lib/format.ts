// Mirrors src/web/renderAdmin.js's formatEventTime()/DISPLAY_TZ so dates read
// identically to the classic admin pages.
const DISPLAY_TZ = "Europe/Berlin";

export function formatEventTime(startTime: number): string {
    if (!startTime) return "";
    return new Date(startTime * 1000).toLocaleString("de-DE", {
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
    return new Date(ms).toLocaleDateString("de-DE", { timeZone: DISPLAY_TZ });
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
        d.toLocaleString("de-DE", { timeZone: DISPLAY_TZ, ...opts });
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
    const dayOf = (ms: number) => Date.parse(
        new Date(ms).toLocaleDateString("en-CA", { timeZone: DISPLAY_TZ }),
    );
    const diff = Math.round((dayOf(startTime * 1000) - dayOf(now)) / 86400000);
    if (diff === 0) return "heute";
    if (diff === 1) return "morgen";
    if (diff === -1) return "gestern";
    if (diff > 1) return `in ${diff} Tagen`;
    return `vor ${Math.abs(diff)} Tagen`;
}

// Mirrors renderAdmin.js's fmtMs() — an epoch-ms timestamp for loot rows (awardedAt/importedAt).
export function fmtMs(ms: number | undefined, withTime = true): string {
    const n = Number(ms);
    if (!n) return "";
    return new Date(n).toLocaleString("de-DE", withTime
        ? { timeZone: DISPLAY_TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }
        : { timeZone: DISPLAY_TZ, day: "2-digit", month: "2-digit", year: "numeric" });
}
