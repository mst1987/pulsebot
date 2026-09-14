const { ok, error } = require("../apiResponse");
const { requireAdmin, requireCsrf } = require("../apiMiddleware");
const { readJsonBody } = require("../apiBody");
const { activeGuildFor } = require("../activeGuild");
const discord = require("../discord");
const { getConfig, listRecruitmentPosts } = require("../settingsStore");
const { resolvePurposes, purposeSummary } = require("../channelPurposes");

/** How many tracked recruitment posts sit in each channel of the guild. */
function recruitmentPostsByChannel(guildId) {
    const counts = {};
    for (const post of listRecruitmentPosts() || []) {
        if (guildId && post.guildId && post.guildId !== guildId) continue;
        if (post.channelId) counts[post.channelId] = (counts[post.channelId] || 0) + 1;
    }
    return counts;
}

/**
 * GET /api/channels — the active guild's categories and channels (with the
 * bot's rights per channel), plus what the bot uses which channel for
 * (`purposes`, resolved from the admin config — still stored and edited as
 * settings, see channelPurposes.js) and the recruitment posts per channel.
 */
function getChannels(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const guildId = activeGuildFor(req);
    const categories = discord.listCategories(guildId);
    const channels = discord.listAllChannels(guildId);
    const guild = (discord.listGuilds() || []).find((g) => g.id === guildId);
    // The lists are only live while the bot is connected to this guild; without
    // it every stored channel would read "nicht gefunden".
    const connected = !!guild;
    const purposes = resolvePurposes(getConfig(), channels, categories, connected);
    ok(res, {
        categories,
        channels,
        activeGuildId: guildId,
        guildName: guild ? guild.name : "",
        connected,
        purposes,
        purposeSummary: purposeSummary(purposes),
        recruitmentPosts: recruitmentPostsByChannel(guildId),
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
