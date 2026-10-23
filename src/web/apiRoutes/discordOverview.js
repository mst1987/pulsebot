// The Discord overview of one server side (docs/discord-servers.md "Discord-Übersicht"):
// who joined or left, whether the bot has what its functions need, whether its
// fixed messages still stand, and a count of untidy roles. Area `channels`, read only.
//
// GET /api/discord/overview?side=event|talk[&fresh=1]
//   → { data: { side, guildId, online,
//               members: [{ guildId, userId, name, at, kind: "join"|"leave", roles: [{ id, name }],
//                           relation: { rosters: [{ id, name, categoryId, status }], characters } }],
//               botCheck: { guildId, known, functions: [...], channels: [...], rolesAboveBot: [...] },
//               messages: [{ kind, kindLabel, title, categoryId, categoryName, guildId, channelId,
//                            channelName, messageId, link, status: "ok"|"deleted"|"channel_missing"|"unknown" }],
//               hygiene: { known, total, empty, aboveBot, sensitive } } }
//   members: the last 7 days, newest first. messages: cached 10 minutes per server;
//   `fresh=1` checks again at once. Counts are null where the bot cannot say
//   (offline, or `empty` while the member cache is incomplete).
//   400 bad_side for any other side.
const { ok, error: apiError } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { getConfig } = require("../../stores/configStore");
const discord = require("../../services/discord/discord");
const guildRoles = require("../../services/discord/guildRoles");
const memberActivity = require("../../services/discord/memberActivity");
const { botCheck } = require("../../services/discord/botCheck");
const { botMessages } = require("../../services/discord/botMessages");
const { roleHygiene } = require("../../services/discord/roleHygiene");

const SIDES = ["event", "talk"];

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/** GET /api/discord/overview?side= */
const getOverview = withUser(async ({ query, res }) => {
    const side = str(query.get("side")) || "event";
    if (!SIDES.includes(side)) return apiError(res, 400, "bad_side", "Unbekannte Seite: event oder talk.");
    const config = getConfig();
    const guildIds = { event: str(guildRoles.eventGuildId(config)), talk: str(guildRoles.talkGuildId(config)) };
    const guildId = guildIds[side];
    ok(res, {
        side,
        guildId,
        online: discord.isOnline(),
        members: memberActivity.recentActivity(guildId, { days: 7 }),
        botCheck: botCheck(side, guildId, config, guildIds),
        messages: await botMessages(side, guildId, config, { fresh: str(query.get("fresh")) === "1" }),
        hygiene: roleHygiene(guildId),
    });
    return undefined;
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/discord/overview", handler: getOverview, area: "channels" },
];

module.exports = { routes };
