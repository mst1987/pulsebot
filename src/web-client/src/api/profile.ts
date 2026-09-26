import { get, send } from "./client";
import type { GameRole, GameClass } from "./raidTemplates";

// ---- Mein Profil (#255, src/web/apiRoutes/profile.js) ----

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

export type RaiderRef = { userId: string; name: string; main: string; className: string };

export type ProfileCharacter = {
    key: string;
    name: string;
    realm: string;
    className: string;
    main: boolean;
    source: "log" | "armory" | "manual";
    armory: { level: number | null; guild: string; fetchedAt: number } | null;
    armoryUrl: string;
    specs: ProfileSpec[];
    /** "Kann offtanken / heilen" of this character — its own word, else what its specs allow. */
    canOfftank: boolean;
    canHeal: boolean;
    suggested: { canOfftank: boolean; canHeal: boolean };
    /** Whether the class can step in as that at all — false: the switch is off and disabled. */
    possible: { canOfftank: boolean; canHeal: boolean };
    /** Other accounts that added the same character. */
    claimedBy: { userId: string; name: string }[];
};

export type RaiderProfile = {
    userId: string;
    name: string;
    characters: ProfileCharacter[];
    /** Summary: whether any character may step in. The switches live on the characters. */
    canOfftank: boolean;
    canHeal: boolean;
    suggested: { canOfftank: boolean; canHeal: boolean };
    availability: string[];
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
    specHistory?: { spec: string; count: number; lastAt: number; character: string }[];
    classes: GameClass[];
    roles: Record<GameRole, string>;
    raidGroups: ProfileRaidGroup[];
    weekdays: { id: string; label: string }[];
    gearLevels: { id: GearLevel; label: string }[];
    limits: { characters: number; wishes: number; avoid: number; note: number };
};

export type ProfilePatch = {
    availability?: string[];
    preferredRaids?: string[];
    wishes?: string[];
    avoidEnabled?: boolean;
    avoid?: string[];
    note?: string;
    characters?: { key: string; main?: boolean; specs?: { key: string; gear: GearLevel }[]; canOfftank?: boolean; canHeal?: boolean }[];
};

export type LogCharacterSuggestion = {
    character: string;
    className: string;
    specKey: string;
    reports: number;
    lastSeen: number;
    match: "assigned" | "name" | "";
    claimedBy: { userId: string; name: string }[];
};

export type AddCharacterInput =
    | { source: "log"; name: string }
    | { source: "armory"; name: string; realm?: string; className?: string }
    | { source: "manual"; name: string; className: string; specs: string[] };

export type CharacterClaim = {
    key: string;
    character: string;
    className: string;
    claims: { userId: string; name: string; main: boolean }[];
};

export function getProfile(): Promise<ProfileData> {
    return get<ProfileData>("/api/profile");
}

export function saveProfile(patch: ProfilePatch): Promise<{ profile: RaiderProfile }> {
    return send("PUT", "/api/profile", patch);
}

export function getLogCharacters(q = ""): Promise<{ characters: LogCharacterSuggestion[] }> {
    return get(`/api/profile/log-characters?q=${encodeURIComponent(q)}`);
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

export function searchRaiders(q: string): Promise<{ raiders: RaiderRef[] }> {
    return get(`/api/profile/raiders?q=${encodeURIComponent(q)}`);
}

export function getCharacterClaims(): Promise<{ claims: CharacterClaim[] }> {
    return get("/api/roster/character-claims");
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
