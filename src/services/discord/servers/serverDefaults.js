// The per-server values of #924 (epic #926), read in their final shape.
//
// Applications (channel + officer role), the raid form's preset channel and the
// two signup channels ("Vielleicht"/"Absagen" notes, guild bank) used to be one
// global value each; they live in config.serverSettings[guildId] now. Every
// reader here answers for ONE server and returns a snowflake or "": a server
// without an entry posts nothing there, it never borrows another server's
// channel. The bot language has its own reader (botLanguage.serverLang).
const { serverSetting } = require("./serverSettings");
const { isSnowflake } = require("../../../utils/ids");

const str = (value) => String(value === undefined || value === null ? "" : value).trim();
const snowflakeOr = (value) => (isSnowflake(str(value)) ? str(value) : "");

const cfgOf = (config) => config || require("../../../stores/settingsStore").getConfig();

/** One snowflake setting of one server ("" = none set, or no server given). */
function serverChannel(guildId, key, { config } = {}) {
    const id = str(guildId);
    if (!id) return "";
    return snowflakeOr(serverSetting(id, key, { config: cfgOf(config) }));
}

const applicationChannelId = (guildId, opts) => serverChannel(guildId, "applicationChannelId", opts);
const officerRoleId = (guildId, opts) => serverChannel(guildId, "officerRoleId", opts);
const signupNoteChannelId = (guildId, opts) => serverChannel(guildId, "signupNoteChannelId", opts);
const guildBankChannelId = (guildId, opts) => serverChannel(guildId, "guildBankChannelId", opts);

/** The raid form's preset channel of one server. */
function raidDefaultChannelId(guildId, { config } = {}) {
    const id = str(guildId);
    if (!id) return "";
    const defaults = serverSetting(id, "raidDefaults", { config: cfgOf(config) }) || {};
    return snowflakeOr(defaults.channelId);
}

/** Every server's value of one key: [{ guildId, value }] for the servers that set one (as stored, trimmed). */
function everyServer(key, { config } = {}) {
    const blocks = cfgOf(config).serverSettings || {};
    const out = [];
    for (const [guildId, block] of Object.entries(blocks)) {
        const value = str(block && block[key]);
        if (value) out.push({ guildId, value });
    }
    return out;
}

/** The officer roles of all servers (a role id is unique across Discord). */
function officerRoleIds(opts) {
    return [...new Set(everyServer("officerRoleId", opts).map((entry) => entry.value))];
}

module.exports = {
    applicationChannelId, officerRoleId, signupNoteChannelId, guildBankChannelId, raidDefaultChannelId,
    everyServer, officerRoleIds,
};
