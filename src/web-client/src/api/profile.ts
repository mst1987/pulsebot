import { get, send } from "./client";
import type { GameRole, GameClass } from "./raidTemplates";
import type { CharLootPreview } from "./history";
import type { RosterStatus } from "./roster";
import type { ItemSearchResult } from "./settings";

// ---- Mein Profil (#255, src/web/apiRoutes/roster/profile.js) ----

export type GearLevel = "none" | "usable" | "ready";

/** "Laut Logs": seen = exactly this spec, other = in the logs with another spec, unknown = not in the logs. */
export type SpecEvidence = { status: "seen" | "other" | "unknown"; reports: number; source?: string; loggedSpec?: string };

export type ProfileSpec = {
    key: string;
    gear: GearLevel;
    label: string;
    specId: string;
    role: GameRole | "";
    icon: string;
    canTank: boolean;
    canHeal: boolean;
    logs: SpecEvidence;
};

/** Another raider as a profile names them: their first character (of the main version when they have one) — there is no main. */
export type RaiderRef = { userId: string; name: string; character: string; className: string };

export type ProfileCharacter = {
    key: string;
    name: string;
    /** The game version the character belongs to (#543) — the signup offers only the event's. */
    versionId: string;
    realm: string;
    className: string;
    source: "log" | "armory" | "manual";
    armory: { level: number | null; guild: string; fetchedAt: number } | null;
    armoryUrl: string;
    /**
     * Does it exist in game — seen in a log or the loot, answered by the armory, or
     * checked by the orga. Unconfirmed: the guild bank cannot mail to it.
     */
    evidence?: { verified: boolean; via: "" | "log" | "loot" | "armory" | "orga" };
    specs: ProfileSpec[];
    /** "Kann offtanken / heilen" of this character — its own word, else what its specs allow. */
    canOfftank: boolean;
    canHeal: boolean;
    suggested: { canOfftank: boolean; canHeal: boolean };
    /** Whether the class can step in as that at all — false: the switch is off and disabled. */
    possible: { canOfftank: boolean; canHeal: boolean };
    /** Other accounts that added the same character. */
    claimedBy: { userId: string; name: string }[];
    /** Part 2, freely given: main professions of its version (at most two; skill null = none kept). */
    professions?: ProfileProfession[];
    /** Part 2: wish items (at most ten, Loot-Council rosters only) - only the raider and the orga read them. */
    wishItems?: ProfileWishItem[];
};

export type ProfileProfession = { id: string; skill: number | null };

export type ProfileWishItem = { itemId: number; name: string; icon: string; iconUrl: string; quality: number | null; link: string };

/** A version's main professions from its rule set; empty = the version has no list (yet). */
export type ProfessionList = { professions: { id: string; label: string; labelEn: string; icon: string }[]; skillMax: number | null };

export type RaiderProfile = {
    userId: string;
    name: string;
    characters: ProfileCharacter[];
    /** Summary: whether any character may step in. The switches live on the characters. */
    canOfftank: boolean;
    canHeal: boolean;
    suggested: { canOfftank: boolean; canHeal: boolean };
    availability: string[];
    /** "ab HH:MM" per chosen weekday (quarter hours); a day without = the whole evening. Info for the orga. */
    availabilityFrom?: Record<string, string>;
    preferredRaids: string[];
    /** For the owner: whom they wished for — never whether it is mutual. */
    wishes: (RaiderRef & { mutual?: boolean })[];
    /** "Nicht mit X raiden" — off until switched on past a warning; only the orga's setup reads it. */
    avoidEnabled: boolean;
    avoid: RaiderRef[];
    note: string;
    updatedAt: number;
    /** Only in the orga's view. */
    wishedBy?: RaiderRef[];
};

export type ProfileRaidGroup = {
    id: string;
    label: string;
    instances: { id: string; name: string; short: string; icon: string; status: string }[];
};

export type ProfileData = {
    profile: RaiderProfile;
    isNew: boolean;
    /** #291: the caller's own specs imported from Raid-Helper, most played first. */
    specHistory?: { spec: string; count: number; lastAt: number; character: string; versionId?: string }[];
    classes: GameClass[];
    /** The main version the classes are from (#541). */
    mainVersion?: string;
    /** Every version's classes, for a character of another version (#543). */
    classesByVersion?: Record<string, GameClass[]>;
    /** The versions a character can belong to, the main version first (#543); `lastName` = first + last name. */
    versions?: ProfileVersion[];
    roles: Record<GameRole, string>;
    raidGroups: ProfileRaidGroup[];
    weekdays: { id: string; label: string }[];
    gearLevels: { id: GearLevel; label: string }[];
    limits: { characters: number; wishes: number; avoid: number; note: number; professions?: number; wishItems?: number; timeStep?: number };
    /** Each version's main professions (part 2); a version without = no "Berufe" part. */
    professionsByVersion?: Record<string, ProfessionList>;
};

export type ProfileVersion = { id: string; label: string; short: string; lastName: boolean };

export type ProfilePatch = {
    availability?: string[];
    availabilityFrom?: Record<string, string>;
    preferredRaids?: string[];
    wishes?: string[];
    avoidEnabled?: boolean;
    avoid?: string[];
    note?: string;
    characters?: {
        key: string; specs?: { key: string; gear: GearLevel }[]; canOfftank?: boolean; canHeal?: boolean;
        professions?: ProfileProfession[];
        /** Item ids: new ones are looked up on the version's Wowhead by the server. */
        wishItems?: number[];
    }[];
    /** The characters' keys in the raider's order — the first of a version is the one suggested for it (there is no main). */
    order?: string[];
};

export type LogCharacterSuggestion = {
    character: string;
    className: string;
    specKey: string;
    reports: number;
    lastSeen: number;
    /** Why it is suggested; "similar" = looks like a typo of the character being set right. */
    match: "similar" | "assigned" | "name" | "";
    claimedBy: { userId: string; name: string }[];
};

export type AddCharacterInput = (
    | { source: "log"; name: string }
    | { source: "armory"; name: string; realm?: string; className?: string }
    | { source: "manual"; name: string; className: string; specs: string[] }
) & { /** The character's game version (#543); missing = the main version. */ versionId?: string };

export type CharacterClaim = {
    key: string;
    character: string;
    versionId?: string;
    className: string;
    claims: { userId: string; name: string }[];
};

export function getProfile(): Promise<ProfileData> {
    return get<ProfileData>("/api/profile");
}

export function saveProfile(patch: ProfilePatch): Promise<{ profile: RaiderProfile }> {
    return send("PUT", "/api/profile", patch);
}

/** `near` = an own character's key being set right: the logged names that look like a typo of it come first. */
export function getLogCharacters(q = "", near = ""): Promise<{ characters: LogCharacterSuggestion[] }> {
    return get(`/api/profile/log-characters?q=${encodeURIComponent(q)}${near ? `&near=${encodeURIComponent(near)}` : ""}`);
}

export function addProfileCharacter(input: AddCharacterInput): Promise<{
    character: ProfileCharacter;
    armory: { linked: boolean; fetched: boolean } | null;
    profile: RaiderProfile;
}> {
    return send("POST", "/api/profile/characters", input);
}

export function removeProfileCharacter(key: string): Promise<{ removed: boolean; profile: RaiderProfile }> {
    return send("POST", "/api/profile/characters", { remove: key });
}

/**
 * Who a character is — what an edit may change; a field left out stays. `specs`
 * are spec keys, each keeps its gear. `fromLog` = the logged character of that
 * name instead (name and class from the logs, it counts as "aus den Logs").
 */
export type CharacterEditInput = { name?: string; realm?: string; className?: string; specs?: string[]; fromLog?: string };

/** What an edit moved along with a new name (rosters, signups, …) — counts per place; null when the name stayed. */
export type CharacterEditMoved = { rosters: number; assignments: number; signups: number; guildBank: number; availability: number } | null;

export type CharacterRename = { fromKey: string; toKey: string; fromName: string; toName: string; versionId: string } | null;

export function editProfileCharacter(key: string, input: CharacterEditInput): Promise<{
    character: ProfileCharacter;
    renamed: CharacterRename;
    moved: CharacterEditMoved;
    profile: RaiderProfile;
}> {
    return send("POST", "/api/profile/characters", { edit: key, ...input });
}

// ---- Alle Charaktere — the orga's tab on the profile page (src/web/apiRoutes/roster/characters.js) ----

/** One raider in the orga's list: the account and its characters. */
export type CharacterOwner = { userId: string; name: string; characters: ProfileCharacter[] };

export function getAllCharacters(): Promise<{ raiders: CharacterOwner[] }> {
    return get("/api/characters");
}

/** The logged characters a raider could be, the typos of character `key` first. */
export function getLogCharactersOf(userId: string, key: string, q = ""): Promise<{ characters: LogCharacterSuggestion[] }> {
    return get(`/api/characters/log-suggestions?userId=${encodeURIComponent(userId)}&key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}`);
}

export function editCharacterOf(userId: string, key: string, input: CharacterEditInput): Promise<{
    key: string;
    renamed: CharacterRename;
    moved: CharacterEditMoved;
    raider: CharacterOwner;
}> {
    return send("POST", "/api/characters/edit", { userId, key, ...input });
}

export function saveCharacterOf(userId: string, key: string, patch: { specs?: { key: string; gear: GearLevel }[]; canOfftank?: boolean; canHeal?: boolean }): Promise<{ raider: CharacterOwner }> {
    return send("POST", "/api/characters/save", { userId, key, ...patch });
}

export function removeCharacterOf(userId: string, key: string): Promise<{ removed: boolean; raider: CharacterOwner }> {
    return send("POST", "/api/characters/remove", { userId, key });
}

export function searchRaiders(q: string): Promise<{ raiders: RaiderRef[] }> {
    return get(`/api/profile/raiders?q=${encodeURIComponent(q)}`);
}

export function getCharacterClaims(): Promise<{ claims: CharacterClaim[] }> {
    return get("/api/roster/character-claims");
}

// ---- The character tabs: roster, loot, dungeons (src/services/characters/profileRaiding.js) ----

/** The raider's own membership in an open roster of the shown version. */
export type ProfileRosterMembership = {
    id: string;
    name: string;
    categoryId: string;
    status: RosterStatus;
    /** ISO date, "" unknown. */
    since: string;
    trialUntil: string | null;
    /** The profile keys of the characters this roster lists for the raider. */
    chars: string[];
    charNames: Record<string, string>;
    /** The orga's spec for the first character, null = "automatisch". */
    spec: { key: string; label: string; icon: string } | null;
};

export type ProfileLoot = { count: number; lastAt: number; items: (CharLootPreview & { boss: string })[] };

/** LevelHelper data of one character (WoW Forever); the tab shows no block without it. */
export type ProfileDungeons = {
    /** Achievement points, null when the addon reported runs but no reading of the character. */
    points: number | null;
    pointsRank: number | null;
    /** How many characters of the version the addon has a points reading of — the field `pointsRank` is a place in. */
    characters: number;
    medals: { gold: number; silver: number; bronze: number };
    runs: number;
    dungeons: number;
    /** Its fastest run per dungeon; `place` among all runs of that dungeon, ranked as the dungeon page does. */
    best: { dungeon: string; seconds: number; medal: "gold" | "silver" | "bronze" | null; place: number; runsOfDungeon: number; finishedAt: number; others: number }[];
};

export type ProfileRaiding = {
    versionId: string;
    /** Whether the version has dungeon best times (feature "dungeonTimes", WoW Forever) - without, no character has a dungeon block. */
    dungeonTimes: boolean;
    rosters: ProfileRosterMembership[];
    /** By profile character key, only the shown version's characters. */
    characters: Record<string, { loot: ProfileLoot; dungeons: ProfileDungeons | null; lootCouncil?: boolean }>;
};

/** Wowhead's items for a name on a version's section - the wish items picker ("" = the main version). */
export function searchProfileItems(q: string, version = ""): Promise<{ items: ItemSearchResult[] }> {
    const query = new URLSearchParams({ q });
    if (version) query.set("version", version);
    return get(`/api/profile/item-search?${query.toString()}`);
}

/** The own characters' roster status, loot and dungeon data of one version ("" = the server's main version). */
export function getProfileRaiding(version = ""): Promise<ProfileRaiding> {
    return get(version ? `/api/profile/raiding?version=${encodeURIComponent(version)}` : "/api/profile/raiding");
}

// ---- Kalender-Abo (#312) ----
// The subscription link comes back exactly once, in the answer that created it:
// the server stores only a hash and can never hand it out again.

export type CalendarToken = {
    id: string;
    name: string;
    hint: string;
    createdAt: number;
    lastUsedAt: number;
    uses: number;
};

export type CalendarTokens = { tokens: CalendarToken[]; max: number; configured: boolean };

export function getCalendarTokens(): Promise<CalendarTokens> {
    return get("/api/profile/calendar");
}

export function createCalendarToken(): Promise<CalendarTokens & { token: string; url: string }> {
    return send("POST", "/api/profile/calendar", {});
}

export function revokeCalendarToken(id: string): Promise<CalendarTokens & { revoked: boolean }> {
    return send("POST", "/api/profile/calendar", { revoke: id });
}

// ---- Sync app keys (#1000) ----
// A personal key of the sync app counts for every server its owner is orga of at
// the time of the request; the plaintext comes back once, in the creating answer.

export type SyncKey = {
    id: string;
    name: string;
    hint: string;
    createdAt: number;
    lastUsedAt: number;
    uses: number;
};

export type SyncKeyServer = { guildId: string; name: string; label: string; role: string };

export type SyncKeys = { allowed: boolean; servers: SyncKeyServer[]; keys: SyncKey[]; max: number };

export function getSyncKeys(): Promise<SyncKeys> {
    return get("/api/profile/sync-keys");
}

export function createSyncKey(name: string): Promise<SyncKeys & { token: string; record: SyncKey }> {
    return send("POST", "/api/profile/sync-keys", { name });
}

export function deleteSyncKey(id: string): Promise<SyncKeys> {
    return send("POST", "/api/profile/sync-keys/delete", { id });
}
