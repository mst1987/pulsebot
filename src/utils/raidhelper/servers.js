// Raid-Helper per Discord server (#927, epic #926).
//
// Every server decides for itself whether it uses Raid-Helper:
// config.serverSettings[guildId].raidhelper = { enabled, serverId, apiKey,
// envKey, at, byName } (stores/settings/configSchema.js SERVER_SETTING_DEFAULTS).
//
//   - Off by default. A server without Raid-Helper never asks raid-helper.xyz
//     and its categories offer only EventHelper (eventSources.signupSourceFor).
//   - `serverId` is the id Raid-Helper knows the server by. Empty = the guild's
//     own id, which is what Raid-Helper uses; the field stays as an override
//     because a test instance's guild differs from the Raid-Helper server it
//     reads (.env.dev GUILD_ID vs RAIDHELPER_SERVER_ID).
//   - `apiKey` is set only from the settings page. `envKey` is the marker the
//     start migration (settingsMigration.migrateRaidhelperServers) puts on the
//     server that used Raid-Helper before #927: it keeps using
//     RAIDHELPER_API_KEY from .env, which is never copied into config.json.
//   - Active = switched on and a key at hand. Only active servers are synced
//     (services/events/raidhelperSync.js), each with its own key and its own
//     budget (budget.forServer).
//
// The key never leaves this module except into the HTTP client: the settings
// page gets maskedRaidhelper() — whether there is one and its last 4 characters.

const { SERVER_SETTING_DEFAULTS } = require("../../stores/settings/configSchema");

const DEFAULTS = SERVER_SETTING_DEFAULTS.raidhelper;

const str = (value) => String(value === undefined || value === null ? "" : value).trim();

/** The stored block of one server, every field present and typed. */
function raidhelperSettingOf(guildId, config) {
    const blocks = (config && config.serverSettings) || {};
    const block = blocks[str(guildId)];
    const raw = block && block.raidhelper && typeof block.raidhelper === "object" ? block.raidhelper : {};
    return {
        enabled: raw.enabled === true,
        serverId: str(raw.serverId),
        apiKey: str(raw.apiKey),
        envKey: raw.envKey === true,
        at: Number(raw.at) || DEFAULTS.at,
        byName: str(raw.byName),
    };
}

/**
 * What a client for one server needs: the id Raid-Helper knows it by and the
 * key (the stored one, else .env for the migrated server). `active` = switched
 * on and a key at hand.
 */
function raidhelperOf(guildId, config, env = process.env) {
    const id = str(guildId);
    const setting = raidhelperSettingOf(id, config);
    const apiKey = setting.apiKey || (setting.envKey ? str(env.RAIDHELPER_API_KEY) : "");
    return {
        guildId: id,
        enabled: setting.enabled,
        serverId: setting.serverId || id,
        apiKey,
        hasKey: !!apiKey,
        active: !!id && setting.enabled && !!apiKey,
    };
}

/** Every guild id that may hold a block: the configured servers and the home guild. */
function knownGuildIds(config) {
    const cfg = config || {};
    const ids = [];
    const servers = cfg.discordServers && Array.isArray(cfg.discordServers.servers) ? cfg.discordServers.servers : [];
    for (const s of servers) if (s && str(s.guildId) && !ids.includes(str(s.guildId))) ids.push(str(s.guildId));
    for (const id of Object.keys(cfg.serverSettings || {})) if (!ids.includes(id)) ids.push(id);
    if (str(cfg.guildId) && !ids.includes(str(cfg.guildId))) ids.push(str(cfg.guildId));
    return ids;
}

/** The servers whose Raid-Helper is active, in server order. */
function activeRaidhelperGuilds(config, env = process.env) {
    return knownGuildIds(config).filter((id) => raidhelperOf(id, config, env).active);
}

/** Whether one server's Raid-Helper is active. */
function raidhelperActive(guildId, config, env = process.env) {
    return raidhelperOf(guildId, config, env).active;
}

/**
 * The block as the settings page may see it: never the key, only whether
 * there is one and its last 4 characters (a stored key only — the .env key
 * shows as `envKey`).
 */
function maskedRaidhelper(guildId, config, env = process.env) {
    const setting = raidhelperSettingOf(guildId, config);
    const resolved = raidhelperOf(guildId, config, env);
    return {
        enabled: setting.enabled,
        serverId: setting.serverId,
        hasKey: resolved.hasKey,
        keyLast4: setting.apiKey.length >= 8 ? setting.apiKey.slice(-4) : "",
        envKey: setting.envKey,
        active: resolved.active,
        at: setting.at,
        byName: setting.byName,
    };
}

module.exports = { raidhelperSettingOf, raidhelperOf, activeRaidhelperGuilds, raidhelperActive, maskedRaidhelper, knownGuildIds };
