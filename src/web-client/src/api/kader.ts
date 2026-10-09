import { get, getKeepalive, send, type ApiError } from "./client";

// ===== Kaderplaner (docs/kaderplaner.md) =====
// Raid rosters for WoW Forever, area "kader". Several Kader per server; every
// player of a Kader has a state that stays until somebody changes it: pool →
// selected (Vorauswahl, interview) → provisional (discussion) → roster / bench /
// tentative. GET /api/kader is the whole view model (src/web/kader/kaderView.js)
// with the chosen Kader; a change inside one Kader answers `{ kader, kaders }`,
// a change on the server's side (accounts, character data, taking players in)
// the whole view again. Keys are the code's own vocabulary: classes "Warrior",
// specs "Warrior-Protection", roles tank|healer|melee|ranged, gear
// none|usable|ready, weekdays mo…so.

export type KaderRole = "tank" | "healer" | "melee" | "ranged";
export type KaderGear = "none" | "usable" | "ready";
export type KaderDay = "mo" | "di" | "mi" | "do" | "fr" | "sa" | "so";
/** What deviates from the raider profile (kaderView.js `differs`). */
export type KaderDiff = "class" | "mainSpec" | "gear" | "tank" | "heal" | "notInProfile";
/** A Forever name ("Vorname Nachname") or a free nickname. */
export type KaderNameStyle = "forever" | "nick";
export type KaderState = "pool" | "selected" | "provisional" | "roster" | "bench" | "tentative";
export type KaderVote = "yes" | "unsure" | "no";
export type KaderQuestionType = "single" | "multi" | "text";

export type KaderSpecDef = { key: string; name: string; nameEn: string; role: KaderRole; canTank: boolean; canHeal: boolean; icon: string };
export type KaderClassDef = { key: string; name: string; nameEn: string; color: string; icon: string; specs: KaderSpecDef[]; canTank: boolean; canHeal: boolean };
/** A buff of the rule set: `label` German, `labelEn` the English name the rule set knows. */
export type KaderRaidBuff = { key: string; label: string; labelEn: string; icon: string; providers: string[] };
export type KaderPartyBuff = KaderRaidBuff & { beneficiaries: string[]; important: boolean };

export type KaderSpecPick = { spec: string; main: boolean; gear: KaderGear };

/** One character as the planner sees it: its own data, else the profile's. */
export type KaderCharacter = {
    id: string;
    name: string;
    nameStyle: KaderNameStyle;
    className: string;
    specs: KaderSpecPick[];
    canTank: boolean;
    canHeal: boolean;
    origin: "profile" | "planner";
    onlineKey?: string;
    isProfileMain?: boolean;
    differs: KaderDiff[];
    mainSpec: string | null;
    role: KaderRole | null;
    gear: KaderGear;
};

export type KaderNight = { date: string; title: string; attended: boolean; reason: string | null };
/** One raid category's last nights for an account (rosterAttendance.js: the last 11 with a signup or a log). */
export type KaderCategoryAttendance = { attended: number; counted: number; nights: KaderNight[] };
/**
 * A player's attendance per raid category id — only the categories that counted
 * a night for the account; null when none did. The page sums the Kader's pick
 * (lib/kader/model.ts attendanceOf).
 */
export type KaderAttendance = Record<string, KaderCategoryAttendance> | null;
/** A raid category of the server: a Discord category with raid events, the game version it plays, the nights it counts. */
export type KaderRaidCategory = { id: string; name: string; versionId: string; versionLabel: string; nights: number };

/** The character a player is prefilled with, and where it comes from ("fehlt" when null). */
export type KaderPrefill = { name: string; className: string; spec: string; source: "planner" | "profile" | "logs"; versionId: string } | null;

/** A character of the raider profile (any game version) or one the logs link to the account: what the account dialog offers. */
export type KaderPickable = {
    key: string;
    name: string;
    className: string;
    versionId: string;
    canTank: boolean;
    canHeal: boolean;
    specs: KaderSpecPick[];
    source: "profile" | "logs";
};

/** A player the planner knows, per server (not per Kader). */
export type KaderPlayer = {
    userId: string;
    displayName: string;
    avatarUrl: string | null;
    onServer: boolean;
    roleIds: string[];
    hasProfile: boolean;
    manual: boolean;
    hasOverride: boolean;
    characters: KaderCharacter[];
    activeCharacterId: string | null;
    differs: KaderDiff[];
    profile: { character: string; className: string; mainSpec: string | null; logSpecs: string[] } | null;
    prefill: KaderPrefill;
    pickable: KaderPickable[];
    availability: KaderDay[];
    attendance: KaderAttendance;
    /** The revision of the planner's character data (0 = none of its own) and who changed it last (the account dialog's conflict check). */
    rev?: number;
    changedBy?: string;
};

export type KaderMember = { userId: string; displayName: string; roleIds: string[]; prefill: KaderPrefill };
export type KaderDiscordRole = { id: string; name: string; color: string; count: number };

export type KaderWish = { className: string; spec: string };
export type KaderAnswer = string | string[];
export type KaderInterview = {
    lead: string;
    answers: Record<string, KaderAnswer>;
    note: string;
    startedAt: string;
    updatedAt: string;
    updatedBy: string;
    completedAt: string;
    completedBy: string;
    /** The revision of the last change to wishes, answers, note, interviewer or completion (missing = 0). */
    rev?: number;
};
export type KaderHistoryItem = { at: string; by: string; type: string; from?: string; to?: string; vote?: string; className?: string; spec?: string };
export type KaderComment = { id: string; by: string; at: string; text: string };

/** A player's entry in one Kader. */
export type KaderEntry = {
    name: string;
    state: KaderState;
    since: string;
    by: string;
    addedAt: string;
    addedBy: string;
    history: KaderHistoryItem[];
    wishes: KaderWish[];
    interview: KaderInterview;
    votes: Record<string, KaderVote>;
    comments: KaderComment[];
    decision: KaderWish | null;
};

/** An answer option; `color` one of KADER_OPTION_COLORS (lib/kader/colors.ts), none = picked by position. */
export type KaderOption = { id: string; label: string; color?: string };
export type KaderQuestion = { id: string; text: string; type: KaderQuestionType; options: KaderOption[]; required: boolean; rev?: number };
export type KaderSlot = { userId: string; spec: string } | null;
export type KaderVariant = { id: string; name: string; size: 10 | 20; groups: KaderSlot[][] };

export type KaderData = {
    id: string;
    name: string;
    leads: string[];
    createdAt: string;
    createdBy: string;
    /** The raid categories attendance counts in (empty: none picked yet, the page shows "—"). */
    attendanceCategories: string[];
    questions: KaderQuestion[];
    players: Record<string, KaderEntry>;
    setups: KaderVariant[];
    /** The revision of the last change in this Kader (missing = 0, never changed since live updates exist). */
    rev?: number;
    /** What changed, oldest first, the newest 50 lines (types and ids only). */
    activity?: KaderActivityItem[];
};

/** The kinds of change a Kader's activity log knows (src/services/kader/kaderActivity.js). */
export type KaderActivityType =
    | "created" | "added" | "removed" | "state" | "decision" | "interview" | "lead" | "interview_completed" | "interview_reopened"
    | "vote" | "comment" | "comment_deleted" | "questions" | "setups" | "settings" | "character";
/** One line of the activity log: several players moved at once are one line with `count`. */
export type KaderActivityItem = {
    rev: number;
    at: string;
    by: string;
    type: KaderActivityType;
    playerId?: string;
    count?: number;
    from?: string;
    to?: string;
    questionId?: string;
};

/** The pages of one Kader a presence can name. */
export type KaderPresenceSub = "" | "pool" | "vorauswahl" | "uebersicht" | "roster" | "fragen" | "setups";
/** What somebody has open with a player: the interview, the discussion drawer, the account dialog. */
export type KaderPresenceWhat = "" | "interview" | "drawer" | "account";
/** Somebody else in the same Kader right now (in memory on the server, gone 25 s after their last poll). */
export type KaderPresence = { userId: string; name: string; sub: KaderPresenceSub; playerId: string; what: KaderPresenceWhat; edit: boolean };
/** The answer of the live poll. */
export type KaderLive = {
    rev: number;
    sharedRev: number;
    changes: KaderActivityItem[];
    /** There were more changes than `changes` holds. */
    more: boolean;
    presence: KaderPresence[];
    /** The Kader is not there (any more). */
    gone?: boolean;
};
/** Where the page is, reported with every poll. */
export type KaderLiveWhere = { tab: string; sub: KaderPresenceSub; playerId: string; what: KaderPresenceWhat; edit: boolean };
/** A 409 "somebody changed this in between": the current revision, who and when. */
export type KaderStaleError = ApiError & { rev?: number; by?: string; at?: string };
/** Whether a refused save was refused because somebody else changed the item in between. */
export const isStale = (e: unknown): e is KaderStaleError => !!e && typeof e === "object" && (e as ApiError).code === "stale";
/** A save that names the revision it started from; `force` overwrites a newer one ("Trotzdem speichern"). */
export type KaderBase = { baseRev?: number; force?: boolean };

export type KaderSummary = { id: string; name: string; leads: string[]; createdAt: string; createdBy: string; counts: Record<KaderState, number>; questions: number };

export type KaderView = {
    versionId: string;
    mainVersion: { id: string; label: string };
    guildId: string;
    roles: KaderRole[];
    classes: KaderClassDef[];
    buffs: { raid: KaderRaidBuff[]; party: KaderPartyBuff[] };
    /** The server's raid categories, in Discord's order. */
    raidCategories: KaderRaidCategory[];
    players: KaderPlayer[];
    members: KaderMember[];
    discordRoles: KaderDiscordRole[];
    names: Record<string, string>;
    kaders: KaderSummary[];
    kader: KaderData | null;
    warnings: string[];
    /** The revision of the last change on the server's side (accounts, character data, Kader created/renamed/deleted). */
    sharedRev?: number;
};

/** What a change inside one Kader answers, plus what the change adds (a created id, counts). */
export type KaderChange = {
    kader: KaderData | null;
    kaders: KaderSummary[];
    sharedRev?: number;
    kaderId?: string;
    moved?: number;
    skipped?: number;
    questionId?: string;
    variantId?: string;
    commentId?: string;
    copied?: number;
    added?: number;
    already?: number;
};

/** A character while it is edited in the account dialog. */
export type KaderCharacterInput = {
    id: string;
    name: string;
    nameStyle: KaderNameStyle;
    className: string;
    specs: KaderSpecPick[];
    canTank: boolean;
    canHeal: boolean;
    onlineKey?: string;
};

export type KaderInterviewPatch = { wishes?: KaderWish[]; answers?: Record<string, KaderAnswer>; note?: string; lead?: string };
export type KaderQuestionInput = { text: string; type: KaderQuestionType; options: { id?: string; label: string; color?: string }[]; required: boolean };

export function getKader(kaderId = ""): Promise<KaderView> {
    return get<KaderView>(kaderId ? `/api/kader?kader=${encodeURIComponent(kaderId)}` : "/api/kader");
}

/** Only the Kader as stored and the summaries: the light refetch after a change somebody else made inside it. */
export function getKaderOnly(kaderId: string): Promise<KaderChange> {
    return get<KaderChange>(`/api/kader/kader?kader=${encodeURIComponent(kaderId)}`);
}

function liveQuery(kaderId: string, where: KaderLiveWhere, extra: Record<string, string> = {}): string {
    const q = new URLSearchParams({ kader: kaderId, tab: where.tab, ...extra });
    if (where.sub) q.set("sub", where.sub);
    if (where.playerId && where.what) {
        q.set("player", where.playerId);
        q.set("what", where.what);
        if (where.edit) q.set("edit", "1");
    }
    return `/api/kader/live?${q.toString()}`;
}

/**
 * The live poll (every 5 s while the tab is visible): reports where the page is and answers the Kader's
 * revision, the changes since `rev` and who else is in the Kader.
 */
export function getKaderLive(kaderId: string, rev: number, where: KaderLiveWhere): Promise<KaderLive> {
    return get<KaderLive>(liveQuery(kaderId, where, { rev: String(rev) }));
}

/** The page leaves the Kader: the others stop seeing it at once. Best effort (the server forgets it 25 s later anyway). */
export function leaveKaderLive(kaderId: string, where: KaderLiveWhere): void {
    getKeepalive(liveQuery(kaderId, where, { leave: "1" }));
}

// ----- Kader
export function createKader(name: string): Promise<KaderChange> {
    return send("POST", "/api/kader/kaders", { name });
}

export function updateKader(kaderId: string, input: { name?: string; leads?: string[]; attendanceCategories?: string[] }): Promise<KaderChange> {
    return send("PUT", "/api/kader/kaders", { kaderId, ...input });
}

export function deleteKader(kaderId: string): Promise<KaderChange> {
    return send("POST", "/api/kader/kaders/delete", { kaderId });
}

// ----- players and states
export function addKaderPlayers(kaderId: string, players: { userId: string; displayName?: string }[]): Promise<KaderView & { added: number; already: number }> {
    return send("POST", "/api/kader/players/add", { kaderId, players });
}

export function removeKaderPlayers(kaderId: string, userIds: string[]): Promise<KaderChange> {
    return send("POST", "/api/kader/players/remove", { kaderId, userIds });
}

export function setKaderState(kaderId: string, userIds: string[], to: KaderState, decision?: KaderWish): Promise<KaderChange> {
    return send("POST", "/api/kader/players/state", { kaderId, userIds, to, ...(decision ? { decision } : {}) });
}

// ----- interview
/** Saves what changed; `base` names the interview's revision the draft started from (409 `stale` when it moved on). */
export function saveKaderInterview(kaderId: string, userId: string, patch: KaderInterviewPatch, base: KaderBase = {}): Promise<KaderChange> {
    return send("PUT", "/api/kader/interview", { kaderId, userId, ...patch, ...base });
}

export function completeKaderInterview(kaderId: string, userId: string): Promise<KaderChange> {
    return send("POST", "/api/kader/interview/complete", { kaderId, userId });
}

export function reopenKaderInterview(kaderId: string, userId: string): Promise<KaderChange> {
    return send("POST", "/api/kader/interview/reopen", { kaderId, userId });
}

// ----- votes and comments
export function setKaderVote(kaderId: string, userId: string, vote: KaderVote | ""): Promise<KaderChange> {
    return send("POST", "/api/kader/votes", { kaderId, userId, vote });
}

export function addKaderComment(kaderId: string, userId: string, text: string): Promise<KaderChange> {
    return send("POST", "/api/kader/comments", { kaderId, userId, text });
}

export function deleteKaderComment(kaderId: string, userId: string, commentId: string): Promise<KaderChange> {
    return send("POST", "/api/kader/comments/delete", { kaderId, userId, commentId });
}

// ----- questions
export function addKaderQuestion(kaderId: string, input: KaderQuestionInput): Promise<KaderChange> {
    return send("POST", "/api/kader/questions", { kaderId, ...input });
}

export function updateKaderQuestion(kaderId: string, questionId: string, input: Partial<KaderQuestionInput>, base: KaderBase = {}): Promise<KaderChange> {
    return send("PUT", "/api/kader/questions", { kaderId, questionId, ...input, ...base });
}

export function deleteKaderQuestion(kaderId: string, questionId: string): Promise<KaderChange> {
    return send("POST", "/api/kader/questions/delete", { kaderId, questionId });
}

export function orderKaderQuestions(kaderId: string, order: string[]): Promise<KaderChange> {
    return send("POST", "/api/kader/questions/order", { kaderId, order });
}

export function copyKaderQuestions(kaderId: string, fromKaderId: string): Promise<KaderChange> {
    return send("POST", "/api/kader/questions/copy", { kaderId, fromKaderId });
}

// ----- example setups
export function addKaderVariant(kaderId: string, input: { name?: string; copyFrom?: string } = {}): Promise<KaderChange> {
    return send("POST", "/api/kader/variants", { kaderId, ...input });
}

export function saveKaderVariant(kaderId: string, variantId: string, input: { name?: string; size?: 10 | 20; groups?: KaderSlot[][] }): Promise<KaderChange> {
    return send("PUT", "/api/kader/variants", { kaderId, variantId, ...input });
}

export function deleteKaderVariant(kaderId: string, variantId: string): Promise<KaderChange> {
    return send("POST", "/api/kader/variants/delete", { kaderId, variantId });
}

export function autoKaderVariant(kaderId: string, variantId: string, sources: KaderState[]): Promise<KaderChange> {
    return send("POST", "/api/kader/variants/auto", { kaderId, variantId, sources });
}

// ----- accounts and character data (answer the whole view; `kaderId` = the open Kader, so the answer carries it)
export function addKaderAccount(input: { userId: string; displayName: string; kaderId?: string; character?: { nameStyle: KaderNameStyle; firstName?: string; lastName?: string; nickname?: string; className: string } }): Promise<KaderView> {
    return send("POST", "/api/kader/accounts", input);
}

export function removeKaderAccount(kaderId: string, userId: string): Promise<KaderView> {
    return send("POST", "/api/kader/accounts/remove", { kaderId, userId });
}

export function saveKaderAssignment(kaderId: string, userId: string, characters: KaderCharacterInput[], activeCharacterId: string | null, base: KaderBase = {}): Promise<KaderView> {
    return send("PUT", "/api/kader/assignments", { kaderId, userId, characters, activeCharacterId, ...base });
}

export function resetKaderAssignment(kaderId: string, userId: string): Promise<KaderView> {
    return send("POST", "/api/kader/assignments/reset", { kaderId, userId });
}

// ----- the raid roster of a Kader (#658): create one, or take newly decided players over.
// Only status and character cross; nothing flows back into the Kader.

/** GET /api/kader/roster: the roster the Kader created (counts only) and what the caller may do. */
export type KaderRosterState = {
    roster: { id: string; name: string; members: number } | null;
    /** Players in roster / bench / tentative — what a roster takes. */
    candidates: number;
    /** Of them, not in the roster yet (all while there is none). */
    pending: number;
    /** Full admin and no roster yet. */
    canCreate: boolean;
    /** Area `kader` write and manager of the roster. */
    canSync: boolean;
};

export function getKaderRoster(kaderId: string): Promise<KaderRosterState> {
    return get<KaderRosterState>(`/api/kader/roster?kader=${encodeURIComponent(kaderId)}`);
}

export function syncKaderRoster(kaderId: string): Promise<{ rosterId: string; added: number; skipped: number; kept: number; roleFailures: { userId: string; roleId: string; code: string }[] }> {
    return send("POST", "/api/kader/roster/sync", { kaderId });
}

/** The raid categories a new roster can belong to (GET /api/rosters/options, full admins): those without a roster. */
export type KaderRosterCategory = { id: string; name: string; rosterId: string | null };

export function getKaderRosterCategories(): Promise<{ categories: KaderRosterCategory[] }> {
    return get<{ categories: KaderRosterCategory[] }>("/api/rosters/options");
}

/** "Roster anlegen" from a Kader (POST /api/rosters/create, source "kader", full admins). */
export function createKaderRoster(kaderId: string, input: { name: string; categoryId?: string }): Promise<{ roster: { id: string; name: string }; initial: { added: number; skipped: number; roleFailures: unknown[] } }> {
    return send("POST", "/api/rosters/create", { source: "kader", kaderId, name: input.name, ...(input.categoryId ? { categoryId: input.categoryId } : {}) });
}
