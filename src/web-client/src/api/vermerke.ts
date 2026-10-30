import { get, send } from "./client";

// Vermerke (docs/vermerke.md, #980): notes the orga keeps on Discord accounts.
// The contract is the header of src/web/apiRoutes/vermerke.js; everything works
// on the caller's active server. Area "vermerke": read = list and notes,
// write = add, change, archive, hide.

export type NoteLevel = "hint" | "warning" | "shadowban";
export type NoteReason = "left_early" | "no_show" | "late_signoff" | "behavior" | "loot" | "other";

export const NOTE_LEVELS: NoteLevel[] = ["hint", "warning", "shadowban"];
export const NOTE_REASONS: NoteReason[] = ["late_signoff", "no_show", "left_early", "behavior", "loot", "other"];
/** Notes per person and server, the archive included (the store's MAX_ENTRIES). */
export const MAX_NOTES = 50;
/** Characters of a note's text (the store's MAX_TEXT). */
export const MAX_NOTE_TEXT = 1000;

/** One person of the list: no text, the reasons with their counts. */
export type VermerkPerson = {
    userId: string;
    name: string;
    /** the highest active level, null when nothing counts any more (archive) */
    level: NoteLevel | null;
    reasons: Partial<Record<NoteReason, number>>;
    activeCount: number;
    totalCount: number;
    lastAt: number;
    lastByName: string;
    /** active entries that come shared from another server */
    sharedCount: number;
    /** no longer on the server; null without a member list */
    left: boolean | null;
};

export type VermerkHistory = { by: string; byName: string; at: number; action: "create" | "update" | "archive" | "restore"; changes?: string[] };

export type VermerkEntry = {
    id: string;
    level: NoteLevel;
    reason: NoteReason;
    text: string;
    eventIds: string[];
    expiresAt: number | null;
    shared: boolean;
    by: string;
    byName: string;
    at: number;
    archived?: boolean;
    archivedAt?: number;
    archivedBy?: string;
    history: VermerkHistory[];
    /** written on the active server (else: shared from another, read only) */
    own: boolean;
    originGuildId: string;
    originName?: string;
    /** a shared entry of another server this server hid for itself */
    hidden: boolean;
    active: boolean;
};

export type VermerkPersonDetail = { userId: string; name: string; level: NoteLevel | null; entries: VermerkEntry[] };

export type VermerkFields = {
    level: NoteLevel;
    reason: NoteReason;
    text: string;
    eventIds: string[];
    expiresAt: number | null;
    shared: boolean;
};

export type PersonHit = { userId: string; name: string; gone: boolean | null };
export type RecentRaid = { eventId: string; title: string; startTime: number; signed: boolean };

export type VermerkList = { guildId: string; guildName: string; people: VermerkPerson[] };

export function getVermerke(): Promise<VermerkList> {
    return get("/api/vermerke");
}

export function getVermerkPerson(userId: string): Promise<VermerkPersonDetail> {
    return get(`/api/vermerke/person?userId=${encodeURIComponent(userId)}`);
}

export function createVermerk(userId: string, name: string, fields: VermerkFields): Promise<{ entry: VermerkEntry }> {
    return send("POST", "/api/vermerke", { userId, name, ...fields });
}

export function updateVermerk(userId: string, id: string, fields: Partial<VermerkFields>): Promise<{ entry: VermerkEntry }> {
    return send("POST", "/api/vermerke/update", { userId, id, ...fields });
}

export function archiveVermerk(userId: string, id: string, archived = true): Promise<{ entry: VermerkEntry }> {
    return send("POST", "/api/vermerke/archive", { userId, id, archived });
}

/** Hides (or shows again) a shared entry of another server on the active one. */
export function hideVermerk(id: string, hidden = true): Promise<{ id: string; hidden: boolean }> {
    return send("POST", "/api/vermerke/hide", { id, hidden });
}

export function searchVermerkPeople(query: string): Promise<{ results: PersonHit[] }> {
    return get(`/api/vermerke/people?q=${encodeURIComponent(query)}`);
}

export function getVermerkRaids(userId: string): Promise<{ raids: RecentRaid[] }> {
    return get(`/api/vermerke/raids?userId=${encodeURIComponent(userId)}`);
}

// ---- Hinweise aus den Daten (#982) ----

export type SignalKind = "late_signoff" | "signoff_after_setup" | "no_show" | "left_early" | "left_server";
export type VermerkSignal = {
    userId: string;
    name: string;
    kind: SignalKind;
    count: number;
    windowDays: number;
    events: { eventId: string; title: string; startTime: number }[];
    lastAt: number;
};

/**
 * The hints from the data. The section is optional: a server without the
 * route yet (404) or any other failure reads as "no hints", never as an error.
 */
export async function getVermerkSignals(): Promise<VermerkSignal[]> {
    try {
        const res = await get<{ signals?: VermerkSignal[] }>("/api/vermerke/signals");
        const list = res && res.signals;
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

export function ignoreVermerkSignal(userId: string, kind: SignalKind): Promise<unknown> {
    return send("POST", "/api/vermerke/signals/ignore", { userId, kind });
}

/** The note reason a hint stands for ("Abmeldung nach Setzung" is a late signoff). */
export function reasonOfSignal(kind: SignalKind): NoteReason {
    if (kind === "signoff_after_setup") return "late_signoff";
    if (kind === "left_server") return "other";
    return kind;
}
