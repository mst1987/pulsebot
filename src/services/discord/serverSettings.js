// Settings per Discord server (#917, epic #926): config.serverSettings[guildId].
//
// A server without an entry gets the default of the part that owns the key (or
// the fallback the caller passes). There is no global fallback: a value set for
// one server never answers for another, unless a part says so itself.
const { SERVER_SETTING_DEFAULTS } = require("../../stores/configSchema");

/**
 * One setting of one server.
 * @param {string} guildId
 * @param {string} key
 * @param {{ config?: object, fallback?: * }} [opts] `config` defaults to the stored settings,
 *   `fallback` replaces the part's default for a server without an entry
 */
function serverSetting(guildId, key, { config, fallback } = {}) {
    const cfg = config || require("../../stores/settingsStore").getConfig();
    const blocks = (cfg && cfg.serverSettings) || {};
    const block = blocks[String(guildId || "").trim()];
    if (block && Object.prototype.hasOwnProperty.call(block, key) && block[key] !== undefined) return block[key];
    if (fallback !== undefined) return fallback;
    return SERVER_SETTING_DEFAULTS[key];
}

module.exports = { serverSetting };
