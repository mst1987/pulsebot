// The shape of config.json (#420): the defaults and every normaliser that turns
// a stored file into what getConfig() hands out. Pure functions only - reading
// and writing the file is configStore.js, one-off upgrades of old files are
// settingsMigration.js (run once at start), so this is all a read ever does.
const {
    categoryIds,
    guildId, raidhelperServerId,
    blizzardClientId, blizzardClientSecret,
} = require("../config/variables");
const { normalizeCategoryLootSystem } = require("../services/loot/lootSystem");
const { normalizeCategoryMessageLook } = require("../services/events/embedLook");
const { normalizeCategoryPlanning } = require("../services/events/planning");
const { normalizeCategorySignupCharacters } = require("../services/signups/signupCharacters");
const { isSnowflake } = require("../utils/ids");
const { rulesFor, DEFAULT_VERSION, VERSIONS } = require("../config/gameVersions");
const { versionSettingsOf, normalizeVersionSettings, versionsWithDefaults } = require("./versionSettingsSchema");
const { normalizeBackupSettings } = require("../services/backup/backupConfig");
const { defaultAddons, storedAddonList, normalizeGithub } = require("../services/addons/addonConfig");

/** The pictures of `config.discordVisuals`, each on by default. */
const DISCORD_VISUALS_DEFAULT = Object.freeze({ overviewWeekStrip: true, setupImage: true, eventCover: true });

// General bot config editable from the admin menu (kept out of .env on purpose).
// Defaults come from config/variables (env / historical hard-codes); values saved
// from the admin menu override them and take effect without a bot restart.
const CONFIG_DEFAULTS = {
    // Discord role IDs that grant access to the admin menu (in addition to the
    // ADMIN_USER_ID bootstrap from .env, which can never be locked out).
    adminRoleIds: [],
    // The rights of roles and accounts (rolePermissions, baseAccess, userPermissions,
    // orgaRoleIds, botCommandAccess) live per server in serverSettings since #925;
    // see SERVER_SETTING_DEFAULTS. Only the full-admin roles above stay global.
    // Home guild used to verify admin-role membership (resolveIsAdmin in auth.js).
    // With discordServers.servers set, getConfig() reports the first one here —
    // this key is only the fallback for an install that never picked one.
    guildId: guildId || "",
    // The Discord servers the bot works with (Einstellungen → Verbindungen →
    // Discord-Server), the server federation of #893: `servers` lists every
    // server as an equal ({ guildId, label }), `links` are directed
    // ({ from, to, channelId }: the raid list of `from` is posted to channelId
    // on `to`; from = to is allowed). All empty = no server configured yet. The channels
    // of "Vielleicht" / "Absagen" and of the guild bank are per server since #924
    // (serverSettings: signupNoteChannelId, guildBankChannelId).
    discordServers: { servers: [], links: [] },
    // Settings per Discord server (#917, epic #926): { [guildId]: { key: value } }.
    // Only servers of discordServers (or pure link targets) keep a block, only the
    // keys of SERVER_SETTING_DEFAULTS survive. Read through
    // services/discord/serverSettings.js; a missing key is that part's default.
    serverSettings: {},
    // Raid-Helper server id (raid-helper.xyz), used for all Raid-Helper API calls.
    // RAIDHELPER_API_KEY stays in .env — it's a real secret, this id isn't.
    raidhelperServerId: raidhelperServerId || "",
    // Discord category IDs that contain the event channels.
    categoryIds: Array.isArray(categoryIds) ? categoryIds : [],
    // Per-category expected raider roles: { [categoryId]: [roleId, ...] }. Used to
    // compare who signed up to an event against who is expected to (attendance).
    categoryRoles: {},
    // The log channels are per server now (#921): serverSettings[guildId].logChannels.
    // An old stored logChannelIds stays readable (legacyLogChannelIds) until the bot hands it
    // to the servers once it is online (services/logcheck/logChannelMigration.js).
    // Battle.net API credentials for optional live character gear (paperdoll) on
    // the char-history page, one API application for every game version. The
    // realm a lookup asks (region, realm slug, namespace) is per version since
    // #542: versionSettings below. Empty → char pages just link to the armory.
    blizzard: {
        clientId: blizzardClientId || "",
        clientSecret: blizzardClientSecret || "",
    },
    // Per game version (#542, services/events/versionSettings.js): Battle.net
    // realm, armory and Warcraft Logs templates, Wowhead path, softres edition
    // and default raidsheet as { [versionId]: block }. Every known version is
    // present, an empty field means "not there for this version". A config
    // from before #542 reads its old single values as the TBC block.
    versionSettings: versionSettingsOf({}),
    // The versions whose standard values (#553, config/gameVersions
    // settingsDefaults) were handed to versionSettings once — the start-up
    // migration fills the empty fields of every *other* version with defaults
    // and adds it here, so a field cleared on purpose later stays empty. A
    // fresh install reads the defaults already, so it counts all of them.
    versionDefaultsApplied: versionsWithDefaults(),
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
    // The language of a category's public messages (signup message, setup post,
    // announcement, pings, Discord event …), keyed by category id: { [categoryId]:
    // "de" | "en" }. A category without one writes in the server language
    // (botLanguage) — a PuG category in English beside German guild raids.
    categoryLanguage: {},
    // Attendance and absences per category (Abwesenheiten page): { [categoryId]:
    // { show: false, window: 4|8|11|16, absences: false } } — only what differs
    // from the default (shown, over the last 11 raids, in the absence overview).
    categoryAttendance: {},
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
    // { [categoryId]: { enabled: true } } — always in the raid's own channel (#894).
    // Off by default — only switched-on categories are stored.
    categoryAnnounce: {},
    // A message with "Vielleicht" / "Absagen" per Discord category:
    // { [categoryId]: "required" | "none" }. A category without an entry is
    // "optional" (the modal asks, the raider may leave it empty). The message is
    // posted to the server's signupNoteChannelId (serverSettings, #924) — see src/services/signups/signupNotes.js.
    categorySignupNotes: {},
    // Where a category's messages go instead (#335): { [categoryId]: channelId }.
    // Missing = the signupNoteChannelId of the category's server (#924).
    categorySignupNoteChannel: {},
    // How many own characters one signup may name per raid category (the first
    // counts, the others "kann auch mit"): { [categoryId]: 1..7 }. A category
    // without an entry allows 8 — the default and the most there is, so 8 is not
    // stored (signupCharacters.maxCharactersFor is the one reader).
    categorySignupCharacters: {},
    // A fixed, guild-owned Google Sheet per Discord category:
    // { [categoryId]: { url, name } }. When one is set, a raid in that category
    // links this sheet instead of needing its own copy. A copy the app actually
    // created for that raid still wins — see resolveEventSheetLink() in configStore.js.
    categorySheets: {},
    // How a category plans its raids: { [categoryId]: "raidplan" | "sheet" } -
    // the raid plan or a Google Sheet, never both. Only a picked mode is stored;
    // without one, a category with a fixed sheet is "sheet", every other
    // "raidplan" (planningOf() in src/services/events/planning.js).
    categoryPlanning: {},
    // The default raid template per Discord category: { [categoryId]: templateId }
    // (Einstellungen → Kategorien). A template that is some category's default
    // cannot be deleted (409 in apiRoutes/raidTemplates.js).
    categoryRaidTemplate: {},
    // The game version the guild plays (#541): what a new event, a new raid
    // template and the profile start with when nobody picked one. A version id
    // of config/gameVersions; switched in Einstellungen → Spielversion.
    mainVersion: DEFAULT_VERSION,
    // The version every raid category plays: { [categoryId]: versionId }. Since
    // #738 every active category has one written down (the start-up migration
    // pins the version it played; a new category is saved with the main
    // version), so the main version is only the default for something new.
    categoryVersion: {},
    // The sections of a category (#738): { [categoryId]: [{ versionId, from, name }] },
    // oldest first. Switching a category to another version starts a new one
    // (`from` = ms of the switch, `name` = the Discord category name then); a
    // category never switched has none (services/events/categoryEras.js).
    categoryEras: {},
    // "Andere Versionen ausblenden" (#563): true = every list, selection list
    // and the menu's content switch show only the main version; a direct link
    // to an event of another version opens it read only (archive). Nothing is
    // deleted, switching it off brings everything back.
    hideOtherVersions: false,
    // "Neue Version starten" (#745, Einstellungen → Spielversion): the items of
    // the checklist that cannot be computed and were marked done by hand, per
    // target version: { [versionId]: { [itemId]: { at, byName } } } — item ids
    // of VERSION_LAUNCH_MANUAL only (services/events/versionLaunch.js).
    versionLaunch: {},
    // Drawn pictures in bot messages (a test, Oct 2026; Einstellungen -> Raid-Standardwerte
    // -> "Bilder in Bot-Nachrichten"): the raid overview's week strip
    // (services/events/raidWeekStrip.js), the setup as a graphic (services/setup/setupImage.js)
    // and the raid's picture as the cover of the Discord server event (discordEventCover.js).
    // On unless switched off; off, the message is drawn as before at its next redraw.
    discordVisuals: { ...DISCORD_VISUALS_DEFAULT },
    // "Neue Gildenrekorde posten" (Einstellungen -> Dungeon-Bestzeiten): a gold
    // run of the LevelHelper addon that is now the fastest of its dungeon goes
    // into `channelId` as a card (services/dungeons/dungeonRecords.js). Off by default.
    dungeonRecords: { post: false, channelId: "" },
    // The top items are per server and game version since #952:
    // serverSettings[guildId].topItems (services/loot/topItems.js). The global
    // list of before stays as `topItemsLegacy` for one release (legacyTopItems).
    // Claude phrases the log recommendations for the raiders (Einstellungen →
    // Verbindungen → KI-Formulierung). Empty key = the rules' own text is shown.
    anthropic: { apiKey: "", model: "" },
    // Warcraft Logs v2 API client (Einstellungen → Verbindungen → Warcraft
    // Logs): the raid DPS/HPS and boss-health curves of the fight timeline.
    // Empty = the report has no such curves; the v1 key in .env does the rest.
    warcraftlogsV2: { clientId: "", clientSecret: "" },
    // GitHub (Einstellungen -> Verbindungen -> GitHub, #818): a fine-grained token
    // with read-only "Contents" on the addon repos, for the private ones among
    // the addon downloads. Never sent to the browser (publicConfig: hasToken).
    github: { token: "" },
    // The addons of the page "Addons" (#818, Einstellungen -> Module -> Addons):
    // [{ id, name, description, repo, private, assets, versions, install, icon,
    // enabled }] - services/addons/addonConfig.js. Default: the three own addons.
    addonDownloads: defaultAddons(),
    // Whether an admin edited that list by hand: an edit in Einstellungen -> Module ->
    // Addons sets it, "Standard wiederherstellen" clears it. Only then does an empty
    // list stay empty; without it an empty list reads as the defaults (storedAddonList).
    addonDownloadsCustomized: false,
    // Role sync between any two configured servers (#264, pairs since #896):
    // [{ fromGuildId, fromRoleId, toGuildId, toRoleId, direction }] with direction
    // "toTarget" | "toSource" | "both" (normalizeRoleSync). The sync only ever ADDS
    // roles (src/services/discord/roleSync.js); a role lost on one server stays on
    // the other and shows up as a hint in the admin menu.
    roleSync: [],
    // Automatic reminders per raid category (#264): { [categoryId]:
    // { missingHours, signedHours } } — hours before the sign-up
    // deadline (else the raid start) to the members still missing, hours before
    // the raid to the signed-up ones; 0 = off. See src/web/events/reminders.js.
    categoryReminders: {},
    // Data snapshots (#691, services/backup/): how often the bot takes one (minutes) and how many it keeps
    // (grandfather-father-son over the hourly ones, the newest n of deploy/manual/pre-restore), and the weekday and
    // time of the weekly restore probe (`restoreTest`, #694, default Wednesday 04:30). The directory and
    // the on/off switch are env (BACKUP_DIR, BACKUP_ENABLED), see services/backup/backupConfig.js.
    backup: normalizeBackupSettings(null),
};

const ROLE_SYNC_DIRECTIONS = ["toTarget", "toSource", "both"];
// The directions of the event/talk pairs before the federation (#896).
const LEGACY_ROLE_SYNC_DIRECTIONS = { toTalk: "toTarget", toEvent: "toSource" };

/**
 * One role-sync entry in the pair shape, or null. An entry of before #896
 * (`eventRoleId`/`talkRoleId`) becomes a pair from the first server to the old
 * talk server: eventRoleId -> fromRoleId, talkRoleId -> toRoleId, toTalk ->
 * toTarget, toEvent -> toSource - it keeps syncing exactly as before.
 */
function roleSyncPair(entry, { serverIds, talkGuildId }) {
    const legacy = entry.fromRoleId === undefined && entry.toRoleId === undefined
        && (entry.eventRoleId !== undefined || entry.talkRoleId !== undefined);
    const pick = (key) => String(entry[key] || "").trim();
    const pair = legacy
        ? { fromGuildId: (serverIds && serverIds[0]) || "", fromRoleId: pick("eventRoleId"), toGuildId: String(talkGuildId || "").trim(), toRoleId: pick("talkRoleId") }
        : { fromGuildId: pick("fromGuildId"), fromRoleId: pick("fromRoleId"), toGuildId: pick("toGuildId"), toRoleId: pick("toRoleId") };
    const direction = LEGACY_ROLE_SYNC_DIRECTIONS[entry.direction] || entry.direction;
    return { ...pair, direction: ROLE_SYNC_DIRECTIONS.includes(direction) ? direction : "toTarget" };
}

/**
 * Normalise the role-sync mapping (#896) to
 * `[{ fromGuildId, fromRoleId, toGuildId, toRoleId, direction }]` with
 * direction "toTarget" (from -> to) | "toSource" (to -> from) | "both".
 * Every id a snowflake, the two servers different and - when `serverIds` is
 * given - both of the configured servers (no link between them needed); one
 * entry per pair (the first wins). Anything else is dropped: a half or broken
 * pair can sync nothing. Old event/talk entries are migrated (roleSyncPair),
 * which needs the context: `serverIds` (the first is the old event server) and
 * the old `talkGuildId`.
 * @param {*} raw
 * @param {{ serverIds?: string[], talkGuildId?: string }} [ctx]
 */
function normalizeRoleSync(raw, ctx = {}) {
    if (!Array.isArray(raw)) return [];
    const known = Array.isArray(ctx.serverIds) ? new Set(ctx.serverIds.map(String)) : null;
    const out = [];
    const seen = new Set();
    for (const entry of raw) {
        if (!entry || typeof entry !== "object") continue;
        const pair = roleSyncPair(entry, ctx);
        const ids = [pair.fromGuildId, pair.fromRoleId, pair.toGuildId, pair.toRoleId];
        if (!ids.every(isSnowflake) || pair.fromGuildId === pair.toGuildId) continue;
        if (known && (!known.has(pair.fromGuildId) || !known.has(pair.toGuildId))) continue;
        const key = ids.join(":");
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(pair);
    }
    return out;
}

/**
 * The context normalizeRoleSync() checks pairs against, from a normalised
 * discordServers block. `legacyTalkGuildId` is the old talk server of a store
 * the start migration (settingsMigration.js, #897) has not rewritten yet: an
 * old `{ eventRoleId, talkRoleId }` entry needs it as the pair's target, and it
 * counts as a valid server even when it is not in `servers` (with the full ten
 * servers there is no room left for it). It goes last, so the first server
 * stays the old event server.
 */
function roleSyncContext(discordServers, legacyTalkGuildId = "") {
    const block = discordServers || {};
    const serverIds = (Array.isArray(block.servers) ? block.servers : []).map((s) => String((s && s.guildId) || "")).filter(Boolean);
    const talk = String(legacyTalkGuildId || "").trim();
    const talkGuildId = isSnowflake(talk) ? talk : "";
    if (talkGuildId && serverIds.length && !serverIds.includes(talkGuildId)) serverIds.push(talkGuildId);
    return { serverIds, talkGuildId };
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

/** `{ overviewWeekStrip, setupImage, eventCover }` as booleans: a picture is on unless stored as false; unknown keys are dropped. */
function normalizeDiscordVisuals(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return Object.fromEntries(Object.keys(DISCORD_VISUALS_DEFAULT).map((key) => [key, src[key] !== false]));
}

/** `{ post, channelId }`: post only a literal true, the channel only a snowflake. */
function normalizeDungeonRecords(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const channelId = String(src.channelId === undefined || src.channelId === null ? "" : src.channelId).trim();
    return { post: src.post === true, channelId: /^\d{17,20}$/.test(channelId) ? channelId : "" };
}

/** "de" | "en"; anything else is the default, German. */
function normalizeBotLanguage(raw) {
    const lang = String(raw || "").trim().toLowerCase();
    return lang === "en" ? "en" : "de";
}

function normalizeMainVersion(raw) {
    const id = String(raw || "").trim();
    return id && rulesFor(id) ? id : DEFAULT_VERSION;
}

/** Normalise { [categoryId]: versionId }: only known versions, empty entries dropped. */
function normalizeCategoryVersion(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [catId, versionId] of Object.entries(raw)) {
        const key = String(catId).trim();
        const value = String(versionId || "").trim();
        if (key && value && rulesFor(value)) out[key] = value;
    }
    return out;
}

/**
 * Normalise { [categoryId]: [{ versionId, from, name }] } (#738): only known
 * versions, `from` a non-negative number (ms), `name` a string; each list
 * sorted oldest first, an empty list dropped.
 */
function normalizeCategoryEras(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [catId, list] of Object.entries(raw)) {
        const key = String(catId).trim();
        if (!key || !Array.isArray(list)) continue;
        const eras = list
            .filter((e) => e && typeof e === "object" && rulesFor(String(e.versionId || "").trim()))
            .map((e) => ({
                versionId: String(e.versionId).trim(),
                from: Math.max(0, Math.floor(Number(e.from) || 0)),
                name: String(e.name || "").trim().slice(0, 100),
            }))
            .sort((a, b) => a.from - b.from);
        if (eras.length) out[key] = eras;
    }
    return out;
}

// A week: a reminder further ahead than that is an announcement, not a reminder.
const MAX_REMINDER_HOURS = 168;

function reminderHours(value) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(n, MAX_REMINDER_HOURS);
}

/**
 * Normalise the per-category reminders to `{ [categoryId]: { missingHours,
 * signedHours } }`. Hours are whole numbers from 1 to 168, anything
 * else is 0 (= off); a category with both reminders off is dropped, so "off"
 * is stored the same way however it was entered. A reminder always goes to the
 * raid's server, a DM for whoever is not there (#894): an old `target`
 * ("talk" / "both") is dropped here, which reads as that.
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
        out[key] = { missingHours, signedHours };
    }
    return out;
}

// talkPingChannelId is gone (#894: pings stay on the raid's server), talkGuildId
// too (#897: the old talk server is an ordinary server now) — an old value is
// dropped here; normalizeDiscordServers() still reads talkGuildId as input.
// A sanity bound, not a real product constraint.
const MAX_EVENT_GUILDS = 10;
const EVENT_GUILD_LABEL_MAX = 60;

/**
 * The old event-server list (before #890), still read by the migration in
 * normalizeDiscordServers() and by the settings route's transition format
 * until the new Discord-Server page (#891) replaces it.
 *
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
 * One server of the federation (#890): `{ guildId, label }` plus `pug: true` when switched on,
 * null when the id is no snowflake. `pug` (#906): only a server with the switch "PuG-Server" gets
 * the roles & onboarding of a PuG server (services/discord/pugOnboarding.js); missing or anything
 * but `true` = off. Off is stored as no field at all, so existing configs read unchanged and the
 * start migration has nothing to write.
 */
function normalizeServerEntry(raw) {
    if (!raw || typeof raw !== "object") return null;
    const guildId = String(raw.guildId || "").trim();
    if (!isSnowflake(guildId)) return null;
    const entry = { guildId, label: String(raw.label || "").trim().slice(0, EVENT_GUILD_LABEL_MAX) };
    if (raw.pug === true) entry.pug = true;
    return entry;
}

/** The server list: deduped by guildId (first wins), capped at MAX_EVENT_GUILDS. */
function normalizeServers(list) {
    const out = [];
    const seen = new Set();
    for (const entry of Array.isArray(list) ? list : []) {
        const normalized = normalizeServerEntry(entry);
        if (!normalized || seen.has(normalized.guildId)) continue;
        seen.add(normalized.guildId);
        out.push(normalized);
        if (out.length >= MAX_EVENT_GUILDS) break;
    }
    return out;
}

/**
 * The directed links (#890): a link counts only when `from` is in `serverIds`,
 * `to` is a snowflake and `channelId` (the raid list's channel on `to`) is a
 * snowflake — anything else is dropped. `to` need not be one of `servers`: a
 * server that only shows a raid list holds no raids (no access, reminders or
 * category checks there), and removing it from `servers` must not bring it
 * back. `from` = `to` is allowed; a second link for the same `from:to` pair is
 * dropped (first wins).
 *
 * `lang` is the language of the list on `to` (heading, buttons, day lines):
 * "de" | "en", or "" = the target server's language (serverLang). `versions`
 * are the game versions the list shows, [] = all. Both are only stored here;
 * the raid list reads them (#892).
 */
const LINK_LANGS = new Set(["de", "en"]);

function normalizeLinkLang(raw) {
    const lang = String(raw || "").trim().toLowerCase();
    return LINK_LANGS.has(lang) ? lang : "";
}

function normalizeLinkVersions(raw) {
    const known = new Set(VERSIONS.map((v) => v.id));
    const out = [];
    for (const entry of Array.isArray(raw) ? raw : []) {
        const id = String(entry || "").trim();
        if (known.has(id) && !out.includes(id)) out.push(id);
    }
    return out;
}

function normalizeLinks(list, serverIds) {
    const known = new Set(serverIds);
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(list) ? list : []) {
        if (!raw || typeof raw !== "object") continue;
        const from = String(raw.from || "").trim();
        const to = String(raw.to || "").trim();
        const channelId = String(raw.channelId || "").trim();
        if (!known.has(from) || !isSnowflake(to) || !isSnowflake(channelId)) continue;
        const key = `${from}:${to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ from, to, channelId, lang: normalizeLinkLang(raw.lang), versions: normalizeLinkVersions(raw.versions) });
    }
    return out;
}

/**
 * The servers and links an old `eventGuilds` list stands for (#890): every
 * event server keeps its label; its overview target becomes the link
 * `{ from: guildId, to: overviewGuildId, channelId: overviewChannelId }`. A
 * target that is no event server stays outside `servers` (only the event
 * servers and the talk server become servers): it never held raids.
 */
function legacyServersAndLinks(eventGuilds) {
    const entries = normalizeEventGuilds(eventGuilds);
    const servers = entries.map((e) => ({ guildId: e.guildId, label: e.label }));
    const links = [];
    for (const e of entries) {
        if (!e.overviewGuildId || !e.overviewChannelId) continue;
        links.push({ from: e.guildId, to: e.overviewGuildId, channelId: e.overviewChannelId, lang: "", versions: [] });
    }
    return { servers, links };
}

/**
 * Normalise the servers block to `{ servers, links }` (#890; the two channel
 * scalars it had are per server since #924 and are dropped here). A
 * block with a `servers` array is the current shape; one without it is an old
 * `eventGuilds` block, migrated here (idempotent: the result has `servers`, so
 * a second run takes the first path and changes nothing).
 *
 * An old `talkGuildId` is input only (#897): the old talk server becomes an
 * ordinary server at the end of the list when missing and there is room, and
 * the field itself is not kept. The start migration (settingsMigration.js)
 * writes that result into the store once. Nothing configured stays
 * `servers: []` (guildRoles.serverIds() then falls back to config.guildId).
 * `fallbackGuildId` (config.guildId) only matters for an old block with a
 * talk server but no event server: it worked on that home guild, which stays
 * the first server, so adding the talk server does not make it the home.
 */
function normalizeDiscordServers(raw, { fallbackGuildId = "" } = {}) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const out = {};
    const talkInput = String(src.talkGuildId === undefined || src.talkGuildId === null ? "" : src.talkGuildId).trim();
    const legacyTalk = isSnowflake(talkInput) ? talkInput : "";
    const current = Array.isArray(src.servers);
    const legacy = current ? null : legacyServersAndLinks(src.eventGuilds);
    const fallback = String(fallbackGuildId || "").trim();
    if (legacy && !legacy.servers.length && legacyTalk && isSnowflake(fallback) && fallback !== legacyTalk) {
        legacy.servers.push({ guildId: fallback, label: "" });
    }
    const servers = current ? normalizeServers(src.servers) : normalizeServers(legacy.servers);
    if (legacyTalk && !servers.some((s) => s.guildId === legacyTalk) && servers.length < MAX_EVENT_GUILDS) {
        servers.push({ guildId: legacyTalk, label: "" });
    }
    out.servers = servers;
    out.links = normalizeLinks(current ? src.links : legacy.links, servers.map((s) => s.guildId));
    return out;
}

/**
 * Normalise the top-item list to `[{ id, name, iconUrl, quality }]`: keep only
 * entries with a positive numeric item id, dedupe by id (first wins) and drop an
 * icon that isn't an http(s) url, so a stored entry is always safe to render as
 * an <img src>. `quality` stays null when Wowhead never reported one — 0 is a
 * real quality ("poor"), same rule as the loot store's itemQuality. A name is
 * cut to TOP_ITEM_NAME_MAX characters (#952: a searched item brings its own).
 */
const TOP_ITEM_NAME_MAX = 200;
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
            name: String(entry.name || "").trim().slice(0, TOP_ITEM_NAME_MAX),
            iconUrl: /^https?:\/\//i.test(iconUrl) ? iconUrl : "",
            quality: typeof entry.quality === "number" ? entry.quality : null,
        });
    }
    return out;
}

/**
 * Normalise categoryLanguage to `{ [categoryId]: "de" | "en" }` — "" (or anything
 * else) means "as the server" and is not stored.
 */
function normalizeCategoryLanguage(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [catId, lang] of Object.entries(raw)) {
        const key = String(catId).trim();
        const clean = String(lang || "").trim().toLowerCase();
        if (key && (clean === "de" || clean === "en")) out[key] = clean;
    }
    return out;
}

/**
 * A categoryLanguage change as sent by the settings page: "de" / "en", or "" for
 * "back to the server language" — kept, so the store's merge drops the category.
 */
function normalizeCategoryLanguagePatch(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [catId, lang] of Object.entries(raw)) {
        const key = String(catId).trim();
        const clean = String(lang || "").trim().toLowerCase();
        if (key) out[key] = clean === "de" || clean === "en" ? clean : "";
    }
    return out;
}

// How many of a category's last raids its attendance quota counts (the setup tooltip and "Meine Anwesenheit"):
// any whole number in this range, typed or stepped in the category's settings.
const ATTENDANCE_WINDOW_MIN = 1;
const ATTENDANCE_WINDOW_MAX = 50;
const ATTENDANCE_DEFAULT_WINDOW = 11;

/** One category's attendance settings with every default filled in. */
function attendanceSettings(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const window = Number(src.window);
    const valid = Number.isInteger(window) && window >= ATTENDANCE_WINDOW_MIN && window <= ATTENDANCE_WINDOW_MAX;
    return {
        show: src.show !== false,
        window: valid ? window : ATTENDANCE_DEFAULT_WINDOW,
        absences: src.absences !== false,
    };
}

/** categoryAttendance as stored: per category only what differs from the default; a category at the defaults drops out. */
function normalizeCategoryAttendance(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [catId, value] of Object.entries(raw)) {
        const key = String(catId).trim();
        if (!key) continue;
        const s = attendanceSettings(value);
        const diff = {};
        if (!s.show) diff.show = false;
        if (s.window !== ATTENDANCE_DEFAULT_WINDOW) diff.window = s.window;
        if (!s.absences) diff.absences = false;
        if (Object.keys(diff).length) out[key] = diff;
    }
    return out;
}

/** A category's attendance settings out of a config, defaults filled in. */
function categoryAttendanceFor(config, categoryId) {
    return attendanceSettings(((config && config.categoryAttendance) || {})[String(categoryId || "")]);
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

/**
 * Normalise categoryAnnounce to `{ [categoryId]: { enabled: true } }` (#306) —
 * off is the default and is not stored. The announcement always goes to the
 * raid's own channel (#894): an old `target` ("talk" / "both") is dropped.
 */
function normalizeCategoryAnnounce(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [catId, value] of Object.entries(raw)) {
        const key = String(catId).trim();
        if (!key || !value || typeof value !== "object" || value.enabled !== true) continue;
        out[key] = { enabled: true };
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

// The items of the checklist "Neue Version starten" (#745) that are marked done by hand.
const VERSION_LAUNCH_MANUAL = Object.freeze(["backup", "export", "lootAddon", "talk"]);

/**
 * The hand-made marks of the version checklist (#745):
 * { [versionId]: { [itemId]: { at, byName } } } — known versions and the item
 * ids of VERSION_LAUNCH_MANUAL only; a version without a mark is dropped.
 */
function normalizeVersionLaunch(raw) {
    const out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    for (const [versionId, marks] of Object.entries(raw)) {
        const id = String(versionId).trim();
        if (!rulesFor(id) || !marks || typeof marks !== "object" || Array.isArray(marks)) continue;
        const kept = {};
        for (const item of VERSION_LAUNCH_MANUAL) {
            const m = marks[item];
            if (m && typeof m === "object") kept[item] = { at: Number(m.at) || 0, byName: String(m.byName || "").slice(0, 100) };
        }
        if (Object.keys(kept).length) out[id] = kept;
    }
    return out;
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

/** `{ clientId, clientSecret }` of the stored Battle.net block over the defaults (a stored value wins, also an emptied one). */
function blizzardCredentials(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const pick = (key) => String(src[key] === undefined || src[key] === null ? CONFIG_DEFAULTS.blizzard[key] : src[key]);
    return { clientId: pick("clientId"), clientSecret: pick("clientSecret") };
}

/**
 * #924: what used to be one global value and is per server now. The officer
 * role pinged on a new application and the channel it is posted to; the raid
 * form's preset channel; the language of the bot's public messages (and the
 * fallback of every raider who chose none); where "Vielleicht" / "Absagen"
 * messages and guild bank requests land. The two signup channels have no
 * default on purpose: a server without one posts nothing there.
 * The bot language alone has a global default as well (config.botLanguage):
 * a server without its own value speaks it (botLanguage.serverLang).
 */
const SERVER_DEFAULTS_924 = Object.freeze({
    applicationChannelId: "",
    officerRoleId: "",
    raidDefaults: Object.freeze({ channelId: "" }),
    botLanguage: "de",
    signupNoteChannelId: "",
    guildBankChannelId: "",
});
// The global fields of before #924 (the start migration moves them into the server blocks).
// Not botLanguage: the global value stays as the default every server inherits.
const GLOBAL_FIELDS_924 = ["applicationChannelId", "officerRoleId", "raidDefaults"];

/**
 * The global log-channel list of before #921, while it waits for the bot to hand
 * it to the servers (logChannelMigration.js): { logChannelIds: [ids] } when the
 * file still holds one (a malformed value reads as none), else nothing, so an
 * install without it never shows the key again.
 */
function legacyLogChannelIds(stored) {
    if (!Object.prototype.hasOwnProperty.call(stored, "logChannelIds")) return {};
    const ids = Array.isArray(stored.logChannelIds) ? stored.logChannelIds.map((id) => String(id || "").trim()).filter(Boolean) : [];
    return { logChannelIds: [...new Set(ids)] };
}

/**
 * The global top-item list of before #952, kept for one release after the start
 * migration copied it onto the TBC servers (settingsMigration.migrateTopItems):
 * { topItemsLegacy: [...] } when the file holds one, else nothing.
 */
function legacyTopItems(stored) {
    if (!Object.prototype.hasOwnProperty.call(stored, "topItemsLegacy")) return {};
    return { topItemsLegacy: normalizeTopItems(stored.topItemsLegacy) };
}

/**
 * The stored file without the global `topItems` of before #952: only the start
 * migration reads it (from the file), no reader sees the unchecked raw list.
 * Only hidden: the file keeps it until the migration moved it, a save in between
 * writes it back (configStore.pendingTopItems).
 */
function withoutGlobalTopItems(stored) {
    if (!Object.prototype.hasOwnProperty.call(stored, "topItems")) return stored;
    const rest = { ...stored };
    delete rest.topItems;
    return rest;
}

/**
 * The keys a server block may hold, with the default each part reads when a
 * server has none (#917). The parts 4-8 of epic #926 add theirs, one block each.
 */
const SERVER_SETTING_DEFAULTS = Object.freeze({
    // #924: applications, raid defaults, bot language and two signup channels.
    ...SERVER_DEFAULTS_924,
    // #923: own realm/armory/log templates per version, field by field over
    // config.versionSettings (stores/versionSettingsSchema.js normalizeVersionOverrides)
    versionOverrides: {},
    // #921: the channels watched for Warcraft Logs links, each with the game
    // version its logs belong to: [{ channelId, versionId }].
    logChannels: Object.freeze([]),
    // #925: the rights of roles and accounts on this server, read (and normalised)
    // through services/discord/serverAccess.js. A server without them grants nothing
    // but what full admins (global adminRoleIds, .env) have everywhere.
    rolePermissions: Object.freeze({}),
    baseAccess: Object.freeze({}),
    userPermissions: Object.freeze({}),
    orgaRoleIds: Object.freeze([]),
    botCommandAccess: Object.freeze({}),
    // #927 Raid-Helper je Server (utils/raidhelper/servers.js): off unless a
    // server switches it on; serverId empty = the guild's own id; apiKey is only
    // ever set from the settings page (never copied from .env); envKey marks the
    // one server the start migration lets use RAIDHELPER_API_KEY from .env.
    raidhelper: Object.freeze({ enabled: false, serverId: "", apiKey: "", envKey: false, at: 0, byName: "" }),
    // #922 WCL-Gilde je Server und Version (services/logcheck/wclGuildSettings.js):
    // [{ versionId, guildName, realm, region, interval, lastRunAt, lastSuccessAt, lastResult }];
    // the central job (wclGuildSync.js) fetches the guild's new reports as logs.
    wclGuilds: Object.freeze([]),
    // #952 Top-Items je Server und Version (services/loot/topItems.js):
    // { [versionId]: [{ id, name, iconUrl, quality }] }; the loot views count an
    // award as a top item by the server and version of its raid.
    topItems: Object.freeze({}),
    // #961 the drawn pictures of this server's bot messages: only the switches the
    // server set itself ({ overviewWeekStrip?, setupImage?, eventCover?: boolean });
    // a switch it has not set follows config.discordVisuals, the global default
    // (services/discord/serverSettings.js serverVisuals).
    discordVisuals: Object.freeze({}),
});

/**
 * The guild ids that may hold a serverSettings block: every server, every pure
 * link target and the home guild (config.guildId), which is the only server of
 * an install that never configured the server list.
 */
function serverSettingGuildIds(discordServers, homeGuildId = "") {
    const block = discordServers || {};
    const ids = new Set();
    for (const s of Array.isArray(block.servers) ? block.servers : []) if (s && s.guildId) ids.add(s.guildId);
    for (const l of Array.isArray(block.links) ? block.links : []) if (l && l.to) ids.add(l.to);
    const home = String(homeGuildId || "").trim();
    if (isSnowflake(home)) ids.add(home);
    return ids;
}

/**
 * `serverSettings` in its final shape: blocks of unknown servers and keys of no
 * part are dropped, a block that is kept stays (an empty one stays empty).
 * `keys` defaults to SERVER_SETTING_DEFAULTS (tests hand in their own).
 */
function normalizeServerSettings(raw, discordServers, homeGuildId = "", keys = SERVER_SETTING_DEFAULTS) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const known = serverSettingGuildIds(discordServers, homeGuildId);
    const out = {};
    for (const [guildId, block] of Object.entries(raw)) {
        if (!known.has(guildId)) continue;
        const src = block && typeof block === "object" && !Array.isArray(block) ? block : {};
        const clean = {};
        for (const key of Object.keys(src)) {
            if (Object.prototype.hasOwnProperty.call(keys, key) && src[key] !== undefined) clean[key] = src[key];
        }
        out[guildId] = clean;
    }
    return out;
}

/**
 * A serverSettings update merged per server and per key: a block sent for one
 * server leaves the others alone, a key sent replaces only that key. Cleaned
 * up by normalizeServerSettings when the config is read.
 */
function mergeServerSettings(current, partial) {
    const isMap = (value) => value && typeof value === "object" && !Array.isArray(value);
    const merged = isMap(current) ? { ...current } : {};
    if (!isMap(partial)) return merged;
    for (const [guildId, block] of Object.entries(partial)) {
        merged[guildId] = { ...(isMap(merged[guildId]) ? merged[guildId] : {}), ...(isMap(block) ? block : {}) };
    }
    return merged;
}

/**
 * `stored` without the global fields of before #924 that a server block already
 * carries (they are read per server only). A global field no block carries yet
 * stays: the start migration has not moved it (it failed), and a save in between
 * must not lose it - the next start moves it.
 */
function withoutGlobalFields924(stored) {
    if (!GLOBAL_FIELDS_924.some((key) => key in stored)) return stored;
    const blocks = stored.serverSettings && typeof stored.serverSettings === "object" && !Array.isArray(stored.serverSettings)
        ? Object.values(stored.serverSettings) : [];
    const carried = (key) => blocks.some((b) => b && typeof b === "object" && b[key] !== undefined);
    const out = { ...stored };
    for (const key of GLOBAL_FIELDS_924) if (carried(key)) delete out[key];
    return out;
}

/** A stored config.json merged over the defaults, every field in its final shape. */
function normalizeConfig(raw) {
    const stored = withoutGlobalTopItems(withoutGlobalFields924(raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}));
    const discordServers = normalizeDiscordServers(stored.discordServers, { fallbackGuildId: String(stored.guildId || "").trim() || CONFIG_DEFAULTS.guildId });
    const homeGuildId = (discordServers.servers[0] && discordServers.servers[0].guildId)
        || String(stored.guildId || "").trim() || CONFIG_DEFAULTS.guildId;
    return {
        ...CONFIG_DEFAULTS,
        ...stored,
        // An empty stored guild id falls back to the default instead of winning
        // over it: the settings form writes this field on every save, so an
        // install that never filled it in would otherwise keep a blank value —
        // no admin-role check, no preselected server in the menu.
        // The first server, once picked, *is* the home guild; the old key
        // stays the fallback for installs that never configured one.
        guildId: homeGuildId,
        discordServers,
        serverSettings: normalizeServerSettings(stored.serverSettings, discordServers, homeGuildId),
        adminRoleIds: Array.isArray(stored.adminRoleIds) ? stored.adminRoleIds : CONFIG_DEFAULTS.adminRoleIds,
        categoryIds: Array.isArray(stored.categoryIds) ? stored.categoryIds : CONFIG_DEFAULTS.categoryIds,
        categoryRoles: normalizeCategoryRoles(stored.categoryRoles),
        ...legacyLogChannelIds(stored),
        // Only the credentials: the realm fields of before #542 live in versionSettings.
        blizzard: blizzardCredentials(stored.blizzard),
        versionSettings: versionSettingsOf(stored),
        anthropic: { ...CONFIG_DEFAULTS.anthropic, ...(stored.anthropic || {}) },
        warcraftlogsV2: { ...CONFIG_DEFAULTS.warcraftlogsV2, ...(stored.warcraftlogsV2 || {}) },
        github: normalizeGithub(stored.github),
        // never stored = the defaults; a stored list wins, an empty one only when an admin emptied it
        addonDownloads: storedAddonList(stored),
        addonDownloadsCustomized: stored.addonDownloadsCustomized === true,
        categoryLootTool: (stored.categoryLootTool && typeof stored.categoryLootTool === "object")
            ? stored.categoryLootTool : { ...CONFIG_DEFAULTS.categoryLootTool },
        categoryLootSystem: normalizeCategoryLootSystem(stored.categoryLootSystem),
        ...signupSourcesOf(stored),
        raidhelperRetirement: normalizeRaidhelperRetirement(stored.raidhelperRetirement),
        categorySetupDms: normalizeCategorySetupDms(stored.categorySetupDms),
        categoryLanguage: normalizeCategoryLanguage(stored.categoryLanguage),
        categoryAttendance: normalizeCategoryAttendance(stored.categoryAttendance),
        categoryDiscordEvent: normalizeCategoryFlags(stored.categoryDiscordEvent),
        categoryVoiceChannel: normalizeCategoryVoiceChannel(stored.categoryVoiceChannel),
        categoryMessageLook: normalizeCategoryMessageLook(stored.categoryMessageLook),
        categoryAnnounce: normalizeCategoryAnnounce(stored.categoryAnnounce),
        categorySignupNotes: normalizeCategorySignupNotes(stored.categorySignupNotes),
        categorySignupNoteChannel: normalizeCategoryVoiceChannel(stored.categorySignupNoteChannel),
        categorySignupCharacters: normalizeCategorySignupCharacters(stored.categorySignupCharacters),
        categorySheets: normalizeCategorySheets(stored.categorySheets),
        categoryPlanning: normalizeCategoryPlanning(stored.categoryPlanning),
        categoryRaidTemplate: normalizeCategoryRaidTemplate(stored.categoryRaidTemplate),
        mainVersion: normalizeMainVersion(stored.mainVersion),
        categoryVersion: normalizeCategoryVersion(stored.categoryVersion),
        categoryEras: normalizeCategoryEras(stored.categoryEras),
        hideOtherVersions: stored.hideOtherVersions === true,
        // #924: the bot language of every server without its own (serverSettings[guildId].botLanguage)
        botLanguage: normalizeBotLanguage(stored.botLanguage),
        versionLaunch: normalizeVersionLaunch(stored.versionLaunch),
        discordVisuals: normalizeDiscordVisuals(stored.discordVisuals),
        dungeonRecords: normalizeDungeonRecords(stored.dungeonRecords),
        ...legacyTopItems(stored),
        roleSync: normalizeRoleSync(stored.roleSync, roleSyncContext(discordServers, (stored.discordServers || {}).talkGuildId)),
        categoryReminders: normalizeCategoryReminders(stored.categoryReminders),
        backup: normalizeBackupSettings(stored.backup),
    };
}

module.exports = {
    CONFIG_DEFAULTS, ROLE_SYNC_DIRECTIONS,
    normalizeConfig, normalizeDiscordServers, normalizeServerSettings, mergeServerSettings, serverSettingGuildIds, SERVER_SETTING_DEFAULTS, GLOBAL_FIELDS_924, normalizeEventGuilds, normalizeEventGuildEntry,
    normalizeServers, normalizeLinks, legacyServersAndLinks, MAX_SERVERS: MAX_EVENT_GUILDS, EVENT_GUILD_LABEL_MAX,
    normalizeRoleSync, roleSyncContext, normalizeCategoryRaidTemplate, normalizeCategoryReminders, normalizeTopItems, TOP_ITEM_NAME_MAX,
    normalizeCategorySetupDms, normalizeCategoryLanguage, normalizeCategoryLanguagePatch,
    normalizeCategoryAttendance, attendanceSettings, categoryAttendanceFor, ATTENDANCE_WINDOW_MIN, ATTENDANCE_WINDOW_MAX, ATTENDANCE_DEFAULT_WINDOW, normalizeCategoryFlags, normalizeCategoryVoiceChannel, normalizeCategoryAnnounce,
    normalizeCategorySignupNotes, normalizeCategorySignupCharacters, normalizeCategorySignupSource, configuredCategoryIds, signupSourcesOf,
    normalizeRaidhelperRetirement, normalizeVersionLaunch, VERSION_LAUNCH_MANUAL, normalizeCategorySheets, normalizeCategoryPlanning, normalizeCategoryRoles,
    normalizeMainVersion, normalizeCategoryVersion, normalizeCategoryEras, normalizeVersionSettings, normalizeBotLanguage,
    normalizeDiscordVisuals, DISCORD_VISUALS_DEFAULT, normalizeDungeonRecords,
};
