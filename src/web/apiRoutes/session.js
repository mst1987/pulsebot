const auth = require("../auth");
const discord = require("../discord");
const { activeGuildFor } = require("../activeGuild");
const { ok, error } = require("../apiResponse");
const { requireAdmin, requireCsrf } = require("../apiMiddleware");
const { readJsonBody } = require("../apiBody");

/** GET /api/session — who the caller is (if anyone), their CSRF token, and —
 * for admins — the guilds the bot is in plus which one they're managing. */
function getSession(req, res) {
    const user = auth.getUser(req);
    const isAdmin = !!(user && user.isAdmin);
    ok(res, {
        user: user ? { id: user.id, name: user.name, isAdmin: !!user.isAdmin } : null,
        csrfToken: user ? auth.csrfToken(req) : null,
        guilds: isAdmin ? discord.listGuilds() : [],
        activeGuildId: isAdmin ? activeGuildFor(req) : "",
    });
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

module.exports = { getSession, postActiveGuild };
