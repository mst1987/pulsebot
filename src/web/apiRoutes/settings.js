const { ok, error } = require("../apiResponse");
const { requireAdmin, requireCsrf } = require("../apiMiddleware");
const { readJsonBody } = require("../apiBody");
const { activeGuildFor } = require("../activeGuild");
const {
    getConfig, saveConfig, listRaidsheets, saveRaidsheet, deleteRaidsheet,
} = require("../settingsStore");
const discord = require("../discord");

const asStringArray = (v) => (Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : []);

/** GET /api/settings — config + raidsheets + the active guild's roles/categories. */
function getSettings(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const guildId = activeGuildFor(req);
    ok(res, {
        config: getConfig(),
        raidsheets: listRaidsheets(),
        roles: discord.listRoles(guildId),
        categories: discord.listCategories(guildId),
        activeGuildId: guildId,
    });
}

/**
 * PATCH /api/settings — merge-updates the admin config. Only keys present in
 * the body are changed (saveConfig() itself merges raidDefaults/blizzard).
 * blizzard.clientSecret: omit to keep the stored secret, send "" to clear it,
 * send a value to replace it (the client only includes it when the admin
 * actually chose to change it — see ChangeSecretField in SettingsPage.tsx).
 */
async function updateSettings(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const partial = {};
    if (body.adminRoleIds !== undefined) partial.adminRoleIds = asStringArray(body.adminRoleIds);
    if (body.officerRoleId !== undefined) partial.officerRoleId = String(body.officerRoleId).trim();
    if (body.applicationChannelId !== undefined) partial.applicationChannelId = String(body.applicationChannelId).trim();
    if (body.highestBidsChannelId !== undefined) partial.highestBidsChannelId = String(body.highestBidsChannelId).trim();
    if (body.highestBidsMessageId !== undefined) partial.highestBidsMessageId = String(body.highestBidsMessageId).trim();
    if (body.categoryIds !== undefined) partial.categoryIds = asStringArray(body.categoryIds);
    if (body.categoryRoles !== undefined && typeof body.categoryRoles === "object") partial.categoryRoles = body.categoryRoles;
    if (body.logChannelIds !== undefined) partial.logChannelIds = asStringArray(body.logChannelIds);
    if (body.raidDefaults !== undefined && typeof body.raidDefaults === "object") partial.raidDefaults = body.raidDefaults;
    if (body.blizzard !== undefined && typeof body.blizzard === "object") partial.blizzard = body.blizzard;
    ok(res, { config: saveConfig(partial) });
}

/** POST /api/settings/raidsheets — create (no id) or update (id) a raidsheet. */
async function saveRaidsheetHandler(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    if (!String(body.name || "").trim()) return error(res, 400, "invalid", "Name fehlt.");
    ok(res, saveRaidsheet(body), 201);
}

/** POST /api/settings/raidsheets/delete — body: { id }. */
async function deleteRaidsheetHandler(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const id = String(body.id || "").trim();
    if (!id || !deleteRaidsheet(id)) return error(res, 404, "not_found", "Raidsheet nicht gefunden.");
    ok(res, { id });
}

module.exports = { getSettings, updateSettings, saveRaidsheetHandler, deleteRaidsheetHandler };
