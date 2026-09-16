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
    // Home guild used to verify admin-role membership (resolveIsAdmin in auth.js).
    // With discordServers.eventGuildId set, getConfig() reports that one here —
    // this key is only the fallback for an install that never picked the two roles.
    guildId: guildId || "",
    // The two Discord servers the bot works with (Einstellungen → Verbindungen →
    // Discord-Server): the event server (event channels, Raid-Helper) and the
    // talk server (overview, sign-up per bot, pings), plus the talk server's
    // target channels. All empty = today's behaviour with a single server.
    discordServers: { eventGuildId: "", talkGuildId: "", talkOverviewChannelId: "", talkPingChannelId: "" },
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
    // Defaults pre-filled into the raid-event form.
    raidDefaults: { templateId: "", channelId: "" },
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
    // A fixed, guild-owned Google Sheet per Discord category:
    // { [categoryId]: { url, name } }. When one is set, a raid in that category
    // links this sheet instead of needing its own copy. A copy the app actually
    // created for that raid still wins — see resolveEventSheetLink() below.
    categorySheets: {},
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

// ---- raid templates (Raid-Helper templateId -> friendly name) ----
// Raid-Helper has no public "list templates" endpoint, so the admin menu keeps
// its own list of the server's templates: added by hand or imported from the
// server's existing Raid-Helper events. It powers the dropdown in the raid form.

/** All known raid templates, newest-updated first. */
function listRaidTemplates() {
    const data = readJson(RAID_TEMPLATES_FILE, { templates: [] });
    const templates = Array.isArray(data.templates) ? data.templates : [];
    return templates.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/**
 * Create or update a raid template, keyed by its Raid-Helper templateId.
 * A blank templateId is rejected (returns null). Returns the saved template.
 */
function saveRaidTemplate(data) {
    const id = String(data.id || "").trim();
    if (!id) return null;
    const name = String(data.name || "").trim();
    const templates = listRaidTemplates();
    const match = templates.find((t) => t.id === id);
    let saved;
    if (match) {
        saved = Object.assign(match, { name: name || match.name, updatedAt: Date.now() });
    } else {
        saved = { id, name, createdAt: Date.now(), updatedAt: Date.now() };
        templates.push(saved);
    }
    writeJson(RAID_TEMPLATES_FILE, { templates });
    return saved;
}

/**
 * Upsert many raid templates at once (used by the "import from Raid-Helper"
 * action). Returns { added, updated } counts.
 */
function saveRaidTemplates(list) {
    const incoming = (Array.isArray(list) ? list : [])
        .map((t) => ({ id: String(t.id || "").trim(), name: String(t.name || "").trim() }))
        .filter((t) => t.id);
    const templates = listRaidTemplates();
    let added = 0;
    let updated = 0;
    for (const t of incoming) {
        const match = templates.find((x) => x.id === t.id);
        if (match) {
            // Only overwrite the name when the import actually carries one.
            if (t.name && t.name !== match.name) match.name = t.name;
            match.updatedAt = Date.now();
            updated += 1;
        } else {
            templates.push({ id: t.id, name: t.name, createdAt: Date.now(), updatedAt: Date.now() });
            added += 1;
        }
    }
    if (incoming.length) writeJson(RAID_TEMPLATES_FILE, { templates });
    return { added, updated };
}

/** Delete a raid template by its templateId. Returns true if one was removed. */
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
        raidDefaults: { ...CONFIG_DEFAULTS.raidDefaults, ...(stored.raidDefaults || {}) },
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
        categoryIds: Array.isArray(stored.categoryIds) ? stored.categoryIds : CONFIG_DEFAULTS.categoryIds,
        categoryRoles: normalizeCategoryRoles(stored.categoryRoles),
        logChannelIds: Array.isArray(stored.logChannelIds) ? stored.logChannelIds : CONFIG_DEFAULTS.logChannelIds,
        blizzard: { ...CONFIG_DEFAULTS.blizzard, ...(stored.blizzard || {}) },
        anthropic: { ...CONFIG_DEFAULTS.anthropic, ...(stored.anthropic || {}) },
        warcraftlogsV2: { ...CONFIG_DEFAULTS.warcraftlogsV2, ...(stored.warcraftlogsV2 || {}) },
        categoryLootTool: (stored.categoryLootTool && typeof stored.categoryLootTool === "object")
            ? stored.categoryLootTool : { ...CONFIG_DEFAULTS.categoryLootTool },
        categorySheets: normalizeCategorySheets(stored.categorySheets),
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

// A Discord snowflake: digits only. Anything else (a pasted link, a name) is
// dropped rather than stored as an id no lookup can ever resolve.
const SNOWFLAKE = /^\d{5,25}$/;
const DISCORD_SERVER_KEYS = ["eventGuildId", "talkGuildId", "talkOverviewChannelId", "talkPingChannelId"];

/**
 * Normalise the two-server block to `{ eventGuildId, talkGuildId,
 * talkOverviewChannelId, talkPingChannelId }`, every field a snowflake or "".
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
    listRaidTemplates, saveRaidTemplate, saveRaidTemplates, deleteRaidTemplate,
    listNotify, getNotify, saveNotify, deleteNotify,
    listRaidsheets, getRaidsheet, saveRaidsheet, deleteRaidsheet,
    getConfig, saveConfig, resolveEventSheetLink, normalizeDiscordServers,
    normalizeRoleSync, normalizeCategoryReminders, ROLE_SYNC_DIRECTIONS, REMINDER_TARGETS,
};
