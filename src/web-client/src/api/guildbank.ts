import { get, send } from "./client";

// ── Gildenbank ───────────────────────────────────────────────────────────────
// The guild bank stock the addon uploads (src/web/apiRoutes/guildBank.js): the
// page "Gildenbank" (#632) and the assignment of a bank to a Discord server in
// Einstellungen → Verbindungen.

/** What the orga decided for an item; "new" only ever comes from a scan. */
export type GuildBankStatus = "new" | "hide" | "show" | "give";

/** One item of a bank: stock of the last scan, the orga's settings, Wowhead's meta. */
export type GuildBankItem = {
    itemId: number;
    /** In the bank at the last scan, over the visible bank tabs. */
    count: number;
    /** Count per visible bank tab index ("2": 14). */
    tabs: Record<string, number>;
    /** Over every tab, hidden ones included. */
    totalCount: number;
    allTabs: Record<string, number>;
    /** The whole stock lies in hidden bank tabs: not listed, not requestable. */
    tabHidden: boolean;
    status: GuildBankStatus;
    /** Always kept in the bank, never offered. */
    reserve: number;
    /** 0 = no limit. */
    maxPerRequest: number;
    /** The orga's own group, "" = Wowhead's. */
    category: string;
    firstSeenAt: number;
    name: string;
    icon: string;
    iconUrl: string;
    quality: number | null;
    classId: number | null;
    subclassId: number | null;
    className: string;
    subclassName: string;
    metaSource: "" | "local" | "wowhead";
    /** Confirmed requests waiting for the hand-out. */
    reserved: number;
    /** count - reserved - reserve, never below 0. */
    available: number;
    /** The line it is listed under: category, else Wowhead's class/subclass, "" unknown. */
    group: string;
    /** Wowhead's group alone (what an empty category falls back to). */
    autoGroup: string;
};

export type GuildBankTab = { index: number; name: string; inScan: boolean; hidden: boolean };

/** A bank of the server, for the selector. */
export type GuildBankSummary = { key: string; gameVersion: string; versionShort: string; realm: string; guild: string; scannedAt: number };

export type GuildBank = {
    key: string;
    gameVersion: string;
    versionShort: string;
    realm: string;
    guild: string;
    faction: string;
    guildId: string;
    pending: boolean;
    scannedAt: number;
    scannedBy: string;
    /** Copper. */
    money: number;
    uploadedBy: string;
    tabs: GuildBankTab[];
    /** Where item links go ("" = no Wowhead links for this version). */
    wowheadPath: string;
    /** Confirmed requests waiting for the hand-out in game. */
    reservedRequests: number;
    items: GuildBankItem[];
};

export type GuildBankPageData = { banks: GuildBankSummary[]; bank: GuildBank | null };

/** The banks of the active server and the one shown: `key`, else the content version's, else the first. */
export function getGuildBank({ key = "", version = "" }: { key?: string; version?: string } = {}): Promise<GuildBankPageData> {
    const params = new URLSearchParams();
    if (key) params.set("key", key);
    if (version) params.set("version", version);
    const qs = params.toString();
    return get<GuildBankPageData>(`/api/guildbank${qs ? `?${qs}` : ""}`);
}

export type GuildBankItemPatch = Partial<{ status: Exclude<GuildBankStatus, "new">; reserve: number; maxPerRequest: number; category: string }>;

/** Change what the orga decided for one item; answers the item with its new numbers. */
export function setGuildBankItem(key: string, itemId: number, patch: GuildBankItemPatch): Promise<{ item: GuildBankItem }> {
    return send<{ item: GuildBankItem }>("POST", "/api/guildbank/item", { key, itemId, ...patch });
}

/** Hide or show a whole bank tab; answers the bank's tabs. */
export function setGuildBankTabHidden(key: string, index: number, hidden: boolean): Promise<{ tabs: GuildBankTab[] }> {
    return send<{ tabs: GuildBankTab[] }>("POST", "/api/guildbank/tab", { key, index, hidden });
}

/** An event server a bank can be assigned to. */
export type GuildBankServer = { guildId: string; name: string; label: string };

/** A bank as the settings list it (no items). */
export type GuildBankAdminRow = {
    key: string;
    gameVersion: string;
    realm: string;
    guild: string;
    guildId: string;
    pending: boolean;
    serverName: string;
    scannedAt: number;
    scannedBy: string;
    counts: { items: number };
};

export type GuildBankSettings = { banks: GuildBankAdminRow[]; servers: GuildBankServer[]; pending: number };

/** Every bank (waiting ones first) and the event servers to pick from. */
export function getGuildBankSettings(): Promise<GuildBankSettings> {
    return get<GuildBankSettings>("/api/settings/guild-banks");
}

/** Assign a bank to an event server; "" takes the assignment back. */
export function assignGuildBank(key: string, guildId: string): Promise<{ bank: GuildBankAdminRow }> {
    return send<{ bank: GuildBankAdminRow }>("POST", "/api/settings/guild-banks/assign", { key, guildId });
}

/** Forget a bank with everything the orga decided for it. */
export function deleteGuildBank(key: string): Promise<{ key: string }> {
    return send<{ key: string }>("POST", "/api/settings/guild-banks/delete", { key });
}
