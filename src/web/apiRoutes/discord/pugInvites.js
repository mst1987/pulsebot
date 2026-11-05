// Einstellungen → Verbindungen → Discord-Server: the bot's invites per link
// and where members came from (#905, services/discord/pug/pugInvites.js). Full
// admins, and the server-admin rank for its own server: a link only with the rank
// on both ends (docs/permissions.md).
const { ok, error } = require("../../http/apiResponse");
const { withUser } = require("../../http/apiHandler");
const guildRoles = require("../../../services/discord/roles/guildRoles");
const discord = require("../../../services/discord/discord");
const pugInvites = require("../../../services/discord/pug/pugInvites");
const { OTHER_SERVER, mayUseLink, mayUseServer } = require("../../http/serverQuery");
const inviteStore = require("../../../stores/discord/discordInviteStore");

/** How long the page waits for the check against Discord before it answers anyway. */
const RECONCILE_WAIT_MS = 5000;

/** Run the invite check, but never longer than `ms`: a slow Discord must not hang the page. */
function reconcileBriefly(ms = RECONCILE_WAIT_MS) {
    let timer;
    const timeout = new Promise((resolve) => {
        timer = setTimeout(resolve, ms);
        if (timer.unref) timer.unref();
    });
    const check = Promise.resolve()
        .then(() => pugInvites.reconcileInvites())
        .catch(() => {});
    return Promise.race([check, timeout]).finally(() => clearTimeout(timer));
}

/** The overview as far as `user` reaches: the rank sees its server and the links it holds on both ends. */
function overviewFor(user, req) {
    const overview = pugInvites.inviteOverview();
    if (user.isAdmin) return overview;
    return {
        links: overview.links.filter((link) => mayUseLink(user, req, link.from, link.to)),
        servers: overview.servers.filter((server) => mayUseServer(user, req, server.guildId)),
    };
}

/**
 * GET /api/settings/pug-invites — `{ links, servers }`: every link with its
 * invite URL, error, "deleted", "joined" and "signedUp"; every server with its
 * general invite and the channel its invites point at. Checks the invites
 * against Discord first (one deleted by hand shows as deleted); that check goes over
 * every server, so the rank gets the state of the last regular check instead.
 */
const getPugInvites = withUser({ serverAdmin: true }, async ({ user, req, res }) => {
    if (user.isAdmin) await reconcileBriefly();
    ok(res, overviewFor(user, req));
});

/**
 * POST /api/settings/pug-invites — body: { key | guildId, regenerate? }.
 * Creates the invite of the link `key` ("from:to") or the general invite of
 * `guildId` when it has none; `regenerate` replaces it and deletes the old one.
 */
const postPugInvite = withUser({ serverAdmin: true, csrf: true, body: true }, async ({ user, req, body, res }) => {
    const key = String(body.key || "").trim();
    const guildId = String(body.guildId || "").trim();
    const regenerate = body.regenerate === true;
    if (key) {
        const link = guildRoles.links().find((l) => `${l.from}:${l.to}` === key);
        if (!link) return error(res, 400, "unknown_link", "Diese Verknüpfung gibt es nicht.");
        if (!mayUseLink(user, req, link.from, link.to)) return error(res, 403, "other_server", OTHER_SERVER);
        if (regenerate) await pugInvites.regenerateLinkInvite(key);
        else await pugInvites.ensureLinkInvite(key);
    } else if (guildId) {
        if (!mayUseServer(user, req, guildId)) return error(res, 403, "other_server", OTHER_SERVER);
        if (!guildRoles.serverIds().includes(guildId)) return error(res, 400, "unknown_server", "Dieser Server ist nicht eingetragen.");
        if (regenerate) await pugInvites.regenerateGeneralInvite(guildId);
        else await pugInvites.ensureGeneralInvite(guildId);
    } else {
        return error(res, 400, "key", "Keine Verknüpfung und kein Server angegeben.");
    }
    ok(res, overviewFor(user, req));
});

/**
 * POST /api/settings/pug-invites/channel — body: { guildId, channelId }.
 * The channel new invites of that server point at ("" = the bot picks one).
 * Invites already made keep their channel until they are created again.
 */
const postInviteChannel = withUser({ serverAdmin: true, csrf: true, body: true }, async ({ user, req, body, res }) => {
    const guildId = String(body.guildId || "").trim();
    const channelId = String(body.channelId || "").trim();
    if (!mayUseServer(user, req, guildId)) return error(res, 403, "other_server", OTHER_SERVER);
    if (!guildRoles.serverIds().includes(guildId)) return error(res, 400, "unknown_server", "Dieser Server ist nicht eingetragen.");
    if (channelId && !discord.listTextChannels(guildId).some((c) => c.id === channelId)) {
        return error(res, 400, "channel", "Diesen Textkanal gibt es auf dem Server nicht.");
    }
    inviteStore.setInviteChannel(guildId, channelId);
    ok(res, overviewFor(user, req));
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/settings/pug-invites", handler: getPugInvites, area: "settings" },
    { method: "POST", path: "/api/settings/pug-invites", handler: postPugInvite, area: "settings" },
    { method: "POST", path: "/api/settings/pug-invites/channel", handler: postInviteChannel, area: "settings" },
];

module.exports = { getPugInvites, postPugInvite, postInviteChannel, reconcileBriefly, routes };
