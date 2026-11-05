// The Twitch streamers of the active server (settings page, docs/twitch.md): read the
// list with its status, add, change, remove, "Jetzt prüfen", decide raiders' requests.
// Always the server active in the session, never one named by the request: a tab that
// loaded another server gets 409, a login or request this server does not have 404, a
// channel or role of another server 403. The raider's own side: roster/profileTwitch.js.
//
// The credentials are not this file's: PATCH /api/settings shows and writes them, full
// admins only (CREDENTIAL_KEYS in apiRoutes/system/settings.js). This answer says only yes
// or no about them, to everybody with the settings area: the page's status needs it.
const { ok, error } = require("../../http/apiResponse");
const { withUser } = require("../../http/apiHandler");
const { activeGuildFor } = require("../../http/activeGuild");
const { mayUseChannel, guildOfChannel, OTHER_SERVER } = require("../../http/serverQuery");
const { getConfig, saveConfig } = require("../../../stores/settings/settingsStore");
const { serverSettingGuildIds } = require("../../../stores/settings/configSchema");
const discord = require("../../../services/discord/discord");
const {
    MAX_STREAMERS_PER_SERVER, MAX_TEXT_LENGTH, MAX_GAME_FILTERS, MAX_GAME_NAME_LENGTH,
    TwitchSettingsError, parseLogin, twitchStreamersOf, twitchStreamersFromBody,
} = require("../../../services/twitch/twitchSettings");
const { runTwitchCheck, twitchStatusOf, lastTwitchRun } = require("../../../services/twitch/twitchJob");
const {
    openRequests, openRequestOf, rejectRequest, markApproved, removeStreamer,
} = require("../../../services/twitch/twitchRequests");

const str = (v) => (v === undefined || v === null ? "" : String(v)).trim();

const LIMITS = {
    streamers: MAX_STREAMERS_PER_SERVER,
    textLength: MAX_TEXT_LENGTH,
    games: MAX_GAME_FILTERS,
    gameNameLength: MAX_GAME_NAME_LENGTH,
};

/** The fields of the form; `source` and anything else a body carries stay out. */
const FORM_FIELDS = ["channelId", "roleId", "text", "games"];

function view(guildId, config = getConfig()) {
    const streamers = twitchStreamersOf(guildId, { config });
    const status = new Map(twitchStatusOf(streamers.map((e) => ({ guildId, ...e }))).map((s) => [s.login, s]));
    const { clientId, clientSecret } = config.twitch || {};
    return {
        guildId,
        hasCredentials: !!(clientId && clientSecret),
        mention: discord.mentionInfoIn(guildId),
        lastRun: lastTwitchRun(),
        limits: LIMITS,
        streamers: streamers.map((entry) => {
            const entryStatus = { ...status.get(entry.login) };
            delete entryStatus.login;
            return { ...entry, status: entryStatus };
        }),
        requests: openRequests(guildId).map(({ userId, userName, login, requestedAt }) => ({ userId, userName, login, requestedAt })),
    };
}

/** The active server of a write, or null after the refusal was sent. */
function writeTarget(body, req, res) {
    const guildId = str(activeGuildFor(req));
    if (!guildId) {
        error(res, 400, "no_active_server", "Kein aktiver Server gewählt.");
        return null;
    }
    if (str(body.serverSettingsGuildId) !== guildId) {
        error(res, 409, "server_switched", "Der aktive Server wurde inzwischen gewechselt. Bitte die Seite neu laden.");
        return null;
    }
    const config = getConfig();
    // normalizeServerSettings drops the block of a server of no list: refused instead of "saved"
    if (!serverSettingGuildIds(config.discordServers, config.guildId).has(guildId)) {
        error(res, 400, "unknown_server", "Dieser Server steht nicht in der Serverliste.");
        return null;
    }
    return { guildId, config };
}

/**
 * Whether the channel may be used on this server: everybody needs it on this server;
 * a full admin also reaches one the bot does not see (bot offline), but none it knows
 * on another server, postPayload would refuse that with wrong_guild at every stream.
 */
function channelAllowed(user, req, guildId, channelId) {
    if (!mayUseChannel(user, req, channelId)) return false;
    const owner = guildOfChannel(channelId);
    return !owner || owner === guildId;
}

/** The same for a role, against the bot's role list of this server (fail closed). */
function roleAllowed(user, guildId, roleId) {
    if (discord.listRoles(guildId).some((role) => role.id === roleId)) return true;
    if (!user.isAdmin) return false;
    return !discord.findRolesAnywhere([roleId])[roleId];
}

/**
 * Check what changes against the server and answer false after a refusal. An unchanged
 * channel or role is not checked again: a role deleted long ago must not block a new text.
 */
function targetsAllowed({ user, req, res, guildId }, next, before) {
    if (next.channelId !== (before && before.channelId)) {
        if (!channelAllowed(user, req, guildId, next.channelId)) {
            error(res, 403, "other_server", OTHER_SERVER);
            return false;
        }
        if (discord.isNonTextChannel(next.channelId)) {
            error(res, 400, "invalid_channel", "In diesen Kanal kann der Bot nichts posten. Bitte einen Textkanal wählen.");
            return false;
        }
    }
    if (!next.roleId || next.roleId === (before && before.roleId)) return true;
    // the id of the server is its @everyone role: never a ping target, not even for a full admin
    if (next.roleId === guildId) {
        error(res, 400, "invalid_role", "@everyone kann nicht gepingt werden.");
        return false;
    }
    if (!roleAllowed(user, guildId, next.roleId)) {
        error(res, 403, "other_server", OTHER_SERVER);
        return false;
    }
    return true;
}

/** Check the whole list and store it; a TwitchSettingsError becomes a 400 with its code. */
function saveList({ guildId, config, res }, list, current, pick) {
    let checked;
    try {
        checked = twitchStreamersFromBody(list, { current });
    } catch (e) {
        if (!(e instanceof TwitchSettingsError)) throw e;
        error(res, 400, e.code, e.message);
        return null;
    }
    if (!pick(checked)) return null;
    const saved = saveConfig({ serverSettings: { [guildId]: { twitchStreamers: checked } } });
    return view(guildId, saved || config);
}

function formOf(body) {
    const out = {};
    for (const key of FORM_FIELDS) if (body[key] !== undefined) out[key] = body[key];
    return out;
}

/** GET /api/settings/twitch - list and status of the active server. */
const getStreamers = withUser({}, async ({ req, res }) => {
    const guildId = str(activeGuildFor(req));
    if (!guildId) return error(res, 400, "no_active_server", "Kein aktiver Server gewählt.");
    ok(res, view(guildId));
});

/** POST /api/settings/twitch - add one streamer: name or channel link, channel, optional role, text, games. */
const postStreamer = withUser({ csrf: true, body: true }, async ({ user, body, req, res }) => {
    const target = writeTarget(body, req, res);
    if (!target) return undefined;
    const { guildId, config } = target;
    const current = twitchStreamersOf(guildId, { config });
    const result = saveList({ guildId, config, res }, [...current, { login: body.login, ...formOf(body) }], current, (list) => (
        targetsAllowed({ user, req, res, guildId }, list[list.length - 1], null)
    ));
    if (result) ok(res, result);
    return undefined;
});

/** PUT /api/settings/twitch - change one streamer of this server; a field left out stays. */
const putStreamer = withUser({ csrf: true, body: true }, async ({ user, body, req, res }) => {
    const target = writeTarget(body, req, res);
    if (!target) return undefined;
    const { guildId, config } = target;
    const login = parseLogin(body.login);
    const current = twitchStreamersOf(guildId, { config });
    const before = current.find((e) => e.login === login);
    if (!before) return error(res, 404, "not_found", "Diesen Streamer gibt es auf diesem Server nicht.");
    const list = current.map((e) => (e.login === login ? { ...e, ...formOf(body) } : e));
    const result = saveList({ guildId, config, res }, list, current, (checked) => (
        targetsAllowed({ user, req, res, guildId }, checked.find((e) => e.login === login), before)
    ));
    if (result) ok(res, result);
    return undefined;
});

/**
 * DELETE /api/settings/twitch - remove one streamer of this server. A running message
 * is ended by the next check, which finds its state without an entry and keeps it as a
 * tombstone until the stream is over: put back in the same stream, nobody is pinged twice.
 */
const deleteStreamer = withUser({ csrf: true, body: true }, async ({ body, req, res }) => {
    const target = writeTarget(body, req, res);
    if (!target) return undefined;
    const { guildId, config } = target;
    const login = parseLogin(body.login);
    const current = twitchStreamersOf(guildId, { config });
    if (!current.some((e) => e.login === login)) {
        return error(res, 404, "not_found", "Diesen Streamer gibt es auf diesem Server nicht.");
    }
    ok(res, view(guildId, removeStreamer(guildId, login, { config })));
    return undefined;
});

/**
 * The open request a decision is about, or null after the refusal was sent. The body's
 * `login` is the name the orga saw: a raider may have withdrawn and asked again with another
 * one meanwhile, and nobody decides about a name they never saw. It is only compared, the
 * entry's login always comes from the request.
 */
function requestToDecide(guildId, body, res) {
    const request = openRequestOf(guildId, str(body.userId));
    if (!request) {
        error(res, 404, "not_found", "Diese Anfrage gibt es auf diesem Server nicht.");
        return null;
    }
    if (parseLogin(body.login) !== request.login) {
        error(res, 409, "request_changed", "Diese Anfrage hat sich geändert. Bitte neu prüfen.");
        return null;
    }
    return request;
}

/**
 * POST /api/settings/twitch/requests/approve - give a raider's open request its entry: the
 * login is the request's, channel, role, text and games are the orga's, `source` is fixed
 * here. Refused (a changed request, a full list, a login listed meanwhile) the request stays
 * open. The record is written before the list: should the list fail then, the raider's status
 * is "none" and they ask again; the other way round they would be announced with no way off.
 */
const approveRequest = withUser({ csrf: true, body: true }, async ({ user, body, req, res }) => {
    const target = writeTarget(body, req, res);
    if (!target) return undefined;
    const { guildId, config } = target;
    const request = requestToDecide(guildId, body, res);
    if (!request) return undefined;
    const current = twitchStreamersOf(guildId, { config });
    if (current.length >= MAX_STREAMERS_PER_SERVER) {
        return error(res, 409, "too_many", `Höchstens ${MAX_STREAMERS_PER_SERVER} Streamer je Server.`);
    }
    if (current.some((e) => e.login === request.login)) {
        return error(res, 409, "duplicate_streamer", `${request.login} steht schon in der Liste.`);
    }
    const saved = saveList({ guildId, config, res }, [...current, { ...formOf(body), login: request.login }], current, (list) => {
        const entry = list[list.length - 1];
        if (!targetsAllowed({ user, req, res, guildId }, entry, null)) return false;
        entry.source = "raider";
        markApproved(request);
        return true;
    });
    if (saved) ok(res, saved);
    return undefined;
});

/** POST /api/settings/twitch/requests/reject - say no to an open request of this server. */
const postRejectRequest = withUser({ csrf: true, body: true }, async ({ body, req, res }) => {
    const target = writeTarget(body, req, res);
    if (!target) return undefined;
    const request = requestToDecide(target.guildId, body, res);
    if (!request) return undefined;
    rejectRequest(target.guildId, request.userId);
    ok(res, view(target.guildId, target.config));
    return undefined;
});

/**
 * POST /api/settings/twitch/check - "Jetzt prüfen": the streamers of the active server,
 * now, on a test instance as well. That Twitch did not answer is an answer, not a failure.
 */
const postCheck = withUser({ csrf: true, body: true }, async ({ body, req, res }) => {
    const target = writeTarget(body, req, res);
    if (!target) return undefined;
    const result = await runTwitchCheck({ guildId: target.guildId });
    ok(res, { result, ...view(target.guildId) });
    return undefined;
});

const routes = [
    { method: "GET", path: "/api/settings/twitch", handler: getStreamers, area: "settings" },
    { method: "POST", path: "/api/settings/twitch", handler: postStreamer, area: "settings" },
    { method: "PUT", path: "/api/settings/twitch", handler: putStreamer, area: "settings" },
    { method: "DELETE", path: "/api/settings/twitch", handler: deleteStreamer, area: "settings" },
    { method: "POST", path: "/api/settings/twitch/check", handler: postCheck, area: "settings" },
    { method: "POST", path: "/api/settings/twitch/requests/approve", handler: approveRequest, area: "settings" },
    { method: "POST", path: "/api/settings/twitch/requests/reject", handler: postRejectRequest, area: "settings" },
];

module.exports = { getStreamers, postStreamer, putStreamer, deleteStreamer, postCheck, approveRequest, postRejectRequest, routes };
