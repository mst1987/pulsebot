const { ok, error } = require("../http/apiResponse");
const { requireFullAdmin } = require("../http/apiMiddleware");
const { withUser } = require("../http/apiHandler");
const { activeGuildFor } = require("../http/activeGuild");
const { maskedRaidhelper, raidhelperSettingOf, raidhelperActive } = require("../../utils/raidhelper/servers");
const { firstServerId, storedCategoryGuilds } = require("../../services/discord/serverOf");
const { mayUseServer, guildOfChannel, OTHER_SERVER } = require("../http/serverQuery");
const {
    getConfig, saveConfig, listRaidsheets, saveRaidsheet, deleteRaidsheet, listRaidTemplates, getRaidTemplate,
} = require("../../stores/settingsStore");
const {
    normalizeCategoryLanguagePatch, attendanceSettings, normalizeCategoryVersion, MAX_SERVERS,
    EVENT_GUILD_LABEL_MAX, mergeServerSettings, serverSettingGuildIds,
} = require("../../stores/configSchema");
const { accessSettings, ACCESS_KEYS: SERVER_ACCESS_KEYS } = require("../../services/discord/serverAccess");
const { serverSetting, serverVisuals, ownVisualsOf } = require("../../services/discord/serverSettings");
const serverDefaults = require("../../services/discord/serverDefaults");
const { serverLang, defaultLang } = require("../../services/discord/botLanguage");
const { isSnowflake } = require("../../utils/ids");
const { switchPreview, versionSwitches, applySeriesFix, notifyCategoryVersionSwitch } = require("../../services/events/categorySwitch");
const categoryLifecycle = require("../../services/events/categoryLifecycle");
const categoryGuild = require("../../services/events/categoryGuild");
const {
    listTokens: listIngestTokens, createToken: createIngestToken, revokeToken: revokeIngestToken,
} = require("../../stores/ingestTokenStore");
const discord = require("../../services/discord/discord");
const guildRoles = require("../../services/discord/guildRoles");
const roleSync = require("../../services/discord/roleSync");
const pugRoleGuard = require("../../services/discord/pugRoleGuard");
const languageChange = require("../../services/discord/languageChange");
const availabilityPanel = require("../../services/signups/availabilityPanel");
const raidOverview = require("../../services/events/raidOverview");
const { listKnownCategories } = require("../../services/discord/categoryNames");
const { normalizeLootSystem } = require("../../services/loot/lootSystem");
const { lastReminderRun } = require("../events/reminders");
const wowhead = require("../../utils/loot/wowhead");
const {
    AREAS, normalizeRolePermissions, normalizeUserPermissions, normalizeAreaAccess,
} = require("../../config/permissions");
const { normalizeBotCommandAccess } = require("../../config/botCommands");
const { normalizeAddonList, defaultAddons } = require("../../services/addons/addonConfig");
const { VERSIONS } = require("../../config/gameVersions");
const versionSettings = require("../../services/events/versionSettings");
const { capabilityMatrix } = require("../../services/events/versionCapabilities");
const { isVersionFeature, normalizeDisabled } = require("../../config/versionFeatures");
const { mainVersionFor, knownVersion } = require("../../services/events/mainVersion");
const { logChannelsOf, logChannelsFromBody } = require("../../services/logcheck/logChannelSettings");
const { wclGuildsOf, wclGuildsFromBody } = require("../../services/logcheck/wclGuildSettings");
const { normalizeCategoryPlanning } = require("../../services/events/planning");
const { normalizeCategorySignupCharacters } = require("../../services/signups/signupCharacters");
const { upcomingByVersion, archiveExport, archiveCsv, versionsWithData } = require("../../services/events/contentVersions");
// Makes Excel read the umlauts of an archive CSV as UTF-8.
const BOM = String.fromCharCode(0xfeff);
const { defaultVersionSettings, defaultColorOf, normalizeVersionOverrides, overrideProblems } = require("../../stores/versionSettingsSchema");
const { expectedRoleIds, syncRosterRoleIds } = require("../../services/roster/categoryRoles");
const { switchRosterPreview, rostersAfterSwitches } = require("../../services/roster/rosterVersionSwitch");

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

// In the server overview per category: `{ id: false }` takes it out, true stays in
// the patch so the store's merge drops a category shown again.
function normalizeCategoryServerOverviewPatch(raw) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;
    for (const [categoryId, on] of Object.entries(raw)) {
        const id = String(categoryId).trim();
        if (id) out[id] = on !== false;
    }
    return out;
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
// adminRoleIds is global; the other five belong to one server since #925: the
// API reads and writes them as top-level fields, but they are the ones of the
// active server (config.serverSettings[guildId]), never of another.
const ACCESS_KEYS = ["adminRoleIds", "rolePermissions", "baseAccess", "userPermissions", "botCommandAccess", "orgaRoleIds"];

// Config keys that hold a credential to a foreign system the bot pays for or
// acts through (the Anthropic key, the Warcraft Logs API client). Full-admin
// only as well: a limited settings user neither sees whether one is set nor
// can replace it with their own. The client mirrors this with `adminOnly` on
// the section (src/web-client/src/lib/settings/settingsSections.ts).
// The GitHub token (#818) reads the private addon repos.
const CREDENTIAL_KEYS = ["anthropic", "warcraftlogsV2", "github"];

// The addon downloads (#818): which repos the server fetches files from with
// the GitHub token and hands to every member — guarded like the token itself.
// `addonDownloadsReset` is no config key, only the body's "Standard
// wiederherstellen"; the edit mark is set by the server alone.
const ADDON_KEYS = ["addonDownloads", "addonDownloadsCustomized", "addonDownloadsReset"];

// The Discord servers and their links (#251, #890). Full-admin only: the first
// server is where the admin-role check runs, so whoever may move it decides
// whose roles count.
const GUILD_KEYS = ["discordServers"];

// The role sync between servers (#264): it hands out roles on its own, so
// it is guarded like the access keys — whoever may edit it decides who gets
// which role on the other server.
const ROLE_SYNC_KEYS = ["roleSync"];

// Raid-Helper per server (#927): its key is a credential like the ones above.
// `raidhelper` is no config key, only the body's block for the active server.
const RAIDHELPER_KEYS = ["raidhelper"];

// The reminder rules of every server's categories (#957): edited under
// Alle Server › Einstellungen, which is full admins only — and the rules ping
// members on every server, so a settings writer of one server must not change
// those of another.
const REMINDER_KEYS = ["categoryReminders"];

// Everything a non-admin settings user may neither read nor write.
const FULL_ADMIN_KEYS = [...ACCESS_KEYS, ...CREDENTIAL_KEYS, ...GUILD_KEYS, ...ROLE_SYNC_KEYS, ...ADDON_KEYS, ...RAIDHELPER_KEYS, ...REMINDER_KEYS];

// #957: what every server shares and only Alle Server › Einstellungen edits - the
// Battle.net connection, the main version (and hiding the others), the settings
// per version, the dungeon record post. Every settings user reads them (the pages
// need the versions), but only a full admin writes them: one server's orga must
// not change what all servers use. The client leaves them out on System › Einstellungen.
const SHARED_WRITE_KEYS = ["blizzard", "mainVersion", "hideOtherVersions", "versionSettings", "dungeonRecords"];

// #924: the two signup channels of a server ("Vielleicht"/"Absagen" notes, guild bank requests).
const SERVER_CHANNEL_FIELDS = ["signupNoteChannelId", "guildBankChannelId"];

/** The guild bank's orga channel of every server, as one comparable string. */
const guildBankOf = (config) => JSON.stringify(serverDefaults.everyServer("guildBankChannelId", { config: config || {} }));

/** The servers that may hold their own settings (#924): the servers, the link targets, the home guild. */
const settingGuildsOf = (config) => serverSettingGuildIds((config && config.discordServers) || {}, (config && config.guildId) || "");

const UNKNOWN_SERVER = "Dieser Discord-Server ist nicht eingetragen – erst unter Alle Server › Einstellungen › Discord-Server aufnehmen.";

/**
 * #962: the servers a save would write a block for that may hold none - neither a
 * server nor a link target nor the home guild, after this save. normalizeServerSettings
 * would drop their block on the next read, so the save is refused instead of
 * answering "saved" for values that are gone.
 */
function unknownServerBlocks(partial, before) {
    const blocks = partial.serverSettings && typeof partial.serverSettings === "object" ? Object.keys(partial.serverSettings) : [];
    if (!blocks.length) return [];
    const stored = (before && before.discordServers) || {};
    const sent = partial.discordServers || {};
    const known = serverSettingGuildIds(
        { servers: sent.servers || stored.servers || [], links: sent.links || stored.links || [] },
        partial.guildId !== undefined ? partial.guildId : (before && before.guildId) || "",
    );
    return blocks.filter((guildId) => !known.has(guildId));
}

/** The bot language of every server, as one comparable string. */
const serverLangsOf = (config) => [...settingGuildsOf(config)].sort().map((id) => `${id}:${serverLang(config, id)}`).join(",");

/**
 * The values of one server the settings form edits (#924), flat like the
 * global fields of before: the application channel, the officer role, the raid
 * form's preset channel and the bot language. No server = the defaults.
 * The language also has a global default (config.botLanguage): `botLanguage`
 * is what the server speaks (its own value, else the default),
 * `botLanguageOwn` whether it has an own value; without a server the form
 * edits the default itself.
 */
function serverDefaultsOf(config, guildId) {
    const cfg = config || {};
    const id = String(guildId || "").trim();
    const read = (key) => serverSetting(id, key, { config: cfg });
    const fallback = defaultLang(cfg);
    const own = id ? ((cfg.serverSettings || {})[id] || {}).botLanguage : undefined;
    const ownLang = own === "en" || own === "de" ? own : "";
    return {
        applicationChannelId: String(read("applicationChannelId") || ""),
        officerRoleId: String(read("officerRoleId") || ""),
        raidDefaults: { channelId: String((read("raidDefaults") || {}).channelId || "") },
        botLanguage: ownLang || fallback,
        botLanguageDefault: fallback,
        botLanguageOwn: !!ownLang,
        // #961 the drawn pictures: what this server draws (own switch, else the global default);
        // without a server the default itself. discordVisualsOwn = whether it set switches itself.
        discordVisuals: serverVisuals(id, { config: cfg }),
        discordVisualsDefault: serverVisuals("", { config: cfg }),
        discordVisualsOwn: !!id && Object.keys(ownVisualsOf(((cfg.serverSettings || {})[id] || {}).discordVisuals)).length > 0,
    };
}

/**
 * The answer's config: the stored one plus the active server's values (#924), narrowed by viewConfig
 * (#925: rights of the active server for a full admin only, no credentials for anybody else).
 */
const viewWithDefaults = (config, view) => viewConfig({ ...config, ...serverDefaultsOf(config, view.guildId) }, view);

/**
 * The four per-server fields of a PATCH body (#924), cleaned; {} = none sent.
 * `botLanguage: null` removes the server's own language ("use the default"):
 * the key stays with the value undefined, which the store's merge drops.
 */
function serverDefaultsPatch(body) {
    const out = {};
    if (body.applicationChannelId !== undefined) out.applicationChannelId = String(body.applicationChannelId || "").trim();
    if (body.officerRoleId !== undefined) out.officerRoleId = String(body.officerRoleId || "").trim();
    if (body.raidDefaults !== undefined && body.raidDefaults && typeof body.raidDefaults === "object") {
        out.raidDefaults = { channelId: String(body.raidDefaults.channelId || "").trim() };
    }
    if (body.botLanguage === null) out.botLanguage = undefined;
    else if (body.botLanguage !== undefined) out.botLanguage = String(body.botLanguage || "").trim().toLowerCase() === "en" ? "en" : "de";
    return out;
}

/**
 * The signup channels per server of a PATCH (#924): `{ [guildId]: { signupNoteChannelId, guildBankChannelId } }`,
 * only known servers, each channel a snowflake or "" (= none, nothing is posted). `{ error }` names the reason.
 */
function checkServerChannels(sent, known) {
    if (!sent || typeof sent !== "object" || Array.isArray(sent)) return { error: "Die Kanäle fehlen." };
    const out = {};
    for (const [rawId, raw] of Object.entries(sent)) {
        const guildId = String(rawId).trim();
        if (!known.has(guildId)) return { error: "Unbekannter Server." };
        const block = raw && typeof raw === "object" ? raw : {};
        const next = {};
        for (const key of SERVER_CHANNEL_FIELDS) {
            if (block[key] === undefined) continue;
            const value = String(block[key] || "").trim();
            if (value && !isSnowflake(value)) return { error: "Unbekannter Kanal." };
            next[key] = value;
        }
        if (Object.keys(next).length) out[guildId] = next;
    }
    return { channels: out };
}

// Body keys stored per Discord server (config.serverSettings[guildId]). Each
// part of the "data per server" epic (#926) that moves a setting there adds
// its key here, so its PATCH is checked by serverSettingsTarget() below.
// categoryIds (#926) is one list over every server, but a save changes only the
// saving server's part (mergedCategoryIds) - so it is bound to the tab's server too.
// #925: the rights of a server (all but the global adminRoleIds) are guarded the same way.
const SERVER_SCOPED_KEYS = [
    "logChannels", "raidhelper", "versionOverrides", "categoryIds",
    "applicationChannelId", "officerRoleId", "raidDefaults", "botLanguage", "wclGuilds",
    "rolePermissions", "baseAccess", "userPermissions", "orgaRoleIds", "botCommandAccess",
    "discordVisuals",
];
// Server-bound keys that, without an active server, edit the first server
// (#927 Raid-Helper, as its section shows; #926 the categories, shown on the
// first server then); every other key then needs one.
const FIRST_SERVER_FALLBACK_KEYS = ["raidhelper", "categoryIds"];
// Server-bound keys with a global default besides (#924 bot language, #961 the
// drawn pictures): without an active server they write that default (full admins
// only, updateSettings).
const GLOBAL_DEFAULT_KEYS = ["botLanguage", "discordVisuals"];

/**
 * The server a PATCH of server-bound settings writes to — guarded against a
 * stale tab. The active server is per session, not per tab: a tab loaded on
 * server A whose session has since switched to B (another tab) would
 * otherwise write A's values into B. So the client sends the server it loaded
 * (`serverSettingsGuildId`, GET's `activeGuildId`, "" when none was active)
 * with every server-bound key, and a mismatch is refused with 409 instead of
 * overwriting.
 * Without an active server a key of GLOBAL_DEFAULT_KEYS writes the global
 * default (`global: true`); removing a server's own value (null) needs one.
 * @returns {{ guildId: string, global: boolean } | { status: number, code: string, message: string } | null}
 *   null when the body holds no server-bound key
 */
function serverSettingsTarget(req, body, config) {
    const keys = SERVER_SCOPED_KEYS.filter((k) => body[k] !== undefined);
    if (!keys.length) return null;
    const active = String(activeGuildFor(req) || "");
    if (String(body.serverSettingsGuildId || "") !== active) {
        return { status: 409, code: "server_switched", message: "Der Discord-Server wurde gewechselt – bitte die Seite neu laden." };
    }
    const noServer = { status: 400, code: "no_active_server", message: "Kein aktiver Discord-Server." };
    if (active) return { guildId: active, global: false };
    if (GLOBAL_DEFAULT_KEYS.some((k) => body[k] === null)) return noServer;
    const rest = keys.filter((k) => !GLOBAL_DEFAULT_KEYS.includes(k));
    if (!rest.length) return { guildId: "", global: true };
    const fallback = rest.every((k) => FIRST_SERVER_FALLBACK_KEYS.includes(k)) ? String(firstServerId(config) || "") : "";
    return fallback ? { guildId: fallback, global: true } : noServer;
}

/** GET /api/settings — config + raidsheets + the active guild's roles/categories. */
const getSettings = withUser({}, async ({ user, req, res }) => {
    const guildId = activeGuildFor(req);
    const config = getConfig();
    // Names for the accounts that hold a per-user grant, so the permissions tab
    // shows people rather than 18-digit ids. Only full admins see that list at
    // all, so only they trigger the lookup — and a failed lookup must not cost
    // anyone the settings page, since the ids alone still work.
    let userNames = {};
    let userAvatars = {};
    if (user.isAdmin) {
        // the accounts with a grant on the active server (#925)
        const accountIds = Object.keys(accessSettings(guildId, config).userPermissions);
        try {
            userNames = await discord.resolveUserNames(guildId, accountIds);
        } catch (e) {
            console.warn("resolveUserNames failed:", e.message);
        }
        // their Discord pictures, from the cache the name lookup just filled; none = the row shows the initial
        userAvatars = Object.fromEntries(accountIds
            .map((id) => [id, discord.avatarUrlFor(guildId, id)])
            .filter(([, url]) => url));
    }
    ok(res, {
        // The access config and the credentials are admin-only; a limited
        // settings user never sees (nor can save) them.
        // #924: the per-server fields as the active server holds them, flat like before; #925 the rights
        // of the active server for a full admin only.
        config: viewWithDefaults(config, { isAdmin: !!user.isAdmin, guildId }),
        canManageAccess: !!user.isAdmin,
        areas: AREAS,
        userNames,
        userAvatars,
        raidsheets: listRaidsheets(),
        // For the default-template select per category — names only, so a
        // settings user needs no raid rights to pick one.
        raidTemplates: listRaidTemplates().map((t) => ({ id: t.id, name: t.name, versionId: t.versionId, size: t.size })),
        // Einstellungen → Spielversion (#541): the versions to pick from, names only.
        gameVersions: VERSIONS.map((v) => ({ id: v.id, label: v.label, short: v.short, icon: v.icon || "", color: defaultColorOf(v.id) })),
        // The standard values per version (#553) for "Standardwerte übernehmen";
        // an all-empty block = the version has none yet (Forever).
        versionDefaults: defaultVersionSettings(config.versionSettings),
        // "Funktionen je Version" (#761): per version and feature: possible, switched on, why not.
        versionCapabilities: capabilityMatrix({ config }),
        // "Andere Versionen ausblenden" (#563): the coming raids per version, for the warning.
        upcomingByVersion: upcomingByVersion({ config }),
        // The versions with data (#563): the archive export names only those.
        dataVersions: [...versionsWithData(config)],
        roles: discord.listRoles(guildId),
        categories: discord.listCategories(guildId),
        // The module fields pick a channel by name instead of a typed id; an
        // empty list (bot offline) makes the page fall back to the id field.
        channels: typeof discord.listTextChannels === "function" ? discord.listTextChannels(guildId) : [],
        // The voice channel a category's raids meet in (#305); empty = bot offline.
        voiceChannels: typeof discord.listVoiceChannels === "function" ? discord.listVoiceChannels(guildId) : [],
        // The channel picker of "Nachricht bei Vielleicht/Absage" per category (#335).
        noteChannels: noteChannels(config, guildId),
        bot: botStatus(guildId),
        // #744: configured categories Discord no longer has (only when the bot sees
        // every server), each with what "Kategorie abschließen" would remove.
        // #926: only the active server's part of config.categoryIds, plus those
        // without a proven configured server (shown on the first server, never closable).
        ...serverCategoriesOf(config, guildId),
        // One card per server (cheap: names, member counts, rights). The member
        // overlap needs a full member fetch and loads with the section itself.
        servers: user.isAdmin ? serverCards(config) : null,
        // The full admin roles hold on every server (#925): their picker lists
        // the roles of all servers, named with their server. Full admins only.
        adminRoles: user.isAdmin ? adminRolesOf(config) : [],
        // Where the roles of this page live (#925): a global full admin role of
        // another server reads "role · server" there, not "unknown". Full admins only.
        roleOrigins: user.isAdmin ? roleOriginsOf(config, guildId) : {},
        activeGuildId: guildId,
        // Einstellungen → Server → Raid-Helper (#927): the active server's block, masked (never the key).
        raidhelper: user.isAdmin ? maskedRaidhelper(raidhelperGuildOf(req, config), config) : null,
        // whether the active server reads Raid-Helper at all - without it a category offers only EventHelper
        raidhelperActive: raidhelperActive(raidhelperGuildOf(req, config), config),
    });
});

/**
 * Where the messages of "Vielleicht" / "Absagen" may go (#335): the text
 * channels of every server, named with their server when there are several
 * (like the Discord-Server dialog), plus the active server's default channel
 * (#924: one per server) — a limited settings user does not see the server
 * blocks, the card still names it.
 * An empty list means the bot is offline (the card then marks nothing).
 */
function noteChannels(config, activeGuildId = "") {
    try {
        const guildIds = guildRoles.configuredGuildIds(config);
        const list = typeof discord.listTextChannels === "function" ? discord.listTextChannels : () => [];
        const names = new Map((typeof discord.listGuilds === "function" ? discord.listGuilds() || [] : []).map((g) => [g.id, g.name]));
        const channels = guildIds.flatMap((id) => (list(id) || []).map((c) => ({
            id: c.id,
            name: c.name,
            category: guildIds.length > 1 ? [names.get(id) || "", c.category].filter(Boolean).join(" · ") : c.category || "",
        })));
        return { defaultId: serverDefaults.signupNoteChannelId(activeGuildId, { config }), channels };
    } catch (e) {
        console.warn("note channels failed:", e.message);
        return { defaultId: "", channels: [] };
    }
}

/**
 * The roles a full admin role can be picked from (#925): those of every
 * configured server, each with its server's name. A bot's own role is held by
 * no member and left out. A failure reads as "none known".
 */
function adminRolesOf(config) {
    try {
        const names = new Map((typeof discord.listGuilds === "function" ? discord.listGuilds() || [] : []).map((g) => [g.id, g.name]));
        return guildRoles.configuredGuildIds(config).flatMap((gid) => (discord.listRoles(gid) || [])
            .filter((r) => !r.managed)
            .map((r) => ({ id: r.id, name: r.name, color: r.color, guildId: gid, guildName: names.get(gid) || "" })));
    } catch (e) {
        console.warn("admin roles failed:", e.message);
        return [];
    }
}

/**
 * The server of each role the rights page of `guildId` names (#925): the
 * global full admin roles plus the role grants and orga roles stored for this
 * server, looked up over every server the bot is on. A role found nowhere is
 * missing - only that one reads "unknown". A failure reads as "none known".
 */
function roleOriginsOf(config, guildId) {
    try {
        if (typeof discord.findRolesAnywhere !== "function") return {};
        const access = accessSettings(guildId, config);
        return discord.findRolesAnywhere([
            ...asStringArray(config.adminRoleIds),
            ...Object.keys(access.rolePermissions || {}),
            ...(access.orgaRoleIds || []),
        ]);
    } catch (e) {
        console.warn("role origins failed:", e.message);
        return {};
    }
}

/** Every server's status card; a failure reads as "nothing known". */
function serverCards(config) {
    try {
        return { events: guildRoles.eventGuildCards(config) };
    } catch (e) {
        console.warn("server status failed:", e.message);
        return { events: [] };
    }
}

/** A Discord locale ("de", "en-US", "en-GB") as the link language it suggests: "de", "en" or "" (unknown). */
function localeLang(locale) {
    const lang = String(locale || "").toLowerCase().split("-")[0];
    return lang === "de" || lang === "en" ? lang : "";
}

/** How many of the configured raid categories (config.categoryIds) live on `guildId`. */
function raidCategoryCount(guildId, config) {
    const wanted = new Set(asStringArray(config.categoryIds));
    if (!wanted.size) return 0;
    try {
        return (discord.listCategories(guildId) || []).filter((c) => wanted.has(String(c.id))).length;
    } catch (e) {
        console.warn("raid categories failed:", e.message);
        return 0;
    }
}

/**
 * GET /api/settings/discord-servers — everything the "Discord-Server" page
 * (#891) shows and edits:
 *   - `discordServers`: servers and links.
 *   - `channels`: the two signup channels of every server that may hold its own
 *     settings (#924), "" = none (nothing is posted there).
 *   - `servers`: one row per configured server — Discord name, status, missing
 *     bot rights, members, raid categories (0 is a normal state: such a server
 *     only shows lists) and its Discord language.
 *   - `guilds`: every server the bot is on with its text channels and language
 *     (the pickers of the "add server" and "add link" dialogs).
 *   - `versions`: the game versions for the link's version chips.
 */
const getDiscordServers = withUser({ full: true }, ({ res }) => {
    const config = getConfig();
    const block = config.discordServers || {};
    const servers = (block.servers || []).map((entry) => {
        const card = guildRoles.describeGuild(entry.guildId, "event");
        const guild = discord.getGuild(entry.guildId);
        return {
            ...card,
            label: entry.label || "",
            raidCategories: raidCategoryCount(entry.guildId, config),
            lang: localeLang(guild && guild.preferredLocale),
        };
    });
    const guilds = (discord.listGuilds() || []).map((g) => {
        const guild = discord.getGuild(g.id);
        return { id: g.id, name: g.name, lang: localeLang(guild && guild.preferredLocale), channels: discord.listTextChannels(g.id) };
    });
    ok(res, {
        discordServers: { servers: block.servers || [], links: block.links || [] },
        channels: Object.fromEntries([...settingGuildsOf(config)].map((guildId) => [guildId, {
            signupNoteChannelId: serverDefaults.signupNoteChannelId(guildId, { config }),
            guildBankChannelId: serverDefaults.guildBankChannelId(guildId, { config }),
        }])),
        servers,
        guilds,
        versions: VERSIONS.map((v) => ({ id: v.id, label: v.label, short: v.short })),
    });
});

/**
 * Check the servers/links of a PATCH (#891) and return them cleaned, or
 * `{ error }` with the reason. Unlike normalizeLinks(), which silently drops a
 * bad link on read, a save says what is wrong: an unknown source server, a
 * missing channel, a duplicate `from:to` pair. `links` are checked against the
 * servers sent along, or the stored ones when only the links are sent.
 */
function checkServersAndLinks(sent, stored) {
    const out = {};
    let serverIds = (stored.servers || []).map((s) => s.guildId);
    if (sent.servers !== undefined) {
        if (!Array.isArray(sent.servers)) return { error: "Die Serverliste fehlt." };
        if (sent.servers.length > MAX_SERVERS) return { error: `Höchstens ${MAX_SERVERS} Server.` };
        const seen = new Set();
        out.servers = [];
        for (const raw of sent.servers) {
            const guildId = String((raw && raw.guildId) || "").trim();
            if (!isSnowflake(guildId)) return { error: "Unbekannter Server." };
            if (seen.has(guildId)) return { error: "Server doppelt eingetragen." };
            seen.add(guildId);
            const entry = { guildId, label: String((raw && raw.label) || "").trim().slice(0, EVENT_GUILD_LABEL_MAX) };
            // "PuG-Server" switch (#906): stored only when on, like normalizeServerEntry().
            if (raw.pug === true) entry.pug = true;
            out.servers.push(entry);
        }
        // Only servers sent: a stored link whose source goes away would be
        // dropped silently on save — say so instead.
        if (sent.links === undefined && (stored.links || []).some((l) => !seen.has(l.from))) {
            return { error: "Der Server ist noch Quelle einer Verknüpfung – erst die Verknüpfung entfernen." };
        }
        serverIds = out.servers.map((s) => s.guildId);
    }
    if (sent.links !== undefined) {
        if (!Array.isArray(sent.links)) return { error: "Die Verknüpfungen fehlen." };
        const known = new Set(serverIds);
        const versionIds = new Set(VERSIONS.map((v) => v.id));
        const pairs = new Set();
        out.links = [];
        for (const raw of sent.links) {
            const link = raw && typeof raw === "object" ? raw : {};
            const from = String(link.from || "").trim();
            const to = String(link.to || "").trim();
            const channelId = String(link.channelId || "").trim();
            if (!known.has(from)) return { error: "Unbekannter Quell-Server." };
            if (!isSnowflake(to)) return { error: "Unbekannter Ziel-Server." };
            if (!isSnowflake(channelId)) return { error: "Kanal fehlt." };
            if (pairs.has(`${from}:${to}`)) return { error: "Diese Verknüpfung gibt es schon." };
            pairs.add(`${from}:${to}`);
            const lang = String(link.lang || "");
            if (!["", "de", "en"].includes(lang)) return { error: "Unbekannte Sprache." };
            const versions = link.versions === undefined ? [] : link.versions;
            if (!Array.isArray(versions) || versions.some((v) => !versionIds.has(String(v)))) return { error: "Unbekannte Spielversion." };
            out.links.push({ from, to, channelId, lang, versions: [...new Set(versions.map(String))] });
        }
    }
    return out;
}

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
 * configured server's raid categories with names and the last sweep.
 * Full admins only (#957): it lists the categories of every server.
 */
const getReminders = withUser({ full: true }, async ({ res }) => {
    const config = getConfig();
    // Names from the live list backed by earlier snapshots, so a category the
    // bot cannot see right now still reads as a name rather than an id — and a
    // category that only exists on a secondary server still gets one.
    const names = new Map();
    for (const guildId of guildRoles.eventGuildIds(config)) {
        for (const c of listKnownCategories(guildId) || []) if (!names.has(c.id)) names.set(c.id, c.name);
    }
    const ids = [...new Set([...(config.categoryIds || []), ...Object.keys(config.categoryReminders || {})])];
    ok(res, {
        categoryReminders: config.categoryReminders || {},
        // `active: false`: a deactivated category (#744) — its rule stays, but it reminds nobody.
        categories: ids.map((id) => ({ id, name: names.get(id) || "", roleCount: expectedRoleIds(id, config).length, active: categoryLifecycle.isCategoryActive(id, config) })),
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
 * serverSettings without the rights of any server (#925): those reach the
 * browser only as the top-level fields of the active server, and only for a
 * full admin - a limited settings user must not read who may do what.
 */
function serverSettingsWithoutAccess(serverSettings) {
    const blocks = serverSettings && typeof serverSettings === "object" && !Array.isArray(serverSettings) ? serverSettings : {};
    return Object.fromEntries(Object.entries(blocks).map(([gid, block]) => [gid, omit(block || {}, SERVER_ACCESS_KEYS)]));
}

/**
 * The config the settings page gets (GET and the PATCH answer): a full admin
 * sees the rights of the active server as top-level fields (an empty server =
 * empty rights; the old top-level fields of before the migration never show),
 * a limited settings user sees no access key and no credential at all.
 * serverSettings: a full admin gets every server's block, anybody else only
 * the active server's - the settings of another server are not theirs (#925).
 */
function viewConfig(config, { isAdmin, guildId }) {
    const base = { ...config };
    if (base.serverSettings !== undefined) {
        const blocks = serverSettingsWithoutAccess(base.serverSettings);
        const gid = String(guildId || "");
        base.serverSettings = isAdmin ? blocks : (gid && blocks[gid] ? { [gid]: blocks[gid] } : {});
    }
    const view = isAdmin ? { ...base, ...accessSettings(guildId, config) } : omit(base, FULL_ADMIN_KEYS);
    return publicConfig(view);
}

/** Whether a body's serverSettings touches a rights key of any server (#925). */
function touchesServerAccess(serverSettings) {
    if (!serverSettings || typeof serverSettings !== "object") return false;
    return Object.values(serverSettings).some((block) => block && typeof block === "object"
        && SERVER_ACCESS_KEYS.some((k) => block[k] !== undefined));
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
    if (config.github !== undefined) {
        out.github = { hasToken: !!(config.github && config.github.token) };
    }
    if (config.serverSettings !== undefined) out.serverSettings = publicServerSettings(config.serverSettings);
    // #952: the old global list is kept for the server only, the browser reads the lists per server
    delete out.topItemsLegacy;
    return out;
}

/** The per-server settings without a Raid-Helper key (#927): only whether one is set. */
function publicServerSettings(serverSettings) {
    const out = {};
    for (const [guildId, block] of Object.entries(serverSettings || {})) {
        if (!block || typeof block !== "object" || !block.raidhelper) {
            out[guildId] = block;
            continue;
        }
        const { apiKey, ...rest } = block.raidhelper || {};
        out[guildId] = { ...block, raidhelper: { ...rest, hasKey: !!apiKey } };
    }
    return out;
}

/** The server the Raid-Helper section edits (#927): the active one, else the first. */
function raidhelperGuildOf(req, config) {
    return String(activeGuildFor(req) || firstServerId(config) || "");
}

const RAIDHELPER_KEY_MAX = 200;

/**
 * The stored Raid-Helper block of a server after a PATCH (#927): `enabled`,
 * `serverId` (empty = the guild's own id) and `apiKey` (omit = keep, "" =
 * clear) taken from the body, the rest kept. `{ error }` on a bad value.
 */
function raidhelperPatch(body, guildId, config) {
    if (!guildId) return { error: "Kein Discord-Server bekannt." };
    const raw = body && typeof body === "object" ? body : {};
    const current = raidhelperSettingOf(guildId, config);
    const next = { ...current };
    if (raw.enabled !== undefined) next.enabled = raw.enabled === true;
    if (raw.serverId !== undefined) {
        const serverId = String(raw.serverId || "").trim();
        if (serverId && !isSnowflake(serverId)) return { error: "Die Raid-Helper-Server-ID ist keine Discord-ID." };
        next.serverId = serverId;
    }
    if (raw.apiKey !== undefined) {
        const apiKey = String(raw.apiKey || "").trim();
        if (apiKey.length > RAIDHELPER_KEY_MAX || /\s/.test(apiKey)) return { error: "Der Raid-Helper-Schlüssel ist ungültig." };
        next.apiKey = apiKey;
        // a key entered here replaces the .env fallback of the migrated server
        if (apiKey) next.envKey = false;
    }
    return { block: next };
}

// The blizzard fields taken from a PATCH body besides the secret. The realm
// (region, realm slug, namespace) is per game version since #542.
const BLIZZARD_FIELDS = ["clientId"];

/**
 * The versionSettings of a PATCH body (#542): per known version the fields
 * sent, each checked. A filled value the schema would throw away (a template
 * without {char}, a region that does not exist, a raidsheet nobody has) is an
 * error with its field, never a silent "" - the admin sees what was wrong.
 * @returns {{ partial: object } | { error: string }}
 */
function versionSettingsPatch(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const sheets = new Set(listRaidsheets().map((sh) => sh.id));
    const partial = {};
    for (const v of VERSIONS) {
        const block = src[v.id];
        if (!block || typeof block !== "object") continue;
        const clean = versionSettings.normalizeBlock(block);
        partial[v.id] = {};
        for (const field of versionSettings.FIELDS) {
            if (block[field] === undefined) continue;
            const sent = String(block[field] === null ? "" : block[field]).trim();
            if (sent && !clean[field]) return { error: `${v.label}: ${field} ist ungültig.`, field, versionId: v.id };
            if (field === "raidsheetId" && clean[field] && !sheets.has(clean[field])) return { error: `${v.label}: Raidsheet nicht gefunden.`, field, versionId: v.id };
            partial[v.id][field] = clean[field];
        }
        // The features switched off (#761): a list of known feature ids, sent whole.
        if (block.disabled !== undefined) {
            const list = Array.isArray(block.disabled) ? block.disabled : null;
            const unknown = list ? list.find((f) => !isVersionFeature(f)) : "";
            if (!list || unknown !== undefined) {
                return { error: unknown ? `${v.label}: unbekannte Funktion „${unknown}“.` : `${v.label}: disabled ist ungültig.`, field: "disabled", versionId: v.id };
            }
            partial[v.id].disabled = normalizeDisabled(list);
        }
    }
    return { partial };
}

// --- per-server version overrides (#923, epic #926) ---
/**
 * The armory/log templates and Blizzard realm the active server sets for
 * itself, from `body.versionOverrides` (sent whole for the server the page
 * loaded; an empty field falls back to the version's standard). A filled value
 * the schema would throw away is an error with its field, like
 * versionSettingsPatch. Which server it is decides serverSettingsTarget().
 * @returns {{ block: object } | { error: string, field: string, versionId: string }}
 */
function versionOverridesPatch(raw) {
    const problem = overrideProblems(raw)[0];
    if (problem) {
        const label = (VERSIONS.find((v) => v.id === problem.versionId) || { label: problem.versionId }).label;
        return { error: `${label}: ${problem.field} ist ungültig.`, field: problem.field, versionId: problem.versionId };
    }
    return { block: normalizeVersionOverrides(raw) };
}
// --- end per-server version overrides ---

/**
 * The addon list of a PATCH (#818). Einstellungen -> Module -> Addons is the
 * only sender and saves it on its own: the list sent whole (an edit, so the
 * edit mark goes with it and an emptied list stays empty), or
 * `addonDownloadsReset: true` for "Standard wiederherstellen" (the defaults,
 * mark cleared). A body that carries the list along with anything else is no
 * edit of it and is refused, as is a list of which no entry survives the
 * normaliser - neither may ever wipe the page "Addons". No list = nothing.
 * @returns {{ partial: object } | { error: string }}
 */
function addonListPatch(body) {
    const reset = body.addonDownloadsReset === true;
    if (body.addonDownloads === undefined && !reset) return { partial: {} };
    const others = Object.keys(body).filter((k) => !ADDON_KEYS.includes(k));
    if (others.length) return { error: "Die Addon-Liste wird nur für sich gespeichert, nicht zusammen mit anderen Einstellungen." };
    if (reset) return { partial: { addonDownloads: defaultAddons(), addonDownloadsCustomized: false } };
    if (!Array.isArray(body.addonDownloads)) return { error: "addonDownloads muss eine Liste sein." };
    const list = normalizeAddonList(body.addonDownloads);
    if (body.addonDownloads.length && !list.length) return { error: "Kein Eintrag der Liste ist ein gültiges Addon (Name und Repo fehlen)." };
    return { partial: { addonDownloads: list, addonDownloadsCustomized: true } };
}

/**
 * PATCH /api/settings — merge-updates the admin config. Only keys present in
 * the body are changed (saveConfig() itself merges serverSettings/blizzard).
 * blizzard.clientSecret: omit to keep the stored secret, send "" to clear it,
 * send a value to replace it (the client only includes it when the admin
 * actually chose to change it — see BlizzardSecretField in SettingsPage.tsx).
 * adminRoleIds/rolePermissions (ACCESS_KEYS) and the Anthropic/WCL
 * credentials (CREDENTIAL_KEYS) are full-admin-only.
 */
const updateSettings = withUser({ csrf: true, body: true }, async ({ body, req, res, user }) => {
    // #952: the top items live per server and version now (PUT /api/top-items) - a stale tab is told so
    if (body.topItems !== undefined) return error(res, 400, "moved", "Die Top-Items stehen jetzt je Server und Version – bitte die Seite neu laden.");
    const touchesGuarded = [...FULL_ADMIN_KEYS, ...SHARED_WRITE_KEYS].some((k) => body[k] !== undefined) || touchesServerAccess(body.serverSettings);
    if (touchesGuarded && !requireFullAdmin(req, res)) return;
    // checked before anything else, so a stale tab changes nothing at all
    const server = serverSettingsTarget(req, body, getConfig());
    if (server && server.status) return error(res, server.status, server.code, server.message);
    // #924: without an active server the language is the default of every server - full admins only
    const writesDefault = !!(server && server.global) && GLOBAL_DEFAULT_KEYS.some((k) => body[k] !== undefined);
    if (writesDefault && !requireFullAdmin(req, res)) return;
    const partial = {};
    // global: the full-admin roles count on every server
    if (body.adminRoleIds !== undefined) partial.adminRoleIds = asStringArray(body.adminRoleIds);
    // #925: the other rights belong to the active server and are written there only
    const access = {};
    // which roles count as orga (the rest are raider roles) — guarded like the access keys
    if (body.orgaRoleIds !== undefined) access.orgaRoleIds = asStringArray(body.orgaRoleIds);
    if (body.rolePermissions !== undefined) access.rolePermissions = normalizeRolePermissions(body.rolePermissions);
    if (body.baseAccess !== undefined) access.baseAccess = normalizeAreaAccess(body.baseAccess);
    if (body.userPermissions !== undefined) access.userPermissions = normalizeUserPermissions(body.userPermissions);
    // Sent as the whole map: a command left out follows its defaultAccess again.
    if (body.botCommandAccess !== undefined) access.botCommandAccess = normalizeBotCommandAccess(body.botCommandAccess);
    if (Object.keys(access).length) {
        // serverSettingsTarget() checked the tab's server against the active one (409) and that
        // one is active at all (400) - rights never fall back to the first server
        partial.serverSettings = { [server.guildId]: access };
    }
    if (body.guildId !== undefined) partial.guildId = String(body.guildId).trim();
    // Only the fields sent: settingsStore merges them into the stored block and
    // normalises the result, so a PATCH of one channel keeps both servers.
    if (body.discordServers !== undefined && body.discordServers && typeof body.discordServers === "object") {
        partial.discordServers = {};
        // The old dialog's `eventGuilds` list is gone with #891, the two global channels
        // with #924: a tab still open on them must not overwrite what it knows nothing about.
        if (body.discordServers.eventGuilds !== undefined || SERVER_CHANNEL_FIELDS.some((k) => body.discordServers[k] !== undefined)) {
            return error(res, 400, "invalid_discord_servers", "Veraltetes Format – bitte die Seite neu laden.");
        }
        const stored = getConfig();
        const checked = checkServersAndLinks(body.discordServers, stored.discordServers || {});
        if (checked.error) return error(res, 400, "invalid_discord_servers", checked.error);
        if (checked.servers) partial.discordServers.servers = checked.servers;
        if (checked.links) partial.discordServers.links = checked.links;
        // #924: the signup channels per server, for the servers known after this save.
        if (body.discordServers.channels !== undefined) {
            const storedBlock = stored.discordServers || {};
            const known = serverSettingGuildIds(
                { servers: checked.servers || storedBlock.servers || [], links: checked.links || storedBlock.links || [] }, stored.guildId || "",
            );
            const channels = checkServerChannels(body.discordServers.channels, known);
            if (channels.error) return error(res, 400, "invalid_discord_servers", channels.error);
            // merged per server: rights sent in the same body (above) must not get lost
            const servers = { ...(partial.serverSettings || {}) };
            for (const [gid, block] of Object.entries(channels.channels || {})) servers[gid] = { ...(servers[gid] || {}), ...block };
            partial.serverSettings = servers;
        }
        if (!Object.keys(partial.discordServers).length) delete partial.discordServers;
    }
    if (body.raidhelperServerId !== undefined) partial.raidhelperServerId = String(body.raidhelperServerId).trim();
    // #924: application channel, officer role, raid defaults and bot language belong to the active
    // server — the one checked by serverSettingsTarget() (no first-server fallback for these).
    // Without one the language goes to the global default (checked above).
    const ownServer = serverDefaultsPatch(body);
    // #961 the drawn pictures: only the known switches, as booleans
    const sentVisuals = body.discordVisuals && typeof body.discordVisuals === "object" ? ownVisualsOf(body.discordVisuals) : null;
    if (writesDefault) {
        if (body.botLanguage !== undefined) partial.botLanguage = ownServer.botLanguage;
        delete ownServer.botLanguage;
        // the global default, merged per switch by the store
        if (sentVisuals) partial.discordVisuals = sentVisuals;
    } else if (body.discordVisuals === null) {
        // "use the default again": the server's own switches go (serverSettingsTarget checked there is a server)
        ownServer.discordVisuals = undefined;
    } else if (sentVisuals && server && server.guildId) {
        // the server's own switches: the ones sent over the ones it set before (the store replaces the key whole)
        const before = ownVisualsOf(((getConfig().serverSettings || {})[server.guildId] || {}).discordVisuals);
        ownServer.discordVisuals = { ...before, ...sentVisuals };
    }
    if (Object.keys(ownServer).length) {
        const guildId = server ? server.guildId : "";
        if (!guildId || !settingGuildsOf(getConfig()).has(guildId)) {
            return error(res, 400, "unknown_server", UNKNOWN_SERVER);
        }
        const merged = { ...((partial.serverSettings || {})[guildId] || {}), ...ownServer };
        partial.serverSettings = { ...(partial.serverSettings || {}), [guildId]: merged };
    }
    // #927: the active server's Raid-Helper block, merged here (the store replaces a server's key whole)
    let raidhelperGuild = "";
    if (body.raidhelper !== undefined) {
        // the server checked by serverSettingsTarget() (active, else the first one)
        raidhelperGuild = server.guildId;
        const patch = raidhelperPatch(body.raidhelper, raidhelperGuild, getConfig());
        if (patch.error) return error(res, 400, "invalid_raidhelper", patch.error);
        const servers = { ...(partial.serverSettings || {}) };
        servers[raidhelperGuild] = { ...(servers[raidhelperGuild] || {}), raidhelper: patch.block };
        partial.serverSettings = servers;
    }
    if (body.categoryIds !== undefined) partial.categoryIds = asStringArray(body.categoryIds);
    if (body.categoryRoles !== undefined && typeof body.categoryRoles === "object") partial.categoryRoles = body.categoryRoles;
    // #921: the log channels of the server the tab loaded, sent whole (ids or { channelId, versionId }).
    if (body.logChannels !== undefined) {
        const { guildId } = server;
        const config = getConfig();
        const parents = new Map((discord.listAllChannels(guildId) || []).map((c) => [c.id, c.parentId || ""]));
        const logChannels = logChannelsFromBody(body.logChannels, {
            current: logChannelsOf(guildId, { config }), parentOf: (id) => parents.get(id) || "", config,
        });
        partial.serverSettings = { ...(partial.serverSettings || {}) };
        partial.serverSettings[guildId] = { ...(partial.serverSettings[guildId] || {}), logChannels };
    }
    // #922 the WCL guilds of the active server: version, guild, realm, region,
    // interval from the page; lastRunAt/lastResult stay the job's.
    if (body.wclGuilds !== undefined) {
        const { guildId } = server;
        const wclGuilds = wclGuildsFromBody(body.wclGuilds, { current: wclGuildsOf(guildId, { config: getConfig() }) });
        partial.serverSettings = { ...(partial.serverSettings || {}) };
        partial.serverSettings[guildId] = { ...(partial.serverSettings[guildId] || {}), wclGuilds };
    }
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
    // github.token (#818): the same contract — omit = keep, "" = clear.
    if (body.github !== undefined && body.github && typeof body.github === "object" && body.github.token !== undefined) {
        partial.github = { token: String(body.github.token || "").trim() };
    }
    // The addon list (#818): only its own section sends it, alone (addonListPatch).
    const addons = addonListPatch(body);
    if (addons.error) return error(res, 400, "invalid_addons", addons.error);
    Object.assign(partial, addons.partial);
    if (body.categoryLootTool !== undefined) partial.categoryLootTool = normalizeCategoryLootTool(body.categoryLootTool);
    if (body.categoryLootSystem !== undefined) partial.categoryLootSystem = normalizeCategoryLootSystemPatch(body.categoryLootSystem);
    if (body.categorySignupSource !== undefined) partial.categorySignupSource = normalizeCategorySignupSource(body.categorySignupSource);
    if (body.categorySetupDms !== undefined) partial.categorySetupDms = normalizeCategorySetupDms(body.categorySetupDms);
    // The language of a category's public messages: "de" / "en", "" = back to the server language.
    if (body.categoryLanguage !== undefined) partial.categoryLanguage = normalizeCategoryLanguagePatch(body.categoryLanguage);
    // Attendance per category: each category sent whole ({ show, window, absences }); the store drops one at the defaults.
    if (body.categoryAttendance !== undefined && body.categoryAttendance && typeof body.categoryAttendance === "object") {
        partial.categoryAttendance = Object.fromEntries(Object.entries(body.categoryAttendance)
            .filter(([id]) => String(id).trim())
            .map(([id, value]) => [String(id).trim(), attendanceSettings(value)]));
    }
    if (body.categoryDiscordEvent !== undefined) partial.categoryDiscordEvent = normalizeCategoryDiscordEvent(body.categoryDiscordEvent);
    if (body.categoryServerOverview !== undefined) partial.categoryServerOverview = normalizeCategoryServerOverviewPatch(body.categoryServerOverview);
    if (body.categoryVoiceChannel !== undefined) partial.categoryVoiceChannel = normalizeCategoryVoiceChannel(body.categoryVoiceChannel);
    if (body.categoryMessageLook !== undefined) partial.categoryMessageLook = normalizeCategoryMessageLookPatch(body.categoryMessageLook);
    if (body.categoryAnnounce !== undefined) partial.categoryAnnounce = normalizeCategoryAnnounce(body.categoryAnnounce);
    if (body.categorySignupNotes !== undefined) partial.categorySignupNotes = normalizeCategorySignupNotesPatch(body.categorySignupNotes);
    // The channel of those messages per category (#335): same contract as the voice channel.
    if (body.categorySignupNoteChannel !== undefined) partial.categorySignupNoteChannel = normalizeCategoryVoiceChannel(body.categorySignupNoteChannel);
    // Characters per signup per category (1..8, clamped): the 8 stays in the patch
    // so the store's merge sets the category back to the default and drops it.
    if (body.categorySignupCharacters !== undefined) {
        partial.categorySignupCharacters = normalizeCategorySignupCharacters(body.categorySignupCharacters, { keepDefault: true });
    }
    if (body.categorySheets !== undefined) partial.categorySheets = normalizeCategorySheets(body.categorySheets);
    // Raid plan or sheet per category: merged by the store, an unknown mode drops out.
    if (body.categoryPlanning !== undefined) partial.categoryPlanning = normalizeCategoryPlanning(body.categoryPlanning);
    // Sent whole; an id no template has is dropped, so a category can never
    // point at a template that is not there (the store normalises the rest).
    if (body.categoryRaidTemplate !== undefined) {
        const known = new Set(listRaidTemplates().map((t) => t.id));
        const raw = body.categoryRaidTemplate && typeof body.categoryRaidTemplate === "object" ? body.categoryRaidTemplate : {};
        partial.categoryRaidTemplate = Object.fromEntries(Object.entries(raw).filter(([, id]) => known.has(String(id || ""))));
    }
    // The main version and the categories that play another one (#541): the
    // store keeps only known version ids, the map is sent whole.
    if (body.mainVersion !== undefined) partial.mainVersion = String(body.mainVersion || "").trim();
    if (body.categoryVersion !== undefined) {
        partial.categoryVersion = body.categoryVersion && typeof body.categoryVersion === "object" ? body.categoryVersion : {};
    }
    if (body.hideOtherVersions !== undefined) partial.hideOtherVersions = body.hideOtherVersions === true;
    // The drawn pictures in bot messages (#961): per server or the global default - written above with the server's values.
    // Dungeon records (Einstellungen -> Dungeon-Bestzeiten): only the two fields, merged and checked by the store.
    if (body.dungeonRecords !== undefined && body.dungeonRecords && typeof body.dungeonRecords === "object") {
        partial.dungeonRecords = {};
        if (typeof body.dungeonRecords.post === "boolean") partial.dungeonRecords.post = body.dungeonRecords.post;
        if (body.dungeonRecords.channelId !== undefined) partial.dungeonRecords.channelId = String(body.dungeonRecords.channelId || "").trim();
    }
    // Per version (#542): only the versions and fields sent, merged by the store.
    if (body.versionSettings !== undefined) {
        const patch = versionSettingsPatch(body.versionSettings);
        if (patch.error) return error(res, 400, "invalid_version_settings", patch.error);
        partial.versionSettings = patch.partial;
    }
    // Per server (#923): the active server's own armory/log templates and realm per version.
    if (body.versionOverrides !== undefined) {
        const overrides = versionOverridesPatch(body.versionOverrides);
        if (overrides.error) return error(res, 400, "invalid_version_settings", overrides.error);
        partial.serverSettings = { ...(partial.serverSettings || {}) };
        partial.serverSettings[server.guildId] = { ...(partial.serverSettings[server.guildId] || {}), versionOverrides: overrides.block };
    }
    // Complete values as well; settingsStore validates them (snowflakes, known
    // directions and targets, hours 1–168) and replaces the stored ones.
    if (body.roleSync !== undefined) partial.roleSync = Array.isArray(body.roleSync) ? body.roleSync : [];
    if (body.categoryReminders !== undefined) {
        partial.categoryReminders = body.categoryReminders && typeof body.categoryReminders === "object" ? body.categoryReminders : {};
    }
    const before = getConfig();
    // #926: a save on one server never adds or removes a category of another one.
    // The server is the tab's (checked by serverSettingsTarget()), never the session's alone:
    // a tab on A saving after another tab switched to B would otherwise empty B's part.
    if (partial.categoryIds !== undefined) partial.categoryIds = mergedCategoryIds(partial.categoryIds, before, server.guildId);
    // #925: everybody but a full admin changes the categories of the active server only
    // (after the merge, so the other servers' kept part is no "edit")
    if (foreignCategoryEdits(partial, before, { user, req }).length) return error(res, 403, "other_server", OTHER_SERVER);
    // #744: no active category at all would read as "every category" — refused while raids exist.
    if (emptiesActiveCategories(partial, before)) return error(res, 400, "categories_empty", categoryLifecycle.EMPTY_LIST_MESSAGE);
    // #738: every active category plays an explicit version; a changed one starts a new section.
    const versions = categoryVersionPatch(body, partial, before);
    if (versions.error) return error(res, 400, "category_version_missing", versions.error);
    // #930: a role of the PuG onboarding (everyone takes it) must not gain a right here.
    const pugGrants = pugGrantsOf(before, partial, versions.switches, body.categorySwitchFixes);
    if (pugGrants.found.length) return error(res, 409, "pug_onboarding_role", pugRoleGuard.refusalMessage(pugGrants.found, { reopened: pugGrants.reopened }));
    // #962: a block for a server that is not entered would be dropped silently - refused instead
    if (unknownServerBlocks(partial, before).length) return error(res, 400, "unknown_server", UNKNOWN_SERVER);
    const langBefore = serverLangsOf(before);
    // #744: what deactivating pauses (series, reminders), for the save's answer.
    const deactivated = deactivationOf(partial, before);
    const saved = saveConfig(partial);
    // The settings still edit a category's raider roles; the roster of the version a category plays
    // follows them (#653) - not for a category switched just now: its roster changes below (#739).
    const switchedIds = new Set(versions.switches.map((sw) => sw.categoryId));
    if (partial.categoryRoles !== undefined) syncRosterRoleIds(saved.categoryRoles, { actor: String((user && user.id) || ""), config: saved, skip: switchedIds });
    // #739: the listeners (the roster: close the old one, maybe a new one) get the dialog's choices
    const switchedCategories = await notifyCategoryVersionSwitch(
        afterCategorySwitches(versions.switches, body.categorySwitchFixes, { user }),
        { config: saved, user, fixes: body.categorySwitchFixes && typeof body.categorySwitchFixes === "object" ? body.categorySwitchFixes : {} },
    );
    // A new server language (#924: of any server), or a category's own, redraws the bot's public messages (not awaited).
    if (serverLangsOf(saved) !== langBefore || JSON.stringify(saved.categoryLanguage || {}) !== JSON.stringify(before.categoryLanguage || {})) {
        void languageChange.afterServerLangChange({ config: saved });
    }
    // The guild bank area of the raider organizers comes and goes with its channel:
    // redraw them now instead of at the next five-minute sweep (not awaited, never throws).
    else if (guildBankOf(saved) !== guildBankOf(before)) void availabilityPanel.refreshPanels({ config: saved }).catch(() => {});
    // A category taken into or out of the server overview: the overviews are redrawn after the
    // usual short pause (the same nudge an event change gives), not at the next sweep.
    if (stableJson(saved.categoryServerOverview || {}) !== stableJson(before.categoryServerOverview || {})) raidOverview.scheduleRefresh();
    // a switch may have changed the raider roles (#739: they mirror the new roster) - answer what is stored now
    const after = switchedCategories.length ? getConfig() : saved;
    ok(res, {
        config: viewWithDefaults(after, { isAdmin: !!(user && user.isAdmin), guildId: activeGuildFor(req) }),
        switchedCategories,
        deactivatedCategories: deactivated,
        ...(raidhelperGuild ? { raidhelper: maskedRaidhelper(raidhelperGuild, saved) } : {}),
        ...(body.wclGuilds !== undefined && server ? { wclGuilds: wclGuildsOf(server.guildId, { config: saved }) } : {}),
        // #926: with the active server's part of categoryIds, so the page keeps showing only its own
        ...serverCategoriesOf(after, server ? server.guildId : activeGuildFor(req)),
    });
});

// ---- rights per server (#925, docs/permissions.md) ----
// The category maps the store replaces whole: a category left out of them is changed too.
const WHOLE_CATEGORY_MAPS = new Set(["categoryRaidTemplate", "categoryVersion", "categoryReminders"]);
// Derived by this route (from categoryVersion, which is checked), not sent by the client.
const DERIVED_CATEGORY_MAPS = new Set(["categoryEras"]);

/** Key order does not make a value different. */
function stableJson(value) {
    return JSON.stringify(value, (_k, v) => (v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, v[key]]))
        : v));
}

/** The server of a category: Discord's cache, else the stored name snapshot (a deleted one); "" = unknown. */
function categoryGuildOf(categoryId) {
    const id = String(categoryId || "").trim();
    if (!id) return "";
    const live = guildOfChannel(id);
    if (live) return live;
    try {
        return String(storedCategoryGuilds().get(id) || "");
    } catch {
        return "";
    }
}

/** May user change the category's settings: a full admin always, else only one of the active server. */
const mayEditCategory = (user, req, categoryId) => mayUseServer(user, req, categoryGuildOf(categoryId));

/**
 * The categories of another server (or an unknown one) a PATCH would change - [] for a full
 * admin. Compared with the stored values, so a tab that sends a whole map back unchanged passes;
 * an entry that differs, is new, or (a map replaced whole, the active list) goes, counts.
 */
function foreignCategoryEdits(partial, before, { user, req }) {
    if (user && user.isAdmin) return [];
    const touched = new Set();
    if (Array.isArray(partial.categoryIds)) {
        const was = new Set(asStringArray(before.categoryIds));
        const now = new Set(partial.categoryIds);
        for (const id of now) if (!was.has(id)) touched.add(id);
        for (const id of was) if (!now.has(id)) touched.add(id);
    }
    for (const [key, map] of Object.entries(partial)) {
        if (!/^category[A-Z]/.test(key) || DERIVED_CATEGORY_MAPS.has(key)) continue;
        if (!map || typeof map !== "object" || Array.isArray(map)) continue;
        const stored = before[key] && typeof before[key] === "object" ? before[key] : {};
        for (const [id, value] of Object.entries(map)) {
            if (stableJson(value) !== stableJson(stored[id])) touched.add(String(id));
        }
        if (WHOLE_CATEGORY_MAPS.has(key)) for (const id of Object.keys(stored)) if (!(id in map)) touched.add(String(id));
    }
    return [...touched].filter((id) => !mayEditCategory(user, req, id));
}

/** The categories a PATCH takes out of the active list, with what pauses (#744) — logged once. */
function deactivationOf(partial, before) {
    if (partial.categoryIds === undefined) return [];
    const list = categoryLifecycle.deactivationPreview({ config: before, nextIds: partial.categoryIds }).categories;
    for (const d of list) {
        const paused = [d.series && d.series.enabled ? "Serie" : "", d.reminders ? "Erinnerungen" : ""].filter(Boolean).join(", ");
        console.log(`[settings] Kategorie ${d.categoryId} deaktiviert (#744)${paused ? `, pausiert: ${paused}` : ""}`);
    }
    return list;
}

/**
 * The rights the PATCH would give a PuG onboarding role (#930) - including what a version
 * switch does after the save: the roster it creates with the dialog's roles and the raider
 * roles mirrored from it (rosterVersionSwitch), checked before anything is written.
 * `reopened`: the rosters a switch back opens again, for the refusal's way out.
 */
function pugGrantsOf(before, partial, switches, fixes) {
    const after = { ...before, ...partial };
    // the rights of a server are merged into the stored blocks, as saveConfig does (#925)
    if (partial.serverSettings) after.serverSettings = mergeServerSettings(before.serverSettings, partial.serverSettings);
    let rostersAfter;
    let reopened = [];
    if (switches.length) {
        const sim = rostersAfterSwitches(switches, fixes);
        rostersAfter = sim.rosters;
        reopened = sim.reopened;
        after.categoryRoles = { ...(after.categoryRoles || {}), ...sim.categoryRoles };
    }
    return { found: pugRoleGuard.newGrants({ before, after, rostersAfter }), reopened };
}

/** Whether a PATCH takes the last active category away although raids exist (#744). */
function emptiesActiveCategories(partial, before) {
    if (partial.categoryIds === undefined || partial.categoryIds.length) return false;
    // An install that never picked one keeps "every category" (it was never a choice made here).
    if (!(before.categoryIds || []).length) return false;
    return categoryLifecycle.emptyListBlocked(partial.categoryIds);
}

/** The categories Discord no longer has, with their names (#744). Best-effort: [] on any trouble. */
function missingCategoriesOf(config, guildId, ctx) {
    try {
        const context = ctx || categoryGuild.categoryContext(config);
        const names = categoryNamesOf(config);
        return categoryLifecycle.missingCategories({ config, nameOf: (id) => names.get(id) || "", guildId: guildId || context.first, ctx: context });
    } catch (e) {
        console.warn("missingCategories failed:", e.message);
        return [];
    }
}

/**
 * The raid categories of one server (#926, prod incident 2026-10-27): the ids of
 * config.categoryIds shown and edited on `guildId` (one without a proven,
 * configured server shows on the first server), those of them without such a
 * server (marked, never closable), and the ones proven deleted there.
 * Best-effort: on any trouble nothing reads as deleted.
 */
function serverCategoriesOf(config, guildId) {
    const stored = asStringArray(config.categoryIds);
    try {
        const ctx = categoryGuild.categoryContext(config);
        const serverCategoryIds = categoryGuild.idsOnServer(stored, guildId, ctx);
        const configured = [...new Set([...stored, ...categoryLifecycle.configuredCategoryIds(config)])];
        const own = new Set(categoryGuild.idsOnServer(configured, guildId, ctx));
        const gid = String(guildId || "").trim() || ctx.first;
        return {
            serverCategoryIds,
            // every configured category shown here whose server is not a listed one (shown on the
            // first server) or whose fate is not provable - never closable
            unprovenCategoryIds: [...own].filter((id) => !categoryGuild.hasKnownServer(id, ctx)
                || categoryGuild.categoryState(id, ctx).state === "unknown"),
            // configured categories shown on another server: the page leaves their rows out
            otherServerCategoryIds: configured.filter((id) => !own.has(id)),
            missingCategories: missingCategoriesOf(config, guildId, ctx),
            // a server outside discordServers.servers: a save keeps no activation there (merge drops it)
            serverListed: !ctx.servers.length || ctx.servers.includes(gid),
        };
    } catch (e) {
        console.warn("server categories failed:", e.message);
        return { serverCategoryIds: stored, unprovenCategoryIds: stored, otherServerCategoryIds: [], missingCategories: [], serverListed: true };
    }
}

/** A PATCH's categoryIds merged into the stored list: only the saving server's part changes (#926). */
function mergedCategoryIds(sent, before, guildId) {
    return categoryGuild.mergeServerCategoryIds({ stored: asStringArray(before.categoryIds), sent, guildId, ctx: categoryGuild.categoryContext(before) });
}

/**
 * GET /api/settings/category-deactivate?next=a,b&guild=<id> — what saving the active
 * categories `next` pauses (#744): per category taken out its series and
 * reminders, and whether the list would be empty although raids exist.
 */
const getCategoryDeactivate = withUser({}, async ({ user, req, res, url }) => {
    const config = getConfig();
    // #926: `next` is the active server's list; the other servers' categories stay as stored
    const sent = String(url.searchParams.get("next") || "").split(",").map((s) => s.trim()).filter(Boolean);
    // the server the tab loaded (`guild`, "" = none active): 409 when the session switched since
    const server = serverSettingsTarget(req, { categoryIds: sent, serverSettingsGuildId: url.searchParams.get("guild") || "" }, config);
    if (!server.guildId) return error(res, server.status, server.code, server.message);
    const next = mergedCategoryIds(sent, config, server.guildId);
    const preview = categoryLifecycle.deactivationPreview({ config, nextIds: next });
    const names = categoryNamesOf(config);
    ok(res, {
        // #925: what pauses on another server is not this caller's business (a full admin sees all)
        categories: preview.categories.filter((c) => mayEditCategory(user, req, c.categoryId))
            .map((c) => ({ ...c, name: names.get(c.categoryId) || "" })),
        emptyBlocked: !next.length && !!(config.categoryIds || []).length && preview.emptyBlocked,
    });
});

/**
 * POST /api/settings/category-close { categoryId } — "Kategorie abschließen"
 * (#744) for a category deleted in Discord: its series, settings, reminders,
 * Loot-Council profile entry and Kader attendance entries go, its rosters are
 * closed (#739: readable, no role sync); raids, loot and
 * logs stay. 409 while Discord still has it, 503 while that is unknown.
 */
const closeCategoryHandler = withUser({ csrf: true, body: true }, async ({ body, req, res, user }) => {
    const categoryId = String((body && body.categoryId) || "").trim();
    // #925: a category of another server (or an unknown one) is not there for everybody but a full admin
    if (categoryId && !mayEditCategory(user, req, categoryId)) return error(res, 404, "not_found", "Kategorie nicht gefunden.");
    const config = getConfig();
    const name = categoryNamesOf(config).get(categoryId) || "";
    // #739: its rosters are closed too, by this caller
    // #926: only a category of the active server
    const result = categoryLifecycle.closeCategory(categoryId, { config, actor: String((user && user.id) || ""), guildId: activeGuildFor(req) });
    if (result.error) return error(res, result.error.status, result.error.code, result.error.message);
    console.log(`[settings] Kategorie ${name || categoryId} abgeschlossen (#744) von ${(user && (user.name || user.id)) || "?"}`);
    ok(res, { ...result, name, config: viewConfig(getConfig(), { isAdmin: !!(user && user.isAdmin), guildId: activeGuildFor(req) }), ...serverCategoriesOf(getConfig(), activeGuildFor(req)) });
});

/** Category id → name over every server (live list backed by the snapshot); "" when unknown. */
function categoryNamesOf(config) {
    const names = new Map();
    try {
        for (const guildId of guildRoles.eventGuildIds(config)) {
            for (const c of listKnownCategories(guildId) || []) if (c && !names.has(c.id)) names.set(c.id, c.name || "");
        }
    } catch {
        // a name is a courtesy: the section keeps "" and the id still says which category
    }
    return names;
}

/**
 * The category versions of a PATCH (#738). Every active category must have a
 * version — checked when the body touches the active categories or the map.
 * A category whose version changes starts a new section: `partial.categoryEras`
 * gets the history after the switch.
 * @returns {{ error?: string, switches: object[] }}
 */
function categoryVersionPatch(body, partial, before) {
    if (body.categoryIds === undefined && body.categoryVersion === undefined) return { switches: [] };
    const ids = partial.categoryIds !== undefined ? partial.categoryIds : (before.categoryIds || []);
    const map = normalizeCategoryVersion(partial.categoryVersion !== undefined ? partial.categoryVersion : before.categoryVersion);
    const missing = ids.filter((id) => !map[id]);
    const names = categoryNamesOf(before);
    if (missing.length) {
        return { error: `Jede aktive Kategorie braucht eine Spielversion: ${missing.map((id) => names.get(id) || id).join(", ")}.`, switches: [] };
    }
    if (partial.categoryVersion === undefined) return { switches: [] };
    const { switches, categoryEras } = versionSwitches({ before, categoryVersion: map, nameOf: (id) => names.get(id) || "" });
    if (categoryEras) partial.categoryEras = categoryEras;
    return { switches };
}

/**
 * The dialog's choice for each switched category's series (`categorySwitchFixes`
 * = `{ [categoryId]: { series: "pause" | templateId } }`), applied once the
 * switch is saved. Returns the switches with what happened to the series.
 */
function afterCategorySwitches(switches, fixes, { user }) {
    const src = fixes && typeof fixes === "object" && !Array.isArray(fixes) ? fixes : {};
    return (switches || []).map((sw) => {
        const fix = src[sw.categoryId] && typeof src[sw.categoryId] === "object" ? src[sw.categoryId].series : "";
        const series = applySeriesFix({ categoryId: sw.categoryId, fix, toVersion: sw.toVersion, getTemplate: getRaidTemplate, user });
        console.log(`[settings] Kategorie ${sw.name || sw.categoryId}: Spielversion ${sw.fromVersion} → ${sw.toVersion}, neuer Abschnitt (#738)${series ? `, Serie ${series === "paused" ? "pausiert" : "mit neuer Vorlage"}` : ""}`);
        return { ...sw, series };
    });
}

/**
 * GET /api/settings/category-switch?categoryId=&versionId= — what switching a
 * category to another version means (#738), for the confirmation dialog: the
 * coming raids that keep the old version, the series and default template
 * whose template no longer fits, the templates of the new version.
 */
const getCategorySwitch = withUser({}, async ({ user, req, res, url }) => {
    const categoryId = String(url.searchParams.get("categoryId") || "").trim();
    const versionId = String(url.searchParams.get("versionId") || "").trim();
    if (!categoryId) return error(res, 400, "invalid", "Keine Kategorie angegeben.");
    // #925: like the PATCH, the active server's categories only (a full admin all)
    if (!mayEditCategory(user, req, categoryId)) return error(res, 404, "not_found", "Kategorie nicht gefunden.");
    if (!VERSIONS.some((v) => v.id === versionId)) return error(res, 400, "invalid", "Unbekannte Spielversion.");
    const config = getConfig();
    const preview = switchPreview({ categoryId, versionId, config, listTemplates: listRaidTemplates });
    // #739: the roster that is closed, the one of the new version, whether one can be created
    const roster = switchRosterPreview(categoryId, { fromVersion: preview.from.id, toVersion: preview.switching ? preview.to.id : "" });
    ok(res, { ...preview, roster, name: categoryNamesOf(config).get(categoryId) || "" });
});

/**
 * GET /api/settings/item-search?q=&edition=&version= — Wowhead item search for
 * the top-item page (Einstellungen → <Server> → Top-Items). The same lookup the
 * softres hard-reserve picker uses, but under the settings area, so defining
 * top items doesn't require raid rights.
 */
const getItemSearch = withUser({}, async ({ req, res, url }) => {
    const q = url.searchParams.get("q") || "";
    // An edition asked for wins; else the Wowhead path of the version asked for
    // (#952), else of the main version (#542), with the active server's own
    // template (#923) - none set, no search.
    const edition = url.searchParams.get("edition") || "";
    const config = getConfig();
    const versionId = knownVersion(url.searchParams.get("version")) || mainVersionFor({ config });
    const path = edition ? "" : versionSettings.settingsForVersion(versionId, { config, guildId: activeGuildFor(req) }).wowheadPath;
    const items = edition || path ? await wowhead.searchItems(q, { edition, path }) : [];
    ok(res, { items });
});

/**
 * GET /api/settings/archive-export?format=csv|json — loot and attendance of
 * every version but the main one (#563), as a download: the archive the orga
 * keeps before "Andere Versionen ausblenden". Full admins only (it carries
 * every raider's history); read only, nothing is removed.
 */
const getArchiveExport = withUser({ full: true }, async ({ res, url }) => {
    const data = archiveExport({ config: getConfig() });
    const day = data.exportedAt.slice(0, 10);
    const name = `eventhelper-archiv-${data.versions.join("-") || "leer"}-${day}`;
    if (url.searchParams.get("format") === "json") {
        res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": `attachment; filename="${name}.json"`,
            "Cache-Control": "no-store",
        });
        return res.end(JSON.stringify(data, null, 2));
    }
    res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}.csv"`,
        "Cache-Control": "no-store",
    });
    return res.end(BOM + archiveCsv(data));
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
    { method: "GET", path: "/api/settings/archive-export", handler: getArchiveExport, area: "settings" },
    { method: "GET", path: "/api/settings/category-switch", handler: getCategorySwitch, area: "settings" },
    { method: "GET", path: "/api/settings/category-deactivate", handler: getCategoryDeactivate, area: "settings" },
    { method: "POST", path: "/api/settings/category-close", handler: closeCategoryHandler, area: "settings" },
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
    getSettings, updateSettings, getItemSearch, getArchiveExport, getCategorySwitch, saveRaidsheetHandler, deleteRaidsheetHandler,
    getIngestTokens, createIngestTokenHandler, deleteIngestTokenHandler, getDiscordServers,
    getRoleSync, getReminders,
    publicConfig, viewConfig, ACCESS_KEYS, CREDENTIAL_KEYS, GUILD_KEYS, ROLE_SYNC_KEYS, ADDON_KEYS, REMINDER_KEYS, FULL_ADMIN_KEYS, SHARED_WRITE_KEYS, SERVER_SCOPED_KEYS,
    routes,
};
