import { get, send } from "./client";
import type { Category } from "./channels";
import type { CharLootPreview } from "./history";

// Manual raider->character-per-category assignments (see raiderCharactersStore.js
// on the backend). Used to enrich the Raid-Detail attendance tab's "missing" list
// with the character a raider actually plays for that raid category.
export type RaiderCharactersData = {
    members: { id: string; displayName: string }[];
    membersError: string | null;
    roleIds: string[];
    assignments: Record<string, string>;
    knownCharacters: string[];
};

export function getRaiderCharacters(categoryId: string): Promise<RaiderCharactersData> {
    return get<RaiderCharactersData>(`/api/raider-characters?category=${encodeURIComponent(categoryId)}`);
}

export function saveRaiderCharacters(
    categoryId: string,
    assignments: Record<string, string>,
): Promise<{ assignments: Record<string, string> }> {
    return send("POST", "/api/raider-characters", { categoryId, assignments });
}

// ===== Roster (all characters per raid category) =====
// Assembled server-side by src/web/roster.js from the manual per-category
// assignments plus the imported loot; gear issues come from the newest CLA
// evaluation that contains the character (src/web/charGearIssues.js). Colours,
// icons and links are computed server-side, same rule as AnnotatedCharacter.

// One gear finding from a CLA evaluation ("kein Item", "keine Verzauberung",
// "leerer Sockel", …) — mirrors utils/logcheck/gearIssues.js's issue objects.
// High findings come first (see charGearIssues.js), so a capped list always
// leads with what actually costs the raid something.
export type GearIssue = {
    kind: string;
    label: string;
    severity: "high" | "medium";
    itemId: string;
    itemName: string;
    /** "Kopf", "Ring 1", … — empty when the report carried no usable slot. */
    slotName: string;
    /** Paperdoll slot key ("HEAD", "FINGER_1", …) the finding belongs to; "" without a slot. */
    slotKey?: string;
    iconUrl: string;
};

// The newest evaluation a character appears in, plus its findings for them.
// `reportRefId` addresses the locally stored report (/r/<id>), `reportUrl` the
// Warcraft-Logs report it was built from.
export type CharGearReport = {
    character: string;
    className: string;
    issues: GearIssue[];
    issueCount: number;
    reportRefId: string;
    reportId: string;
    reportUrl: string;
    reportTitle: string;
    zone: string;
    generatedAt: number;
};

export type RosterChar = {
    key: string;
    character: string;
    realm: string;
    categoryIds: string[];
    /** Has a manual raider->character assignment (vs. only known from loot). */
    assigned: boolean;
    raiderIds: string[];
    lootCount: number;
    items: CharLootPreview[];
    className: string;
    spec: string;
    source: string;
    classColor: string;
    iconUrl: string;
    armoryUrl: string;
    wclUrl: string;
    gear: CharGearReport | null;
    /** The newest log's role, else the spec's; "" when unknown (web/rosterAttendance.js). */
    role: RosterRole;
    /** Per category id: attendance over its last raid nights. */
    attendance: Record<string, RosterAttendance>;
};

export type RosterRole = "tank" | "healer" | "dps" | "";

/** startTime: unix seconds, like every other event startTime — multiply by 1000 before formatting. */
export type RosterNight = { eventId: string; title: string; startTime: number; attended: boolean; reason: string };

export type RosterAttendance = {
    attended: number;
    total: number;
    /** null when no night could be counted. */
    pct: number | null;
    missed: Omit<RosterNight, "attended">[];
    /** The attended nights, newest first — the roster's answer (its tooltip lists them under "Dabei"). */
    present?: Omit<RosterNight, "attended" | "reason">[];
    /** Night by night — only in the character page's answer. */
    raids?: RosterNight[];
};

/** What a category's group head says: counted nights, its raids, the newest raid's boss icon. */
export type RosterCategoryInfo = { raids: number; contents: string[]; icon: string };

/** One segment of the roster's class distribution — see web/rosterStats.js. */
export type RosterClassShare = { className: string; classColor: string; count: number };

/**
 * The header band's numbers, folded server-side over the same rows the table
 * below renders. They describe the *whole* roster: the filter bar underneath
 * narrows the table, not the headline.
 */
export type RosterStats = {
    total: number;
    assigned: number;
    fromLootOnly: number;
    categories: number;
    uncategorized: number;
    loot: number;
    evaluated: number;
    withIssues: number;
    clean: number;
    issues: number;
    highIssues: number;
    /** Mean attendance share in percent; null when no character had a counted night. */
    avgAttendance: number | null;
    attendanceCounted: number;
    classes: RosterClassShare[];
};

/** Why and since when a character is off the roster (web/rosterHiddenStore.js). */
export type RosterHiddenNote = { character: string; reason: string; at: number; by: string };

export type RosterData = {
    chars: RosterChar[];
    /** Taken off the roster — the page's "Ausgeblendet" tab, not part of `stats`. */
    hiddenChars: (RosterChar & { hidden: RosterHiddenNote })[];
    categories: Category[];
    categoryInfo: Record<string, RosterCategoryInfo>;
    stats: RosterStats;
    activeGuildId: string;
    /** The game version shown (#543): "" = all; the default is the main version. */
    version?: string;
    mainVersion?: string;
    /** Every version with characters plus the main version — the page's filter. */
    versions?: RosterVersion[];
};

export type RosterVersion = { id: string; label: string; short: string; count: number };

/** The roster of one game version (#543): "" = the main version, "all" = every version. */
export function getRoster(version = ""): Promise<RosterData> {
    return get<RosterData>(`/api/roster${version ? `?version=${encodeURIComponent(version)}` : ""}`);
}

/**
 * Take a character off the roster, or put it back.
 *
 * Deletes nothing — the loot history, the evaluations and the character page
 * stay whole; the roster simply stops listing them.
 */
export function setRosterHidden(
    character: string,
    hidden: boolean,
    reason = "",
): Promise<{ character: string; hidden: boolean }> {
    return send("POST", "/api/roster/hide", { character, hide: hidden, reason });
}

/** A spec whose BiS list carries an item — see lootCouncil.js's bisSpecsView(). */
export type RosterBisSpec = { specKey: string; label: string; iconUrl: string; classColor: string; role: string; tier: string; alsoFor: string[] };

export type RosterItemFacts = { itemId: number; contentId: string; content: string; boss: string; tier: string; bisSpecs: RosterBisSpec[] };

export type RosterCharData = {
    character: string;
    role: RosterRole;
    categories: (RosterCategoryInfo & { id: string; name: string })[];
    attendance: Record<string, RosterAttendance>;
    items: Record<string, RosterItemFacts>;
};

/** The character page's roster facts: role, attendance night by night, drop source and BiS per worn item. */
export function getRosterChar(name: string, itemIds: number[] = []): Promise<RosterCharData> {
    const items = itemIds.length ? `&items=${itemIds.join(",")}` : "";
    return get<RosterCharData>(`/api/roster/char?name=${encodeURIComponent(name)}${items}`);
}

// ===== Raid rosters per category (#654, read only) =====
// Built server-side by src/web/roster/rosterView.js from rosterStore.js: names,
// characters (class, spec, colour, icon), roles and attendance come from the
// server and are never recomputed here.

/** A member's status in a roster (rosterStore STATUSES). */
export type RosterStatus = "core" | "trial" | "bench" | "pause";

/** A Discord role as the roster pages show it; `name` "" when Discord does not list it (bot offline). */
export type RosterDiscordRole = { id: string; name: string; color: string };

/** What a roster card and a roster's head share. */
export type RosterHead = {
    id: string;
    name: string;
    categoryId: string | null;
    categoryName: string;
    versionId: string;
    versionLabel: string;
    /** The raids the category ran lately (short names), from its logs or event titles. */
    contents: string[];
    /** Counted raid nights of the category. */
    raids: number;
    icon: string;
    mainRole: RosterDiscordRole | null;
    /** The extra role of status trial; null when the roster has none. */
    trialRole: RosterDiscordRole | null;
    discordRoles: (RosterDiscordRole | null)[];
    slots: { total: number; tank: number; healer: number; bench: number };
    allowMultipleChars: boolean;
    source: "manual" | "kader" | "migration";
    /** The Kader of the Kaderplaner linked to the roster (1:1), null for none. */
    kaderId: string | null;
    /** Detail only: the linked Kader's id and name ("" when it is gone). */
    kader?: { id: string; name: string } | null;
    counts: Record<RosterStatus, number>;
    members: number;
    /** Core and trial members: the ones that take a place. */
    places: number;
    /** Roles of the members that take a place, by their first character. */
    roleCounts: { tank: number; healer: number; dps: number; unknown: number };
    /** Mean attendance in percent over everybody but paused members; null without a counted night. */
    attendance: number | null;
    attendanceCounted: number;
    /** `withoutRole` null when the Discord member list is not available. */
    todo: { withoutRole: number | null; withoutChar: number; trial: number };
    /** Overview cards only (#658): trial members whose end lies within 7 days or has passed, earliest first. */
    trialEnding?: { userId: string; displayName: string; trialUntil: string; overdue: boolean }[];
};

export type RosterOverview = {
    rosters: RosterHead[];
    categoriesWithoutRoster: { id: string; name: string; versionId: string; versionLabel: string }[];
    /** Full admins create rosters (#657). */
    canCreate: boolean;
};

/** Where a member's spec comes from (services/roster/memberSpec.js): the orga, the last signup, the logs, the profile, the class alone. */
export type RosterSpecSource = "override" | "signup" | "logs" | "profile" | "class" | "";

/** A member's first character as the chain resolved it; `reason` says why spec or class is missing. */
export type RosterResolvedSpec = {
    className: string;
    spec: string;
    specLabel: string;
    specIcon: string;
    role: RosterRole;
    source: RosterSpecSource;
    reason: "" | "no_char" | "no_class" | "no_spec";
    /** The orga's stored choice ("" = automatisch), also when it does not fit the class. */
    override: string;
    /** What the chain finds without the orga's choice. */
    auto: { className: string; spec: string; specLabel: string; specIcon: string; source: RosterSpecSource };
};

/** A spec the drawer's picker offers (the specs of the first character's class). */
export type RosterSpecChoice = { key: string; id: string; label: string; labelEn: string; icon: string; role: string };

/** A roster character, resolved by the server (profile of the roster's version, else the character cache). */
export type RosterMemberChar = {
    key: string;
    name: string;
    className: string;
    classColor: string;
    /** The spec key ("Warrior-Protection") or, from the cache, a spec name. */
    spec: string;
    specId: string;
    specLabel: string;
    /** A WoW icon name; "" when only `iconUrl` is known. */
    specIcon: string;
    iconUrl: string;
    role: RosterRole;
};

export type RosterMember = {
    userId: string;
    displayName: string;
    avatarUrl: string;
    /** null when the Discord member list is not available. */
    onServer: boolean | null;
    status: RosterStatus;
    /** ISO time of the last status change. */
    since: string;
    trialUntil: string | null;
    chars: RosterMemberChar[];
    role: RosterRole;
    /** Class, spec and role of the first character and where they come from (the Komposition counts the same). */
    resolved?: RosterResolvedSpec;
    /** The specs of the first character's class — only for a manager (the drawer's "Spec in diesem Roster"). */
    specChoices?: RosterSpecChoice[];
    /** Holds one of the roster's Discord roles; null when unknown (no list or no role set). */
    hasRole: boolean | null;
    /** The roster's roles (main, others, trial) this person holds; null when the member list is unavailable. */
    heldRoles: string[] | null;
    /** The orga's note — only for a caller who may manage the roster. */
    note?: string;
    /** Further profile characters of the roster's version, not assigned here — only for a manager. */
    otherChars?: RosterMemberChar[];
    /** Per person over the category's window; null without category or without characters. */
    attendance: (RosterAttendance & { link?: "manual" | "auto" }) | null;
};

export type RosterDetail = {
    roster: RosterHead;
    members: RosterMember[];
    /** The category's attendance window (raids); null without category. */
    window: number | null;
    membersKnown: boolean;
    canManage: boolean;
    isAdmin: boolean;
    /** What the settings dialog starts from; null for a caller who may not manage the roster. */
    settings: RosterSettings | null;
};

/** The stored settings of a roster a head does not carry (GET /api/rosters/roster, managers and admins). */
export type RosterSettings = {
    categoryId: string | null;
    versionId: string;
    roleIds: string[];
    trialRoleId: string | null;
    managers: { roleIds: string[]; userIds: string[]; users: { userId: string; displayName: string }[] };
    signupOnly: boolean;
    allowMultipleChars: boolean;
    slots: RosterHead["slots"];
    /** The linked Kader of the Kaderplaner, null for none. */
    kaderId: string | null;
};

/** Every roster of the active server as a card. */
export function getRosters(): Promise<RosterOverview> {
    return get<RosterOverview>("/api/rosters");
}

/** One roster with its members. */
export function getRosterDetail(id: string): Promise<RosterDetail> {
    return get<RosterDetail>(`/api/rosters/roster?id=${encodeURIComponent(id)}`);
}
