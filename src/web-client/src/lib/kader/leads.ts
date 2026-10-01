// Who conducts an interview: one colour per lead (the same in the Kader header,
// the interview lists, the Übersicht and the drawer) and the pick of the
// "Gespräch führt" filter of the Gespräche list. Pure.
import type { KaderData, KaderEntry } from "../../api";

/** The colours a lead can have (the .kp-hue-N classes of kader.css). */
export const LEAD_HUES = 4;

/** A filter value for "nobody is assigned" and for "me" (user ids are numeric, so these never clash). */
export const LEAD_NONE = "none";
export const LEAD_ME = "me";
export const LEAD_ALL = "all";

function hash(id: string): number {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return h;
}

/**
 * The colour of every lead of a Kader. It comes from the user id, so a lead keeps it when the list
 * changes order or somebody is added; only two leads that would share a colour are told apart
 * (the lower id keeps it, the other takes the next free one).
 */
export function leadHues(leads: string[]): Record<string, number> {
    const out: Record<string, number> = {};
    let taken = new Set<number>();
    for (const id of [...new Set(leads)].sort()) {
        let h = hash(id) % LEAD_HUES;
        for (let i = 0; i < LEAD_HUES && taken.has(h); i++) h = (h + 1) % LEAD_HUES;
        out[id] = h;
        taken.add(h);
        if (taken.size >= LEAD_HUES) taken = new Set();
    }
    return out;
}

/** The colour (0..3) of one lead; somebody who is no lead (any more) gets the one their id gives. */
export function leadHue(leads: string[], userId: string): number {
    const hue = leadHues(leads)[userId];
    return hue === undefined ? hash(userId) % LEAD_HUES : hue;
}

/** The leads of a Kader, then everybody else who still conducts an interview there (a former lead), in the order they appear. */
export function interviewersOf(kader: KaderData, entries: KaderEntry[]): string[] {
    const out = [...kader.leads];
    for (const e of entries) {
        const id = e.interview.lead;
        if (id && !out.includes(id)) out.push(id);
    }
    return out;
}

/** Whether an interview passes the pick of the list filter ("all", "me", "none" or a user id). */
export function leadMatches(entry: KaderEntry, pick: string, me: string): boolean {
    if (pick === LEAD_ALL) return true;
    const lead = entry.interview.lead;
    if (pick === LEAD_NONE) return !lead;
    if (pick === LEAD_ME) return !!lead && lead === me;
    return lead === pick;
}

/** A stored pick, repaired: "all" unless it names somebody who still conducts an interview (or "me" / "none"). */
export function cleanLeadPick(raw: unknown, interviewers: string[]): string {
    if (raw === LEAD_ME || raw === LEAD_NONE) return raw;
    return typeof raw === "string" && interviewers.includes(raw) ? raw : LEAD_ALL;
}
