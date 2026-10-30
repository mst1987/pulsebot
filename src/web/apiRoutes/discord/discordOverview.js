// The Discord overview of one server of the list (docs/discord-servers.md "Discord-Übersicht"):
// who joined or left, whether the bot has what its functions need, whether its
// fixed messages still stand, and a count of untidy roles. Area `channels`, read only.
//
// GET /api/discord/servers
//   → { data: [{ guildId, name, label, online, iconUrl }] }   the server list (#895) in its
//     order, name = the Discord name ("" offline), label = the optional own label; a full
//     admin sees every server, everybody else the server active in their session (#925)
//
// GET /api/discord/overview?guildId=<one of the servers>[&fresh=1]   (none: the first server)
//   → { data: { guildId, online,
//               members: [{ guildId, userId, name, at, kind: "join"|"leave", roles: [{ id, name }],
//                           relation: { rosters: [{ id, name, categoryId, status }], characters } }],
//               botCheck: { guildId, known, functions: [...], channels: [...], rolesAboveBot: [...] },
//               messages: [{ kind, kindLabel, title, categoryId, categoryName, guildId, channelId,
//                            channelName, messageId, link,
//                            status: "ok"|"deleted"|"channel_missing"|"no_access"|"unknown" }],
//               hygiene: { known, total, empty, aboveBot, sensitive } } }
//   members: the last 7 days, newest first. messages: each answer is kept 10 minutes
//   per message, "unknown" (offline, timeout, 5xx) never; one check stops after 5 s and
//   what has not answered reads "unknown". `fresh=1` asks Discord again for every
//   message of the server. botCheck.channels leaves out a channel that lies on another
//   server; botCheck.functions reads "not_needed" for what is not set up on this server. Counts are null where the bot cannot say
//   (offline, or `empty` while the member cache is incomplete).
//   400 unknown_guild for a guildId outside the server list, 403 other_server for another
//   server than the active one (full admins excepted, #925).
const { ok } = require("../../http/apiResponse");
const { serverFromQuery, mayUseServer } = require("../../http/serverQuery");
const { withUser } = require("../../http/apiHandler");
const { getConfig } = require("../../../stores/settings/configStore");
const discord = require("../../../services/discord/discord");
const guildRoles = require("../../../services/discord/roles/guildRoles");
const memberActivity = require("../../../services/discord/members/memberActivity");
const { botCheck } = require("../../../services/discord/botCheck");
const { botMessages } = require("../../../services/discord/botMessages");
const { roleHygiene } = require("../../../services/discord/roles/roleHygiene");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/** GET /api/discord/servers - a full admin sees every server, everybody else their active one (#925). */
const listServers = withUser(async ({ user, req, res }) => {
    ok(res, guildRoles.serverChoices(getConfig()).filter((s) => mayUseServer(user, req, s.guildId)));
});

/** GET /api/discord/overview?guildId= */
const getOverview = withUser(async ({ user, req, query, res }) => {
    const config = getConfig();
    const guildId = serverFromQuery(query, res, { user, req, config });
    if (guildId === null) return undefined;
    ok(res, {
        guildId,
        online: discord.isOnline(),
        members: memberActivity.recentActivity(guildId, { days: 7 }),
        botCheck: botCheck(guildId, config),
        messages: await botMessages(guildId, config, { fresh: str(query.get("fresh")) === "1" }),
        hygiene: roleHygiene(guildId),
    });
    return undefined;
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/discord/servers", handler: listServers, area: "channels" },
    { method: "GET", path: "/api/discord/overview", handler: getOverview, area: "channels" },
];

module.exports = { routes };
