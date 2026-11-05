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
const { resolveServer, serverIsTrusted } = require("../../services/discord/roles/guildRoles");
const { getConfig } = require("../../stores/settings/configStore");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();
const OTHER_SERVER = "Für diesen Server hast du hier keine Rechte.";
const CHANNEL_OTHER_SERVER = "Der Kanal liegt auf einem anderen Server als die Kategorie.";
const MEMBERS_UNAVAILABLE = "members_unavailable";
const OUTSIDE_SERVER = "outside_server";

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
 * Whether `user` may act on a link between two servers (#1073): a full admin, the server-admin rank
 * only with the rank on both ends, whichever server is active. What one end's admin decides alone
 * must not reach the other server.
 */
function mayUseLink(user, req, from, to) {
    if (!user) return false;
    if (user.isAdmin) return true;
    if (!user.isServerAdmin) return false;
    // required here, not at the top: tests of the callers mock auth without this export
    const { userForGuild } = require("./auth");
    return [from, to].every((guildId) => {
        const view = userForGuild(req, str(guildId));
        return !!view && view.isServerAdmin === true;
    });
}

/**
 * Whether roles count for data of every server from this request: the active server carries the mark
 * of a full admin (#1073, guildRoles.serverIsTrusted). A way that does not go through onlyByRank or
 * `sharedData` (a category's managers, say) asks this itself; a full admin does not need to.
 */
const rolesCountForSharedData = (req) => serverIsTrusted(activeGuildFor(req));

/**
 * Whether the server lets `user` write what every server shares, a global record, at all (#1105):
 * a full admin or a server with the mark. A grant on a server without it counts for nothing: nothing
 * says who gave it. The rank still answers for itself on a marked server (onlyByRank).
 */
function mayWriteSharedData(user, req) {
    return !!user && (user.isAdmin === true || rolesCountForSharedData(req));
}

/**
 * Whether what `user` may do here does not reach data of every server: it holds the server-admin
 * rank (#1072) or stands on a server without the mark (#1073), and what counts there
 * (`rolesMay(auth.getUserWithoutRank)`) would not allow it. A full admin never, somebody on a trusted
 * server without the rank neither. Without the mark nothing of the server counts there, not its base
 * access nor an own grant either (userAccess.sharedDataAccess).
 */
function onlyByRank(user, req, rolesMay) {
    if (!user || user.isAdmin) return false;
    if (!user.isServerAdmin && rolesCountForSharedData(req)) return false;
    // required here, not at the top: tests of the callers mock auth without this export
    return !rolesMay(require("./auth").getUserWithoutRank(req));
}

/**
 * The raiders `user` reaches from this request (#1077, services/characters/profileVisibility.js).
 * `visible`: null for a full admin (no limit), otherwise a set: members of the active server, raiders
 * signed up there, and the caller. `membersKnown`: false when the member list could not be read, so
 * a missing account may be just unknown. `membersOnly`: the stricter limit of the rank alone
 * (`onlyByRank`), the members and nobody else. Routes with such a limit ask `onlyByRank` first; the
 * routes that show lists a rank may read anyway (a roster's members, its Abgleich) do too.
 * @returns {Promise<{ visible: Set<string>|null, membersKnown: boolean }>}
 */
async function raiderReachFor(user, req, { membersOnly = false } = {}) {
    if (user && user.isAdmin) return { visible: null, membersKnown: true };
    if (membersOnly) {
        // required here, not at the top: it pulls in the bot's discord module, see guildOfChannel
        const { serverMemberIds } = require("../../services/discord/members/serverMembers");
        const members = await serverMemberIds(activeGuildFor(req));
        return { visible: members || new Set(), membersKnown: !!members };
    }
    const { raiderVisibility } = require("../../services/characters/profileVisibility");
    const { ids, membersKnown } = await raiderVisibility(activeGuildFor(req));
    if (user && user.id) ids.add(str(user.id));
    return { visible: ids, membersKnown };
}

/** The set of `raiderReachFor`, for a list: it fails closed, an unreadable member list only shortens it. */
async function visibleRaidersFor(user, req) {
    return (await raiderReachFor(user, req)).visible;
}

/**
 * Why an account is out of a reach: "" when it is in, MEMBERS_UNAVAILABLE when the member list could
 * not be read, else OUTSIDE_SERVER. Either way the caller refuses (fail closed); only the answer differs.
 */
function outsideReach(reach, userId) {
    const id = str(userId);
    if (!reach.visible || reach.visible.has(id)) return "";
    return id && !reach.membersKnown ? MEMBERS_UNAVAILABLE : OUTSIDE_SERVER;
}

/**
 * The limit of a bulk way into a roster (from a Kader, from raid nights, the takeover), which takes
 * several accounts where the hand way (rosterMembers.js) takes one: who has the way by the rank alone
 * (`onlyByRank`) takes members of the active server only. `mayTakeIn` is null without a limit; with
 * `unavailable` the member list could not be read, so the caller answers `membersUnavailable` before
 * anything happens (fail closed).
 * @returns {Promise<{ mayTakeIn: ((userId: string) => boolean) | null, unavailable: boolean }>}
 */
async function takeInLimit(user, req, rolesMay) {
    if (!onlyByRank(user, req, rolesMay)) return { mayTakeIn: null, unavailable: false };
    const reach = await raiderReachFor(user, req, { membersOnly: true });
    return { mayTakeIn: (userId) => !outsideReach(reach, userId), unavailable: !reach.membersKnown };
}

/** The 503 for a refusal that only an unreadable member list caused. */
const membersUnavailable = (res) => apiError(res, 503, MEMBERS_UNAVAILABLE, "Die Mitgliederliste von Discord ist gerade nicht erreichbar.");

/**
 * The server a channel (or thread) of the bot belongs to, from the bot's cache: "" for a
 * channel the bot does not see or while it is offline - a caller then reaches it only as a
 * full admin (fail closed).
 */
function guildOfChannel(channelId) {
    const id = str(channelId);
    if (!id) return "";
    // required here, not at the top: discord.js pulls in much of the bot
    const client = require("../../services/discord/discord").getClient();
    const cache = client && client.channels && client.channels.cache;
    const channel = cache && typeof cache.get === "function" ? cache.get(id) : null;
    if (!channel) return "";
    return str(channel.guildId || (channel.guild && channel.guild.id));
}

/**
 * Whether `user` may act on a Discord channel from this request (#925): a full admin on
 * every channel, everybody else on channels of the active server only.
 */
function mayUseChannel(user, req, channelId) {
    if (user && user.isAdmin) return true;
    return mayUseServer(user, req, guildOfChannel(channelId));
}

/**
 * Whether a category's fixed message may go into this channel: a category's messages stay on
 * its own server, for a full admin too. True while the bot cannot name both servers - posting
 * then fails on its own if the channel is out of reach.
 */
function channelOnCategoryServer(categoryId, channelId) {
    const category = guildOfChannel(categoryId);
    const channel = guildOfChannel(channelId);
    return !category || !channel || category === channel;
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

module.exports = { serverFromQuery, mayUseServer, mayUseLink, onlyByRank, rolesCountForSharedData, mayWriteSharedData, raiderReachFor, visibleRaidersFor, outsideReach, takeInLimit, membersUnavailable, MEMBERS_UNAVAILABLE, OUTSIDE_SERVER, mayUseChannel, channelOnCategoryServer, guildOfChannel, OTHER_SERVER, CHANNEL_OTHER_SERVER };
