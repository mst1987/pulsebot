import { send } from "../client";

// The Warcraft Logs guild of a Discord server, per game version (#922). Saved
// with PATCH /api/settings (`wclGuilds`, server-bound like the log channels);
// the server's minute job fetches each entry's new reports every `interval`
// minutes (0 = only by hand).

/** The minutes between two fetches; mirrors INTERVALS in services/logcheck/wclGuildSettings.js. */
export const WCL_GUILD_INTERVALS = [0, 15, 30, 60, 180, 360, 1440] as const;
export const WCL_GUILD_DEFAULT_INTERVAL = 60;
/** The regions of the WCL guild endpoint; mirrors REGIONS in wclGuildSettings.js. */
export const WCL_GUILD_REGIONS = ["EU", "US", "KR", "TW", "CN"] as const;

/** The outcome of the last fetch: new logs, or a short error (never a key). */
export type WclGuildResult = { found: number; error: string; at: number };

export type WclGuildInput = { versionId: string; guildName: string; realm: string; region: string; interval: number };

/** lastRunAt: every fetch (when the next is due); lastSuccessAt: only answered fetches (where the next window starts). */
export type WclGuild = WclGuildInput & { lastRunAt: number; lastSuccessAt: number; lastResult: WclGuildResult | null };

/** The identity of an entry; mirrors entryKey() in wclGuildSettings.js. */
export function wclGuildKey(e: Pick<WclGuildInput, "versionId" | "guildName" | "realm" | "region">): string {
    return [e.versionId.trim(), e.guildName.trim().toLowerCase(), e.realm.trim().toLowerCase(), (e.region.trim().toUpperCase() || "EU")].join("|");
}

/**
 * POST /api/settings/wcl-guilds/fetch: fetch one saved entry of the active
 * server now, whatever its interval. `guildId` is the server the page loaded;
 * a session switched since answers 409 `server_switched`.
 */
export function fetchWclGuild(key: string, guildId: string): Promise<{ key: string; result: WclGuildResult; wclGuilds: WclGuild[] }> {
    return send("POST", "/api/settings/wcl-guilds/fetch", { key, serverSettingsGuildId: guildId });
}
