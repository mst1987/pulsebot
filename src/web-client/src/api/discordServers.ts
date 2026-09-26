import { get, send } from "./client";
import type { SessionGuild } from "./session";
import type { TextChannel } from "./recruitment";

/** One configured event server (src/web/settingsStore.js's normalizeEventGuildEntry). */
export type EventGuildEntry = {
    guildId: string;
    label: string;
    /** Both set or both "" — where this server's own raid overview is posted (any bot guild, including itself). */
    overviewGuildId: string;
    overviewChannelId: string;
};

export type DiscordServers = {
    eventGuilds: EventGuildEntry[];
    talkGuildId: string;
    talkPingChannelId: string;
    /** Where the messages of "Vielleicht" / "Absagen" are posted — a channel on any server. */
    signupNoteChannelId: string;
};

export type BotPermission = { key: string; label: string; ok: boolean };

/** One configured server as the settings card shows it (src/web/guildRoles.js). */
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

/** One event server's card plus its overview target (src/web/guildRoles.js's eventGuildCards()). */
export type EventServerCard = DiscordServerCard & {
    label: string;
    overviewGuildId: string;
    overviewChannelId: string;
    overviewGuildName: string;
};

export type MemberOverlap = { eventCount: number | null; talkCount: number | null; both: number | null; error: string | null };

export type DiscordServersData = {
    discordServers: DiscordServers;
    events: EventServerCard[];
    talk: DiscordServerCard | null;
    /** null without both an event and a talk server. */
    overlap: MemberOverlap | null;
    guilds: (SessionGuild & { channels: TextChannel[] })[];
};

export function getDiscordServers(): Promise<DiscordServersData> {
    return get<DiscordServersData>("/api/settings/discord-servers");
}

/** One event server's raid overview (#257, #361, src/web/talkOverview.js). Times are epoch ms, 0 = never. */
export type TalkOverviewStatus = {
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

/** Every configured event server's overview status, for the settings cards. */
export function getTalkOverview(): Promise<{ statuses: TalkOverviewStatus[] }> {
    return get<{ statuses: TalkOverviewStatus[] }>("/api/settings/talk-overview?preview=0");
}

export function repostTalkOverview(
    guildId: string,
): Promise<{ result: { guildId: string; label: string; status: string; error?: string; messageId?: string }; status: TalkOverviewStatus | null }> {
    return send("POST", "/api/settings/talk-overview", { repost: true, guildId });
}
