import { get } from "./client";

// The Discord overview of one server of the server list (System › Discord › Übersicht, #895): the
// contract is the header of src/web/apiRoutes/discordOverview.js, the page
// docs/channels.md.

export type BotRight = { key: string; label: string; ok: boolean | null };

export type BotFunctionState = "ok" | "missing" | "unknown" | "not_needed";

/** One bot function and the rights it needs on the server (services/discord/botCheck.js). */
export type BotFunction = { key: string; label: string; state: BotFunctionState; rights: BotRight[] };

export type BotChannelState = "ok" | "missing" | "not_set" | "channel_missing" | "unknown";

/** A channel the settings name for a purpose, and whether the bot can work in it. */
export type BotChannel = {
    key: string;
    label: string;
    channelId: string;
    channelName: string;
    state: BotChannelState;
    /** the labels of the rights the bot lacks in that channel */
    missing: string[];
    /** the missing rights as keys (Discord permission flags), for the label in the client language; older servers may leave it out */
    missingKeys?: string[];
};

export type BotCheck = {
    guildId: string;
    /** false = bot offline or not on that server: every state reads "unknown" */
    known: boolean;
    functions: BotFunction[];
    channels: BotChannel[];
    /** roles the bot hands out but cannot reach */
    rolesAboveBot: { id: string; name: string; usedBy: string[] }[];
};

export type MemberActivity = {
    guildId: string;
    userId: string;
    name: string;
    /** epoch ms */
    at: number;
    kind: "join" | "leave";
    roles: { id: string; name: string }[];
    relation: { rosters: { id: string; name: string; categoryId: string; status: string }[]; characters: number };
};

export type BotMessageStatus = "ok" | "deleted" | "channel_missing" | "no_access" | "unknown";

export type BotMessageKind = "orgaHub" | "availability" | "raidOverview" | "talkOverview" | "roleMessage" | "addonCenter" | "recruitment";

/** One fixed message of the bot and whether it still stands. */
export type BotMessage = {
    kind: BotMessageKind | string;
    kindLabel: string;
    title: string;
    categoryId: string;
    categoryName: string;
    guildId: string;
    channelId: string;
    channelName: string;
    messageId: string;
    /** the message in Discord, "" when there is none to open */
    link: string;
    status: BotMessageStatus;
};

/** Counts of the server's roles; null where the bot cannot say. */
export type RoleHygiene = {
    known: boolean;
    total: number | null;
    empty: number | null;
    aboveBot: number | null;
    sensitive: number | null;
};

export type DiscordOverview = {
    /** "" = no server is set */
    guildId: string;
    online: boolean;
    members: MemberActivity[];
    botCheck: BotCheck;
    messages: BotMessage[];
    hygiene: RoleHygiene;
};

/** A server of the server list as the server picker shows it (GET /api/discord/servers). */
export type DiscordServerChoice = {
    guildId: string;
    /** the Discord name, "" while the bot is not on that server */
    name: string;
    /** the orga's own short label, "" when none is set */
    label: string;
    online: boolean;
    iconUrl: string;
    /** the old talk server (until #897): an old `?side=talk` link opens it */
    legacyTalk?: boolean;
};

/** The query part for one server ("" = the server's default, the first of the list). */
export function guildQuery(guildId?: string): string {
    return guildId ? `guildId=${encodeURIComponent(guildId)}` : "";
}

/** GET /api/discord/servers — the servers of the list in their order. */
export function getServerChoices(): Promise<DiscordServerChoice[]> {
    return get("/api/discord/servers");
}

/** GET /api/discord/overview — `fresh` asks Discord again for every fixed message. */
export function getDiscordOverview(guildId = "", fresh = false): Promise<DiscordOverview> {
    const q = [guildQuery(guildId), fresh ? "fresh=1" : ""].filter(Boolean).join("&");
    return get(`/api/discord/overview${q ? `?${q}` : ""}`);
}
