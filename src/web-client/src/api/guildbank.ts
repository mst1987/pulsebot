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
    /** Created by the orga, not by a scan. */
    addedByHand?: boolean;
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
    /** Handed out after the last scan: still in `count` until the next scan, no longer in the bank. */
    handedOut: number;
    /** count - reserved - handedOut - reserve, never below 0. */
    available: number;
    /** Open (not yet confirmed) requests of the item: promised, not set aside (#775). */
    open: number;
    /** available - open, never below 0: what a new request or the waiting list may still get. */
    free: number;
    /** How many waiting-list entries wait for the item. */
    waiting: number;
    /** Their amounts together. */
    waitingAmount: number;
    /** The item's application emoji in the bot's selects ("" = none yet, #633). */
    emojiId: string;
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
    /** Handed-out requests still kept (90 days) — the "Ausgegeben" tab's count. */
    handedOutRequests: number;
    items: GuildBankItem[];
};

export type GuildBankPageData = {
    /** The active server's banks of the asked version only (#741). */
    banks: GuildBankSummary[];
    /** null when the version has no bank on this server — never one of another version. */
    bank: GuildBank | null;
    /** Short names of the other (visible) versions this server has a bank of — the empty page's hint. */
    otherVersions?: string[];
};

/** The active server's banks of `version` and the one shown: `key` among them, else the first. */
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

/** A raider's request from the stock that still waits: open (for the orga) or confirmed (for the hand-out in game). */
export type GuildBankRequest = {
    id: string;
    itemId: number;
    item: string;
    iconUrl: string;
    amount: number;
    userId: string;
    userName: string;
    /** Who receives it in game ("" = no character in the profile). */
    characterName: string;
    realm: string;
    purpose: string;
    status: "open" | "confirmed";
    createdAt: number;
    /** Who confirmed it. */
    handledByName: string;
    handledAt: number;
    /** The recipient is a character of the raider's profile: only then may the orga confirm it, only then does the addon mail it. */
    linked: boolean;
};

/** The bank's open and confirmed requests (the "Anfragen" dialog), open first. */
export function getGuildBankRequests(key: string): Promise<{ requests: GuildBankRequest[] }> {
    return get<{ requests: GuildBankRequest[] }>(`/api/guildbank/requests?key=${encodeURIComponent(key)}`);
}

/** One entry of a bank's waiting list (#775): a raider — or, imported by the orga, a character alone (userId ""). */
export type GuildBankWaitingEntry = {
    id: string;
    itemId: number;
    item: string;
    iconUrl: string;
    amount: number;
    userId: string;
    userName: string;
    characterName: string;
    realm: string;
    purpose: string;
    createdAt: number;
    /** 1 = next in its item's queue. */
    position: number;
    /** The orga member who added or imported it ("" = the raider in Discord). */
    addedByName: string;
    /** Its character is a character of the raider's profile (else it cannot be confirmed when it moves up). */
    linked: boolean;
};

export type GuildBankWaitlist = { entries: GuildBankWaitingEntry[] };

/** A bank's waiting list, each item's queue in order. */
export function getGuildBankWaitlist(key: string): Promise<GuildBankWaitlist> {
    return get<GuildBankWaitlist>(`/api/guildbank/waitlist?key=${encodeURIComponent(key)}`);
}

/** Add an entry at the end of an item's list: a name (matched to a raider's character, else the character alone) or a picked profile character. */
export function addGuildBankWaiting(
    key: string,
    entry: { name: string; itemId: number; amount: number; userId?: string; characterKey?: string },
): Promise<GuildBankWaitlist & { added: number }> {
    return send<GuildBankWaitlist & { added: number }>("POST", "/api/guildbank/waitlist/add", { key, ...entry });
}

/** One place forward ("up") or back ("down") in the item's list. */
export function moveGuildBankWaiting(key: string, id: string, direction: "up" | "down"): Promise<GuildBankWaitlist> {
    return send<GuildBankWaitlist>("POST", "/api/guildbank/waitlist/move", { key, id, direction });
}

/** Take an entry off the list. */
export function removeGuildBankWaiting(key: string, id: string): Promise<GuildBankWaitlist> {
    return send<GuildBankWaitlist>("POST", "/api/guildbank/waitlist/remove", { key, id });
}

/** One Wowhead hit of the add-item dialog's name search. */
export type GuildBankItemHit = { id: number; name: string; icon: string; iconUrl: string; quality: number | null };

/** Wowhead's items for a name on the bank's version. */
export function searchGuildBankItems(key: string, q: string): Promise<{ items: GuildBankItemHit[] }> {
    return get<{ items: GuildBankItemHit[] }>(`/api/guildbank/item/search?key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}`);
}

/** Create an item the bank does not hold (yet): an item id, a Wowhead link or a name; it lands on "Ausgebbar" with stock 0. */
export function addGuildBankItem(key: string, input: { itemId: number } | { query: string }): Promise<{ item: GuildBankItem; created: boolean }> {
    return send<{ item: GuildBankItem; created: boolean }>("POST", "/api/guildbank/item/add", { key, ...input });
}

/** A pasted line as the import's preview reads it. */
export type GuildBankImportRow = {
    line: number;
    name: string;
    itemText: string;
    amount: number;
    /** The line could not be read (German). */
    error: string;
    item: { itemId: number; name: string; iconUrl: string } | null;
    /** Unknown or not offered (German). */
    itemError: string;
    /** The raider the name belongs to (or the orga picked); null = imported as the character alone, not linked. */
    match: { userId: string; userName: string; characterName: string; realm: string; characterKey?: string; className?: string } | null;
    /** Characters of several raiders carry the name. */
    ambiguous: boolean;
    /** The raiders' characters of that name when it is ambiguous — one of them can be picked. */
    candidates?: { userId: string; userName: string; characterKey: string; characterName: string; realm: string; className: string }[];
    /** The row lands linked to a profile character. */
    linked?: boolean;
    /** The orga picked the character (`links`). */
    picked?: boolean;
    /** Will be imported. */
    ok: boolean;
    /** The item was found despite a typo in its name: `item` is the real one. */
    fuzzy?: boolean;
};

/** The orga's pick for an import line: line number → profile character. */
export type GuildBankImportLinks = Record<number, { userId: string; characterKey: string }>;

/** What pasted lines would import (nothing stored). */
export function previewGuildBankWaitlist(key: string, text: string, links: GuildBankImportLinks = {}): Promise<{ rows: GuildBankImportRow[] }> {
    return send<{ rows: GuildBankImportRow[] }>("POST", "/api/guildbank/waitlist/preview", { key, text, links });
}

/** Import pasted lines ("Name<Tab>Item<Tab>Anzahl"): the readable ones at the end of their lists, in order, linked to the picks. */
export function importGuildBankWaitlist(
    key: string,
    text: string,
    links: GuildBankImportLinks = {},
): Promise<GuildBankWaitlist & { added: number; skipped: number; unlinked?: number }> {
    return send<GuildBankWaitlist & { added: number; skipped: number; unlinked?: number }>("POST", "/api/guildbank/waitlist/import", { key, text, links });
}

/** A raider profile's character the link dialog offers. */
export type GuildBankCharacterChoice = {
    userId: string;
    /** The raider's name in the profile. */
    userName: string;
    characterKey: string;
    characterName: string;
    realm: string;
    className: string;
    /** Always the bank's game version: the server offers no other (#741). */
    versionId: string;
    /** WoW icon name: the first spec's, else the class's. */
    icon: string;
    classColor: string;
    specKey: string;
};

/** The profile characters of the bank's version to link a request to (`q`: character or raider name). */
export function searchGuildBankCharacters(key: string, q: string): Promise<{ characters: GuildBankCharacterChoice[] }> {
    return get<{ characters: GuildBankCharacterChoice[] }>(`/api/guildbank/characters?key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}`);
}

/** Link a waiting, open or confirmed request to a profile character: it becomes the raider and the recipient. */
export function linkGuildBankRequest(key: string, id: string, pick: { userId: string; characterKey: string }): Promise<{ request: GuildBankRequest }> {
    return send<{ request: GuildBankRequest }>("POST", "/api/guildbank/request/link", { key, id, ...pick });
}

/** How a request was handed out: the orga's button in Discord, ticked off in game, or mailed from the mailbox (addon). */
export type GuildBankHandoutVia = "" | "discord" | "manual" | "mail";

/** A handed-out request of the bank (the "Ausgegeben" tab). */
export type GuildBankHandedOut = {
    id: string;
    itemId: number;
    item: string;
    iconUrl: string;
    amount: number;
    userId: string;
    userName: string;
    characterName: string;
    realm: string;
    purpose: string;
    createdAt: number;
    confirmedByName: string;
    handedOutAt: number;
    handedOutByName: string;
    handoutVia: GuildBankHandoutVia;
    fromWaitlist: boolean;
};

/** The bank's handed-out requests (kept 90 days), newest first. */
export function getGuildBankHandedOut(key: string): Promise<{ requests: GuildBankHandedOut[] }> {
    return get<{ requests: GuildBankHandedOut[] }>(`/api/guildbank/handedout?key=${encodeURIComponent(key)}`);
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
