// Roster › Abwesenheiten: the pure rules of the page (pages/absences/). Which
// column a day is, where a bar starts and how wide it is, the weeks of the
// head, how many are missing on a raid day, what the filters keep, what a
// raid's role lines say. The server decides who is away (absenceOverview.js);
// this only lays it out.
import type { AbsenceIdentity, AbsencePeriod, AbsenceRaid, AbsenceRaider, AttendanceRaid, AvailabilityEntry } from "../../api";
import { dayMs } from "../signups/availability";
import { roleLabel, specLabel } from "../wow/wowNames";
import { t } from "../../i18n";

const DAY_MS = 86400000;

/** Days from `from` to `day` ("yyyy-MM-dd"): 0 = the first column, negative before it. */
export function dayIndex(from: string, day: string): number {
    return Math.round((dayMs(day) - dayMs(from)) / DAY_MS);
}

/** The day `n` days after `day`, "yyyy-MM-dd". */
export function addDays(day: string, n: number): string {
    return new Date(dayMs(day) + n * DAY_MS).toISOString().slice(0, 10);
}

/** ISO 8601 calendar week of a day. */
export function isoWeek(day: string): number {
    const d = new Date(dayMs(day));
    // Thursday of the same week decides the year the week belongs to
    const weekday = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - weekday + 3);
    const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    const fw = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() - fw + 3);
    return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
}

export type TimelineWeek = { start: string; end: string; kw: number; days: string[] };

/** The weeks of the timeline from `from` (a Monday) on. */
export function timelineWeeks(from: string, weeks: number): TimelineWeek[] {
    return Array.from({ length: Math.max(1, weeks) }, (_, w) => {
        const start = addDays(from, w * 7);
        const days = Array.from({ length: 7 }, (_x, d) => addDays(start, d));
        return { start, end: days[6], kw: isoWeek(start), days };
    });
}

/** How wide one day column is: the shorter the span, the wider the day. */
export function dayWidth(weeks: number): number {
    if (weeks <= 4) return 40;
    if (weeks <= 8) return 26;
    return 18;
}

export type BarPlace = {
    /** First column (clamped to the timeline). */
    start: number;
    /** Columns covered (at least 1). */
    span: number;
    /** It began before the first day shown. */
    cutStart: boolean;
    /** It runs past the last day shown. */
    cutEnd: boolean;
};

/** Where a period sits in a timeline of `days` columns from `from`; null when it is outside. */
export function barPlace(period: Pick<AbsencePeriod, "from" | "to">, from: string, days: number): BarPlace | null {
    const a = dayIndex(from, period.from);
    const b = dayIndex(from, period.to);
    if (b < 0 || a > days - 1) return null;
    const start = Math.max(0, a);
    const end = Math.min(days - 1, b);
    return { start, span: end - start + 1, cutStart: a < 0, cutEnd: b > days - 1 };
}

/** A long absence (two weeks or more) is drawn filled. */
export const LONG_DAYS = 14;

/** What a bar says: the reason when there is one, else how long ("28 Tage"). */
export function barLabel(period: Pick<AbsencePeriod, "comment" | "days">): string {
    return period.comment || t("absences.days", { count: period.days });
}

export type RaidDay = {
    /** The categories with a raid that day, in the order of the overview's categories. */
    categories: string[];
    /** Distinct raiders away from a raid of that day. */
    away: number;
};

/** The days with raids: which categories raid, and how many are missing. */
export function raidDays(raids: AbsenceRaid[]): Map<string, RaidDay> {
    const out = new Map<string, { categories: Set<string>; away: Set<string> }>();
    for (const r of raids) {
        const day = out.get(r.day) || { categories: new Set<string>(), away: new Set<string>() };
        day.categories.add(r.categoryId);
        for (const a of r.absent) day.away.add(a.userId);
        out.set(r.day, day);
    }
    return new Map([...out].map(([day, v]) => [day, { categories: [...v.categories], away: v.away.size }]));
}

/** From this many missing the "fehlen" figure is strong. */
export const MANY_AWAY = 4;

/** Index of a category for its colour (`ab-cat-<n>`), six colours round. */
export function categoryTone(categoryId: string, categories: { id: string }[]): number {
    const i = categories.findIndex((c) => c.id === categoryId);
    return (i < 0 ? categories.length : i) % 6;
}

export type RowFilter = { presence: boolean; search: string };

/**
 * The rows the timeline shows, in the server's order: without attendance,
 * attendance periods and raiders who only have attendance drop out; the search
 * looks at name and character.
 */
export function visibleRaiders(raiders: AbsenceRaider[], { presence, search }: RowFilter): AbsenceRaider[] {
    const q = search.trim().toLowerCase();
    return raiders
        .filter((r) => presence || !r.onlyPresence)
        .filter((r) => !q || r.name.toLowerCase().includes(q) || r.character.toLowerCase().includes(q))
        .map((r) => (presence ? r : { ...r, periods: r.periods.filter((p) => p.kind !== "presence") }));
}

/** The raids still to come (today included), in date order. */
export function upcomingRaids(raids: AbsenceRaid[], today: string): AbsenceRaid[] {
    return raids.filter((r) => r.day >= today).sort((a, b) => a.startTime - b.startTime);
}

/** The names of some raiders by id — the character, else the account — in the order given (unknown ids are left out). */
export function namesOf(ids: string[], raiders: AbsenceRaider[]): string[] {
    const byId = new Map(raiders.map((r) => [r.userId, r]));
    return ids.map((id) => {
        const r = byId.get(id);
        return r ? r.character || r.name : "";
    }).filter(Boolean);
}

/** How full a raid is, in percent of its places (for the card's bar). */
export function signedShare(raid: Pick<AbsenceRaid, "signed" | "size">): number {
    return Math.min(100, Math.round((raid.signed / Math.max(raid.size, raid.signed, 1)) * 100));
}

/** The current or next absence of a raider's entries — what the drawer's highlight box shows. */
export function currentAbsence<T extends Pick<AbsencePeriod, "kind" | "state" | "from">>(entries: T[]): T | null {
    const open = entries.filter((e) => e.kind === "absence" && e.state !== "past");
    return open.find((e) => e.state === "running") || open.sort((a, b) => a.from.localeCompare(b.from))[0] || null;
}

/** The name a row shows: the character when known, else the account. */
export function displayName(who: Pick<AbsenceIdentity, "character" | "name">): string {
    return who.character || who.name;
}

/** "Wiederherstellung · Heiler": the small line under a name. */
export function playsLine(who: Pick<AbsenceIdentity, "spec" | "specLabel" | "role">): string {
    return [who.spec ? specLabel(who.spec, who.specLabel) : "", who.role ? roleLabel(who.role) : ""].filter(Boolean).join(" · ");
}

// ---- "Meine Anwesenheit" ----

/**
 * The server's German verdicts of a raid night (rosterAttendance.js), as keys of
 * absences.mine.reason.* — an unknown one stays as sent. Matched without their
 * accents ("später" → "spater"), so no German literal sits in the client.
 */
const REASON_KEYS: Record<string, string> = {
    "im Log": "inLog",
    "im Log (Klasse passt)": "inLogClass",
    "angemeldet": "signed",
    "angemeldet (spater)": "late",
    "abgemeldet": "absence",
    "nicht im Log": "notInLog",
    "keine Anmeldung": "noSignup",
    "Ersatzbank": "bench",
    "vorlaufig": "tentative",
};

/** A raid night's verdict in the menu's language. */
export function reasonText(reason: string): string {
    const key = REASON_KEYS[reason.normalize("NFD").replace(/[\u0300-\u036f]/g, "")];
    return key ? t(`absences.mine.reason.${key}`) : reason;
}

/** The counted nights oldest first, so the newest stands last in the row. */
export function nightsInOrder(raids: AttendanceRaid[]): AttendanceRaid[] {
    return [...raids].sort((a, b) => a.startTime - b.startTime);
}

/** Planned, running or over — for an own entry, which carries no state (today: "yyyy-MM-dd"). */
export function entryState(entry: Pick<AvailabilityEntry, "from" | "to">, today: string): AbsencePeriod["state"] {
    if (entry.to < today) return "past";
    return entry.from > today ? "planned" : "running";
}

/** How long an entry is, both days counted. */
export function entryDays(entry: Pick<AvailabilityEntry, "from" | "to">): number {
    return dayIndex(entry.from, entry.to) + 1;
}