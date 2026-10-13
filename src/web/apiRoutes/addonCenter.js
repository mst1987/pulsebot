// Einstellungen → Module → Addons, "Downloadzentrale im Discord": the settings of
// the addon download centre (services/addons/addonCenter.js) and the message itself.
// Full admins only, like the addon list it shows (docs/addons.md, "Wer darf was") —
// its own store and routes, so nothing here goes near PATCH /api/settings and the
// addon list's guards.
//
// GET    /api/addon-center   settings, the posted centre, the last check, the channels (with
//                            the game version their category plays), the roles per server, the
//                            selectable game versions and the one "automatic" means for the channel
// PUT    /api/addon-center   body { channelId?, roleId?, announce?, versionId? } — saved at once; another
//                            channel moves a posted centre there, another role or game version redraws it
// POST   /api/addon-center   post the centre (again: the old message is deleted)
// DELETE /api/addon-center   take it down
const { ok, error: apiError } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { getConfig } = require("../../stores/configStore");
const store = require("../../stores/addonCenterStore");
const addonCenter = require("../../services/addons/addonCenter");
const discord = require("../../services/discord/discord");
const guildRoles = require("../../services/discord/guildRoles");
const linkCheck = require("../../services/discord/linkCheck");
const { mainVersionFor, isVersionVisible, visibleVersions } = require("../../services/events/mainVersion");
const { versionLabel } = require("../../services/events/versionSettings");

function centerView(center) {
    if (!center) return null;
    return {
        channelId: center.channelId,
        postedAt: center.postedAt,
        url: center.url || linkCheck.messageLink(center.guildId, center.channelId, center.messageId) || "",
    };
}

/** The version a category plays, a hidden one counts as the main version (as the centre reads it). */
function categoryVersionOf(categoryId, config) {
    const wanted = mainVersionFor({ categoryId, config });
    return isVersionVisible(wanted, config) ? wanted : mainVersionFor({ config });
}

/** The text channels of every configured server, each named with the game version its category plays. */
function channelsOf(config) {
    try {
        const guildIds = guildRoles.configuredGuildIds(config);
        const names = new Map((discord.listGuilds() || []).map((g) => [g.id, g.name]));
        return guildIds.flatMap((guildId) => (discord.listTextChannels(guildId) || []).map((c) => {
            const versionId = categoryVersionOf(c.parentId, config);
            return {
                id: c.id,
                name: c.name,
                guildId,
                category: [guildIds.length > 1 ? names.get(guildId) || "" : "", versionLabel(versionId)].filter(Boolean).join(" · "),
            };
        }));
    } catch (e) {
        console.warn("addon centre channels failed:", e.message);
        return [];
    }
}

/** The game versions the centre can be set to: the visible ones, id and label. */
function versionsOf(config) {
    return visibleVersions(config).map((id) => ({ id, label: versionLabel(id) }));
}

/** What "automatic" means for the chosen channel: its category's version, null without a (known) channel. */
function autoVersionOf(config, channelId) {
    if (!channelId) return null;
    try {
        for (const guildId of guildRoles.configuredGuildIds(config)) {
            const channel = (discord.listTextChannels(guildId) || []).find((c) => c.id === channelId);
            if (channel) {
                const id = categoryVersionOf(channel.parentId, config);
                return { id, label: versionLabel(id) };
            }
        }
    } catch (e) {
        console.warn("addon centre auto version failed:", e.message);
    }
    return null;
}

/** The roles of every configured server (the update role lives on the centre's server). */
function rolesOf(config) {
    const out = {};
    try {
        for (const guildId of guildRoles.configuredGuildIds(config)) out[guildId] = discord.listRoles(guildId) || [];
    } catch (e) {
        console.warn("addon centre roles failed:", e.message);
    }
    return out;
}

function view() {
    const config = getConfig();
    const settings = store.getSettings();
    return {
        settings,
        center: centerView(store.getCenter()),
        checkedAt: store.getCheckedAt(),
        online: discord.isOnline(),
        channels: channelsOf(config),
        roles: rolesOf(config),
        versions: versionsOf(config),
        autoVersion: autoVersionOf(config, settings.channelId),
    };
}

/** GET /api/addon-center */
const getCenter = withUser({ full: true }, async ({ res }) => {
    ok(res, view());
});

/** PUT /api/addon-center — the settings, saved at once. */
const putSettings = withUser({ full: true, csrf: true, body: true }, async ({ user, body, res }) => {
    const patch = {};
    for (const key of ["channelId", "roleId", "versionId"]) if (body[key] !== undefined) patch[key] = String(body[key] === null ? "" : body[key]);
    if (body.announce !== undefined) patch.announce = body.announce === true;
    const result = await addonCenter.saveSettings(patch, { by: user.id });
    if (result.error && !result.settings) return apiError(res, 400, "bad_request", result.error);
    ok(res, { ...view(), ...(result.error ? { warning: result.error } : {}) });
});

/** POST /api/addon-center — post the centre (again). */
const postCenter = withUser({ full: true, csrf: true }, async ({ user, res }) => {
    const result = await addonCenter.postCenter({ by: user.id });
    if (result.error) return apiError(res, 400, "bad_request", result.error);
    ok(res, view());
});

/** DELETE /api/addon-center — take it down. */
const deleteCenter = withUser({ full: true, csrf: true }, async ({ res }) => {
    const removed = await addonCenter.removeCenter();
    if (!removed) return apiError(res, 404, "not_found", "Die Downloadzentrale ist nicht gepostet.");
    ok(res, view());
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/addon-center", handler: getCenter, adminOnly: true },
    { method: "PUT", path: "/api/addon-center", handler: putSettings, adminOnly: true },
    { method: "POST", path: "/api/addon-center", handler: postCenter, adminOnly: true },
    { method: "DELETE", path: "/api/addon-center", handler: deleteCenter, adminOnly: true },
];

module.exports = { routes, channelsOf, rolesOf, versionsOf, autoVersionOf };
