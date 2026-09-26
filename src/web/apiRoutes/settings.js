const { ok, error } = require("../http/apiResponse");
const { requireFullAdmin } = require("../http/apiMiddleware");
const { withUser } = require("../http/apiHandler");
const { activeGuildFor } = require("../http/activeGuild");
const {
    getConfig, saveConfig, listRaidsheets, saveRaidsheet, deleteRaidsheet, listRaidTemplates,
} = require("../../stores/settingsStore");
const {
    listTokens: listIngestTokens, createToken: createIngestToken, revokeToken: revokeIngestToken,
} = require("../../stores/ingestTokenStore");
const discord = require("../../services/discord/discord");
const guildRoles = require("../../services/discord/guildRoles");
const roleSync = require("../../services/discord/roleSync");
const { listKnownCategories } = require("../../services/discord/categoryNames");
const { normalizeLootSystem } = require("../lootSystem");
const { lastReminderRun } = require("../reminders");
const { pingTargetInfo } = require("../../services/discord/pingDelivery");
const wowhead = require("../../utils/loot/wowhead");
const {
    AREAS, normalizeRolePermissions, normalizeUserPermissions, normalizeAreaAccess,
} = require("../../config/permissions");
const { normalizeBotCommandAccess } = require("../../config/botCommands");

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

// The message look per category: `{ id: { raidArt, titleSize } }`, every entry
// kept whole — one back at the defaults must reach the store's merge, which
// then drops it (embedLook.normalizeCategoryMessageLook).
function normalizeCategoryMessageLookPatch(raw) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;
    for (const [categoryId, look] of Object.entries(raw)) {
        const id = String(categoryId).trim();
        const src = look && typeof look === "object" ? look : {};
        if (id) out[id] = { raidArt: src.raidArt !== false, titleSize: String(src.titleSize || "") };
    }
    return out;
}

// The loot system per category: `{ id: system|"" }` — an empty string (also
// for an unknown value) survives the merge, so the store drops the category
// and it follows its loot addon again.
function normalizeCategoryLootSystemPatch(raw) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;
    for (const [categoryId, system] of Object.entries(raw)) {
        const id = String(categoryId).trim();
        if (id) out[id] = normalizeLootSystem(system);
    }
    return out;
}

// Where a category's new events are created. Anything but the two sources
// becomes "raidhelper", the default, which the store then drops again.
function normalizeCategorySignupSource(raw) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;
    for (const [categoryId, source] of Object.entries(raw)) {
        const id = String(categoryId).trim();
        if (id) out[id] = source === "eventhelper" ? "eventhelper" : "raidhelper";
    }
    return out;
}

// The setup DM switch per category (#290): `{ id: true|false }` — a false
// survives the merge, so the store can drop the category again.
function normalizeCategorySetupDms(raw) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;
    for (const [categoryId, on] of Object.entries(raw)) {
        const id = String(categoryId).trim();
        if (id) out[id] = on === true;
    }
    return out;
}

// The Discord-event switch per category (#305) — same contract as the setup DMs.
function normalizeCategoryDiscordEvent(raw) {
    return normalizeCategorySetupDms(raw);
}

// The voice channel per category (#305): `{ id: channelId|"" }` — an empty
// string survives the merge, so the store drops the category again.
function normalizeCategoryVoiceChannel(raw) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;
    for (const [categoryId, channelId] of Object.entries(raw)) {
        const id = String(categoryId).trim();
        if (id) out[id] = String(channelId === null || channelId === undefined ? "" : channelId).trim();
    }
    return out;
}

// "Beim Anlegen ankündigen" per category (#306): `{ id: { enabled, target } }`
// — a `false` survives the merge, so the store can drop the category again.
function normalizeCategoryAnnounce(raw) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;
    for (const [categoryId, value] of Object.entries(raw)) {
        const id = String(categoryId).trim();
        if (!id) continue;
        const v = value && typeof value === "object" ? value : {};
        out[id] = { enabled: v.enabled === true, target: String(v.target || "event") };
    }
    return out;
}

// The message with "Vielleicht" / "Absagen" per category: "optional" is kept in
// the patch (the store merges, then drops it), anything unknown becomes it.
function normalizeCategorySignupNotesPatch(raw) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;
    for (const [categoryId, mode] of Object.entries(raw)) {
        const id = String(categoryId).trim();
        if (id) out[id] = ["required", "none"].includes(mode) ? mode : "optional";
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
const ACCESS_KEYS = ["adminRoleIds", "rolePermissions", "baseAccess", "userPermissions", "botCommandAccess"];

// Config keys that hold a credential to a foreign system the bot pays for or
// acts through (the Anthropic key, the Warcraft Logs API client). Full-admin
// only as well: a limited settings user neither sees whether one is set nor
// can replace it with their own. The client mirrors this with `adminOnly` on
// the section (src/web-client/src/lib/settingsSections.ts).
const CREDENTIAL_KEYS = ["anthropic", "warcraftlogsV2"];

// Which Discord server is the event server and which the talk server (#251).
// Full-admin only: the event server is where the admin-role check runs, so
// whoever may move it decides whose roles count.
const GUILD_KEYS = ["discordServers"];

// The role sync between both servers (#264): it hands out roles on its own, so
// it is guarded like the access keys — whoever may edit it decides who gets
// which role on the other server.
const ROLE_SYNC_KEYS = ["roleSync"];

// Everything a non-admin settings user may neither read nor write.
const FULL_ADMIN_KEYS = [...ACCESS_KEYS, ...CREDENTIAL_KEYS, ...GUILD_KEYS, ...ROLE_SYNC_KEYS];

const DISCORD_SERVER_FIELDS = ["talkGuildId", "talkPingChannelId", "signupNoteChannelId"];

/** GET /api/settings — config + raidsheets + the active guild's roles/categories. */
const getSettings = withUser({}, async ({ user, req, res }) => {
    const guildId = activeGuildFor(req);
    const config = getConfig();
    // Names for the accounts that hold a per-user grant, so the permissions tab
    // shows people rather than 18-digit ids. Only full admins see that list at
    // all, so only they trigger the lookup — and a failed lookup must not cost
    // anyone the settings page, since the ids alone still work.
    let userNames = {};
    if (user.isAdmin) {
        try {
            userNames = await discord.resolveUserNames(guildId, Object.keys(config.userPermissions || {}));
        } catch (e) {
            console.warn("resolveUserNames failed:", e.message);
        }
    }
    ok(res, {
        // The access config and the credentials are admin-only; a limited
        // settings user never sees (nor can save) them.
        config: publicConfig(user.isAdmin ? config : omit(config, FULL_ADMIN_KEYS)),
        canManageAccess: !!user.isAdmin,
        areas: AREAS,
        userNames,
        raidsheets: listRaidsheets(),
        // For the default-template select per category — names only, so a
        // settings user needs no raid rights to pick one.
        raidTemplates: listRaidTemplates().map((t) => ({ id: t.id, name: t.name, versionId: t.versionId, size: t.size })),
        roles: discord.listRoles(guildId),
        categories: discord.listCategories(guildId),
        // The module fields pick a channel by name instead of a typed id; an
        // empty list (bot offline) makes the page fall back to the id field.
        channels: typeof discord.listTextChannels === "function" ? discord.listTextChannels(guildId) : [],
        // The voice channel a category's raids meet in (#305); empty = bot offline.
        voiceChannels: typeof discord.listVoiceChannels === "function" ? discord.listVoiceChannels(guildId) : [],
        // The channel picker of "Nachricht bei Vielleicht/Absage" per category (#335).
        noteChannels: noteChannels(config),
        bot: botStatus(guildId),
        // The two server cards (cheap: names, member counts, rights). The member
        // overlap needs a full member fetch and loads with the section itself.
        servers: user.isAdmin ? serverCards(config) : null,
        activeGuildId: guildId,
    });
});

/**
 * Where the messages of "Vielleicht" / "Absagen" may go (#335): the text
 * channels of the event and the talk server, named with their server when there
 * are two (like the Discord-Server dialog), plus the default channel's id — a
 * limited settings user does not see `discordServers`, the card still names it.
 * An empty list means the bot is offline (the card then marks nothing).
 */
function noteChannels(config) {
    try {
        const guildIds = guildRoles.configuredGuildIds(config);
        const list = typeof discord.listTextChannels === "function" ? discord.listTextChannels : () => [];
        const names = new Map((typeof discord.listGuilds === "function" ? discord.listGuilds() || [] : []).map((g) => [g.id, g.name]));
        const channels = guildIds.flatMap((id) => (list(id) || []).map((c) => ({
            id: c.id,
            name: c.name,
            category: guildIds.length > 1 ? [names.get(id) || "", c.category].filter(Boolean).join(" · ") : c.category || "",
        })));
        return { defaultId: String(((config && config.discordServers) || {}).signupNoteChannelId || ""), channels };
    } catch (e) {
        console.warn("note channels failed:", e.message);
        return { defaultId: "", channels: [] };
    }
}

/** Every event server's status card plus the talk server's; a failure reads as "nothing known". */
function serverCards(config) {
    try {
        return { events: guildRoles.eventGuildCards(config), talk: guildRoles.talkGuild(config) };
    } catch (e) {
        console.warn("server status failed:", e.message);
        return { events: [], talk: null };
    }
}

/**
 * GET /api/settings/discord-servers — everything the "Discord-Server" section
 * shows and edits: the stored ids, both status cards, the member overlap, and
 * every server the bot is on with its role and text channels (the pickers of
 * the edit dialog, so switching the talk server there lists that server's
 * channels without another request).
 */
const getDiscordServers = withUser({ full: true }, async ({ res }) => {
    const config = getConfig();
    const guilds = (discord.listGuilds() || []).map((g) => ({
        ...g,
        role: guildRoles.guildRole(g.id, config),
        channels: discord.listTextChannels(g.id),
    }));
    ok(res, {
        discordServers: config.discordServers,
        ...serverCards(config),
        overlap: await guildRoles.memberOverlap(config),
        guilds,
    });
});

/**
 * GET /api/settings/role-sync — the role sync block of the Discord-Server
 * section: the mapping, both servers' roles, whether the bot may manage roles
 * on each, the drift list (members who kept a synced role the source lost;
 * computed now, nothing stored) and the last sweep. Full-admin only.
 */
const getRoleSync = withUser({ full: true }, async ({ res }) => {
    ok(res, await roleSync.roleSyncView(getConfig()));
});

/**
 * GET /api/settings/reminders — the reminder block: the stored rules, every
 * configured event server's raid categories with names, whether the talk
 * server's ping channel exists as a target, and the last sweep.
 */
const getReminders = withUser({}, async ({ res }) => {
    const config = getConfig();
    // Names from the live list backed by earlier snapshots, so a category the
    // bot cannot see right now still reads as a name rather than an id — and a
    // category that only exists on a secondary event server still gets one.
    const names = new Map();
    for (const guildId of guildRoles.eventGuildIds(config)) {
        for (const c of listKnownCategories(guildId) || []) if (!names.has(c.id)) names.set(c.id, c.name);
    }
    const ids = [...new Set([...(config.categoryIds || []), ...Object.keys(config.categoryReminders || {})])];
    ok(res, {
        categoryReminders: config.categoryReminders || {},
        categories: ids.map((id) => ({ id, name: names.get(id) || "", roleCount: ((config.categoryRoles || {})[id] || []).length })),
        pingTargets: pingTargetInfo(config),
        lastRun: lastReminderRun(),
    });
});

/**
 * Whether the bot is logged in and which guild the settings run against — the
 * status line of the "Discord & Raid-Helper" connection card. Best-effort: a
 * missing client simply reads as offline.
 */
function botStatus(guildId) {
    try {
        const client = discord.getClient();
        const guild = discord.getGuild(guildId);
        return {
            online: !!(client && typeof client.isReady === "function" && client.isReady()),
            readySince: client && client.readyTimestamp ? client.readyTimestamp : 0,
            guildName: guild ? guild.name : "",
        };
    } catch {
        return { online: false, readySince: 0, guildName: "" };
    }
}

function omit(obj, keys) {
    const out = { ...obj };
    for (const k of keys) delete out[k];
    return out;
}

/**
 * The config as the browser may see it: the Battle.net client secret, the
 * Anthropic key and the WCL v2 client secret never leave the server, only
 * whether one is set (`hasClientSecret` / `hasApiKey`). A credential block
 * the caller may not see (omitted above for a non-admin) stays absent.
 */
function publicConfig(config) {
    const out = { ...config };
    if (config.blizzard !== undefined) {
        const { clientSecret, ...rest } = config.blizzard || {};
        out.blizzard = { ...rest, hasClientSecret: !!clientSecret };
    }
    if (config.anthropic !== undefined) {
        const anthropic = config.anthropic || {};
        out.anthropic = { model: anthropic.model || "", hasApiKey: !!anthropic.apiKey };
    }
    if (config.warcraftlogsV2 !== undefined) {
        const wclV2 = config.warcraftlogsV2 || {};
        out.warcraftlogsV2 = { clientId: wclV2.clientId || "", hasClientSecret: !!wclV2.clientSecret };
    }
    return out;
}

// The blizzard fields taken from a PATCH body besides the secret.
const BLIZZARD_FIELDS = ["clientId", "region", "realmSlug", "namespace"];

/**
 * PATCH /api/settings — merge-updates the admin config. Only keys present in
 * the body are changed (saveConfig() itself merges raidDefaults/blizzard).
 * blizzard.clientSecret: omit to keep the stored secret, send "" to clear it,
 * send a value to replace it (the client only includes it when the admin
 * actually chose to change it — see BlizzardSecretField in SettingsPage.tsx).
 * adminRoleIds/rolePermissions (ACCESS_KEYS) and the Anthropic/WCL
 * credentials (CREDENTIAL_KEYS) are full-admin-only.
 */
const updateSettings = withUser({ csrf: true, body: true }, async ({ body, req, res }) => {
    const touchesGuarded = FULL_ADMIN_KEYS.some((k) => body[k] !== undefined);
    if (touchesGuarded && !requireFullAdmin(req, res)) return;
    const partial = {};
    if (body.adminRoleIds !== undefined) partial.adminRoleIds = asStringArray(body.adminRoleIds);
    if (body.rolePermissions !== undefined) partial.rolePermissions = normalizeRolePermissions(body.rolePermissions);
    if (body.baseAccess !== undefined) partial.baseAccess = normalizeAreaAccess(body.baseAccess);
    // Guarded like the other access keys above, but it was never taken over
    // into `partial` — a per-account grant set in the menu was silently dropped.
    if (body.userPermissions !== undefined) partial.userPermissions = normalizeUserPermissions(body.userPermissions);
    // Sent as the whole map: a command left out follows its defaultAccess again.
    if (body.botCommandAccess !== undefined) partial.botCommandAccess = normalizeBotCommandAccess(body.botCommandAccess);
    if (body.guildId !== undefined) partial.guildId = String(body.guildId).trim();
    // Only the fields sent: settingsStore merges them into the stored block and
    // normalises the result, so a PATCH of one channel keeps both servers.
    if (body.discordServers !== undefined && body.discordServers && typeof body.discordServers === "object") {
        partial.discordServers = {};
        for (const k of DISCORD_SERVER_FIELDS) {
            if (body.discordServers[k] !== undefined) partial.discordServers[k] = String(body.discordServers[k] || "").trim();
        }
        // Raw pass-through: real validation happens in settingsStore's
        // normalizeEventGuilds() (dedup, snowflake checks, half-set target).
        if (Array.isArray(body.discordServers.eventGuilds)) partial.discordServers.eventGuilds = body.discordServers.eventGuilds;
    }
    if (body.raidhelperServerId !== undefined) partial.raidhelperServerId = String(body.raidhelperServerId).trim();
    if (body.officerRoleId !== undefined) partial.officerRoleId = String(body.officerRoleId).trim();
    if (body.applicationChannelId !== undefined) partial.applicationChannelId = String(body.applicationChannelId).trim();
    if (body.categoryIds !== undefined) partial.categoryIds = asStringArray(body.categoryIds);
    if (body.categoryRoles !== undefined && typeof body.categoryRoles === "object") partial.categoryRoles = body.categoryRoles;
    if (body.logChannelIds !== undefined) partial.logChannelIds = asStringArray(body.logChannelIds);
    if (body.raidDefaults !== undefined && typeof body.raidDefaults === "object") partial.raidDefaults = body.raidDefaults;
    // blizzard: only the known fields, the secret only when sent (omit = keep, "" = clear)
    if (body.blizzard !== undefined && typeof body.blizzard === "object") {
        partial.blizzard = {};
        for (const k of BLIZZARD_FIELDS) {
            if (body.blizzard[k] !== undefined) partial.blizzard[k] = String(body.blizzard[k] || "").trim();
        }
        if (body.blizzard.clientSecret !== undefined) partial.blizzard.clientSecret = String(body.blizzard.clientSecret || "").trim();
    }
    // anthropic.apiKey follows the blizzard secret's contract: omit = keep, "" = clear.
    if (body.anthropic !== undefined && typeof body.anthropic === "object") {
        partial.anthropic = {};
        if (body.anthropic.model !== undefined) partial.anthropic.model = String(body.anthropic.model || "").trim();
        if (body.anthropic.apiKey !== undefined) partial.anthropic.apiKey = String(body.anthropic.apiKey || "").trim();
    }
    // warcraftlogsV2.clientSecret: the same contract — omit = keep, "" = clear.
    if (body.warcraftlogsV2 !== undefined && typeof body.warcraftlogsV2 === "object") {
        partial.warcraftlogsV2 = {};
        if (body.warcraftlogsV2.clientId !== undefined) partial.warcraftlogsV2.clientId = String(body.warcraftlogsV2.clientId || "").trim();
        if (body.warcraftlogsV2.clientSecret !== undefined) partial.warcraftlogsV2.clientSecret = String(body.warcraftlogsV2.clientSecret || "").trim();
    }
    if (body.categoryLootTool !== undefined) partial.categoryLootTool = normalizeCategoryLootTool(body.categoryLootTool);
    if (body.categoryLootSystem !== undefined) partial.categoryLootSystem = normalizeCategoryLootSystemPatch(body.categoryLootSystem);
    if (body.categorySignupSource !== undefined) partial.categorySignupSource = normalizeCategorySignupSource(body.categorySignupSource);
    if (body.categorySetupDms !== undefined) partial.categorySetupDms = normalizeCategorySetupDms(body.categorySetupDms);
    if (body.categoryDiscordEvent !== undefined) partial.categoryDiscordEvent = normalizeCategoryDiscordEvent(body.categoryDiscordEvent);
    if (body.categoryVoiceChannel !== undefined) partial.categoryVoiceChannel = normalizeCategoryVoiceChannel(body.categoryVoiceChannel);
    if (body.categoryMessageLook !== undefined) partial.categoryMessageLook = normalizeCategoryMessageLookPatch(body.categoryMessageLook);
    if (body.categoryAnnounce !== undefined) partial.categoryAnnounce = normalizeCategoryAnnounce(body.categoryAnnounce);
    if (body.categorySignupNotes !== undefined) partial.categorySignupNotes = normalizeCategorySignupNotesPatch(body.categorySignupNotes);
    // The channel of those messages per category (#335): same contract as the voice channel.
    if (body.categorySignupNoteChannel !== undefined) partial.categorySignupNoteChannel = normalizeCategoryVoiceChannel(body.categorySignupNoteChannel);
    if (body.categorySheets !== undefined) partial.categorySheets = normalizeCategorySheets(body.categorySheets);
    // Sent whole; an id no template has is dropped, so a category can never
    // point at a template that is not there (the store normalises the rest).
    if (body.categoryRaidTemplate !== undefined) {
        const known = new Set(listRaidTemplates().map((t) => t.id));
        const raw = body.categoryRaidTemplate && typeof body.categoryRaidTemplate === "object" ? body.categoryRaidTemplate : {};
        partial.categoryRaidTemplate = Object.fromEntries(Object.entries(raw).filter(([, id]) => known.has(String(id || ""))));
    }
    // Sent as the complete list; settingsStore normalises it and replaces the
    // stored one, so removing an item is just leaving it out.
    if (body.topItems !== undefined) partial.topItems = Array.isArray(body.topItems) ? body.topItems : [];
    // Complete values as well; settingsStore validates them (snowflakes, known
    // directions and targets, hours 1–168) and replaces the stored ones.
    if (body.roleSync !== undefined) partial.roleSync = Array.isArray(body.roleSync) ? body.roleSync : [];
    if (body.categoryReminders !== undefined) {
        partial.categoryReminders = body.categoryReminders && typeof body.categoryReminders === "object" ? body.categoryReminders : {};
    }
    ok(res, { config: publicConfig(saveConfig(partial)) });
});

/**
 * GET /api/settings/item-search?q=&edition= — Wowhead item search for the
 * top-item picker in Einstellungen → Loot. The same lookup the softres
 * hard-reserve picker uses, but under the settings area, so defining top items
 * doesn't require raid rights.
 */
const getItemSearch = withUser({}, async ({ res, url }) => {
    const q = url.searchParams.get("q") || "";
    const edition = url.searchParams.get("edition") || "tbc";
    const items = await wowhead.searchItems(q, { edition });
    ok(res, { items });
});

/** POST /api/settings/raidsheets — create (no id) or update (id) a raidsheet. */
const saveRaidsheetHandler = withUser({ csrf: true, body: true }, async ({ body, res }) => {
    if (!String(body.name || "").trim()) return error(res, 400, "invalid", "Name fehlt.");
    ok(res, saveRaidsheet(body), 201);
});

/** POST /api/settings/raidsheets/delete — body: { id }. */
const deleteRaidsheetHandler = withUser({ csrf: true, body: true }, async ({ body, res }) => {
    const id = String(body.id || "").trim();
    if (!id || !deleteRaidsheet(id)) return error(res, 404, "not_found", "Raidsheet nicht gefunden.");
    ok(res, { id });
});

// ---- loot-sync API tokens (the WoW addon's companion uploader) ----
// Full-admin only, like the other access settings: these are credentials that
// bypass the Discord login entirely, so someone with mere write access to
// "Einstellungen" must not be able to mint one.

/** GET /api/settings/ingest-tokens — the tokens, never their secrets. */
const getIngestTokens = withUser({ full: true }, async ({ res }) => {
    ok(res, { tokens: listIngestTokens() });
});

/**
 * POST /api/settings/ingest-tokens — body: { name }. Mints a token and returns
 * the plaintext **once**; it is stored hashed and can never be shown again.
 */
const createIngestTokenHandler = withUser({ full: true, csrf: true, body: true }, async ({ user, body, res }) => {
    const { token, record } = createIngestToken(body.name, user.name || user.id || "");
    ok(res, { token, record }, 201);
});

/** POST /api/settings/ingest-tokens/delete — body: { id }. Revokes immediately. */
const deleteIngestTokenHandler = withUser({ full: true, csrf: true, body: true }, async ({ body, res }) => {
    const id = String(body.id || "").trim();
    if (!id || !revokeIngestToken(id)) return error(res, 404, "not_found", "Token nicht gefunden.");
    ok(res, { id });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/settings", handler: getSettings, area: "settings" },
    { method: "PATCH", path: "/api/settings", handler: updateSettings, area: "settings" },
    { method: "GET", path: "/api/settings/item-search", handler: getItemSearch, area: "settings" },
    { method: "POST", path: "/api/settings/raidsheets", handler: saveRaidsheetHandler, area: "settings" },
    { method: "POST", path: "/api/settings/raidsheets/delete", handler: deleteRaidsheetHandler, area: "settings" },
    { method: "GET", path: "/api/settings/discord-servers", handler: getDiscordServers, area: "settings" },
    { method: "GET", path: "/api/settings/role-sync", handler: getRoleSync, area: "settings" },
    { method: "GET", path: "/api/settings/reminders", handler: getReminders, area: "settings" },
    { method: "GET", path: "/api/settings/ingest-tokens", handler: getIngestTokens, area: "settings" },
    { method: "POST", path: "/api/settings/ingest-tokens", handler: createIngestTokenHandler, area: "settings" },
    { method: "POST", path: "/api/settings/ingest-tokens/delete", handler: deleteIngestTokenHandler, area: "settings" },
];

module.exports = {
    getSettings, updateSettings, getItemSearch, saveRaidsheetHandler, deleteRaidsheetHandler,
    getIngestTokens, createIngestTokenHandler, deleteIngestTokenHandler, getDiscordServers,
    getRoleSync, getReminders,
    publicConfig, ACCESS_KEYS, CREDENTIAL_KEYS, GUILD_KEYS, ROLE_SYNC_KEYS, FULL_ADMIN_KEYS,
    routes,
};
