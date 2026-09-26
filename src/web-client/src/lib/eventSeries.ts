// Wiederkehrende Events (#289): the pure rules behind the series page — how a
// coming date reads ("wird am Do 17.09. um 19:30 angelegt", "angelegt am
// 17.09. als #…"), which badge it gets, and how the modal's draft becomes a
// preview request. No React in here, and strippable (one-line signatures, no
// types inside bodies), so src/web-client/src/lib/eventSeries.test.ts runs it for real.
import type { EventSeries, EventSeriesInput, SeriesDate, SeriesDateState } from "../api";
import { t } from "../i18n";
import { formatDayDate, formatTime, isoDay } from "./format";

/** The weekdays as the series stores them (1 = Monday … 7 = Sunday); names via weekdayShort/weekdayLong. */
export const WEEKDAYS = [{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }, { value: 6 }, { value: 7 }];

/** 3 → "Mi" / "Wed". */
export function weekdayShort(value: number): string {
    return t(`series.weekday.short.${value}`);
}

/** 3 → "Mittwoch" / "Wednesday". */
export function weekdayLong(value: number): string {
    return t(`series.weekday.long.${value}`);
}

/** "2026-09-23" → "Mi 23.09." / "Wed 23/09" (a calendar day: noon UTC is the same day in DISPLAY_TZ). */
export function dayLabel(date: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
    if (!m) return date || "";
    return formatDayDate(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
}

/** A moment as Berlin "Do 17.09." */
export function momentDay(ms: number): string {
    if (!ms) return "";
    return dayLabel(isoDay(ms));
}

/** A moment as Berlin "19:30". */
export function momentTime(ms: number): string {
    return formatTime(ms);
}

export type StateTone = "ok" | "mid" | "bad" | "accent" | "";

// The tone per state; the label is series.state.<state>, looked up when asked for.
const STATE_TONE = {
    planned: "",
    due: "accent",
    creating: "accent",
    interrupted: "bad",
    created: "ok",
    existing: "ok",
    cancelled: "mid",
    deleted: "mid",
    failed: "bad",
    skipped: "mid",
    off: "",
} as Record<string, StateTone>;

export function stateBadge(state: SeriesDateState): { label: string; tone: StateTone } {
    const known = Object.prototype.hasOwnProperty.call(STATE_TONE, state) ? state : "planned";
    return { label: t(`series.state.${known}`), tone: STATE_TONE[known] };
}

/** " als #mi-23-09" / " as #mi-23-09", or nothing without a channel. */
function channelPart(name: string): string {
    return name ? t("series.line.channel", { name }) : "";
}

/** What happens to one date, as one short sentence. */
export function dateLine(o: SeriesDate): string {
    const channel = channelPart(o.channelName);
    switch (o.state) {
        case "planned": return t("series.line.planned", { day: momentDay(o.createAt), time: momentTime(o.createAt) });
        case "due": return t("series.line.due");
        case "creating": return t("series.line.creating");
        case "interrupted": return t("series.line.interrupted");
        case "created": return t("series.line.created", { day: momentDay(o.at), time: momentTime(o.at), channel });
        case "existing": return t("series.line.existing", { channel });
        case "cancelled": return t("series.line.cancelled");
        case "deleted": return t("series.line.deleted");
        case "failed": return t("series.line.failed", { error: o.error || t("series.line.unknownError"), retry: o.willRetry ? t("series.line.retry") : "" });
        case "skipped": return t("series.line.skipped");
        case "off": return t("series.line.off");
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
    const done = ["skipped", "created", "existing", "cancelled", "deleted"];
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
    return t("series.line.lastCreated", { day: dayLabel(last.date), channel: channelPart(last.channelName), at: momentDay(last.at) });
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
