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
};

export function getRoster(): Promise<RosterData> {
    return get<RosterData>("/api/roster");
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
