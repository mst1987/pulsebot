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
