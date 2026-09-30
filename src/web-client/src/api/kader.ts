import { get, send } from "./client";

// ===== Kaderplaner (docs/kaderplaner.md) =====
// Raid rosters for WoW Forever, area "kader". GET /api/kader is the whole view
// model (src/web/kader/kaderView.js); every write answers with the fresh view,
// so the page only swaps it in. Keys are the code's own vocabulary: classes
// "Warrior", specs "Warrior-Protection", roles tank|healer|melee|ranged, gear
// none|usable|ready, weekdays mo…so.

export type KaderRole = "tank" | "healer" | "melee" | "ranged";
export type KaderGear = "none" | "usable" | "ready";
export type KaderDay = "mo" | "di" | "mi" | "do" | "fr" | "sa" | "so";
/** What deviates from the raider profile (kaderView.js `differs`). */
export type KaderDiff = "class" | "mainSpec" | "gear" | "tank" | "heal" | "notInProfile";

export type KaderSpecDef = { key: string; name: string; nameEn: string; role: KaderRole; canTank: boolean; canHeal: boolean; icon: string };
export type KaderClassDef = { key: string; name: string; nameEn: string; color: string; icon: string; specs: KaderSpecDef[]; canTank: boolean; canHeal: boolean };
export type KaderRaidBuff = { key: string; label: string; icon: string; providers: string[] };
export type KaderPartyBuff = KaderRaidBuff & { beneficiaries: string[]; important: boolean };

/** A Forever name ("Vorname Nachname") or a free nickname. */
export type KaderNameStyle = "forever" | "nick";

export type KaderSpecPick = { spec: string; main: boolean; gear: KaderGear };

/** One character as the planner sees it: its own assignment, else the profile's. */
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

export type KaderPlayer = {
    userId: string;
    displayName: string;
    avatarUrl: string | null;
    hasProfile: boolean;
    manual: boolean;
    hasOverride: boolean;
    characters: KaderCharacter[];
    activeCharacterId: string | null;
    differs: KaderDiff[];
    profile: { character: string; className: string; mainSpec: string | null; logSpecs: string[] } | null;
    availability: KaderDay[];
    attendance: KaderAttendance;
};

export type KaderMember = {
    userId: string;
    displayName: string;
    inPool: boolean;
    hasProfile: boolean;
    profile: { className: string; mainSpec: string | null } | null;
    pct: number | null;
};

export type KaderRoster = {
    id: string;
    name: string;
    size: number;
    targets: Record<KaderRole, number>;
    members: { userId: string; role: KaderRole }[];
    bench: string[];
};
export type KaderVariant = { id: string; name: string; groups: (string | null)[][] };

export type KaderView = {
    versionId: string;
    guildId: string;
    roles: KaderRole[];
    classes: KaderClassDef[];
    buffs: { raid: KaderRaidBuff[]; party: KaderPartyBuff[] };
    players: KaderPlayer[];
    members: KaderMember[];
    rosters: KaderRoster[];
    setups: Record<string, { variants: KaderVariant[] }>;
    warnings: string[];
    /** Only on the answer of a create. */
    rosterId?: string;
    variantId?: string;
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

export type KaderPlace = "role" | "bench" | "free";

export function getKader(): Promise<KaderView> {
    return get<KaderView>("/api/kader");
}

export function addKaderAccount(input: { userId: string; displayName: string; character?: { nameStyle: KaderNameStyle; firstName?: string; lastName?: string; nickname?: string; className: string } }): Promise<KaderView> {
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

export function createKaderRoster(input: { name: string; size: number }): Promise<KaderView> {
    return send("POST", "/api/kader/rosters", input);
}

export function updateKaderRoster(rosterId: string, input: { name?: string; size?: number; targets?: Record<KaderRole, number> }): Promise<KaderView> {
    return send("PUT", "/api/kader/rosters", { rosterId, ...input });
}

export function deleteKaderRoster(rosterId: string): Promise<KaderView> {
    return send("POST", "/api/kader/rosters/delete", { rosterId });
}

export function placeKaderPlayer(rosterId: string, userId: string, to: KaderPlace, role?: KaderRole): Promise<KaderView> {
    return send("POST", "/api/kader/rosters/place", { rosterId, userId, to, role });
}

export function addKaderVariant(rosterId: string, input: { name?: string; copyFrom?: string } = {}): Promise<KaderView> {
    return send("POST", "/api/kader/variants", { rosterId, ...input });
}

export function saveKaderVariant(rosterId: string, variantId: string, input: { name?: string; groups?: (string | null)[][] }): Promise<KaderView> {
    return send("PUT", "/api/kader/variants", { rosterId, variantId, ...input });
}

export function deleteKaderVariant(rosterId: string, variantId: string): Promise<KaderView> {
    return send("POST", "/api/kader/variants/delete", { rosterId, variantId });
}

export function autoKaderVariant(rosterId: string, variantId: string): Promise<KaderView> {
    return send("POST", "/api/kader/variants/auto", { rosterId, variantId });
}
