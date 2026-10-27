// Shared by server.js's SSR routes and apiRouter.js's JSON routes: which guild
// the admin is currently managing. The rule itself is guildChoice.js, which
// auth.js uses too: the rights of a request are those of this server (#925).
const auth = require("./auth");
const { pickActiveGuild } = require("./guildChoice");

/**
 * The server the admin is managing: the guild selected in this session, else
 * the configured guild when the bot is on it, else the bot's only guild ("" when
 * none fits). See guildChoice.pickActiveGuild.
 */
function activeGuildFor(req) {
    return pickActiveGuild(auth.getActiveGuild(req));
}

module.exports = { activeGuildFor };
