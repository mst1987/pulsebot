// The server a Discord page of the web admin asks for (#895, Server-Verbund):
// `?guildId=<id>` must be one of the servers of `discordServers.servers`; without
// one the first server counts (an old `?side=talk` link too, #897).
// An unknown guildId is answered here with 400 unknown_guild.
//
// Rights hold per server (#925, docs/permissions.md "Rechte je Server"): only a
// full admin picks any server of the list. Everybody else reaches the server
// active in their session only - without `guildId` that one counts, another
// guildId answers 403 "other_server" (their rights were computed on the active
// server and say nothing about another).
const { error: apiError } = require("./apiResponse");
const { activeGuildFor } = require("./activeGuild");
const { resolveServer } = require("../../services/discord/guildRoles");
const { getConfig } = require("../../stores/configStore");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();
const OTHER_SERVER = "Für diesen Server hast du hier keine Rechte.";

/**
 * Whether `user` may act on `guildId` from this request: a full admin on every
 * server, everybody else on the active server of their session only.
 */
function mayUseServer(user, req, guildId) {
    if (user && user.isAdmin) return true;
    const active = str(activeGuildFor(req));
    return !!active && str(guildId) === active;
}

/**
 * The guildId the request means, "" when no server is configured, or null after
 * the 400 unknown_guild or the 403 other_server has been sent (the handler then returns).
 * @param {URLSearchParams} query
 * @param {import("http").ServerResponse} res
 * @param {{ user: object, req: object, config?: object }} access  the caller - required, the rights hold per server
 * @returns {string|null}
 */
function serverFromQuery(query, res, { user, req, config = getConfig() } = {}) {
    if (!user || !req) throw new Error("serverFromQuery: pass { user, req } - the rights hold per server (#925)");
    const wanted = str(query.get("guildId"));
    // without a guildId a non-admin means the server active in their session, not the first of the list
    const asked = !wanted && !user.isAdmin ? str(activeGuildFor(req)) : wanted;
    const guildId = resolveServer({ guildId: asked }, config);
    if (guildId === null) {
        apiError(res, 400, "unknown_guild", "Diesen Server gibt es in der Serverliste nicht.");
        return null;
    }
    if (!mayUseServer(user, req, guildId)) {
        apiError(res, 403, "other_server", OTHER_SERVER);
        return null;
    }
    return guildId;
}

module.exports = { serverFromQuery, mayUseServer, OTHER_SERVER };
