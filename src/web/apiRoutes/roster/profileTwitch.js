// "Mein Profil": a raider's own requests to be announced on Twitch (docs/twitch.md).
//
// Only one's own account: the Discord id comes from the session, a body names at most the
// server and the Twitch name. No role, no channel, no text comes from here, those are the
// orga's when it approves, so nobody can get a ping out of a request.
//
// A request needs membership of that server, decided by Discord and fail closed: `false`
// refuses, and so does "not knowable" (bot offline, Discord slow). `sessionGuildAccess`
// proves nothing here, it hands out base access without membership. Withdrawing and taking
// oneself off the list ask nobody: they only ever touch one's own record.
const { ok, error } = require("../../http/apiResponse");
const { withUser } = require("../../http/apiHandler");
const { getConfig } = require("../../../stores/settings/settingsStore");
const discord = require("../../../services/discord/discord");
const { serverChoices } = require("../../../services/discord/roles/guildRoles");
const { TwitchSettingsError } = require("../../../services/twitch/twitchSettings");
const { fileRequest, statusOf, withdrawRequest, removeOwnEntry } = require("../../../services/twitch/twitchRequests");
const { requestOf, requestsOfUser } = require("../../../stores/discord/twitchRequestStore");

const str = (v) => (v === undefined || v === null ? "" : String(v)).trim();

const CONFLICT_CODES = new Set(["already_open", "already_approved", "already_listed"]);

/**
 * The caller's line per server: the servers they are in, and any they left but still have
 * a record on. "Not knowable" keeps the server in view (a Discord hiccup never empties the
 * section), the request itself is then refused.
 */
async function payload(userId) {
    const config = getConfig();
    const servers = serverChoices(config);
    const member = await Promise.all(servers.map((s) => discord.guildMembership(s.guildId, userId)));
    const lines = servers.flatMap((server, i) => {
        const record = requestOf(server.guildId, userId);
        const status = statusOf(record, config);
        if (member[i] === false && status === "none") return [];
        const shown = status === "none" ? null : record;
        return [{
            guildId: server.guildId,
            name: str(server.name) || str(server.label) || server.guildId,
            icon: str(server.iconUrl),
            status,
            login: shown ? shown.login : "",
            requestedAt: shown ? shown.requestedAt : 0,
            decidedAt: shown ? shown.decidedAt : 0,
        }];
    });
    const last = requestsOfUser(userId).sort((a, b) => b.requestedAt - a.requestedAt)[0];
    return { servers: lines, lastLogin: last ? last.login : "" };
}

/** GET /api/profile/twitch - the caller's requests, one line per server. */
const getProfileTwitch = withUser({}, async ({ user, res }) => {
    ok(res, await payload(String(user.id)));
});

/** POST /api/profile/twitch - body: { guildId, login }. One's own request on a server one is a member of. */
const postProfileTwitch = withUser({ csrf: true, body: true }, async ({ user, body, res }) => {
    const userId = String(user.id);
    const guildId = str(body.guildId);
    const config = getConfig();
    if (!serverChoices(config).some((s) => s.guildId === guildId)) {
        return error(res, 404, "not_found", "Diesen Server gibt es hier nicht.");
    }
    const member = await discord.guildMembership(guildId, userId);
    if (member === false) return error(res, 403, "not_member", "Du bist auf diesem Server nicht Mitglied.");
    if (member !== true) return error(res, 503, "member_unknown", "Discord antwortet gerade nicht. Bitte gleich noch einmal versuchen.");
    try {
        fileRequest({ guildId, userId, userName: user.name, login: body.login, config: getConfig() });
    } catch (e) {
        if (!(e instanceof TwitchSettingsError)) throw e;
        return error(res, CONFLICT_CODES.has(e.code) ? 409 : 400, e.code, e.message);
    }
    ok(res, await payload(userId), 201);
    return undefined;
});

/** POST /api/profile/twitch/withdraw - body: { guildId }. One's own open request. */
const postWithdraw = withUser({ csrf: true, body: true }, async ({ user, body, res }) => {
    const userId = String(user.id);
    if (!withdrawRequest(str(body.guildId), userId)) {
        return error(res, 404, "not_found", "Hier wartet keine Anfrage von dir.");
    }
    ok(res, await payload(userId));
    return undefined;
});

/** POST /api/profile/twitch/remove - body: { guildId }. One's own approved entry off the list. */
const postRemove = withUser({ csrf: true, body: true }, async ({ user, body, res }) => {
    const userId = String(user.id);
    if (!removeOwnEntry(str(body.guildId), userId)) {
        return error(res, 404, "not_found", "Du stehst auf diesem Server nicht in der Liste.");
    }
    ok(res, await payload(userId));
    return undefined;
});

/** Part of the page Profil, reachable with base access (docs/permissions.md). */
const routes = [
    { method: "GET", path: "/api/profile/twitch", handler: getProfileTwitch, area: "signup", scope: "all" },
    { method: "POST", path: "/api/profile/twitch", handler: postProfileTwitch, area: "signup", scope: "all" },
    { method: "POST", path: "/api/profile/twitch/withdraw", handler: postWithdraw, area: "signup", scope: "all" },
    { method: "POST", path: "/api/profile/twitch/remove", handler: postRemove, area: "signup", scope: "all" },
];

module.exports = { getProfileTwitch, postProfileTwitch, postWithdraw, postRemove, routes };
