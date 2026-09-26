import { get, send } from "./client";
import type { TopLootAward } from "./dashboard";
import type { LootSource, LootItem, CharLootPreview } from "./history";

// ---- Loot overviews (Gründe / Items) ----------------------------------------
// Labels, colours (tone) and the raid/tier catalogs all come from the server
// (utils/lootReasons.js, config/tbcContent.js) — the client only maps a tone
// onto a CSS class, so a new reason or a new raid never needs a client change.

export type LootReason = { id: string; label: string; tone: string; order: number };
export type LootContent = { id: string; label: string; short: string; tier: string; zoneId: number };
export type LootTier = { id: string; label: string };

/** One reason bucket of one raider, with the items behind it (hover list). */
export type CharReasonBucket = {
    reason: string;
    /** What the badge says: the guild's own response wording when every item in
     *  the bucket carries the same one, else the bucket name. */
    label: string;
    /** The bucket name itself, for the tooltip and the filter. */
    reasonLabel: string;
    tone: string;
    order: number;
    count: number;
    items: CharLootPreview[];
};

export type CharReasonRow = {
    key: string;
    character: string;
    realm: string;
    className: string;
    spec: string;
    classColor: string;
    iconUrl: string;
    categoryIds: string[];
    count: number;
    reasons: CharReasonBucket[];
};

/** One award of an item: who got it, when, in which raid and for what reason. */
export type LootAward = {
    /** The stored row's id — what deleteLootItems() removes. */
    id: string;
    character: string;
    characterKey: string;
    className: string;
    spec: string;
    classColor: string;
    iconUrl: string;
    reason: string;
    reasonLabel: string;
    reasonTone: string;
    response: string;
    eventId: string;
    eventLabel: string;
    categoryId: string;
    awardedAt: number;
    source: LootSource;
};

export type LootCatalogItem = {
    itemId: number;
    itemName: string;
    itemIconUrl: string;
    /** See LootItem.itemQuality. */
    itemQuality: number | null;
    itemLink: string;
    /** "" when the content table doesn't know the item — shown as "Unbekannt". */
    contentId: string;
    tier: string;
    boss: string;
    /** "t4"/"t5"/"t6" on a tier-set token, "" otherwise. */
    tokenTier: string;
    /** The raid categories this item was ever awarded in. */
    categoryIds: string[];
    count: number;
    lastAwardedAt: number;
    awards: LootAward[];
};

export type LootStats = {
    reasons: LootReason[];
    contents: LootContent[];
    tiers: LootTier[];
    characters: CharReasonRow[];
    items: LootCatalogItem[];
    unknownContentCount: number;
};

export function getLootStats(): Promise<LootStats> {
    return get<LootStats>("/api/history/loot-stats");
}

// One page of the "Latest Loot" tab. The rows are the same awards the dashboard
// card shows (see web/lootAwards.js); filtering and paging happen on the server,
// because the loot store holds every row ever imported.
export type LootAwardsQuery = {
    /** false widens the list from the configured top items to all loot. */
    topOnly: boolean;
    search: string;
    category: string;
    content: string;
    reason: string;
    page: number;
};

export type LootAwardsData = {
    items: TopLootAward[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    /** How many top items are configured at all (Einstellungen → Loot). */
    topItemCount: number;
    contents: LootContent[];
    reasons: LootReason[];
    unknownContentCount: number;
};

export function getLootAwards(q: LootAwardsQuery): Promise<LootAwardsData> {
    const qs = new URLSearchParams({
        top: q.topOnly ? "1" : "0",
        q: q.search,
        category: q.category,
        content: q.content,
        reason: q.reason,
        page: String(q.page),
    });
    return get<LootAwardsData>(`/api/history/loot-awards?${qs.toString()}`);
}

export function deleteHistoryLog(logId: string): Promise<{ id: string }> {
    return send("POST", "/api/history/log-delete", { logId });
}

// `categoryId` only takes effect when the import ends up without a Raid-Helper
// event (manual title / no match) — an event brings its own Discord category,
// which always wins. See apiRoutes/history.js's importLoot.
export type ImportLootInput = { data: string; tool: string; event: string; manualLabel: string; categoryId?: string };

export function importLoot(
    input: ImportLootInput,
): Promise<{ eventId: string; eventLabel: string; categoryId: string; added: number; skipped: number }> {
    return send("POST", "/api/history/import", input);
}

/** File an already-imported loot bucket under a raid category ("" clears it). */
export function setLootCategory(
    input: { event: string; categoryId: string },
): Promise<{ eventId: string; categoryId: string; updated: number }> {
    return send("POST", "/api/history/loot-category", input);
}

export function clearHistoryEvent(event: string): Promise<{ removed: number }> {
    return send("POST", "/api/history/clear", { event });
}

/**
 * Delete single loot rows (LootItem.id) — the row-level counterpart to
 * clearHistoryEvent(), for the one item that was logged twice or awarded to the
 * wrong raider. Re-importing the same export brings it back (the import dedupes
 * against what is stored).
 */
export function deleteLootItems(ids: string[]): Promise<{ removed: number }> {
    return send("POST", "/api/history/loot-delete", { ids });
}

// ---- adding one award by hand ("Item nachtragen") ----

/** One possible drop of a raid, as the picker lists it. */
export type RaidDropItem = {
    id: number;
    name: string;
    iconUrl: string;
    itemLink: string;
    /** See LootItem.itemQuality — colours the name. */
    quality: number | null;
    /** "Trash" and "" are not encounters; see tbcContent.js's RAID_LOOT. */
    boss: string;
};

/** A raid with everything that can drop in it. */
export type LootCatalogContent = {
    id: string;
    label: string;
    short: string;
    tier: string;
    tierLabel: string;
    items: RaidDropItem[];
};

/** A raider the award can be credited to, with the look their name renders in. */
export type LootPickerCharacter = {
    character: string;
    className: string;
    spec: string;
    classColor: string;
    iconUrl: string;
};

export type LootPickerData = {
    contents: LootCatalogContent[];
    /** Which raid(s) this event was — the picker opens on the first of them. */
    suggested: string[];
    reasons: { id: string; label: string; tone: string }[];
    characters: LootPickerCharacter[];
};

/**
 * What the "Item nachtragen" form offers: the raid drop tables, the raid(s) the
 * event was, the award reasons and the known raiders. Static apart from the
 * per-event suggestion, so a page loads it once when the form is opened.
 */
export function getLootPicker(event: string, title = ""): Promise<LootPickerData> {
    return get<LootPickerData>(`/api/history/loot-picker?event=${encodeURIComponent(event)}&title=${encodeURIComponent(title)}`);
}

export type AddLootInput = {
    event: string;
    itemId: number;
    character: string;
    boss?: string;
    instance?: string;
    response?: string;
    offspec?: boolean;
    /** Unix ms; the server falls back to "now" when it is 0/absent. */
    awardedAt?: number;
};

/**
 * Add one award that no export carried (handed out after the raid, a night
 * nobody logged). Rejects with a 409 when the same item/raider/time is already
 * stored — that is a double submit, not a second drop.
 */
export function addLootItem(
    input: AddLootInput,
): Promise<{ eventId: string; eventLabel: string; added: number; skipped: number; item: LootItem }> {
    return send("POST", "/api/history/loot-add", input);
}

// ---- addon inbox: raid sessions the loot-sync tool uploaded, awaiting a decision ----

/** The event a session was matched to. A suggestion — the admin confirms it. */
export type InboxMatchEvent = {
    eventId: string;
    eventLabel: string;
    startTime: number;
    categoryId: string;
    categoryName: string;
};

export type InboxMatch = {
    /** More than one raid started that day — nothing is preselected. */
    ambiguous: boolean;
    suggested: InboxMatchEvent | null;
    candidates: InboxMatchEvent[];
};

export type InboxSession = {
    /** Handle for accept/dismiss. */
    id: string;
    /** The addon's own id for the raid night — stable across re-uploads. */
    sessionId: string;
    receivedAt: number;
    updatedAt: number;
    startedAt: number;
    endedAt: number;
    /** Was das Addon gemeldet hat — kann leer oder bloss ein Kontinent sein. */
    instance: string;
    /**
     * Der Raid, unter dem die Session angezeigt wird. Bevorzugt die Meldung des
     * Addons; ist die leer oder nur ein Kontinent, aus den Item-IDs abgeleitet
     * (siehe web/lootSessionContent.js).
     */
    contentLabel: string;
    /** Woher `contentLabel` stammt — "items" heisst: erschlossen, nicht gemeldet. */
    contentSource: "addon" | "items" | "";
    /** Wie viele Items sich einem Raid zuordnen liessen. */
    contentMatched: number;
    itemCount: number;
    /**
     * The session's loot, decorated exactly like stored history (reason badge,
     * raid, tier) although it isn't stored yet — so the preview looks like what
     * accepting will produce. `id` is absent: these rows have no store id.
     */
    items: LootItem[];
    realm: string;
    reporter: string;
    addonVersion: string;
    tokenName: string;
    match: InboxMatch | null;
};

/** An accepted session whose later uploads append to its event by themselves. */
export type InboxLinkedSession = {
    sessionId: string;
    eventId: string;
    eventLabel: string;
    contentLabel: string;
    startedAt: number;
    itemCount: number;
    /** Items later uploads appended without a click ("+6 nachgeliefert"). */
    appended: number;
    at: number;
};

export function getLootInbox(): Promise<{ sessions: InboxSession[]; linked?: InboxLinkedSession[] }> {
    return get<{ sessions: InboxSession[]; linked?: InboxLinkedSession[] }>("/api/history/inbox");
}

/** An event as the import preview names it; startTime in ms. */
export type ImportPreviewEvent = { id: string; title: string; startTime: number };

export type ImportPreview = {
    count: number;
    format: "rclc" | "gargul" | "eventhelper";
    formatLabel: string;
    /** Earliest award in the export (ms), 0 without any. */
    detectedAt: number;
    content: { contentIds: string[]; label: string; matched: number };
    match: { ambiguous: boolean; suggested: ImportPreviewEvent | null; candidates: ImportPreviewEvent[] };
    /** The event the rows would land in as far as known before importing. */
    targetEventId: string;
    /** Rows that event already holds — the import will skip them. */
    duplicates: number;
};

/** What importLoot() would do with this export, without storing anything. */
export function previewLootImport(
    input: { data: string; tool: string; event: string },
): Promise<ImportPreview> {
    return send("POST", "/api/history/import-preview", input);
}

/**
 * File a pending session under an event. `event` accepts the same vocabulary as
 * the paste import (an event id, "__auto__", "__manual__"); left empty it takes
 * the match the upload already suggested.
 */
export function acceptLootInbox(
    input: { id: string; event?: string; manualLabel?: string; categoryId?: string },
): Promise<{ eventId: string; eventLabel: string; categoryId: string; added: number; skipped: number }> {
    return send("POST", "/api/history/inbox-accept", input);
}

/** Throw a session away. The decision sticks — re-uploads will not bring it back. */
export function dismissLootInbox(
    id: string,
): Promise<{ id: string; sessionId: string }> {
    return send("POST", "/api/history/inbox-dismiss", { id });
}
