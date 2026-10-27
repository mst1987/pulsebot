const auth = require("../http/auth");
const discord = require("../../services/discord/discord");
const { guildRole, serverLabel } = require("../../services/discord/guildRoles");
const { activeGuildFor } = require("../http/activeGuild");
const { ok, error } = require("../http/apiResponse");
const { requireCsrf } = require("../http/apiMiddleware");
const { withUser } = require("../http/apiHandler");
const { readJsonBody } = require("../http/apiBody");
const userPrefs = require("../../stores/userPrefsStore");
const { AREAS, emptyAccess, fullAccess, userHasMenuAccess, userIsOrga, can } = require("../../config/permissions");
const { getConfig } = require("../../stores/settingsStore");
const { guildId: envGuildId } = require("../../config/variables");
const { configForGuild, accessSettings, fullAdminRoleIds } = require("../../services/discord/serverAccess");
const { normalizeRoleIds, MAX_ROLES } = require("../http/viewAs");
const { contentVersions } = require("../../services/events/contentVersions");
const { areaAudience, orgaRoleNames } = require("../http/areaAudience");
const { orgaCategoryIds, requestCache } = require("../../services/roster/categoryOrga");

/** GET /api/session — who the caller is (if anyone), their CSRF token, what the
 * caller may see (per-area access) and — for menu users — the guilds the bot is
 * in plus which one they're managing. */
async function getSession(req, res) {
    const user = auth.getUser(req);
    const hasMenu = userHasMenuAccess(user);
    const orgaCategories = hasMenu ? await orgaCategoriesOf(user, req) : [];
    ok(res, {
        user: user
            ? {
                id: user.id,
                name: user.name,
                // The Discord picture for the menu's user circle (from the login, else the bot's cache); left
                // out when there is none - the circle shows the initial then.
                ...avatarField(user, req),
                isAdmin: !!user.isAdmin,
                // The client hides areas/actions accordingly; the server gates
                // them for real in apiAccess.js.
                // Since #925 `access` is the rights on the active server (`guildId`) only; `allAccess`
                // the rights over every server, for the pages under "Alle Server" (Mein Profil, Addons).
                access: user.isAdmin ? fullAccess() : { ...emptyAccess(), ...(user.access || {}) },
                allAccess: user.isAdmin ? fullAccess() : { ...emptyAccess(), ...(user.allAccess || user.access || {}) },
                // The menu language the account chose ("de" | "en"), left out
                // while it never chose one — the browser's own choice stands then.
                ...langField(user.id),
                // "Ansicht als Rolle" (viewAs.js): which roles the menu shows
                // right now, and whether this account may start such a view.
                ...viewAsFields(req, user),
                // Orga (permissions.userIsOrga): a full admin, or holding one of the orga roles
                // (Einstellungen → Berechtigungen) — sees the orga's parts of the pages.
                isOrga: userIsOrga(user),
                // The categories whose current roster the caller manages (#729, categoryOrga.orgaCategoryIds with
                // `managerOnly`): the orga of those categories - the client shows them the orga's parts there.
                orgaCategories,
                // Who sees each area the caller may open (areaAudience.js): the client marks an area
                // only admins and orga roles open as "Orga-Bereich" and names those orga roles.
                ...audienceFields(user, req),
            }
            : null,
        csrfToken: user ? auth.csrfToken(req) : null,
        areas: AREAS,
        // Each with its role ("event" = one of the servers, "" = none), the switcher's badge.
        guilds: hasMenu ? sessionGuilds() : [],
        activeGuildId: hasMenu ? activeGuildFor(req) : "",
        // The content switch of the menu (#563): main version, whether the others are
        // hidden, and the versions it offers (only those with data or a category).
        content: hasMenu ? contentVersions() : null,
    });
}

/** The category ids the caller is the orga of through a roster; best-effort, [] on failure ("Ansicht als": the viewed roles'). */
async function orgaCategoriesOf(user, req) {
    try {
        return await orgaCategoryIds(user, { managerOnly: true, cache: requestCache(req) });
    } catch {
        return [];
    }
}

/**
 * `{ audience, orgaRoles }`: areaAudience() for the areas the caller may open (a full admin: all
 * of them), and the names of the orga roles (the orga zones name them). Best-effort: empty on failure.
 */
function audienceFields(user, req) {
    try {
        const guildId = permissionGuildId(req);
        // the rights settings of the active server (#925); the full-admin roles count everywhere
        const config = configForGuild(getConfig(), guildId);
        const admins = fullAdminRoleIds(config);
        let roles = [];
        try {
            roles = (guildId && discord.listRoles(guildId)) || [];
        } catch {
            roles = [];
        }
        const merged = { ...config, adminRoleIds: admins };
        const all = areaAudience(merged, roles);
        const access = user.isAdmin ? fullAccess() : (user.access || {});
        return {
            audience: Object.fromEntries(Object.entries(all).filter(([area]) => can(access, area, "read"))),
            orgaRoles: orgaRoleNames(merged, roles),
        };
    } catch {
        return { audience: {}, orgaRoles: [] };
    }
}

function avatarField(user, req) {
    const avatarUrl = user.avatarUrl || discord.avatarUrlFor(activeGuildFor(req) || envGuildId, user.id);
    return avatarUrl ? { avatarUrl } : {};
}

function langField(userId) {
    const lang = userPrefs.getLang(userId);
    return lang ? { lang } : {};
}

/**
 * The servers the bot is on, each tagged with its role, its own label (#895)
 * from the settings and its Discord icon (empty → the client's crest).
 */
function sessionGuilds() {
    return discord.listGuilds().map((g) => ({ ...g, role: guildRole(g.id), label: serverLabel(g.id), iconUrl: discord.guildIconUrl(g.id) }));
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

/**
 * The server whose roles carry the menu rights: the active server (#925) - its
 * Einstellungen > Berechtigungen decide what a role there may open.
 */
function permissionGuildId(req) {
    return String(activeGuildFor(req) || "");
}

/** The roles of the active server, each marked admin role / with permissions of its own there. */
function viewAsRoles(req) {
    const guildId = permissionGuildId(req);
    if (!guildId) return [];
    const config = getConfig();
    const adminIds = new Set(fullAdminRoleIds(config).map(String));
    const perms = accessSettings(guildId, config).rolePermissions;
    return (discord.listRoles(guildId) || []).map((r) => ({
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
        const names = new Map(viewAsRoles(req).map((r) => [r.id, r.name]));
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
    ok(res, { roles: viewAsRoles(req), maxRoles: MAX_ROLES });
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
    const known = new Set(viewAsRoles(req).map((r) => r.id));
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
