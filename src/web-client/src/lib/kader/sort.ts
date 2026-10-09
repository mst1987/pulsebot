// Sorting the Kaderplaner's tables (Pool, Vorauswahl · Übersicht, the import's
// member list) through the shared table sort: useTableSort (lib/ui/tableSort.ts)
// remembers the column per table, sortRows orders. What this adds is the value
// of a column as a list of parts compared one after the other — numbers as
// numbers, text in the menu language's alphabet ("Ä" beside "A", "10" after
// "9") — and "no value" (null) last in both directions, so a missing
// attendance or an unanswered question never tops the list. Equal rows keep
// their order, and every table hands its rows in sorted by name, so a tie
// reads alphabetically. Pure.
import type { KaderAnswer, KaderClassDef, KaderData, KaderEntry, KaderMember, KaderPlayer, KaderQuestion, KaderView, KaderWish } from "../../api";
import { locale } from "../../i18n";
import { sortRows, type Dir } from "../ui/tableSort";
import { isAnswered, progress, statusOf, type InterviewStatus } from "./interview";
import { attendanceOf, className, playerName, ROLES, rolesOf, specName, specRole, STATES } from "./model";

/** A column's value of one row: parts compared in order; null = no value, always last. */
export type SortParts = (string | number)[] | null;

type Row = { userId: string; entry: KaderEntry };
type Ctx = { view: KaderView; kader: KaderData; players: Map<string, KaderPlayer> };

function compareParts(a: (string | number)[], b: (string | number)[], collator: Intl.Collator): number {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i += 1) {
        const x = a[i];
        const y = b[i];
        if (x === undefined) return -1;
        if (y === undefined) return 1;
        const d = typeof x === "number" && typeof y === "number" ? x - y : collator.compare(String(x), String(y));
        if (d) return d < 0 ? -1 : 1;
    }
    return 0;
}

/**
 * The rows in the order of `parts`, `dir` applied to every part; a row without
 * a value last either way; equal rows keep their order. Each value is ranked
 * once with the collator, sortRows then compares plain numbers.
 */
export function sortByParts<T>(rows: T[], parts: (row: T) => SortParts, dir: Dir): T[] {
    const collator = new Intl.Collator(locale(), { sensitivity: "base", numeric: true });
    const keyed = rows.map((row) => ({ row, parts: parts(row) }));
    const ranked = keyed.filter((k) => k.parts !== null);
    const byValue = (a: typeof keyed[number], b: typeof keyed[number]) => compareParts(a.parts || [], b.parts || [], collator);
    const ordered = ranked.slice().sort(byValue);
    const rank = new Map<typeof keyed[number], number>();
    ordered.forEach((k, i) => rank.set(k, i > 0 && byValue(ordered[i - 1], k) === 0 ? rank.get(ordered[i - 1]) || 0 : i));
    const last = dir === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    return sortRows(keyed, (k) => (k.parts === null ? last : rank.get(k) || 0), dir).map((k) => k.row);
}

/** `rows` by name first, then by the column: a tie in the column reads alphabetically. */
export function sortTable<T>(rows: T[], name: (row: T) => string, parts: (row: T) => SortParts, dir: Dir): T[] {
    return sortByParts(sortByParts(rows, (r) => [name(r)], "asc"), parts, dir);
}

// ------------------------------------------------------------ the parts

/** Class, then spec, in the menu language — what a prefilled character sorts by. */
export function pickParts(classes: KaderClassDef[], pick: KaderWish | null | undefined): SortParts {
    if (!pick || !pick.className) return null;
    return [className(classes, pick.className), specName(classes, pick.spec)];
}

/** A wish: its role (tank, heal, melee, ranged), then class and spec. */
export function wishParts(classes: KaderClassDef[], wish: KaderWish | null | undefined): SortParts {
    if (!wish || !wish.className) return null;
    const role = specRole(classes, wish.spec);
    return [role ? ROLES.indexOf(role) : ROLES.length, className(classes, wish.className), specName(classes, wish.spec)];
}

/**
 * An answer: a single choice by option order, a multiple one by how many are
 * picked, then which (in option order), a text alphabetically; none is null.
 */
export function answerParts(q: KaderQuestion, value: KaderAnswer | undefined): SortParts {
    if (!isAnswered(q, value)) return null;
    if (q.type === "text") return [String(value).trim()];
    const ids = q.options.map((o) => o.id);
    if (q.type === "single") return [ids.indexOf(String(value))];
    const picked = (Array.isArray(value) ? value : [value]).map((id) => ids.indexOf(String(id))).filter((i) => i >= 0).sort((a, b) => a - b);
    return [picked.length, ...picked];
}

const INTERVIEW_ORDER: Record<InterviewStatus, number> = { open: 0, started: 1, done: 2 };

// ----------------------------------------------------------------- Pool

export type PoolSortKey = "name" | "char" | "roles" | "attendance" | "state";
/** The Pool's columns and the direction a first click picks: names A–Z, counts and attendance highest first, states furthest along first. */
export const POOL_SORT: Record<PoolSortKey, Dir> = { name: "asc", char: "asc", roles: "desc", attendance: "desc", state: "desc" };

export function poolParts({ view, kader, players }: Ctx, key: PoolSortKey): (row: Row) => SortParts {
    switch (key) {
        case "char": return (r) => {
            const p = players.get(r.userId);
            return pickParts(view.classes, p && p.prefill ? p.prefill : null);
        };
        case "roles": return (r) => {
            const names = rolesOf(view, players.get(r.userId)).map((x) => x.name);
            return [names.length, names.join(", ")];
        };
        case "attendance": return (r) => {
            const att = attendanceOf(view, kader, players.get(r.userId));
            return att ? [att.pct] : null;
        };
        case "state": return (r) => [STATES.indexOf(r.entry.state)];
        default: return (r) => [playerName(view, r.userId, r.entry)];
    }
}

// ------------------------------------------------------------ Übersicht

/** "name" | "wish1" | "wish2" | "interview" | "since" | "q-<question id>". */
export type OverviewSortKey = string;

/** The Übersicht's columns, one per question of the Kader; a multiple choice starts with the most picks. */
export function overviewSortDefaults(questions: KaderQuestion[]): Record<OverviewSortKey, Dir> {
    const out: Record<OverviewSortKey, Dir> = { name: "asc", wish1: "asc", wish2: "asc", interview: "asc", since: "desc" };
    for (const q of questions) out[`q-${q.id}`] = q.type === "multi" ? "desc" : "asc";
    return out;
}

export function overviewParts({ view, kader }: Ctx, key: OverviewSortKey, now = Date.now()): (row: Row) => SortParts {
    if (key === "wish1" || key === "wish2") {
        const i = key === "wish1" ? 0 : 1;
        return (r) => wishParts(view.classes, r.entry.wishes[i]);
    }
    if (key === "interview") {
        // not started < started < held, then how far: wish and required answers
        return (r) => {
            const p = progress(r.entry, kader.questions);
            return [INTERVIEW_ORDER[statusOf(r.entry)], p.total ? p.done / p.total : 0];
        };
    }
    if (key === "since") {
        // how long they have been waiting: the column shows days
        return (r) => {
            const ms = Date.parse(r.entry.since);
            return Number.isFinite(ms) ? [now - ms] : null;
        };
    }
    if (key.startsWith("q-")) {
        const q = kader.questions.find((x) => `q-${x.id}` === key);
        return (r) => (q ? answerParts(q, r.entry.interview.answers[q.id]) : null);
    }
    return (r) => [playerName(view, r.userId, r.entry)];
}

// --------------------------------------------------------------- import

export type ImportSortKey = "name" | "prefill" | "source";
export const IMPORT_SORT: Record<ImportSortKey, Dir> = { name: "asc", prefill: "asc", source: "asc" };
const SOURCE_ORDER = { planner: 0, profile: 1, logs: 2 };

/** The import's member list: the Discord name, the prefilled character, where it comes from (none last). */
export function importParts(view: KaderView, key: ImportSortKey, inKader: (m: KaderMember) => boolean): (m: KaderMember) => SortParts {
    if (key === "prefill") return (m) => pickParts(view.classes, m.prefill);
    if (key === "source") return (m) => (inKader(m) ? [Object.keys(SOURCE_ORDER).length] : m.prefill ? [SOURCE_ORDER[m.prefill.source]] : null);
    return (m) => [m.displayName];
}
