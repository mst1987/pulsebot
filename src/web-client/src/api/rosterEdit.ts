import { get, send } from "./client";
import type { RosterRole, RosterStatus } from "./roster";

// ===== Raid rosters: editing (#655 members, #656 Discord roles, #657 create and settings) =====
// The write routes of src/web/apiRoutes/rosterMembers.js, rosterRoles.js and
// rosterAdmin.js plus the read routes of the tabs (Abgleich, Komposition,
// Verlauf). A refusal arrives as { code, message }; the page translates the
// code (lib/roster/rosterEdit.ts errorText), never shows the server's text.

/** One role write as the server reports it (services/roster/rosterRoleSync.js). */
export type RosterRoleResult = { roleId: string; roleName: string; give: boolean; ok: boolean; code: string; changed: boolean };

/** The role writes a member change caused; `skipped` when there was nothing to write ("no_roles", "no_guild"). */
export type RosterRoleOutcome = { ok: boolean; skipped?: string; results: RosterRoleResult[] };

/** A member as the store holds it (answer of a member write). */
export type StoredRosterMember = {
    status: RosterStatus;
    since: string;
    by: string;
    chars: string[];
    charNames: Record<string, string>;
    note: string;
    trialUntil: string | null;
};

/** What a member write may change; `chars` are profile keys or names typed by hand, the first counts. */
export type RosterMemberPatch = {
    status?: RosterStatus;
    chars?: string[];
    charNames?: Record<string, string>;
    note?: string;
    trialUntil?: string | null;
};

/** Take someone in (mode "add") or change a member (mode "update"); left out: add when no member yet. */
export function saveRosterMember(rosterId: string, userId: string, patch: RosterMemberPatch, mode?: "add" | "update"): Promise<{ userId: string; created: boolean; member: StoredRosterMember; roles: RosterRoleOutcome }> {
    return send("POST", "/api/rosters/members", { rosterId, userId, ...(mode ? { mode } : {}), ...patch });
}

/** Take someone out of the roster; every role of the roster is taken from them. */
export function removeRosterMember(rosterId: string, userId: string): Promise<{ userId: string; removed: true; roles: RosterRoleOutcome }> {
    return send("POST", "/api/rosters/members/remove", { rosterId, userId });
}

/** A profile character as the member search lists it (first spec). */
export type RosterSearchChar = { key: string; name: string; className: string; spec: string; specId: string; specLabel: string; specIcon: string; classColor: string };

export type RosterSearchResult = { userId: string; displayName: string; inRoster: boolean; chars: RosterSearchChar[] };

/**
 * The Discord members of a roster's server matching `q` (non-members first, 25 at most);
 * without `id` the active server and `version` (the manager picker of the create dialog).
 */
export function searchRosterMembers({ id = "", q = "", version = "" }: { id?: string; q?: string; version?: string }): Promise<{ results: RosterSearchResult[] }> {
    const params = new URLSearchParams();
    if (id) params.set("id", id);
    params.set("q", q);
    if (version) params.set("version", version);
    return get(`/api/rosters/member-search?${params.toString()}`);
}

/** Give or take one role of the roster (default the main role). */
export function setRosterRole(rosterId: string, userId: string, give: boolean, roleId?: string): Promise<{ result: RosterRoleResult }> {
    return send("POST", "/api/rosters/roles", { rosterId, userId, give, ...(roleId ? { roleId } : {}) });
}

/** One role of the roster as the Abgleich tab lists it. */
export type RosterSyncRole = { id: string; name: string; color: string; main: boolean; trial: boolean; exists: boolean };

/** A roster role the role sync mirrors to or from the other server (docs/discord-servers.md). */
export type RosterMirror = { roleId: string; otherRoleId: string; direction: string; side: "event" | "talk"; incoming: boolean; outgoing: boolean };

export type RosterSync = {
    rosterId: string;
    guildId: string;
    roles: RosterSyncRole[];
    canManageRoles: boolean;
    /** "offline" / "members_unavailable": the two role lists are empty then, never "everyone lacks the role". */
    membersError: string | null;
    inRosterWithoutRole: { userId: string; displayName: string; status: RosterStatus }[];
    roleWithoutRoster: { userId: string; displayName: string; takeFailed: boolean }[];
    withoutChar: { userId: string; displayName: string; suggestion: { key: string; name: string; className: string } | null }[];
    logCharsWithoutPerson: { key: string; character: string; className: string; nights: number; lastSeen: number; claimedBy: { userId: string; name: string }[] }[];
    mirrored: RosterMirror[];
    canManage: boolean;
};

/** The four lists of the Abgleich tab. */
export function getRosterSync(id: string): Promise<RosterSync> {
    return get(`/api/rosters/sync?id=${encodeURIComponent(id)}`);
}

export type RosterOptionRole = { id: string; name: string; color: string; position: number; manageable: boolean };

export type RosterTemplateSlots = { total: number; tank: number; healer: number; bench: number; templateId: string; templateName: string };

export type RosterOptions = {
    guildId: string;
    categories: { id: string; name: string; versionId: string; rosterId: string | null; rosterName: string }[];
    versions: { id: string; label: string; short: string }[];
    defaultVersion: string;
    roles: RosterOptionRole[];
    canManageRoles: boolean;
    online: boolean;
    /** Only for a reader of the Kaderplaner. */
    kaders: { id: string; name: string; inRoster: number; candidates: number }[];
    templateSlots: Record<string, RosterTemplateSlots>;
    isAdmin: boolean;
};

/** What the create dialog and the settings offer for the active server. */
export function getRosterOptions(): Promise<RosterOptions> {
    return get("/api/rosters/options");
}

export type RosterSlots = { total: number; tank: number; healer: number; bench: number };

/** The settings a create or an update sends; an update sends only what changed. */
export type RosterSettingsPatch = {
    name?: string;
    categoryId?: string | null;
    versionId?: string;
    roleIds?: string[];
    trialRoleId?: string | null;
    managers?: { roleIds?: string[]; userIds?: string[] };
    slots?: Partial<RosterSlots>;
    allowMultipleChars?: boolean;
    signupOnly?: boolean;
};

export type RosterSource = "role" | "kader" | "raids" | "none";

/** How the first members came in (answer of a create). */
export type RosterInitial = {
    source: RosterSource;
    added: number;
    skipped: number;
    roleFailures: { userId: string; roleId: string; code: string }[];
    error: string | null;
};

/** A roster as the store holds it (answer of a create / update); the page reloads its views from it. */
export type StoredRoster = { id: string; name: string; categoryId: string | null; versionId: string; guildId: string };

/** Create a roster on the active server (full admins). */
export function createRoster(body: RosterSettingsPatch & { source?: RosterSource; kaderId?: string }): Promise<{ roster: StoredRoster; initial: RosterInitial }> {
    return send("POST", "/api/rosters/create", body);
}

/** Change a roster's settings (admins everything, managers name, slots and the two switches). */
export function updateRoster(rosterId: string, patch: RosterSettingsPatch): Promise<{ roster: StoredRoster; trimmedChars: number }> {
    return send("POST", "/api/rosters/update", { rosterId, ...patch });
}

/** Delete a roster (full admins); the Discord roles stay where they are. */
export function deleteRoster(rosterId: string): Promise<{ rosterId: string; deleted: true }> {
    return send("POST", "/api/rosters/delete", { rosterId });
}

export type RosterComposition = {
    rosterId: string;
    versionId: string;
    slots: RosterSlots;
    counts: Record<RosterStatus, number>;
    roles: { role: Exclude<RosterRole, "">; target: number; actual: number }[];
    dps: { melee: number; ranged: number };
    unknown: number;
    bench: { target: number; actual: number };
    open: number;
    classes: { className: string; label: string; labelEn: string; color: string; icon: string; count: number }[];
    buffs: { key: string; label: string; labelEn: string; icon: string; scope: string; providers: string[]; covered: boolean }[];
    buffsAvailable: boolean;
    canManage: boolean;
};

/** The Komposition tab: places per role against the plan, classes, buffs. */
export function getRosterComposition(id: string): Promise<RosterComposition> {
    return get(`/api/rosters/composition?id=${encodeURIComponent(id)}`);
}

/** One line of a roster's history; `what` and `detail` as stored (lib/roster/rosterEdit.ts historyText reads them). */
export type RosterHistoryEntry = { at: string; by: string; byName: string; userId: string; userName: string; what: string; detail: string };

export type RosterHistoryPage = { entries: RosterHistoryEntry[]; total: number; offset: number; limit: number };

/** A page of the roster's history, newest first; with `userId` only the lines about that person. */
export function getRosterHistory(id: string, { userId = "", offset = 0, limit = 50 }: { userId?: string; offset?: number; limit?: number } = {}): Promise<RosterHistoryPage> {
    const params = new URLSearchParams({ id, offset: String(offset), limit: String(limit) });
    if (userId) params.set("userId", userId);
    return get(`/api/rosters/history?${params.toString()}`);
}
