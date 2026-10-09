// The interview of the Vorauswahl (docs/kaderplaner.md): how far one is, what
// an answer says, whether a question is the seven weekdays, and what changed
// since the last save (the page saves only that). Pure.
import type { KaderAnswer, KaderEntry, KaderInterviewPatch, KaderQuestion, KaderWish } from "../../api";

export type InterviewStatus = "open" | "started" | "done";

export function isAnswered(q: KaderQuestion, value: KaderAnswer | undefined): boolean {
    if (value === undefined || value === null) return false;
    if (q.type === "multi") return Array.isArray(value) && value.length > 0;
    return String(value).trim() !== "";
}

/** The wishes plus every required question: `{ done, total }` (the server's interviewProgress). */
export function progress(entry: KaderEntry, questions: KaderQuestion[]): { done: number; total: number; missing: KaderQuestion[] } {
    const required = questions.filter((q) => q.required);
    const missing = required.filter((q) => !isAnswered(q, entry.interview.answers[q.id]));
    const wishes = entry.wishes.length > 0 ? 1 : 0;
    return { done: wishes + required.length - missing.length, total: 1 + required.length, missing };
}

/** Not started (nobody saved anything yet), started, or completed ("geführt"). */
export function statusOf(entry: KaderEntry): InterviewStatus {
    if (entry.interview.completedAt) return "done";
    return entry.interview.startedAt ? "started" : "open";
}

/** The labels an answer stands for, in option order; a text answer as it is. */
export function answerLabels(q: KaderQuestion, value: KaderAnswer | undefined): string[] {
    if (!isAnswered(q, value)) return [];
    if (q.type === "text") return [String(value)];
    const ids = Array.isArray(value) ? value : [value];
    return q.options.filter((o) => ids.includes(o.id)).map((o) => o.label);
}

const WEEKDAYS = [
    ["mo", "montag", "mon", "monday"], ["di", "dienstag", "tue", "tuesday"], ["mi", "mittwoch", "wed", "wednesday"],
    ["do", "donnerstag", "thu", "thursday"], ["fr", "freitag", "fri", "friday"], ["sa", "samstag", "sat", "saturday"],
    ["so", "sonntag", "sun", "sunday"],
];

/** Whether a question's options are the seven weekdays, Monday first: then the page draws day squares. */
export function isWeekdays(q: KaderQuestion): boolean {
    if (q.type === "text" || q.options.length !== 7) return false;
    return q.options.every((o, i) => WEEKDAYS[i].includes(o.label.trim().toLowerCase().replace(/\.$/, "")));
}

/**
 * A click on an option: a single answer switches to it (or off again when it
 * was the one), a multiple one adds or removes it, in option order.
 */
export function toggleAnswer(q: KaderQuestion, value: KaderAnswer | undefined, optionId: string): KaderAnswer {
    if (q.type === "single") return value === optionId ? "" : optionId;
    const picked = Array.isArray(value) ? value : [];
    const next = picked.includes(optionId) ? picked.filter((id) => id !== optionId) : [...picked, optionId];
    return q.options.map((o) => o.id).filter((id) => next.includes(id));
}

/** A short label for a weekday option ("Montag" → "Mo"). */
export function dayShort(label: string): string {
    const clean = label.trim();
    return clean.length <= 3 ? clean : clean.slice(0, 2);
}

// ------------------------------------------------------------------ draft

export type InterviewDraft = { wishes: KaderWish[]; answers: Record<string, KaderAnswer>; note: string; lead: string };

export function draftOf(entry: KaderEntry): InterviewDraft {
    return {
        wishes: entry.wishes.map((w) => ({ ...w })),
        answers: { ...entry.interview.answers },
        note: entry.interview.note,
        lead: entry.interview.lead,
    };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const emptyAnswer = (v: KaderAnswer | undefined) => v === undefined || (Array.isArray(v) ? v.length === 0 : String(v).trim() === "");

/**
 * What the draft changes against what is stored: only those fields, and only
 * the answers that differ (an emptied one as ""). Null when nothing changed.
 */
export function patchOf(draft: InterviewDraft, entry: KaderEntry): KaderInterviewPatch | null {
    const patch: KaderInterviewPatch = {};
    if (!same(draft.wishes, entry.wishes)) patch.wishes = draft.wishes;
    const answers: Record<string, KaderAnswer> = {};
    const ids = new Set([...Object.keys(draft.answers), ...Object.keys(entry.interview.answers)]);
    for (const id of ids) {
        const next = draft.answers[id];
        const prev = entry.interview.answers[id];
        if (emptyAnswer(next) && emptyAnswer(prev)) continue;
        if (typeof next === "string" && typeof prev === "string" && next.trim() === prev.trim()) continue;
        if (!same(next, prev)) answers[id] = emptyAnswer(next) ? "" : (next as KaderAnswer);
    }
    if (Object.keys(answers).length) patch.answers = answers;
    if (draft.note !== entry.interview.note) patch.note = draft.note;
    if (draft.lead !== entry.interview.lead) patch.lead = draft.lead;
    return Object.keys(patch).length ? patch : null;
}

/** Moves one wish up (-1) or down (+1). */
export function moveWish(wishes: KaderWish[], index: number, by: -1 | 1): KaderWish[] {
    const to = index + by;
    if (to < 0 || to >= wishes.length) return wishes;
    const next = [...wishes];
    [next[index], next[to]] = [next[to], next[index]];
    return next;
}

/** Moves one wish to another place (drag and drop). */
export function placeWish(wishes: KaderWish[], from: number, to: number): KaderWish[] {
    if (from === to || from < 0 || from >= wishes.length) return wishes;
    const next = [...wishes];
    const [moved] = next.splice(from, 1);
    next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
    return next;
}
