// The shape of config.json (#420): the defaults and every normaliser that turns
// a stored file into what getConfig() hands out. Pure functions only - reading
// and writing the file is configStore.js, one-off upgrades of old files are
// settingsMigration.js (run once at start), so this is all a read ever does.
const {
    officerRoleId, applicationChannelId,
    categoryIds,
    guildId, raidhelperServerId,
    blizzardClientId, blizzardClientSecret, blizzardRegion, blizzardRealmSlug, blizzardNamespace,
} = require("../config/variables");
const { normalizeRolePermissions, normalizeUserPermissions, normalizeAreaAccess } = require("../config/permissions");
const { normalizeBotCommandAccess } = require("../config/botCommands");
const { normalizeCategoryLootSystem } = require("../services/loot/lootSystem");
const { normalizeCategoryMessageLook } = require("../services/events/embedLook");
const { isSnowflake } = require("../utils/ids");

// General bot config editable from the admin menu (kept out of .env on purpose).
// Defaults come from config/variables (env / historical hard-codes); values saved
// from the admin menu override them and take effect without a bot restart.
const CONFIG_DEFAULTS = {
    // Discord role IDs that grant access to the admin menu (in addition to the
    // ADMIN_USER_ID bootstrap from .env, which can never be locked out).
    adminRoleIds: [],
    // Fine-grained rights for roles that are NOT full admins:
    // { [roleId]: { [areaId]: { read, write } } } — see config/permissions.js.
    // A member's rights are the union over all the roles they hold.
    rolePermissions: {},
    // What every logged-in Discord account may do without holding any configured
    // role: { [areaId]: { read, write } }, merged into the role grants as a union.
    // Empty by default — the menu only opens up where an admin says so.
    baseAccess: {},
    // Rights handed to single Discord accounts rather than to a role:
    // { [userId]: { [areaId]: { read, write } } }, unioned in like the base
    // access. For areas that go to named people (the loot council), where a
    // Discord role would only be a second list to keep in sync.
    userPermissions: {},
    // Who may use which bot command: { [commandName]: { mode, roleIds } } with
    // mode "everyone" | "roles" | "admins". Empty = every command follows its
    // own defaultAccess (see config/botCommands.js and services/discord/botAccess.js).
    botCommandAccess: {},
    // Home guild used to verify admin-role membership (resolveIsAdmin in auth.js).
    // With discordServers.eventGuilds set, getConfig() reports the first one
    // here — this key is only the fallback for an install that never picked one.
    guildId: guildId || "",
    // The Discord servers the bot works with (Einstellungen → Verbindungen →
    // Discord-Server): any number of event servers (event channels,
    // Raid-Helper), each optionally posting its own raid overview to a channel
    // on another server (the talk server or another event server), plus one
    // talk server for pings and sign-up-per-bot. All empty = no server
    // configured yet. `signupNoteChannelId` is where the messages of
    // "Vielleicht" / "Absagen" land (src/services/signups/signupNotes.js) — a channel on
    // any server.
    discordServers: { eventGuilds: [], talkGuildId: "", talkPingChannelId: "", signupNoteChannelId: "" },
    // Raid-Helper server id (raid-helper.xyz), used for all Raid-Helper API calls.
    // RAIDHELPER_API_KEY stays in .env — it's a real secret, this id isn't.
    raidhelperServerId: raidhelperServerId || "",
    // Officer role pinged when a new application arrives.
    officerRoleId: officerRoleId || "",
    // Channel new applications are posted to.
    applicationChannelId: applicationChannelId || "",
    // Discord category IDs that contain the event channels.
    categoryIds: Array.isArray(categoryIds) ? categoryIds : [],
    // Per-category expected raider roles: { [categoryId]: [roleId, ...] }. Used to
    // compare who signed up to an event against who is expected to (attendance).
    categoryRoles: {},
    // Channels the bot watches for Warcraft-Logs links to offer auto-evaluation.
    logChannelIds: [],
    // Defaults pre-filled into the raid-event form. The default *template* is
    // per category now (categoryRaidTemplate); an old raidDefaults.templateId
    // is handed to the categories once at start (settingsMigration.js).
    raidDefaults: { channelId: "" },
    // Battle.net API credentials for optional live character gear (paperdoll) on
    // the char-history page. Empty → char pages just link to classic-armory.org.
    blizzard: {
        clientId: blizzardClientId || "",
        clientSecret: blizzardClientSecret || "",
        region: blizzardRegion || "eu",
        realmSlug: blizzardRealmSlug || "thunderstrike",
        // Profile namespace override; empty = auto (profile-classic-<region>).
        namespace: blizzardNamespace || "",
    },
    // Which loot addon a Discord category uses, keyed by category id:
    // "gargul" | "rclc". Steers the loot-import parser and the char-loot history.
    categoryLootTool: {},
    // Which loot system a category's raids run on, keyed by category id:
    // "softres" | "lootcouncil" | "gdkp" | "other" (src/services/loot/lootSystem.js). A
    // category without an entry follows its loot addon (RCLootcouncil =
    // Loot-Council, else Softres); one raid can still override it.
    categoryLootSystem: {},
    // Where NEW events of a Discord category are created, keyed by category id:
    // "raidhelper" | "eventhelper". Only the default for new events — a
    // Raid-Helper event stays fully in use in either case (eventSources.js).
    // A category without an entry follows `signupSourceDefault` (#291).
    categorySignupSource: {},
    // The source of a category nobody picked one for. "eventhelper" for a new
    // install; an install from before #291 keeps "raidhelper" for the categories
    // it already had (signupSourcesOf() pins them once, nothing flips silently).
    signupSourceDefault: "eventhelper",
    // Switching Raid-Helper off (#291, Verbindungen → Raid-Helper): with
    // `disabled` no request goes to raid-helper.xyz any more (utils/
    // raidhelper/client.js); the stored history stays readable.
    raidhelperRetirement: { disabled: false, at: 0, byName: "" },
    // Whether the approved setup of an own event is also sent as a DM to every
    // raider in it (#290), keyed by category id: { [categoryId]: true }. Off by
    // default — only switched categories are stored.
    categorySetupDms: {},
    // Whether an own event of this category also gets a Discord event (a guild
    // scheduled event, #305), keyed by category id: { [categoryId]: true }. Off
    // by default — only switched categories are stored.
    categoryDiscordEvent: {},
    // The voice channel a raid of this category meets in (#305), keyed by
    // category id: { [categoryId]: channelId }. Only the preset of a new event
    // (`event.voiceChannelId`) — an event keeps whatever was picked for it.
    categoryVoiceChannel: {},
    // The look of a category's signup message (embedLook.js): the raid picture
    // below it (`raidArt`, on by default) and the size of the title tiles
    // (`titleSize` "normal" | "large" | "huge", default "large"). Only what
    // differs from the default is stored: { [categoryId]: { raidArt?, titleSize? } }.
    categoryMessageLook: {},
    // "Beim Anlegen ankündigen" per Discord category (#306):
    // { [categoryId]: { enabled: true, target: "event" | "talk" | "both" } }.
    // Off by default — only switched-on categories are stored.
    categoryAnnounce: {},
    // A message with "Vielleicht" / "Absagen" per Discord category:
    // { [categoryId]: "required" | "none" }. A category without an entry is
    // "optional" (the modal asks, the raider may leave it empty). The message is
    // posted to discordServers.signupNoteChannelId — see src/services/signups/signupNotes.js.
    categorySignupNotes: {},
    // Where a category's messages go instead (#335): { [categoryId]: channelId }.
    // Missing = discordServers.signupNoteChannelId, the default for every category.
    categorySignupNoteChannel: {},
    // A fixed, guild-owned Google Sheet per Discord category:
    // { [categoryId]: { url, name } }. When one is set, a raid in that category
    // links this sheet instead of needing its own copy. A copy the app actually
    // created for that raid still wins — see resolveEventSheetLink() in configStore.js.
    categorySheets: {},
    // The default raid template per Discord category: { [categoryId]: templateId }
    // (Einstellungen → Kategorien). A template that is some category's default
    // cannot be deleted (409 in apiRoutes/raidTemplates.js).
    categoryRaidTemplate: {},
    // The items the guild considers a "big" drop: [{ id, name, iconUrl, quality }],
    // picked from the Wowhead search in Einstellungen → Loot. Imported loot is
    // matched against these ids for the dashboard's "Latest Loot" card
    // (see dashboardData.js's loadTopLoot()).
    topItems: [],
    // Claude phrases the log recommendations for the raiders (Einstellungen →
    // Verbindungen → KI-Formulierung). Empty key = the rules' own text is shown.
    anthropic: { apiKey: "", model: "" },
    // Warcraft Logs v2 API client (Einstellungen → Verbindungen → Warcraft
    // Logs): the raid DPS/HPS and boss-health curves of the fight timeline.
    // Empty = the report has no such curves; the v1 key in .env does the rest.
    warcraftlogsV2: { clientId: "", clientSecret: "" },
    // Role sync between the two servers (#264): [{ eventRoleId, talkRoleId,
    // direction }] with direction "toTalk" | "toEvent" | "both". The sync only
    // ever ADDS roles (src/services/discord/roleSync.js); a role lost on one side stays on
    // the other and shows up as a hint in the admin menu.
    roleSync: [],
    // Automatic reminders per raid category (#264): { [categoryId]:
    // { missingHours, signedHours, target } } — hours before the sign-up
    // deadline (else the raid start) to the members still missing, hours before
    // the raid to the signed-up ones; 0 = off. See src/web/events/reminders.js.
    categoryReminders: {},
};

const ROLE_SYNC_DIRECTIONS = ["toTalk", "toEvent", "both"];

/**
 * Normalise the role-sync mapping to `[{ eventRoleId, talkRoleId, direction }]`:
 * both ids snowflakes, the direction one of ROLE_SYNC_DIRECTIONS (default
 * "toTalk"), one entry per role pair (the first wins). An entry missing either
 * role is dropped — a half mapping can sync nothing.
 */
function normalizeRoleSync(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    const seen = new Set();
    for (const entry of raw) {
        if (!entry || typeof entry !== "object") continue;
        const eventRoleId = String(entry.eventRoleId || "").trim();
        const talkRoleId = String(entry.talkRoleId || "").trim();
        if (!isSnowflake(eventRoleId) || !isSnowflake(talkRoleId)) continue;
        const key = `${eventRoleId}:${talkRoleId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const direction = ROLE_SYNC_DIRECTIONS.includes(entry.direction) ? entry.direction : "toTalk";
        out.push({ eventRoleId, talkRoleId, direction });
    }
    return out;
}

/** Normalise { [categoryId]: templateId }: trimmed strings, empty entries dropped. */
function normalizeCategoryRaidTemplate(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [catId, tplId] of Object.entries(raw)) {
        const key = String(catId).trim();
        const value = String(tplId || "").trim();
        if (key && value) out[key] = value;
    }
    return out;
}

const REMINDER_TARGETS = ["event", "talk", "both"];
// A week: a reminder further ahead than that is an announcement, not a reminder.
const MAX_REMINDER_HOURS = 168;

function reminderHours(value) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(n, MAX_REMINDER_HOURS);
}

/**
 * Normalise the per-category reminders to `{ [categoryId]: { missingHours,
 * signedHours, target } }`. Hours are whole numbers from 1 to 168, anything
 * else is 0 (= off); a category with both reminders off is dropped, so "off"
 * is stored the same way however it was entered.
 */
function normalizeCategoryReminders(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [catId, rule] of Object.entries(raw)) {
        const key = String(catId).trim();
        if (!isSnowflake(key) || !rule || typeof rule !== "object") continue;
        const missingHours = reminderHours(rule.missingHours);
        const signedHours = reminderHours(rule.signedHours);
        if (!missingHours && !signedHours) continue;
        out[key] = {
            missingHours,
            signedHours,
            target: REMINDER_TARGETS.includes(rule.target) ? rule.target : "event",
        };
    }
    return out;
}

const DISCORD_SERVER_KEYS = ["talkGuildId", "talkPingChannelId", "signupNoteChannelId"];
// A sanity bound, not a real product constraint.
const MAX_EVENT_GUILDS = 10;
const EVENT_GUILD_LABEL_MAX = 60;

/**
 * Normalise one event-server entry: `guildId` must be a snowflake (the entry
 * is dropped otherwise), `label` trimmed/capped. `overviewGuildId` +
 * `overviewChannelId` name where this server's own raid overview gets posted
 * (the talk server, another event server, or its own — any bot guild); they
 * must both be snowflakes or both stay "" — a half-set target posts nowhere,
 * the same contract the old talkGuildId+talkOverviewChannelId pair had.
 */
function normalizeEventGuildEntry(raw) {
    if (!raw || typeof raw !== "object") return null;
    const guildId = String(raw.guildId || "").trim();
    if (!isSnowflake(guildId)) return null;
    const overviewGuildId = String(raw.overviewGuildId || "").trim();
    const overviewChannelId = String(raw.overviewChannelId || "").trim();
    const hasTarget = isSnowflake(overviewGuildId) && isSnowflake(overviewChannelId);
    return {
        guildId,
        label: String(raw.label || "").trim().slice(0, EVENT_GUILD_LABEL_MAX),
        overviewGuildId: hasTarget ? overviewGuildId : "",
        overviewChannelId: hasTarget ? overviewChannelId : "",
    };
}

/**
 * Normalise the event-server list: deduped by guildId (first wins), capped at
 * MAX_EVENT_GUILDS. Anything but an array is no server. An old single-server
 * block (`eventGuildId`, no list yet) is turned into a list once at start
 * (settingsMigration.js), not on every read.
 */
function normalizeEventGuilds(list) {
    const src = Array.isArray(list) ? list : [];
    const out = [];
    const seen = new Set();
    for (const entry of src) {
        const normalized = normalizeEventGuildEntry(entry);
        if (!normalized || seen.has(normalized.guildId)) continue;
        seen.add(normalized.guildId);
        out.push(normalized);
        if (out.length >= MAX_EVENT_GUILDS) break;
    }
    return out;
}

/**
 * Normalise the servers block to `{ eventGuilds, talkGuildId,
 * talkPingChannelId, signupNoteChannelId }`. The three scalars stay single
 * snowflakes or ""; `eventGuilds` is the list normalised above. A talk server
 * equal to one of the event servers is no second server: it is cleared, so
 * "one server for everything" is stored the same way however it was entered.
 */
function normalizeDiscordServers(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const out = {};
    for (const key of DISCORD_SERVER_KEYS) {
        const value = String(src[key] === undefined || src[key] === null ? "" : src[key]).trim();
        out[key] = isSnowflake(value) ? value : "";
    }
    out.eventGuilds = normalizeEventGuilds(src.eventGuilds);
    if (out.talkGuildId && out.eventGuilds.some((e) => e.guildId === out.talkGuildId)) out.talkGuildId = "";
    return out;
}

/**
 * Normalise the top-item list to `[{ id, name, iconUrl, quality }]`: keep only
 * entries with a positive numeric item id, dedupe by id (first wins) and drop an
 * icon that isn't an http(s) url, so a stored entry is always safe to render as
 * an <img src>. `quality` stays null when Wowhead never reported one — 0 is a
 * real quality ("poor"), same rule as the loot store's itemQuality.
 */
function normalizeTopItems(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    const seen = new Set();
    for (const entry of raw) {
        if (!entry || typeof entry !== "object") continue;
        const id = Number(entry.id) || 0;
        if (id <= 0 || seen.has(id)) continue;
        seen.add(id);
        const iconUrl = String(entry.iconUrl || "").trim();
        out.push({
            id,
            name: String(entry.name || "").trim(),
            iconUrl: /^https?:\/\//i.test(iconUrl) ? iconUrl : "",
            quality: typeof entry.quality === "number" ? entry.quality : null,
        });
    }
    return out;
}

/** Normalise categorySetupDms to `{ [categoryId]: true }` — off is the default and not stored. */
function normalizeCategorySetupDms(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [catId, on] of Object.entries(raw)) {
        const key = String(catId).trim();
        if (key && on === true) out[key] = true;
    }
    return out;
}

/** A `{ [categoryId]: true }` switch map — off is the default and not stored (#305). */
function normalizeCategoryFlags(raw) {
    return normalizeCategorySetupDms(raw);
}

/** Normalise categoryVoiceChannel (and categorySignupNoteChannel, #335) to `{ [categoryId]: channelId }`; anything that is no snowflake drops out. */
function normalizeCategoryVoiceChannel(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [catId, channelId] of Object.entries(raw)) {
        const key = String(catId).trim();
        const value = String(channelId === null || channelId === undefined ? "" : channelId).trim();
        if (key && isSnowflake(value)) out[key] = value;
    }
    return out;
}

// pingDelivery.PING_TARGETS, written out: that module reads this one, so it
// cannot be required here without a cycle.
const ANNOUNCE_TARGETS = ["event", "talk", "both"];

/**
 * Normalise categoryAnnounce to `{ [categoryId]: { enabled: true, target } }`
 * (#306) — off is the default and is not stored, an unknown target becomes
 * "event" (the event channel, the safe one: it needs no talk server).
 */
function normalizeCategoryAnnounce(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [catId, value] of Object.entries(raw)) {
        const key = String(catId).trim();
        if (!key || !value || typeof value !== "object" || value.enabled !== true) continue;
        out[key] = { enabled: true, target: ANNOUNCE_TARGETS.includes(value.target) ? value.target : "event" };
    }
    return out;
}

const SIGNUP_NOTE_MODES = ["required", "optional", "none"];

/**
 * Normalise categorySignupNotes to `{ [categoryId]: "required" | "none" }` —
 * "optional" is the default and is not stored, anything unknown drops out.
 */
function normalizeCategorySignupNotes(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [catId, mode] of Object.entries(raw)) {
        const key = String(catId).trim();
        if (key && SIGNUP_NOTE_MODES.includes(mode) && mode !== "optional") out[key] = mode;
    }
    return out;
}

const SIGNUP_SOURCES = ["raidhelper", "eventhelper"];

/**
 * Normalise categorySignupSource to `{ [categoryId]: "raidhelper" | "eventhelper" }`.
 * Both values are kept (#291): a category without an entry follows the default,
 * which is no longer Raid-Helper, so "stays on Raid-Helper" has to be written
 * down. Anything else is dropped, so the map never names a third source.
 */
function normalizeCategorySignupSource(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [catId, source] of Object.entries(raw)) {
        const key = String(catId).trim();
        if (key && SIGNUP_SOURCES.includes(source)) out[key] = source;
    }
    return out;
}

/**
 * The categories an install has configured anything for — the ones that were
 * running on Raid-Helper before new categories defaulted to EventHelper.
 */
function configuredCategoryIds(stored) {
    const ids = new Set(Array.isArray(stored.categoryIds) ? stored.categoryIds.map(String) : CONFIG_DEFAULTS.categoryIds.map(String));
    for (const key of ["categoryRoles", "categoryRaidTemplate", "categoryLootTool", "categorySheets", "categoryReminders", "categorySetupDms", "categoryAnnounce"]) {
        const map = stored[key];
        if (map && typeof map === "object" && !Array.isArray(map)) Object.keys(map).forEach((id) => ids.add(String(id)));
    }
    ids.delete("");
    return [...ids];
}

/**
 * `{ categorySignupSource, signupSourceDefault }` as every reader sees it.
 *
 * Until #291 a category without an entry meant Raid-Helper and only switched
 * categories were stored. New categories default to EventHelper now — so a
 * config from before (it has no `signupSourceDefault`) gets every category it
 * already configured pinned to "raidhelper" on read, and the next save writes
 * that down. An old install with no category at all keeps Raid-Helper as its
 * default: there is nothing to pin, and flipping it silently is exactly what
 * must not happen. A fresh install (nothing stored) starts on EventHelper.
 */
function signupSourcesOf(stored) {
    const map = normalizeCategorySignupSource(stored.categorySignupSource);
    if (SIGNUP_SOURCES.includes(stored.signupSourceDefault)) {
        return { categorySignupSource: map, signupSourceDefault: stored.signupSourceDefault };
    }
    const fresh = !Object.keys(stored).length;
    if (fresh) return { categorySignupSource: map, signupSourceDefault: "eventhelper" };
    const known = configuredCategoryIds(stored);
    if (!known.length) return { categorySignupSource: map, signupSourceDefault: "raidhelper" };
    const pinned = { ...map };
    for (const id of known) if (!pinned[id]) pinned[id] = "raidhelper";
    return { categorySignupSource: pinned, signupSourceDefault: "eventhelper" };
}

/** The Raid-Helper switch-off block with a boolean, a time and a name. */
function normalizeRaidhelperRetirement(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return {
        disabled: src.disabled === true,
        at: Number(src.at) || 0,
        byName: String(src.byName || "").slice(0, 100),
    };
}

/**
 * Normalise the categorySheets map to `{ [categoryId]: { url, name } }`: coerce
 * both fields to trimmed strings and drop every category without a url, so an
 * emptied field is the same as "no sheet assigned" and can never link nowhere.
 */
function normalizeCategorySheets(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [catId, sheet] of Object.entries(raw)) {
        const key = String(catId).trim();
        if (!key || !sheet || typeof sheet !== "object") continue;
        const url = String(sheet.url || "").trim();
        if (!url) continue;
        out[key] = { url, name: String(sheet.name || "").trim() };
    }
    return out;
}

/**
 * Normalise the categoryRoles map to `{ [categoryId]: string[] }`: drop non-array
 * values, coerce entries to trimmed non-empty strings, dedupe, and drop categories
 * that end up with no roles. Always returns a plain object (never undefined).
 */
function normalizeCategoryRoles(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [catId, roles] of Object.entries(raw)) {
        const key = String(catId).trim();
        if (!key) continue;
        const list = Array.isArray(roles) ? roles : [];
        const clean = [...new Set(list.map((r) => String(r).trim()).filter(Boolean))];
        if (clean.length) out[key] = clean;
    }
    return out;
}

/** A stored config.json merged over the defaults, every field in its final shape. */
function normalizeConfig(raw) {
    const stored = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const discordServers = normalizeDiscordServers(stored.discordServers);
    return {
        ...CONFIG_DEFAULTS,
        ...stored,
        raidDefaults: { channelId: String((stored.raidDefaults || {}).channelId || CONFIG_DEFAULTS.raidDefaults.channelId) },
        // An empty stored guild id falls back to the default instead of winning
        // over it: the settings form writes this field on every save, so an
        // install that never filled it in would otherwise keep a blank value —
        // no admin-role check, no preselected server in the menu.
        // The first event server, once picked, *is* the home guild; the old key
        // stays the fallback for installs that never configured one.
        guildId: (discordServers.eventGuilds[0] && discordServers.eventGuilds[0].guildId)
            || String(stored.guildId || "").trim() || CONFIG_DEFAULTS.guildId,
        discordServers,
        adminRoleIds: Array.isArray(stored.adminRoleIds) ? stored.adminRoleIds : CONFIG_DEFAULTS.adminRoleIds,
        rolePermissions: normalizeRolePermissions(stored.rolePermissions),
        baseAccess: normalizeAreaAccess(stored.baseAccess),
        userPermissions: normalizeUserPermissions(stored.userPermissions),
        botCommandAccess: normalizeBotCommandAccess(stored.botCommandAccess),
        categoryIds: Array.isArray(stored.categoryIds) ? stored.categoryIds : CONFIG_DEFAULTS.categoryIds,
        categoryRoles: normalizeCategoryRoles(stored.categoryRoles),
        logChannelIds: Array.isArray(stored.logChannelIds) ? stored.logChannelIds : CONFIG_DEFAULTS.logChannelIds,
        blizzard: { ...CONFIG_DEFAULTS.blizzard, ...(stored.blizzard || {}) },
        anthropic: { ...CONFIG_DEFAULTS.anthropic, ...(stored.anthropic || {}) },
        warcraftlogsV2: { ...CONFIG_DEFAULTS.warcraftlogsV2, ...(stored.warcraftlogsV2 || {}) },
        categoryLootTool: (stored.categoryLootTool && typeof stored.categoryLootTool === "object")
            ? stored.categoryLootTool : { ...CONFIG_DEFAULTS.categoryLootTool },
        categoryLootSystem: normalizeCategoryLootSystem(stored.categoryLootSystem),
        ...signupSourcesOf(stored),
        raidhelperRetirement: normalizeRaidhelperRetirement(stored.raidhelperRetirement),
        categorySetupDms: normalizeCategorySetupDms(stored.categorySetupDms),
        categoryDiscordEvent: normalizeCategoryFlags(stored.categoryDiscordEvent),
        categoryVoiceChannel: normalizeCategoryVoiceChannel(stored.categoryVoiceChannel),
        categoryMessageLook: normalizeCategoryMessageLook(stored.categoryMessageLook),
        categoryAnnounce: normalizeCategoryAnnounce(stored.categoryAnnounce),
        categorySignupNotes: normalizeCategorySignupNotes(stored.categorySignupNotes),
        categorySignupNoteChannel: normalizeCategoryVoiceChannel(stored.categorySignupNoteChannel),
        categorySheets: normalizeCategorySheets(stored.categorySheets),
        categoryRaidTemplate: normalizeCategoryRaidTemplate(stored.categoryRaidTemplate),
        topItems: normalizeTopItems(stored.topItems),
        roleSync: normalizeRoleSync(stored.roleSync),
        categoryReminders: normalizeCategoryReminders(stored.categoryReminders),
    };
}

module.exports = {
    CONFIG_DEFAULTS, ROLE_SYNC_DIRECTIONS, REMINDER_TARGETS,
    normalizeConfig, normalizeDiscordServers, normalizeEventGuilds, normalizeEventGuildEntry,
    normalizeRoleSync, normalizeCategoryRaidTemplate, normalizeCategoryReminders, normalizeTopItems,
    normalizeCategorySetupDms, normalizeCategoryFlags, normalizeCategoryVoiceChannel, normalizeCategoryAnnounce,
    normalizeCategorySignupNotes, normalizeCategorySignupSource, configuredCategoryIds, signupSourcesOf,
    normalizeRaidhelperRetirement, normalizeCategorySheets, normalizeCategoryRoles,
};
