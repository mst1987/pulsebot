import { get, send } from "./client";
import type { SessionGuild } from "./session";
import type { TextChannel } from "./recruitment";

/** One configured server (src/config/configSchema.js, #890): the Discord name is shown, `label` is an optional extra title. */
export type ServerEntry = { guildId: string; label: string };

/** One link (#890): the raid list of `from` is posted to `channelId` on `to`; lang "" = the target's server language, versions [] = all. */
export type ServerLink = { from: string; to: string; channelId: string; lang: "de" | "en" | ""; versions: string[] };

export type DiscordServers = {
    servers: ServerEntry[];
    links: ServerLink[];
    /** Where the messages of "Vielleicht" / "Absagen" are posted — a channel on any server. */
    signupNoteChannelId: string;
    /** Where the guild bank requests of every raider organizer land; "" = no guild bank button. */
    guildBankChannelId: string;
    /** Still stored until #897 removes it; the Discord-Server page neither shows nor sends it. */
    talkGuildId?: string;
};

export type BotPermission = { key: string; label: string; ok: boolean };

/** One configured server as a status card (src/web/guildRoles.js). */
export type DiscordServerCard = {
    role: "event" | "talk";
    id: string;
    name: string;
    connected: boolean;
    memberCount: number | null;
    iconUrl: string;
    /** null = not knowable (bot offline or not on that server). */
    permissions: BotPermission[] | null;
    missing: string[];
};

/** One configured server as the page's server table shows it (#891). */
export type ServerRow = DiscordServerCard & {
    label: string;
    /** Configured raid categories on this server; 0 is a normal state (it only shows lists). */
    raidCategories: number;
    /** The server's Discord language, "" when neither German nor English. */
    lang: "de" | "en" | "";
};

/** A server the bot is on, for the pickers of the two dialogs. */
export type GuildOption = SessionGuild & { lang: "de" | "en" | ""; channels: TextChannel[] };

export type VersionOption = { id: string; label: string; short: string };

export type DiscordServersData = {
    discordServers: DiscordServers;
    servers: ServerRow[];
    guilds: GuildOption[];
    versions: VersionOption[];
    /** The talk server's card, only to lock removing the old talk server (until #897 drops it). */
    talk: DiscordServerCard | null;
};

export function getDiscordServers(): Promise<DiscordServersData> {
    return get<DiscordServersData>("/api/settings/discord-servers");
}

/** One link's raid list (#257, #361, #892, src/services/talk/talkOverview.js). `key` is `${from}:${to}`. Times are epoch ms, 0 = never. */
export type TalkOverviewStatus = {
    key: string;
    from: string;
    to: string;
    guildId: string;
    label: string;
    configured: boolean;
    channelId: string;
    messageId: string;
    messageUrl: string;
    postedAt: number;
    editedAt: number;
    checkedAt: number;
    error: string;
};

/** Every source server's overview status, for the links table. */
export function getTalkOverview(): Promise<{ statuses: TalkOverviewStatus[] }> {
    return get<{ statuses: TalkOverviewStatus[] }>("/api/settings/talk-overview?preview=0");
}

/** Re-posts one link's raid list; `key` is `${from}:${to}`, an unknown key answers 400 without fallback. */
export function repostTalkOverview(
    key: string,
): Promise<{ result: { key: string; from: string; to: string; guildId: string; label: string; status: string; error?: string; messageId?: string }; status: TalkOverviewStatus | null }> {
    return send("POST", "/api/settings/talk-overview", { repost: true, key });
}
