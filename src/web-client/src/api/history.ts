import { get, send } from "./client";
import type { RecentEvent } from "./dashboard";
import type { Category } from "./channels";
import type { CharGearReport } from "./roster";

export type HistoryEvent = { id: string; title: string; startTime: number; categoryId: string };
export type RaidRow = RecentEvent;

// "manual" is a row entered in the admin menu rather than exported by an addon.
export type LootSource = "gargul" | "rclc" | "manual" | string;

export type LootEventSummary = {
    eventId: string;
    label: string;
    /**
     * Discord raid category the bucket is filed under, "" when it has none —
     * the normal case for loot imported without a Raid-Helper event, which
     * setLootCategory() assigns after the fact.
     */
    categoryId: string;
    count: number;
    importedAt?: number;
    awardedAt?: number;
    sources: LootSource[];
};

export type LootLog = {
    id: string;
    title?: string;
    reportId?: string;
    link?: string;
    zone?: string;
    status?: string;
    reportUrl?: string;
    reportRefId?: string;
    eventId?: string;
    eventLabel?: string;
    eventStartTime?: number;
    postedAt?: number;
};

// `reason`/`reasonLabel`/`reasonTone` are the normalized award reason the server
// derived from the addon's free-text `response` (see utils/lootReasons.js) — the
// tone picks the badge colour, the raw response stays visible on hover.
// `contentId` is the raid the item drops in, resolved by item id
// (config/tbcContent.js) and therefore also present for Gargul rows, which carry
// no instance at all.
export type LootItem = {
    /** Id of the stored row — the handle deleteLootItems() removes it by. */
    id: string;
    itemId: number;
    itemName: string;
    itemIconUrl?: string;
    /** Wowhead's 0-7 quality scale, resolved at import time; null/absent when
     *  the lookup never came back — see lib/itemQuality.ts. */
    itemQuality?: number | null;
    itemLink: string;
    character: string;
    response: string;
    offspec: boolean;
    reason: string;
    reasonLabel: string;
    reasonTone: string;
    contentId: string;
    tokenTier: string;
    boss: string;
    awardedAt: number;
    source: LootSource;
    eventId?: string;
    eventLabel?: string;
    // How the winner plays — joined onto the row on read (web/lootClassLook.js),
    // not stored with it: a raider's class is a fact about them, not about the
    // item. All four are "" for a character whose class nobody has resolved yet,
    // and their name then renders uncoloured.
    className?: string;
    spec?: string;
    classColor?: string;
    specIconUrl?: string;
};

// A loot character with its resolved WoW class/spec (or blank if unresolved
// yet). classColor/iconUrl are computed server-side from config/classlist.js
// — never duplicated client-side, same rule as lib/recruitmentSpecs.ts's
// specCatalog. categoryIds are the Discord raid categories (e.g. "Montagsraid",
// "Pug") the character got loot in — names are resolved client-side against
// HistoryData.categories, same live Discord list the "Loot-Tool je Kategorie"
// tab already uses. `items` is the character's loot in a trimmed shape (see
// lootStore.js's charLootPreview) — just enough for the Items-column hover to
// show icon, name and the award reason ("BiS", "Mainspec", …).
export type CharLootPreview = {
    itemId: number;
    itemName: string;
    itemIconUrl: string;
    /** See LootItem.itemQuality. */
    itemQuality: number | null;
    itemLink: string;
    response: string;
    offspec: boolean;
    reason: string;
    reasonLabel: string;
    reasonTone: string;
    contentId: string;
    categoryId: string;
    eventId: string;
    eventLabel: string;
    awardedAt: number;
};

export type AnnotatedCharacter = {
    key: string;
    character: string;
    realm: string;
    count: number;
    categoryIds: string[];
    items: CharLootPreview[];
    className: string;
    spec: string;
    source: string;
    reportId: string;
    classColor: string;
    iconUrl: string;
};

export type HistoryData = {
    events: HistoryEvent[];
    upcomingRaids: { events: RaidRow[]; error: string | null };
    pastRaids: { events: RaidRow[]; error: string | null };
    lootEvents: LootEventSummary[];
    logs: LootLog[];
    categories: Category[];
    categoryLootTool: Record<string, string>;
    chars: AnnotatedCharacter[];
    activeGuildId: string;
};

export function getHistoryData(): Promise<HistoryData> {
    return get<HistoryData>("/api/history");
}

export type HistoryEventData = { eventId: string; label: string; items: LootItem[] };

export function getHistoryEvent(eventId: string): Promise<HistoryEventData> {
    return get<HistoryEventData>(`/api/history/event?event=${encodeURIComponent(eventId)}`);
}

export type ResolveCharactersResult = {
    fromExport: number;
    fromReports: number;
    fromWcl: number;
    checkedReports: number;
    pendingReports: number;
    missing: string[];
    unlinked: string[];
    message: string;
};

export function resolveCharacters(): Promise<ResolveCharactersResult> {
    return send("POST", "/api/history/characters-resolve", {});
}

export type GearSocket = {
    type: string;
    gemName: string | null;
    gemId: number | null;
    gemIconUrl: string;
    gemText: string;
};

export type GearItem = {
    slot: string;
    itemId: number | null;
    name: string;
    quality: string;
    level: number | null;
    enchants: string[];
    enchantIds: number[];
    sockets: GearSocket[];
    iconUrl: string;
};

export type CharSummary = {
    name: string;
    realm: string;
    level: number | null;
    itemLevel: number | null;
    lastLogin: number | null;
    className: string;
    faction: string;
    namespace: string;
};

// Mirrors getCharacter()'s stored record, enriched with the same classColor/
// iconUrl fields the "Charaktere" tab gets, so the char page's header can
// render the class/spec suffix the same way.
export type CharInfo = {
    key: string;
    character: string;
    className: string;
    spec: string;
    source: string;
    reportId: string;
    updatedAt: number;
    classColor: string;
    iconUrl: string;
};

export type HistoryCharData = {
    character: string;
    realm: string;
    items: LootItem[];
    armoryUrl: string;
    wclUrl: string;
    gear: GearItem[] | null;
    gearConfigured: boolean;
    gearError: string;
    charSummary: CharSummary | null;
    gearNamespace: string;
    info: CharInfo | null;
    /** The newest CLA evaluation's gear findings, or null if the character
     *  isn't in any of the stored evaluations. */
    gearIssues: CharGearReport | null;
};

export function getHistoryChar(name: string): Promise<HistoryCharData> {
    return get<HistoryCharData>(`/api/history/char?name=${encodeURIComponent(name)}`);
}
