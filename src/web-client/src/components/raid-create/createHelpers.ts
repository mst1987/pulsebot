// The pure helpers of "Neues Event" (RaidCreateDialog.tsx): dates of a
// repeated event, the channel name for a new date, the start step's list.
import type { ReusableEvent } from "../../api";
import { eventDay } from "../../lib/raidTime";
import { DISPLAY_TZ } from "../../lib/format";

export type Choice = { kind: "event" | "template" | "empty"; id: string } | null;
export type ChannelMode = "new" | "clone" | "existing";
export type StartTab = "events" | "templates";
export type TemplateMode = "new" | "update";

export const EMPTY_ICON = "inv_misc_note_02";

/** YYYY-MM-DD of a Date in local time. */
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** YYYY-MM-DD of an event start in the guild's time zone. */
export const berlinDay = (startTime: number) => new Date(startTime * 1000).toLocaleDateString("sv-SE", { timeZone: DISPLAY_TZ });

/**
 * The next date on the template's weekday, at least a day from now and after the
 * template itself — repeating Thursday's raid means next Thursday.
 */
export function nextSameWeekday(startTime: number, now = Date.now()): string {
    if (!startTime) return "";
    const src = new Date(startTime * 1000);
    const d = new Date(Math.max(now, startTime * 1000) + 86400000);
    while (d.getDay() !== src.getDay()) d.setDate(d.getDate() + 1);
    return isoDay(d);
}

export const clockOf = (startTime: number) => (startTime ? eventDay(startTime).time : "");

/** "t6-do-17-09" → "t6-do-24-09" for a new date; a name without a trailing date stays as it is. */
export function channelNameForDate(name: string, date: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!m || !/\d{2}-\d{2}$/.test(name)) return name;
    return name.replace(/\d{2}-\d{2}$/, `${m[3]}-${m[2]}`);
}

/** The latest event of every category, newest first — what "Letzte Events" offers. */
export function latestPerCategory(events: ReusableEvent[]): ReusableEvent[] {
    const best = new Map<string, ReusableEvent>();
    for (const ev of events) {
        const key = ev.categoryId || "__none__";
        const cur = best.get(key);
        if (!cur || (ev.startTime || 0) > (cur.startTime || 0)) best.set(key, ev);
    }
    return [...best.values()].sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
}
