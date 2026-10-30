// Settings per Discord server (#917, epic #926): config.serverSettings[guildId].
//
// A server without an entry gets the default of the part that owns the key (or
// the fallback the caller passes). There is no global fallback: a value set for
// one server never answers for another, unless a part says so itself.
const { SERVER_SETTING_DEFAULTS, DISCORD_VISUALS_DEFAULT, normalizeDiscordVisuals } = require("../../../stores/configSchema");

/**
 * One setting of one server.
 * @param {string} guildId
 * @param {string} key
 * @param {{ config?: object, fallback?: * }} [opts] `config` defaults to the stored settings,
 *   `fallback` replaces the part's default for a server without an entry
 */
function serverSetting(guildId, key, { config, fallback } = {}) {
    const cfg = config || require("../../../stores/settingsStore").getConfig();
    const blocks = (cfg && cfg.serverSettings) || {};
    const block = blocks[String(guildId || "").trim()];
    if (block && Object.prototype.hasOwnProperty.call(block, key) && block[key] !== undefined) return block[key];
    if (fallback !== undefined) return fallback;
    return SERVER_SETTING_DEFAULTS[key];
}

/**
 * The switches a server set itself for its drawn pictures (#961): only known keys with a boolean.
 * @param {object} [block] serverSettings[guildId].discordVisuals
 */
function ownVisualsOf(block) {
    const src = block && typeof block === "object" ? block : {};
    return Object.fromEntries(Object.keys(DISCORD_VISUALS_DEFAULT).filter((k) => typeof src[k] === "boolean").map((k) => [k, src[k]]));
}

/**
 * The drawn pictures of one server's bot messages (#961): what the server set
 * itself, else the global default config.discordVisuals (each on unless false).
 * No server = the global default.
 * @param {string} guildId
 * @param {{ config?: object }} [opts]
 * @returns {{ overviewWeekStrip: boolean, setupImage: boolean, eventCover: boolean }}
 */
function serverVisuals(guildId, { config } = {}) {
    const cfg = config || require("../../../stores/settingsStore").getConfig();
    const block = ((cfg && cfg.serverSettings) || {})[String(guildId || "").trim()];
    return { ...normalizeDiscordVisuals(cfg && cfg.discordVisuals), ...ownVisualsOf(block && block.discordVisuals) };
}

module.exports = { serverSetting, serverVisuals, ownVisualsOf };
