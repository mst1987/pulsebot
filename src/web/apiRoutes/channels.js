const { ok, error } = require("../apiResponse");
const { requireAdmin, requireCsrf } = require("../apiMiddleware");
const { readJsonBody } = require("../apiBody");
const { activeGuildFor } = require("../activeGuild");
const discord = require("../discord");

/** GET /api/channels — the active guild's categories + channels (for the create/duplicate forms). */
function getChannels(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const guildId = activeGuildFor(req);
    ok(res, {
        categories: discord.listCategories(guildId),
        channels: discord.listAllChannels(guildId),
        activeGuildId: guildId,
    });
}

/** POST /api/channels — create a channel in the active guild. Body: { name, type, parentId }. */
async function createChannel(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const guildId = activeGuildFor(req);
    if (!guildId) return error(res, 400, "no_guild", "Kein Server gewählt.");
    const body = await readJsonBody(req);
    try {
        const created = await discord.createChannel(guildId, {
            name: String(body.name || "").trim(),
            type: String(body.type || "text").trim(),
            parentId: String(body.parentId || "").trim(),
        });
        ok(res, created, 201);
    } catch (e) {
        error(res, 400, "create_failed", e.message || "Kanal konnte nicht erstellt werden.");
    }
}

/** POST /api/channels/duplicate — clone a channel. Body: { channelId, name }. */
async function duplicateChannel(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const channelId = String(body.channelId || "").trim();
    if (!channelId) return error(res, 400, "no_channel", "Kein Kanal gewählt.");
    try {
        const created = await discord.duplicateChannel(channelId, String(body.name || "").trim());
        ok(res, created, 201);
    } catch (e) {
        error(res, 400, "duplicate_failed", e.message || "Kanal konnte nicht dupliziert werden.");
    }
}

module.exports = { getChannels, createChannel, duplicateChannel };
