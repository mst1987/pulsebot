const auth = require("../http/auth");
const discord = require("../../services/discord/discord");
const { guildRole } = require("../../services/discord/guildRoles");
const { activeGuildFor } = require("../http/activeGuild");
const { ok, error } = require("../http/apiResponse");
const { requireCsrf } = require("../http/apiMiddleware");
const { withUser } = require("../http/apiHandler");
const { readJsonBody } = require("../http/apiBody");
const userPrefs = require("../../stores/userPrefsStore");
const { AREAS, emptyAccess, fullAccess, userHasMenuAccess } = require("../../config/permissions");
const { getConfig } = require("../../stores/settingsStore");
const { guildId: envGuildId, adminRoleIds: envAdminRoleIds } = require("../../config/variables");
const { normalizeRoleIds, MAX_ROLES } = require("../http/viewAs");

/** GET /api/session — who the caller is (if anyone), their CSRF token, what the
 * caller may see (per-area access) and — for menu users — the guilds the bot is
 * in plus which one they're managing. */
function getSession(req, res) {
    const user = auth.getUser(req);
    const hasMenu = userHasMenuAccess(user);
    ok(res, {
        user: user
            ? {
                id: user.id,
                name: user.name,
                isAdmin: !!user.isAdmin,
                // The client hides areas/actions accordingly; the server gates
                // them for real in apiAccess.js.
                access: user.isAdmin ? fullAccess() : { ...emptyAccess(), ...(user.access || {}) },
                // The menu language the account chose ("de" | "en"), left out
                // while it never chose one — the browser's own choice stands then.
                ...langField(user.id),
                // "Ansicht als Rolle" (viewAs.js): which roles the menu shows
                // right now, and whether this account may start such a view.
                ...viewAsFields(req, user),
            }
            : null,
        csrfToken: user ? auth.csrfToken(req) : null,
        areas: AREAS,
        // Each with its fixed role ("event" | "talk" | ""), the switcher's badge.
        guilds: hasMenu ? sessionGuilds() : [],
        activeGuildId: hasMenu ? activeGuildFor(req) : "",
    });
}

function langField(userId) {
    const lang = userPrefs.getLang(userId);
    return lang ? { lang } : {};
}

/** The servers the bot is on, each tagged with its role from the settings. */
function sessionGuilds() {
    return discord.listGuilds().map((g) => ({ ...g, role: guildRole(g.id) }));
}

/** POST /api/session/guild — switch which guild the admin is managing. Body: { guildId }. */
const postActiveGuild = withUser({ csrf: true, body: true }, async ({ body, req, res }) => {
    const guildId = String(body.guildId || "").trim();
    if (guildId && !discord.listGuilds().some((g) => g.id === guildId)) {
        return error(res, 400, "unknown_guild", "Unbekannter Server.");
    }
    auth.setActiveGuild(req, guildId);
    ok(res, { activeGuildId: guildId });
});

/**
 * POST /api/session/lang — remember the menu language for the caller's own
 * account, so it follows them to another device. Body: { lang: "de" | "en" }.
 */
const postLang = withUser({ csrf: true, body: true }, async ({ user, body, res }) => {
    const result = userPrefs.setLang(user.id, body.lang);
    if (result.code) return error(res, 400, result.code, "Unbekannte Sprache.");
    ok(res, { lang: result.lang });
});

// ---- "Ansicht als Rolle" (src/web/http/viewAs.js) --------------------------------

/** The server whose roles carry the menu rights (Einstellungen › Zugang/Berechtigungen). */
function permissionGuildId() {
    return String(getConfig().guildId || envGuildId || "");
}

/** The roles of that server, each marked admin role / with permissions of its own. */
function viewAsRoles() {
    const config = getConfig();
    const adminIds = new Set([...(config.adminRoleIds || []), ...(envAdminRoleIds || [])].map(String));
    const perms = config.rolePermissions || {};
    return discord.listRoles(permissionGuildId()).map((r) => ({
        id: r.id, name: r.name, color: r.color || "",
        admin: adminIds.has(r.id),
        configured: !!perms[r.id] && Object.keys(perms[r.id]).length > 0,
    }));
}

/** `{ canViewAs, viewAs? }` for the session answer. */
function viewAsFields(req, user) {
    const real = auth.getRealUser(req);
    const out = { canViewAs: !!(real && real.isAdmin) };
    if (user.viewAs) {
        const names = new Map(viewAsRoles().map((r) => [r.id, r.name]));
        out.viewAs = {
            roleIds: user.viewAs.roleIds,
            roleNames: user.viewAs.roleIds.map((id) => names.get(id) || id),
            at: user.viewAs.at,
        };
    }
    return out;
}

/**
 * GET /api/session/view-as — the roles a full admin can look at the menu as.
 * Checked against the admin's *own* rights, so it also answers while a view runs.
 */
function getViewAs(req, res) {
    const real = auth.getRealUser(req);
    if (!real) return error(res, 401, "unauthorized", "Nicht angemeldet.");
    if (!real.isAdmin) return error(res, 403, "forbidden", "Nur für Administratoren.");
    ok(res, { roles: viewAsRoles(), maxRoles: MAX_ROLES });
}

/**
 * POST /api/session/view-as — `{ roleIds: [...] }` starts the view as those
 * roles ([] = only the base access every account has), `{ stop: true }` ends
 * it. Starting takes a real full admin; stopping works whatever the viewed role
 * may do, so nobody gets stuck in it.
 */
async function postViewAs(req, res) {
    const real = auth.getRealUser(req);
    if (!real) return error(res, 401, "unauthorized", "Nicht angemeldet.");
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    if (body.stop === true) {
        auth.setViewAs(req, null);
        return ok(res, { viewAs: null });
    }
    if (!real.isAdmin) return error(res, 403, "forbidden", "Nur für Administratoren.");
    const known = new Set(viewAsRoles().map((r) => r.id));
    const roleIds = normalizeRoleIds(body.roleIds).filter((id) => known.has(id));
    auth.setViewAs(req, roleIds);
    ok(res, { viewAs: { roleIds } });
}

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/session", handler: getSession, auth: "none" },
    { method: "POST", path: "/api/session/guild", handler: postActiveGuild, auth: "menu" },
    { method: "POST", path: "/api/session/lang", handler: postLang, auth: "menu" },
    { method: "GET", path: "/api/session/view-as", handler: getViewAs, auth: "none" },
    { method: "POST", path: "/api/session/view-as", handler: postViewAs, auth: "none" },
];

module.exports = { getSession, postActiveGuild, postLang, getViewAs, postViewAs, routes };
