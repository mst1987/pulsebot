const { ok, error } = require("../apiResponse");
const { requireAdmin, requireFullAdmin, requireCsrf } = require("../apiMiddleware");
const { readJsonBody } = require("../apiBody");
const { activeGuildFor } = require("../activeGuild");
const {
    getConfig, saveConfig, listRaidsheets, saveRaidsheet, deleteRaidsheet,
} = require("../settingsStore");
const {
    listTokens: listIngestTokens, createToken: createIngestToken, revokeToken: revokeIngestToken,
} = require("../ingestTokenStore");
const discord = require("../discord");
const wowhead = require("../../utils/wowhead");
const { AREAS, normalizeRolePermissions, normalizeAreaAccess } = require("../../config/permissions");

const asStringArray = (v) => (Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : []);

// Which loot addon a Discord category uses. Only the two known tools are
// stored; anything else becomes "" (= not set), so a stray value can never end
// up steering the import parser.
const LOOT_TOOLS = ["gargul", "rclc"];
function normalizeCategoryLootTool(raw) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;
    for (const [categoryId, tool] of Object.entries(raw)) {
        const id = String(categoryId).trim();
        if (!id) continue;
        out[id] = LOOT_TOOLS.includes(String(tool)) ? String(tool) : "";
    }
    return out;
}

// A fixed sheet per category: only a http(s) link is stored. Anything else
// (javascript:, a bare word, an empty field) becomes "", which settingsStore's
// normalizer then drops — so a category is either unassigned or carries a link
// that is safe to render as an <a href>.
function normalizeCategorySheets(raw) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;
    for (const [categoryId, sheet] of Object.entries(raw)) {
        const id = String(categoryId).trim();
        if (!id) continue;
        const url = String((sheet && sheet.url) || "").trim();
        out[id] = {
            url: /^https?:\/\//i.test(url) ? url : "",
            name: String((sheet && sheet.name) || "").trim(),
        };
    }
    return out;
}

// Config keys that decide who gets into the menu — only full admins may change
// them, so a role with write access to "Einstellungen" can't grant itself more.
const ACCESS_KEYS = ["adminRoleIds", "rolePermissions", "baseAccess", "userPermissions"];

/** GET /api/settings — config + raidsheets + the active guild's roles/categories. */
function getSettings(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const guildId = activeGuildFor(req);
    const config = getConfig();
    ok(res, {
        // The access config is admin-only; a limited settings user never sees
        // (nor can save) it.
        config: user.isAdmin ? config : omit(config, ACCESS_KEYS),
        canManageAccess: !!user.isAdmin,
        areas: AREAS,
        raidsheets: listRaidsheets(),
        roles: discord.listRoles(guildId),
        categories: discord.listCategories(guildId),
        activeGuildId: guildId,
    });
}

function omit(obj, keys) {
    const out = { ...obj };
    for (const k of keys) delete out[k];
    return out;
}

/**
 * PATCH /api/settings — merge-updates the admin config. Only keys present in
 * the body are changed (saveConfig() itself merges raidDefaults/blizzard).
 * blizzard.clientSecret: omit to keep the stored secret, send "" to clear it,
 * send a value to replace it (the client only includes it when the admin
 * actually chose to change it — see ChangeSecretField in SettingsPage.tsx).
 * adminRoleIds/rolePermissions are full-admin-only (see ACCESS_KEYS).
 */
async function updateSettings(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const touchesAccess = ACCESS_KEYS.some((k) => body[k] !== undefined);
    if (touchesAccess && !requireFullAdmin(req, res)) return;
    const partial = {};
    if (body.adminRoleIds !== undefined) partial.adminRoleIds = asStringArray(body.adminRoleIds);
    if (body.rolePermissions !== undefined) partial.rolePermissions = normalizeRolePermissions(body.rolePermissions);
    if (body.baseAccess !== undefined) partial.baseAccess = normalizeAreaAccess(body.baseAccess);
    if (body.guildId !== undefined) partial.guildId = String(body.guildId).trim();
    if (body.raidhelperServerId !== undefined) partial.raidhelperServerId = String(body.raidhelperServerId).trim();
    if (body.officerRoleId !== undefined) partial.officerRoleId = String(body.officerRoleId).trim();
    if (body.applicationChannelId !== undefined) partial.applicationChannelId = String(body.applicationChannelId).trim();
    if (body.highestBidsChannelId !== undefined) partial.highestBidsChannelId = String(body.highestBidsChannelId).trim();
    if (body.highestBidsMessageId !== undefined) partial.highestBidsMessageId = String(body.highestBidsMessageId).trim();
    if (body.categoryIds !== undefined) partial.categoryIds = asStringArray(body.categoryIds);
    if (body.categoryRoles !== undefined && typeof body.categoryRoles === "object") partial.categoryRoles = body.categoryRoles;
    if (body.logChannelIds !== undefined) partial.logChannelIds = asStringArray(body.logChannelIds);
    if (body.raidDefaults !== undefined && typeof body.raidDefaults === "object") partial.raidDefaults = body.raidDefaults;
    if (body.blizzard !== undefined && typeof body.blizzard === "object") partial.blizzard = body.blizzard;
    if (body.categoryLootTool !== undefined) partial.categoryLootTool = normalizeCategoryLootTool(body.categoryLootTool);
    if (body.categorySheets !== undefined) partial.categorySheets = normalizeCategorySheets(body.categorySheets);
    // Sent as the complete list; settingsStore normalises it and replaces the
    // stored one, so removing an item is just leaving it out.
    if (body.topItems !== undefined) partial.topItems = Array.isArray(body.topItems) ? body.topItems : [];
    ok(res, { config: saveConfig(partial) });
}

/**
 * GET /api/settings/item-search?q=&edition= — Wowhead item search for the
 * top-item picker in Einstellungen → Loot. The same lookup the softres
 * hard-reserve picker uses, but under the settings area, so defining top items
 * doesn't require raid rights.
 */
async function getItemSearch(req, res, url) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const q = url.searchParams.get("q") || "";
    const edition = url.searchParams.get("edition") || "tbc";
    const items = await wowhead.searchItems(q, { edition });
    ok(res, { items });
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

// ---- loot-sync API tokens (the WoW addon's companion uploader) ----
// Full-admin only, like the other access settings: these are credentials that
// bypass the Discord login entirely, so someone with mere write access to
// "Einstellungen" must not be able to mint one.

/** GET /api/settings/ingest-tokens — the tokens, never their secrets. */
function getIngestTokens(req, res) {
    if (!requireFullAdmin(req, res)) return;
    ok(res, { tokens: listIngestTokens() });
}

/**
 * POST /api/settings/ingest-tokens — body: { name }. Mints a token and returns
 * the plaintext **once**; it is stored hashed and can never be shown again.
 */
async function createIngestTokenHandler(req, res) {
    const user = requireFullAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const { token, record } = createIngestToken(body.name, user.name || user.id || "");
    ok(res, { token, record }, 201);
}

/** POST /api/settings/ingest-tokens/delete — body: { id }. Revokes immediately. */
async function deleteIngestTokenHandler(req, res) {
    if (!requireFullAdmin(req, res)) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const id = String(body.id || "").trim();
    if (!id || !revokeIngestToken(id)) return error(res, 404, "not_found", "Token nicht gefunden.");
    ok(res, { id });
}

module.exports = {
    getSettings, updateSettings, getItemSearch, saveRaidsheetHandler, deleteRaidsheetHandler,
    getIngestTokens, createIngestTokenHandler, deleteIngestTokenHandler,
};
