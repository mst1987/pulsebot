const auth = require("../auth");
const discord = require("../discord");
const { guildRole } = require("../guildRoles");
const { activeGuildFor } = require("../activeGuild");
const { ok, error } = require("../apiResponse");
const { requireAdmin, requireCsrf } = require("../apiMiddleware");
const { readJsonBody } = require("../apiBody");
const userPrefs = require("../userPrefsStore");
const { AREAS, emptyAccess, fullAccess, userHasMenuAccess } = require("../../config/permissions");

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
async function postActiveGuild(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const guildId = String(body.guildId || "").trim();
    if (guildId && !discord.listGuilds().some((g) => g.id === guildId)) {
        return error(res, 400, "unknown_guild", "Unbekannter Server.");
    }
    auth.setActiveGuild(req, guildId);
    ok(res, { activeGuildId: guildId });
}

/**
 * POST /api/session/lang — remember the menu language for the caller's own
 * account, so it follows them to another device. Body: { lang: "de" | "en" }.
 */
async function postLang(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const result = userPrefs.setLang(user.id, body.lang);
    if (result.code) return error(res, 400, result.code, "Unbekannte Sprache.");
    ok(res, { lang: result.lang });
}

module.exports = { getSession, postActiveGuild, postLang };
