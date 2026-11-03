import { get, send } from "../client";

// Twitch stream announcements of the active server: the contract is the header of
// src/web/apiRoutes/system/twitch.js, the overview docs/twitch.md. Writes carry the
// server the page was loaded for, a tab left open after a switch gets 409 server_switched.

export type TwitchStatusState = "live" | "filtered" | "offline";

export type TwitchStreamerStatus = {
    state: TwitchStatusState;
    /** ISO time the stream started, "" when none runs. */
    since: string;
    /** When the last stream ended (ms), 0 when unknown. */
    endedAt: number;
    title: string;
    game: string;
    viewers: number;
    /** The message was deleted in Discord: this stream gets no new one. */
    messageGone: boolean;
    /** channel_gone, no_permission, wrong_guild, post_failed, end_gave_up or "". */
    error: string;
    /** Set while the running message is in another channel than the entry. */
    postedChannelId: string;
};

export type TwitchStreamer = {
    login: string;
    channelId: string;
    roleId: string;
    text: string;
    games: string[];
    source: string;
    status: TwitchStreamerStatus;
};

export type TwitchLimits = { streamers: number; textLength: number; games: number; gameNameLength: number };

export type TwitchMention = {
    /** Whether the bot may mention every role; null while unknown (bot offline, server not loaded). */
    botCanMentionAll: boolean | null;
    unmentionableRoleIds: string[];
};

export type TwitchView = {
    guildId: string;
    hasCredentials: boolean;
    lastRun: { at: number; error: string };
    limits: TwitchLimits;
    mention: TwitchMention;
    streamers: TwitchStreamer[];
};

export type TwitchCheckResult =
    | { checked: number; live: number; skipped?: undefined }
    | { skipped: "no_credentials" | "bad_credentials" | "bot_offline" | "rate_limited" | "twitch_unavailable" | "failed"; checked?: undefined; live?: undefined };

export type TwitchStreamerInput = { login: string; channelId?: string; roleId?: string; text?: string; games?: string[] };

const PATH = "/api/settings/twitch";

export function getTwitchSettings(): Promise<TwitchView> {
    return get(PATH);
}

export function addTwitchStreamer(guildId: string, input: TwitchStreamerInput): Promise<TwitchView> {
    return send("POST", PATH, { serverSettingsGuildId: guildId, ...input });
}

export function updateTwitchStreamer(guildId: string, input: TwitchStreamerInput): Promise<TwitchView> {
    return send("PUT", PATH, { serverSettingsGuildId: guildId, ...input });
}

export function removeTwitchStreamer(guildId: string, login: string): Promise<TwitchView> {
    return send("DELETE", PATH, { serverSettingsGuildId: guildId, login });
}

export function checkTwitchStreamers(guildId: string): Promise<TwitchView & { result: TwitchCheckResult }> {
    return send("POST", `${PATH}/check`, { serverSettingsGuildId: guildId });
}
