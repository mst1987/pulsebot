import { get, send } from "./client";
import type { ChannelNaming } from "./channels";
import type { EventSource } from "./raidDetail";

// ---- Wiederkehrende Events (#289) ----

/** A series as stored and as the modal edits it; weekdays 1 = Mo … 7 = So. */
export type EventSeriesInput = {
    categoryId: string;
    enabled: boolean;
    weekdays: number[];
    time: string;
    raidTemplateId: string;
    daysBefore: number;
    title: string;
    skipDates: string[];
};

export type EventSeries = EventSeriesInput & {
    guildId: string;
    leaderId: string;
    updatedAt: number;
    updatedBy: string;
    updatedByName: string;
};

export type SeriesDateState =
    | "planned" | "due" | "creating" | "interrupted" | "created" | "existing" | "cancelled" | "deleted" | "failed" | "skipped" | "off";

/** One coming date of a series and what happens to it. */
export type SeriesDate = {
    date: string;
    startTime: number;
    createAt: number;
    skipped: boolean;
    state: SeriesDateState;
    eventId: string;
    /** The channel it got (created / existing). */
    channelName: string;
    /** The channel it would get, with where the name comes from (not yet created). */
    previewName?: string;
    naming?: ChannelNaming;
    error: string;
    at: number;
    attempts: number;
    willRetry: boolean;
    messageError?: string;
};

export type SeriesTemplate = { id: string; name: string; instanceIds: string[]; size: number | null; isDefault?: boolean };

export type SeriesCategory = {
    id: string;
    name: string;
    source: EventSource;
    series: EventSeries | null;
    template: SeriesTemplate | null;
    summary: string;
    upcoming: SeriesDate[];
    lastCreated: { date: string; at: number; channelName: string; eventId: string } | null;
};

export type EventSeriesData = {
    categories: SeriesCategory[];
    templates: SeriesTemplate[];
    lastRun: { at: number; created: number; failed: number; existing: number; ignored: number; error: string | null } | null;
    canWrite: boolean;
    limits: { minDaysBefore: number; maxDaysBefore: number };
};

export type SeriesPreview = {
    error: string;
    summary: string;
    upcoming: SeriesDate[];
    template: SeriesTemplate | null;
};

export function getEventSeries(): Promise<EventSeriesData> {
    return get<EventSeriesData>("/api/raids/series");
}

export function previewEventSeries(query: string): Promise<SeriesPreview> {
    return get<SeriesPreview>(`/api/raids/series/preview?${query}`);
}

export function saveEventSeries(csrfToken: string | null, input: EventSeriesInput): Promise<{ series: EventSeries; message: string }> {
    return send("PUT", "/api/raids/series", csrfToken, input);
}

export function deleteEventSeries(csrfToken: string | null, categoryId: string): Promise<{ categoryId: string; message: string }> {
    return send("DELETE", "/api/raids/series", csrfToken, { categoryId });
}

export function runEventSeries(csrfToken: string | null, categoryId = "", retryDate = ""): Promise<{ created: number; failed: number; message: string }> {
    return send("POST", "/api/raids/series/run", csrfToken, { categoryId, retryDate });
}
