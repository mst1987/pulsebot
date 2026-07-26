// Shared by server.js's SSR routes and apiRouter.js's JSON routes: which guild
// the admin is currently managing.
const discord = require("./discord");
const auth = require("./auth");

/** The server the admin is managing: explicit selection, else the bot's only guild. */
function activeGuildFor(req) {
    const selected = auth.getActiveGuild(req);
    if (selected) return selected;
    const guilds = discord.listGuilds();
    return guilds.length === 1 ? guilds[0].id : "";
}

module.exports = { activeGuildFor };
