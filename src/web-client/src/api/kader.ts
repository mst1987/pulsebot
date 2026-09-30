import { get, send } from "./client";

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
export type KaderRaidBuff = { key: string; label: string; icon: string; providers: string[] };
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
/** null while nothing is counted (Forever before its raids open): the page shows "—". */
export type KaderAttendance = { attended: number; counted: number; pct: number; nights: KaderNight[] } | null;

/** The character a player is prefilled with, and where it comes from ("fehlt" when null). */
export type KaderPrefill = { name: string; className: string; spec: string; source: "planner" | "profile" | "logs"; versionId: string } | null;

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
    availability: KaderDay[];
    attendance: KaderAttendance;
    attendanceMain: KaderAttendance;
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

export type KaderOption = { id: string; label: string };
export type KaderQuestion = { id: string; text: string; type: KaderQuestionType; options: KaderOption[]; required: boolean };
export type KaderSlot = { userId: string; spec: string } | null;
export type KaderVariant = { id: string; name: string; size: 10 | 20; groups: KaderSlot[][] };

export type KaderData = {
    id: string;
    name: string;
    leads: string[];
    createdAt: string;
    createdBy: string;
    questions: KaderQuestion[];
    players: Record<string, KaderEntry>;
    setups: KaderVariant[];
};
export type KaderSummary = { id: string; name: string; leads: string[]; createdAt: string; createdBy: string; counts: Record<KaderState, number>; questions: number };

export type KaderView = {
    versionId: string;
    mainVersion: { id: string; label: string };
    guildId: string;
    roles: KaderRole[];
    classes: KaderClassDef[];
    buffs: { raid: KaderRaidBuff[]; party: KaderPartyBuff[] };
    players: KaderPlayer[];
    members: KaderMember[];
    discordRoles: KaderDiscordRole[];
    names: Record<string, string>;
    kaders: KaderSummary[];
    kader: KaderData | null;
    warnings: string[];
};

/** What a change inside one Kader answers, plus what the change adds (a created id, counts). */
export type KaderChange = {
    kader: KaderData | null;
    kaders: KaderSummary[];
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
export type KaderQuestionInput = { text: string; type: KaderQuestionType; options: { id?: string; label: string }[]; required: boolean };

export function getKader(kaderId = ""): Promise<KaderView> {
    return get<KaderView>(kaderId ? `/api/kader?kader=${encodeURIComponent(kaderId)}` : "/api/kader");
}

// ----- Kader
export function createKader(name: string): Promise<KaderChange> {
    return send("POST", "/api/kader/kaders", { name });
}

export function updateKader(kaderId: string, input: { name?: string; leads?: string[] }): Promise<KaderChange> {
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
export function saveKaderInterview(kaderId: string, userId: string, patch: KaderInterviewPatch): Promise<KaderChange> {
    return send("PUT", "/api/kader/interview", { kaderId, userId, ...patch });
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

export function updateKaderQuestion(kaderId: string, questionId: string, input: Partial<KaderQuestionInput>): Promise<KaderChange> {
    return send("PUT", "/api/kader/questions", { kaderId, questionId, ...input });
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

// ----- accounts and character data (answer the whole view)
export function addKaderAccount(input: { userId: string; displayName: string; kaderId?: string; character?: { nameStyle: KaderNameStyle; firstName?: string; lastName?: string; nickname?: string; className: string } }): Promise<KaderView> {
    return send("POST", "/api/kader/accounts", input);
}

export function removeKaderAccount(userId: string): Promise<KaderView> {
    return send("POST", "/api/kader/accounts/remove", { userId });
}

export function saveKaderAssignment(userId: string, characters: KaderCharacterInput[], activeCharacterId: string | null): Promise<KaderView> {
    return send("PUT", "/api/kader/assignments", { userId, characters, activeCharacterId });
}

export function resetKaderAssignment(userId: string): Promise<KaderView> {
    return send("POST", "/api/kader/assignments/reset", { userId });
}
