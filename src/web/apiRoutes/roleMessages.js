// Rollen-Nachrichten (self-service roles): a message with a title, a text, a big picture
// and one button plus one reaction per role; a click or a reaction gives or takes the
// role (services/discord/roleMessages.js, docs/role-messages.md). Area `channels`:
// GET reads, POST/PUT/DELETE write (the area gate in apiAccess.js).
//
// GET    /api/role-messages
//        → { data: { messages: [Entry], limits: { roles, reactions, title, body, label } } }
//          Entry = { id, guildId, channelId, messageId, url,
//                    title, body, imageUrl, color: number|null,
//                    roles: [{ roleId, emoji, label }], createdBy, createdAt, updatedAt }
//          url: the Discord link of the message ("" while not posted); guildId: the server
//          (an entry from before #895 with only guildSide: the talk server resp. the first server)
//
// GET    /api/role-messages/options?guildId=<one of the servers>   (none: the first server)
//        → { data: { guildId, online, manageRoles: boolean|null,
//                    roles: [{ id, name, color, managed, ..., privileged: string, editable: boolean }],
//                    channels: [{ id, name, category, parentId, canReact: boolean|null }],
//                    emojis: [{ id, name, animated, code, url }] } }
//          privileged: "" = may be handed out, else the reason why not (English, as logged);
//          editable: the bot sits above the role (and it is no integration role);
//          canReact: the bot may add reactions and read the history there (null = unknown);
//          emojis[].code is what goes into roles[].emoji ("<:name:id>"); offline: empty lists
//
// POST   /api/role-messages
//        body { guildId, channelId, title, body?, imageUrl?, color?, roles: [{ roleId, emoji?, label? }] }
//        → 201 { data: { entry: Entry, url, warnings: [string] } }   posted with its reactions
//
// PUT    /api/role-messages
//        body { id, ...as POST }  (the whole message, not a patch)
//        → { data: { entry: Entry, url, warnings: [string], reposted: boolean } }
//          another channel or server (or the old message gone): posted anew, the old one deleted
//
// DELETE /api/role-messages   body { id } or ?id=
//        → { data: { id, messageDeleted: boolean } }   the entry goes even when the message is gone
//
// Errors: { error: { code, message, roleId?, reason? } } with the HTTP status of the check —
// 400 unknown_guild (not in the server list), no_guild, unknown_channel, missing_title, bad_image, no_roles, too_many_roles,
// too_many_reactions, duplicate_role, unknown_role, bad_emoji, unknown_emoji, duplicate_emoji,
// privileged_role (roleId + reason: the role carries rights), role_unusable (roleId + reason:
// the bot cannot hand it out); 404 not_found; 502 post_failed, edit_failed; 503 bot_offline.
// `message` is German and meant to be shown as it is; warnings (a reaction that could not
// be set) do not fail the save.
const { ok, sendJson, error: apiError } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { getConfig } = require("../../stores/configStore");
const store = require("../../stores/roleMessageStore");
const roleMessages = require("../../services/discord/roleMessages");
const linkCheck = require("../../services/discord/linkCheck");
const { serverFromQuery } = require("../http/serverQuery");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/** An entry as the page reads it: with its server and the link to the message. */
function entryView(entry, config = getConfig()) {
    const rest = { ...entry };
    delete rest.guildSide; // legacy (before #895): the client only knows guildId
    const guildId = roleMessages.guildIdOf(entry, config) || "";
    const url = guildId && entry.messageId ? linkCheck.messageLink(guildId, entry.channelId, entry.messageId) || "" : "";
    return { ...rest, guildId, url };
}

/** A failed check or Discord call as the JSON error, with the role and the reason where there is one. */
function sendFailure(res, e) {
    if (!e || !e.code || !e.status) throw e;
    const details = e.details || {};
    const out = { code: e.code, message: e.message };
    if (details.roleId) out.roleId = details.roleId;
    if (details.reason) out.reason = details.reason;
    sendJson(res, e.status, { error: out });
}

/** The result of a create/update, its entry with server and link. */
function resultView(result) {
    const entry = entryView(result.entry);
    return { ...result, entry, url: result.url || entry.url };
}

/** GET /api/role-messages */
const listMessages = withUser(async ({ res }) => {
    const config = getConfig();
    ok(res, { messages: store.listMessages().map((m) => entryView(m, config)), limits: roleMessages.LIMITS });
});

/** GET /api/role-messages/options?guildId= */
const getOptions = withUser(async ({ query, res }) => {
    const guildId = serverFromQuery(query, res);
    if (guildId === null) return undefined;
    ok(res, roleMessages.roleMessageOptions(guildId));
    return undefined;
});

/** POST /api/role-messages — create and post. */
const createMessage = withUser({ csrf: true, body: true }, async ({ user, body, res }) => {
    try {
        const result = await roleMessages.createRoleMessage(body, { userId: user.id });
        ok(res, resultView(result), 201);
    } catch (e) {
        sendFailure(res, e);
    }
});

/** PUT /api/role-messages — change (edit in place or post anew). */
const updateMessage = withUser({ csrf: true, body: true }, async ({ body, res }) => {
    const id = str(body.id);
    if (!id) return apiError(res, 400, "missing_id", "Welche Rollen-Nachricht? Die id fehlt.");
    try {
        const result = await roleMessages.updateRoleMessage(id, body);
        ok(res, resultView(result));
    } catch (e) {
        sendFailure(res, e);
    }
    return undefined;
});

/** DELETE /api/role-messages — delete the message and the entry. */
const deleteMessage = withUser({ csrf: true, body: true }, async ({ body, query, res }) => {
    const id = str(body.id) || str(query.get("id"));
    if (!id) return apiError(res, 400, "missing_id", "Welche Rollen-Nachricht? Die id fehlt.");
    try {
        ok(res, await roleMessages.deleteRoleMessage(id));
    } catch (e) {
        sendFailure(res, e);
    }
    return undefined;
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/role-messages", handler: listMessages, area: "channels" },
    { method: "GET", path: "/api/role-messages/options", handler: getOptions, area: "channels" },
    { method: "POST", path: "/api/role-messages", handler: createMessage, area: "channels" },
    { method: "PUT", path: "/api/role-messages", handler: updateMessage, area: "channels" },
    { method: "DELETE", path: "/api/role-messages", handler: deleteMessage, area: "channels" },
];

module.exports = { routes, entryView };
