import { get, send } from "../client";
import type { SessionGuild } from "../system/session";
import type { TextChannel } from "../system/recruitment";

/** One configured server (src/config/configSchema.js, #890): the Discord name is shown, `label` is an optional extra title. */
export type ServerEntry = {
    guildId: string;
    label: string;
    /** The switch "PuG-Server" (#906): only then "Rollen & Onboarding" works there; missing = off. */
    pug?: boolean;
};

/** One link (#890): the raid list of `from` is posted to `channelId` on `to`; lang "" = the target's server language, versions [] = all. */
export type ServerLink = { from: string; to: string; channelId: string; lang: "de" | "en" | ""; versions: string[] };

export type DiscordServers = {
    servers: ServerEntry[];
    links: ServerLink[];
    /** PATCH only (#924): the signup channels of single servers, merged per server and field. */
    channels?: Record<string, Partial<ServerChannels>>;
};

/**
 * The two signup channels of one server (#924), "" = none: nothing is posted
 * then, no other server's channel stands in.
 */
export type ServerChannels = {
    /** Where the messages of "Vielleicht" / "Absagen" of this server's raids are posted. */
    signupNoteChannelId: string;
    /** Where the guild bank requests of this server's raider organizers land; "" = no guild bank button. */
    guildBankChannelId: string;
};

export type BotPermission = { key: string; label: string; ok: boolean };

/** One configured server as a status card (src/web/guildRoles.js). */
export type DiscordServerCard = {
    role: "event";
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
    /** The signup channels of every server that may hold its own settings, keyed by guild id. */
    channels: Record<string, ServerChannels>;
    servers: ServerRow[];
    guilds: GuildOption[];
    versions: VersionOption[];
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

/** One link's invite (#905, src/services/discord/pugInvites.js): `url` "" = none yet, `error` a missing bot right first. */
export type PugLinkInvite = {
    key: string;
    from: string;
    to: string;
    code: string;
    url: string;
    channelId: string;
    createdAt: number;
    error: string;
    /** The check found the invite gone on Discord (someone deleted it); `url` is "" then. */
    deleted: boolean;
    /** Members who joined through this invite. */
    joined: number;
    /** Of them, signed up for a raid of the source server (absence does not count). */
    signedUp: number;
};

/** One server's general invite and the channel its invites point at ("" = the bot picks one). */
export type PugServerInvite = {
    guildId: string;
    /** Whether the server is the source of a link; only then it gets invites. */
    source: boolean;
    code: string;
    url: string;
    channelId: string;
    inviteChannelId: string;
    error: string;
    /** The general invite was deleted on Discord. */
    deleted: boolean;
};

export type PugInvites = { links: PugLinkInvite[]; servers: PugServerInvite[] };

export function getPugInvites(): Promise<PugInvites> {
    return get<PugInvites>("/api/settings/pug-invites");
}

/** Creates the invite of a link (`key`) or a server's general invite (`guildId`); `regenerate` replaces it. */
export function postPugInvite(target: { key: string } | { guildId: string }, regenerate = false): Promise<PugInvites> {
    return send("POST", "/api/settings/pug-invites", { ...target, regenerate });
}

/** The channel new invites of a server point at; "" = the bot picks one. */
export function postInviteChannel(guildId: string, channelId: string): Promise<PugInvites> {
    return send("POST", "/api/settings/pug-invites/channel", { guildId, channelId });
}
