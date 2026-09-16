// Wiederkehrende Events (#289): the pure rules behind the series page — how a
// coming date reads ("wird am Do 17.09. um 19:30 angelegt", "angelegt am
// 17.09. als #…"), which badge it gets, and how the modal's draft becomes a
// preview request. No React in here, and strippable (one-line signatures, no
// types inside bodies), so test/web-client/eventSeries.test.js runs it for real.
import type { EventSeries, EventSeriesInput, SeriesDate, SeriesDateState } from "../api";

const TZ = "Europe/Berlin";

export const WEEKDAYS = [
    { value: 1, short: "Mo", long: "Montag" },
    { value: 2, short: "Di", long: "Dienstag" },
    { value: 3, short: "Mi", long: "Mittwoch" },
    { value: 4, short: "Do", long: "Donnerstag" },
    { value: 5, short: "Fr", long: "Freitag" },
    { value: 6, short: "Sa", long: "Samstag" },
    { value: 7, short: "So", long: "Sonntag" },
];

/** "2026-09-23" → "Mi 23.09." (a calendar day, no time zone involved). */
export function dayLabel(date: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
    if (!m) return date || "";
    const weekday = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)).getUTCDay();
    return `${WEEKDAYS[(weekday + 6) % 7].short} ${m[3]}.${m[2]}.`;
}

/** A moment as Berlin "Do 17.09." */
export function momentDay(ms: number): string {
    if (!ms) return "";
    const iso = new Date(ms).toLocaleDateString("en-CA", { timeZone: TZ });
    return dayLabel(iso);
}

/** A moment as Berlin "19:30". */
export function momentTime(ms: number): string {
    if (!ms) return "";
    return new Date(ms).toLocaleTimeString("de-DE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
}

export type StateTone = "ok" | "mid" | "bad" | "accent" | "";

function badge(label: string, tone: StateTone): { label: string; tone: StateTone } {
    return { label, tone };
}

const STATE_BADGE = {
    planned: badge("geplant", ""),
    due: badge("fällig", "accent"),
    creating: badge("wird angelegt", "accent"),
    interrupted: badge("unterbrochen", "bad"),
    created: badge("angelegt", "ok"),
    existing: badge("vorhanden", "ok"),
    cancelled: badge("abgesagt", "mid"),
    failed: badge("Fehler", "bad"),
    skipped: badge("übersprungen", "mid"),
    off: badge("Serie aus", ""),
};

export function stateBadge(state: SeriesDateState): { label: string; tone: StateTone } {
    return STATE_BADGE[state] || STATE_BADGE.planned;
}

/** What happens to one date, as one short sentence. */
export function dateLine(o: SeriesDate): string {
    const channel = o.channelName ? ` als #${o.channelName}` : "";
    switch (o.state) {
        case "planned": return `wird am ${momentDay(o.createAt)} um ${momentTime(o.createAt)} angelegt`;
        case "due": return "ist dran — wird in den nächsten 5 Minuten angelegt";
        case "creating": return "wird gerade angelegt";
        case "interrupted": return "Anlage unterbrochen — bitte prüfen, ob Kanal und Event existieren";
        case "created": return `angelegt am ${momentDay(o.at)} ${momentTime(o.at)}${channel}`;
        case "existing": return `Event gab es schon${channel} — nichts angelegt`;
        case "cancelled": return "abgesagt — wird nicht neu angelegt";
        case "failed": return `fehlgeschlagen: ${o.error || "unbekannter Fehler"}${o.willRetry ? " · neuer Versuch folgt" : ""}`;
        case "skipped": return "übersprungen — hier wird nichts angelegt";
        case "off": return "Serie ist aus";
        default: return "";
    }
}

/**
 * The date the list row names: the first one the series still has to act on
 * (planned, due, failed …); when every coming date is done or skipped, the first
 * one that is not skipped.
 */
export function nextDate(upcoming: SeriesDate[]): SeriesDate | null {
    const list = upcoming || [];
    const done = ["skipped", "created", "existing", "cancelled"];
    return list.find((o) => !done.includes(o.state)) || list.find((o) => o.state !== "skipped") || null;
}

/** The channel name shown beside a date — only a preview; a created date names its channel in its line. */
export function channelOf(o: SeriesDate): string {
    if (o.state === "created" || o.state === "existing") return "";
    return o.channelName || o.previewName || "";
}

/** "zuletzt angelegt: Mo 21.09. als #mo-21-09-ssc-tk (am Mi 16.09.)". */
export function lastCreatedLine(last: { date: string; at: number; channelName: string } | null): string {
    if (!last) return "";
    const channel = last.channelName ? ` als #${last.channelName}` : "";
    return `zuletzt angelegt: ${dayLabel(last.date)}${channel} (am ${momentDay(last.at)})`;
}

/** The modal's starting point: the stored series, else Wednesday 19:30, 6 days before. */
export function draftOf(series: EventSeries | null, categoryId: string): EventSeriesInput {
    if (series) {
        return {
            categoryId, enabled: series.enabled, weekdays: [...series.weekdays], time: series.time, raidTemplateId: series.raidTemplateId,
            daysBefore: series.daysBefore, title: series.title || "", skipDates: [...(series.skipDates || [])],
        };
    }
    return { categoryId, enabled: true, weekdays: [3], time: "19:30", raidTemplateId: "", daysBefore: 6, title: "", skipDates: [] };
}

export function toggleWeekday(draft: EventSeriesInput, day: number): EventSeriesInput {
    const has = draft.weekdays.includes(day);
    const weekdays = has ? draft.weekdays.filter((d) => d !== day) : [...draft.weekdays, day].sort((a, b) => a - b);
    return { ...draft, weekdays };
}

export function toggleSkip(draft: EventSeriesInput, date: string): EventSeriesInput {
    const has = draft.skipDates.includes(date);
    const skipDates = has ? draft.skipDates.filter((d) => d !== date) : [...draft.skipDates, date].sort();
    return { ...draft, skipDates };
}

/** The query string of GET /api/raids/series/preview. */
export function previewQuery(draft: EventSeriesInput): string {
    const params = new URLSearchParams();
    params.set("category", draft.categoryId);
    params.set("weekdays", draft.weekdays.join(","));
    params.set("time", draft.time);
    params.set("daysBefore", String(draft.daysBefore));
    params.set("template", draft.raidTemplateId);
    params.set("skip", draft.skipDates.join(","));
    params.set("enabled", draft.enabled ? "1" : "0");
    if (draft.title) params.set("title", draft.title);
    return params.toString();
}
