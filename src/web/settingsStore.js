const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
    officerRoleId, applicationChannelId,
    highestBidsChannelId, highestBidsMessageId, categoryIds,
    googleSpreadsheetId, googleSheetName, googleSheetGid,
    blizzardClientId, blizzardClientSecret, blizzardRegion, blizzardRealmSlug, blizzardNamespace,
    guildId, raidhelperServerId,
} = require("../config/variables");
const { normalizeRolePermissions, normalizeUserPermissions, normalizeAreaAccess } = require("../config/permissions");
const { isLegacy, migrateLegacy, normalizeTemplate, validateTemplate } = require("./raidTemplates");
const { normalizeBotCommandAccess } = require("../config/botCommands");
const { normalizeCategoryLootSystem } = require("./lootSystem");

// Editable bot settings live as JSON files under data/settings/.
const SETTINGS_DIR = path.join(__dirname, "..", "..", "data", "settings");
const RECRUITMENT_FILE = path.join(SETTINGS_DIR, "recruitment.json");
const RECRUITMENT_POSTS_FILE = path.join(SETTINGS_DIR, "recruitment-posts.json");
const RAID_TEMPLATES_FILE = path.join(SETTINGS_DIR, "raid-templates.json");
const NOTIFY_FILE = path.join(SETTINGS_DIR, "notify.json");
const CONFIG_FILE = path.join(SETTINGS_DIR, "config.json");

// The "Tier 4/5" raidsheet that ships by default (seeded from the GOOGLE_* env
// vars). It always exists so a fresh install can fill setups without any config.
const DEFAULT_RAIDSHEET = {
    id: "tier45",
    name: "Tier 4 / Tier 5",
    spreadsheetId: googleSpreadsheetId || "",
    sheetName: googleSheetName || "Setup",
    gid: googleSheetGid || 34139428,
    keywords: ["kara", "karazhan", "gruul", "maggi", "magtheridon"],
};

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
    // own defaultAccess (see config/botCommands.js and web/botAccess.js).
    botCommandAccess: {},
    // Home guild used to verify admin-role membership (resolveIsAdmin in auth.js).
    // With discordServers.eventGuildId set, getConfig() reports that one here —
    // this key is only the fallback for an install that never picked the two roles.
    guildId: guildId || "",
    // The two Discord servers the bot works with (Einstellungen → Verbindungen →
    // Discord-Server): the event server (event channels, Raid-Helper) and the
    // talk server (overview, sign-up per bot, pings), plus the talk server's
    // target channels. All empty = today's behaviour with a single server.
    // `signupNoteChannelId` is where the messages of "Vielleicht" / "Absagen"
    // land (src/web/signupNotes.js) — a channel on either server.
    discordServers: { eventGuildId: "", talkGuildId: "", talkOverviewChannelId: "", talkPingChannelId: "", signupNoteChannelId: "" },
    // Raid-Helper server id (raid-helper.xyz), used for all Raid-Helper API calls.
    // RAIDHELPER_API_KEY stays in .env — it's a real secret, this id isn't.
    raidhelperServerId: raidhelperServerId || "",
    // Officer role pinged when a new application arrives.
    officerRoleId: officerRoleId || "",
    // Channel new applications are posted to.
    applicationChannelId: applicationChannelId || "",
    // Auction "highest bids" overview message (channel + message id).
    highestBidsChannelId: highestBidsChannelId || "",
    highestBidsMessageId: highestBidsMessageId || "",
    // Discord category IDs that contain the event channels.
    categoryIds: Array.isArray(categoryIds) ? categoryIds : [],
    // Per-category expected raider roles: { [categoryId]: [roleId, ...] }. Used to
    // compare who signed up to an event against who is expected to (attendance).
    categoryRoles: {},
    // Channels the bot watches for Warcraft-Logs links to offer auto-evaluation.
    logChannelIds: [],
    // Defaults pre-filled into the raid-event form. The default *template* is
    // per category now (categoryRaidTemplate); a stored raidDefaults.templateId
    // is only read once more, to migrate it (see categoryRaidTemplateOf()).
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
    // "softres" | "lootcouncil" | "gdkp" | "other" (src/web/lootSystem.js). A
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
    // raidhelperClient.js); the stored history stays readable.
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
    // "Beim Anlegen ankündigen" per Discord category (#306):
    // { [categoryId]: { enabled: true, target: "event" | "talk" | "both" } }.
    // Off by default — only switched-on categories are stored.
    categoryAnnounce: {},
    // A message with "Vielleicht" / "Absagen" per Discord category:
    // { [categoryId]: "required" | "none" }. A category without an entry is
    // "optional" (the modal asks, the raider may leave it empty). The message is
    // posted to discordServers.signupNoteChannelId — see src/web/signupNotes.js.
    categorySignupNotes: {},
    // Where a category's messages go instead (#335): { [categoryId]: channelId }.
    // Missing = discordServers.signupNoteChannelId, the default for every category.
    categorySignupNoteChannel: {},
    // A fixed, guild-owned Google Sheet per Discord category:
    // { [categoryId]: { url, name } }. When one is set, a raid in that category
    // links this sheet instead of needing its own copy. A copy the app actually
    // created for that raid still wins — see resolveEventSheetLink() below.
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
    // ever ADDS roles (src/web/roleSync.js); a role lost on one side stays on
    // the other and shows up as a hint in the admin menu.
    roleSync: [],
    // Automatic reminders per raid category (#264): { [categoryId]:
    // { missingHours, signedHours, target } } — hours before the sign-up
    // deadline (else the raid start) to the members still missing, hours before
    // the raid to the signed-up ones; 0 = off. See src/web/reminders.js.
    categoryReminders: {},
};

function ensureDir() {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
}

function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return fallback;
    }
}

function writeJson(file, data) {
    ensureDir();
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function newId() {
    return crypto.randomBytes(6).toString("hex");
}

/** All recruitment templates, newest-edited first. */
function listRecruitment() {
    const data = readJson(RECRUITMENT_FILE, { templates: [] });
    const templates = Array.isArray(data.templates) ? data.templates : [];
    return templates.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/** A single recruitment template by id, or null. */
function getRecruitment(id) {
    return listRecruitment().find((t) => t.id === id) || null;
}

/**
 * Create or update a recruitment template. If `data.id` matches an existing
 * template it is updated, otherwise a new one is created. Returns the saved template.
 */
function saveRecruitment(data) {
    const templates = listRecruitment();
    const clean = {
        name: String(data.name || "").trim(),
        content: String(data.content || ""),
        title: String(data.title || "").trim(),
        body: String(data.body || ""),
        buttonLabel: String(data.buttonLabel || "").trim(),
    };
    const existing = data.id && templates.find((t) => t.id === data.id);
    let saved;
    if (existing) {
        saved = Object.assign(existing, clean, { updatedAt: Date.now() });
    } else {
        saved = Object.assign({ id: newId(), createdAt: Date.now(), updatedAt: Date.now() }, clean);
        templates.push(saved);
    }
    writeJson(RECRUITMENT_FILE, { templates });
    return saved;
}

/** Delete a recruitment template by id. Returns true if one was removed. */
function deleteRecruitment(id) {
    const templates = listRecruitment();
    const next = templates.filter((t) => t.id !== id);
    if (next.length === templates.length) return false;
    writeJson(RECRUITMENT_FILE, { templates: next });
    return true;
}

// ---- posted recruitment messages (tracked so they can be edited later) ----

/** All tracked posted recruitment messages, newest first. */
function listRecruitmentPosts() {
    const data = readJson(RECRUITMENT_POSTS_FILE, { posts: [] });
    const posts = Array.isArray(data.posts) ? data.posts : [];
    return posts.slice().sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0));
}

function getRecruitmentPost(id) {
    return listRecruitmentPosts().find((p) => p.id === id) || null;
}

/**
 * Record or update a posted recruitment message. Deduplicates by
 * (channelId, messageId) so a re-scan doesn't create duplicates.
 * Returns the saved post.
 */
function saveRecruitmentPost(data) {
    const posts = listRecruitmentPosts();
    const match = posts.find((p) =>
        (data.id && p.id === data.id)
        || (p.channelId === data.channelId && p.messageId === data.messageId));
    const clean = {
        guildId: data.guildId || (match && match.guildId) || "",
        channelId: data.channelId || (match && match.channelId) || "",
        messageId: data.messageId || (match && match.messageId) || "",
        channelName: data.channelName || (match && match.channelName) || "",
        content: data.content || "",
        title: data.title || "",
        body: data.body || "",
        buttonLabel: data.buttonLabel || "",
        // A message the admin menu posted stays "web" when a later scan finds it
        // again — the scan only knows that it exists, not where it came from.
        source: (match && match.source === "web") ? "web" : (data.source || (match && match.source) || "web"),
        // Which template it was posted from — kept across edits and re-scans; a
        // message the scan found on its own has none.
        templateId: data.templateId || (match && match.templateId) || "",
    };
    let saved;
    if (match) {
        saved = Object.assign(match, clean, { updatedAt: Date.now() });
    } else {
        saved = Object.assign({ id: newId(), postedAt: Date.now(), updatedAt: Date.now() }, clean);
        posts.push(saved);
    }
    writeJson(RECRUITMENT_POSTS_FILE, { posts });
    return saved;
}

/** Remove a tracked post (does not touch the Discord message). Returns true if removed. */
function deleteRecruitmentPost(id) {
    const posts = listRecruitmentPosts();
    const next = posts.filter((p) => p.id !== id);
    if (next.length === posts.length) return false;
    writeJson(RECRUITMENT_POSTS_FILE, { posts: next });
    return true;
}

// ---- raid templates (#266): size, tanks, healers per evening ----
// Stored as `{ templates: [...] }` in data/settings/raid-templates.json; the
// shape and its rules are in raidTemplates.js. A pre-#266 entry (a bare
// Raid-Helper `{ id, name }`) is migrated on read and written back once.

/** All raid templates, newest-updated first, legacy entries migrated. */
function listRaidTemplates() {
    const data = readJson(RAID_TEMPLATES_FILE, { templates: [] });
    const stored = Array.isArray(data.templates) ? data.templates : [];
    let migrated = false;
    const templates = stored.filter((t) => t && typeof t === "object").map((t) => {
        if (isLegacy(t)) {
            migrated = true;
            return migrateLegacy(t);
        }
        return { ...normalizeTemplate(t), createdAt: t.createdAt || 0, updatedAt: t.updatedAt || 0 };
    });
    if (migrated) writeJson(RAID_TEMPLATES_FILE, { templates });
    return templates.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/** One template by id, or null. */
function getRaidTemplate(id) {
    return listRaidTemplates().find((t) => t.id === String(id || "")) || null;
}

/**
 * Create (no id) or update (id) a template.
 * @returns {{ template?: object, error?: string, notFound?: boolean }}
 */
function saveRaidTemplate(data) {
    const clean = normalizeTemplate(data);
    // The raw body too: a colour or picture normalizeTemplate() could not use
    // is refused with a sentence instead of silently becoming "none" (#307).
    const problem = validateTemplate(clean, data && typeof data === "object" ? data : {});
    if (problem) return { error: problem };
    const templates = listRaidTemplates();
    if (clean.id) {
        const match = templates.find((t) => t.id === clean.id);
        if (!match) return { notFound: true, error: "Vorlage nicht gefunden." };
        Object.assign(match, clean, { updatedAt: Date.now() });
        writeJson(RAID_TEMPLATES_FILE, { templates });
        return { template: match };
    }
    const saved = { ...clean, id: newId(), createdAt: Date.now(), updatedAt: Date.now() };
    templates.push(saved);
    writeJson(RAID_TEMPLATES_FILE, { templates });
    return { template: saved };
}

/**
 * Take over the Raid-Helper templates found in the server's events (the
 * "Aus Raid-Helper laden" action). One already linked by a template only gets
 * a missing name; an unknown one becomes a template without size, like a
 * migrated entry. Returns { added, updated } counts.
 */
function saveRaidTemplates(list) {
    const incoming = (Array.isArray(list) ? list : [])
        .map((t) => ({ id: String(t.id || "").trim(), name: String(t.name || "").trim() }))
        .filter((t) => t.id);
    const templates = listRaidTemplates();
    let added = 0;
    let updated = 0;
    for (const t of incoming) {
        const match = templates.find((x) => x.raidhelperTemplateId === t.id);
        if (match) {
            if (t.name && !match.name) match.name = t.name;
            updated += 1;
        } else {
            templates.push(migrateLegacy({ id: t.id, name: t.name }));
            added += 1;
        }
    }
    if (incoming.length) writeJson(RAID_TEMPLATES_FILE, { templates });
    return { added, updated };
}

/** Delete a template by id. Returns true if one was removed. */
function deleteRaidTemplate(id) {
    const templates = listRaidTemplates();
    const next = templates.filter((t) => t.id !== id);
    if (next.length === templates.length) return false;
    writeJson(RAID_TEMPLATES_FILE, { templates: next });
    return true;
}

// ---- notify (Anmelde-Aufruf) templates: message texts posted with a role ping ----

/** All Anmelde-Aufruf templates, newest-edited first. */
function listNotify() {
    const data = readJson(NOTIFY_FILE, { templates: [] });
    const templates = Array.isArray(data.templates) ? data.templates : [];
    return templates.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/** A single Anmelde-Aufruf template by id, or null. */
function getNotify(id) {
    return listNotify().find((t) => t.id === id) || null;
}

/** Create or update an Anmelde-Aufruf template. Returns the saved template. */
function saveNotify(data) {
    const templates = listNotify();
    const clean = {
        name: String(data.name || "").trim(),
        title: String(data.title || "").trim(),
        body: String(data.body || ""),
    };
    const existing = data.id && templates.find((t) => t.id === data.id);
    let saved;
    if (existing) {
        saved = Object.assign(existing, clean, { updatedAt: Date.now() });
    } else {
        saved = Object.assign({ id: newId(), createdAt: Date.now(), updatedAt: Date.now() }, clean);
        templates.push(saved);
    }
    writeJson(NOTIFY_FILE, { templates });
    return saved;
}

/** Delete an Anmelde-Aufruf template by id. Returns true if one was removed. */
function deleteNotify(id) {
    const templates = listNotify();
    const next = templates.filter((t) => t.id !== id);
    if (next.length === templates.length) return false;
    writeJson(NOTIFY_FILE, { templates: next });
    return true;
}

// ---- raidsheets: Google-Sheets targets keyed by content (Tier 4/5, …) ----

// Prefer a provided value, falling back when it is null/undefined.
function pick(value, fallback) {
    return value === undefined || value === null ? fallback : value;
}

function normalizeRaidsheet(data, fallback = {}) {
    const keywords = Array.isArray(data.keywords)
        ? data.keywords.map((k) => String(k).trim()).filter(Boolean)
        : String(data.keywords || "").split(",").map((k) => k.trim()).filter(Boolean);
    return {
        name: String(pick(data.name, fallback.name || "")).trim(),
        spreadsheetId: String(pick(data.spreadsheetId, fallback.spreadsheetId || "")).trim(),
        sheetName: String(pick(data.sheetName, fallback.sheetName || "Setup")).trim() || "Setup",
        gid: String(pick(data.gid, pick(fallback.gid, ""))).trim(),
        keywords,
    };
}

/**
 * All configured raidsheets. When nothing has been saved yet the default
 * "Tier 4/5" sheet (seeded from the GOOGLE_* env vars) is returned so the
 * feature works out of the box.
 */
function listRaidsheets() {
    const stored = readJson(CONFIG_FILE, {});
    if (Array.isArray(stored.raidsheets) && stored.raidsheets.length) {
        return stored.raidsheets;
    }
    return [{ ...DEFAULT_RAIDSHEET }];
}

/** A single raidsheet by id, or null. */
function getRaidsheet(id) {
    return listRaidsheets().find((s) => s.id === id) || null;
}

/**
 * Create or update a raidsheet. If `data.id` matches an existing sheet it is
 * updated, otherwise a new one is created. Persisting always materialises the
 * current list (including the seeded default) so it survives further edits.
 */
function saveRaidsheet(data) {
    const sheets = listRaidsheets().map((s) => ({ ...s }));
    const existing = data.id && sheets.find((s) => s.id === data.id);
    let saved;
    if (existing) {
        Object.assign(existing, normalizeRaidsheet(data, existing));
        saved = existing;
    } else {
        saved = { id: newId(), ...normalizeRaidsheet(data) };
        sheets.push(saved);
    }
    const stored = readJson(CONFIG_FILE, {});
    writeJson(CONFIG_FILE, { ...stored, raidsheets: sheets });
    return saved;
}

/** Delete a raidsheet by id. Returns true if one was removed. */
function deleteRaidsheet(id) {
    const sheets = listRaidsheets().map((s) => ({ ...s }));
    const next = sheets.filter((s) => s.id !== id);
    if (next.length === sheets.length) return false;
    const stored = readJson(CONFIG_FILE, {});
    writeJson(CONFIG_FILE, { ...stored, raidsheets: next });
    return true;
}

/** The current admin config, merged over defaults. */
function getConfig() {
    const stored = readJson(CONFIG_FILE, {});
    const discordServers = normalizeDiscordServers(stored.discordServers);
    return {
        ...CONFIG_DEFAULTS,
        ...stored,
        raidDefaults: { channelId: String((stored.raidDefaults || {}).channelId || CONFIG_DEFAULTS.raidDefaults.channelId) },
        // An empty stored guild id falls back to the default instead of winning
        // over it: the settings form writes this field on every save, so an
        // install that never filled it in would otherwise keep a blank value —
        // no admin-role check, no preselected server in the menu.
        // The event server, once picked, *is* the home guild; the old key stays
        // the fallback for installs that only ever configured one server.
        guildId: discordServers.eventGuildId || String(stored.guildId || "").trim() || CONFIG_DEFAULTS.guildId,
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
        categoryAnnounce: normalizeCategoryAnnounce(stored.categoryAnnounce),
        categorySignupNotes: normalizeCategorySignupNotes(stored.categorySignupNotes),
        categorySignupNoteChannel: normalizeCategoryVoiceChannel(stored.categorySignupNoteChannel),
        categorySheets: normalizeCategorySheets(stored.categorySheets),
        categoryRaidTemplate: categoryRaidTemplateOf(stored),
        topItems: normalizeTopItems(stored.topItems),
        roleSync: normalizeRoleSync(stored.roleSync),
        categoryReminders: normalizeCategoryReminders(stored.categoryReminders),
    };
}

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
        if (!SNOWFLAKE.test(eventRoleId) || !SNOWFLAKE.test(talkRoleId)) continue;
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
        if (!SNOWFLAKE.test(key) || !rule || typeof rule !== "object") continue;
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

/**
 * The stored default template per category — or, for a config from before
 * #266 that has none yet, the old global raidDefaults.templateId (a Raid-Helper
 * template id) handed to every raid category, pointing at the template that
 * links that Raid-Helper template. It applied to every new event before, so
 * every category keeps it. The next save writes the map and ends the migration.
 */
function categoryRaidTemplateOf(stored) {
    if (stored.categoryRaidTemplate !== undefined) return normalizeCategoryRaidTemplate(stored.categoryRaidTemplate);
    const legacy = String((stored.raidDefaults || {}).templateId || "").trim();
    if (!legacy) return {};
    const template = listRaidTemplates().find((t) => t.raidhelperTemplateId === legacy);
    if (!template) return {};
    const categories = Array.isArray(stored.categoryIds) ? stored.categoryIds : CONFIG_DEFAULTS.categoryIds;
    return Object.fromEntries(categories.map((id) => [String(id), template.id]));
}

// A Discord snowflake: digits only. Anything else (a pasted link, a name) is
// dropped rather than stored as an id no lookup can ever resolve.
const SNOWFLAKE = /^\d{5,25}$/;
const DISCORD_SERVER_KEYS = ["eventGuildId", "talkGuildId", "talkOverviewChannelId", "talkPingChannelId", "signupNoteChannelId"];

/**
 * Normalise the two-server block to `{ eventGuildId, talkGuildId,
 * talkOverviewChannelId, talkPingChannelId, signupNoteChannelId }`, every field
 * a snowflake or "". The note channel may sit on either server.
 * A talk server equal to the event server is no second server: it is cleared,
 * so "one server for everything" is stored the same way however it was entered.
 */
function normalizeDiscordServers(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const out = {};
    for (const key of DISCORD_SERVER_KEYS) {
        const value = String(src[key] === undefined || src[key] === null ? "" : src[key]).trim();
        out[key] = SNOWFLAKE.test(value) ? value : "";
    }
    if (out.talkGuildId && out.talkGuildId === out.eventGuildId) out.talkGuildId = "";
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
        if (key && /^\d{5,25}$/.test(value)) out[key] = value;
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
 * Which sheet a raid should link: the copy the app created for this very raid
 * if there is one, otherwise the fixed sheet assigned to its category. Returns
 * null when neither exists.
 *
 * @param {object|null} eventSheet  the eventSheetStore record for the raid
 * @param {string} categoryId       the raid channel's Discord category
 * @returns {null | { url, name, source: "event" | "category" }}
 */
function resolveEventSheetLink(eventSheet, categoryId) {
    if (eventSheet && eventSheet.url) {
        return { url: eventSheet.url, name: eventSheet.sheetName || "", source: "event" };
    }
    const assigned = getConfig().categorySheets[String(categoryId || "").trim()];
    if (assigned && assigned.url) {
        return { url: assigned.url, name: assigned.name || "", source: "category" };
    }
    return null;
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

/**
 * Merge and persist a partial config update. Returns the config as every other
 * reader sees it — read back through getConfig(), so a value that only takes its
 * final shape there (a cleared guildId falling back to the default) is what the
 * admin menu gets back and renders, instead of the raw stored blank.
 */
function saveConfig(partial) {
    const current = getConfig();
    const next = { ...current, ...partial };
    if (partial.raidDefaults) next.raidDefaults = { ...current.raidDefaults, ...partial.raidDefaults };
    if (partial.blizzard) next.blizzard = { ...current.blizzard, ...partial.blizzard };
    if (partial.anthropic) next.anthropic = { ...current.anthropic, ...partial.anthropic };
    if (partial.discordServers) {
        next.discordServers = normalizeDiscordServers({ ...current.discordServers, ...partial.discordServers });
        // Keep the fallback key in step, so clearing the event server later
        // falls back to the server that was last in use, not to an older one.
        if (next.discordServers.eventGuildId) next.guildId = next.discordServers.eventGuildId;
    }
    if (partial.warcraftlogsV2) next.warcraftlogsV2 = { ...current.warcraftlogsV2, ...partial.warcraftlogsV2 };
    if (partial.categoryLootTool) next.categoryLootTool = { ...current.categoryLootTool, ...partial.categoryLootTool };
    // Merged, then normalised: "" (like the loot addon) drops the category again.
    if (partial.categoryLootSystem) {
        next.categoryLootSystem = normalizeCategoryLootSystem({ ...current.categoryLootSystem, ...partial.categoryLootSystem });
    }
    // Merged, then normalised. `current` already carries the categories pinned
    // for an install from before #291 (signupSourcesOf), so this save writes them down.
    if (partial.raidhelperRetirement !== undefined) next.raidhelperRetirement = normalizeRaidhelperRetirement(partial.raidhelperRetirement);
    if (partial.categorySignupSource) {
        next.categorySignupSource = normalizeCategorySignupSource({ ...current.categorySignupSource, ...partial.categorySignupSource });
    }
    // Merged, then normalised: a category switched off drops out.
    if (partial.categorySetupDms) {
        next.categorySetupDms = normalizeCategorySetupDms({ ...current.categorySetupDms, ...partial.categorySetupDms });
    }
    // Same contract for the two per-category switches of #305: merged, then
    // normalised — a category switched off (or a cleared voice channel) drops out.
    if (partial.categoryDiscordEvent) {
        next.categoryDiscordEvent = normalizeCategoryFlags({ ...current.categoryDiscordEvent, ...partial.categoryDiscordEvent });
    }
    if (partial.categoryVoiceChannel) {
        next.categoryVoiceChannel = normalizeCategoryVoiceChannel({ ...current.categoryVoiceChannel, ...partial.categoryVoiceChannel });
    }
    if (partial.categoryAnnounce) {
        next.categoryAnnounce = normalizeCategoryAnnounce({ ...current.categoryAnnounce, ...partial.categoryAnnounce });
    }
    // Merged, then normalised: a category set back to "optional" drops out.
    if (partial.categorySignupNotes) {
        next.categorySignupNotes = normalizeCategorySignupNotes({ ...current.categorySignupNotes, ...partial.categorySignupNotes });
    }
    // Same contract as the voice channel: "" drops the category (back to the default).
    if (partial.categorySignupNoteChannel) {
        next.categorySignupNoteChannel = normalizeCategoryVoiceChannel({ ...current.categorySignupNoteChannel, ...partial.categorySignupNoteChannel });
    }
    // Replaced whole, like the top items: a category left out has no default.
    if (partial.categoryRaidTemplate !== undefined) next.categoryRaidTemplate = normalizeCategoryRaidTemplate(partial.categoryRaidTemplate);
    if (partial.categorySheets) {
        next.categorySheets = normalizeCategorySheets({ ...current.categorySheets, ...partial.categorySheets });
    }
    // A list, not a map: what is sent replaces the stored one (that is how an
    // item gets removed again), it is only cleaned up on the way in.
    if (partial.topItems !== undefined) next.topItems = normalizeTopItems(partial.topItems);
    // Both replace the stored value as a whole, like topItems.
    if (partial.roleSync !== undefined) next.roleSync = normalizeRoleSync(partial.roleSync);
    if (partial.categoryReminders !== undefined) next.categoryReminders = normalizeCategoryReminders(partial.categoryReminders);
    writeJson(CONFIG_FILE, next);
    return getConfig();
}

module.exports = {
    listRecruitment, getRecruitment, saveRecruitment, deleteRecruitment,
    listRecruitmentPosts, getRecruitmentPost, saveRecruitmentPost, deleteRecruitmentPost,
    listRaidTemplates, getRaidTemplate, saveRaidTemplate, saveRaidTemplates, deleteRaidTemplate,
    listNotify, getNotify, saveNotify, deleteNotify,
    listRaidsheets, getRaidsheet, saveRaidsheet, deleteRaidsheet,
    getConfig, saveConfig, resolveEventSheetLink, normalizeDiscordServers,
    normalizeRoleSync, normalizeCategoryReminders, ROLE_SYNC_DIRECTIONS, REMINDER_TARGETS,
    normalizeCategorySignupSource, signupSourcesOf, normalizeRaidhelperRetirement,
    normalizeCategoryFlags, normalizeCategoryVoiceChannel,
};
