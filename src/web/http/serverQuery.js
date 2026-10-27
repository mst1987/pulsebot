// The server a Discord page of the web admin asks for (#895, Server-Verbund):
// `?guildId=<id>` must be one of the servers of `discordServers.servers`; without
// one the first server counts (a legacy `?side=talk` still means the talk server).
// An unknown guildId is answered here with 400 unknown_guild.
const { error: apiError } = require("./apiResponse");
const { resolveServer } = require("../../services/discord/guildRoles");
const { getConfig } = require("../../stores/configStore");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/**
 * The guildId the request means, "" when no server is configured, or null after
 * the 400 unknown_guild has been sent (the handler then returns).
 * @param {URLSearchParams} query
 * @param {import("http").ServerResponse} res
 * @returns {string|null}
 */
function serverFromQuery(query, res, config = getConfig()) {
    const guildId = resolveServer({ guildId: str(query.get("guildId")), side: str(query.get("side")) }, config);
    if (guildId === null) {
        apiError(res, 400, "unknown_guild", "Diesen Server gibt es in der Serverliste nicht.");
        return null;
    }
    return guildId;
}

module.exports = { serverFromQuery };
