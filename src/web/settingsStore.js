const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
    officerRoleId, applicationChannelId,
    highestBidsChannelId, highestBidsMessageId, categoryIds,
    googleSpreadsheetId, googleSheetName, googleSheetGid,
} = require("../config/variables");

// Editable bot settings live as JSON files under data/settings/.
const SETTINGS_DIR = path.join(__dirname, "..", "..", "data", "settings");
const RECRUITMENT_FILE = path.join(SETTINGS_DIR, "recruitment.json");
const RECRUITMENT_POSTS_FILE = path.join(SETTINGS_DIR, "recruitment-posts.json");
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
    // Officer role pinged when a new application arrives.
    officerRoleId: officerRoleId || "",
    // Channel new applications are posted to.
    applicationChannelId: applicationChannelId || "",
    // Auction "highest bids" overview message (channel + message id).
    highestBidsChannelId: highestBidsChannelId || "",
    highestBidsMessageId: highestBidsMessageId || "",
    // Discord category IDs that contain the event channels.
    categoryIds: Array.isArray(categoryIds) ? categoryIds : [],
    // Channels the bot watches for Warcraft-Logs links to offer auto-evaluation.
    logChannelIds: [],
    // Defaults pre-filled into the raid-event form.
    raidDefaults: { templateId: "", channelId: "" },
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
        source: data.source || (match && match.source) || "web",
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
    return {
        ...CONFIG_DEFAULTS,
        ...stored,
        raidDefaults: { ...CONFIG_DEFAULTS.raidDefaults, ...(stored.raidDefaults || {}) },
        adminRoleIds: Array.isArray(stored.adminRoleIds) ? stored.adminRoleIds : CONFIG_DEFAULTS.adminRoleIds,
        categoryIds: Array.isArray(stored.categoryIds) ? stored.categoryIds : CONFIG_DEFAULTS.categoryIds,
        logChannelIds: Array.isArray(stored.logChannelIds) ? stored.logChannelIds : CONFIG_DEFAULTS.logChannelIds,
    };
}

/** Merge and persist a partial config update. Returns the full saved config. */
function saveConfig(partial) {
    const next = { ...getConfig(), ...partial };
    if (partial.raidDefaults) next.raidDefaults = { ...getConfig().raidDefaults, ...partial.raidDefaults };
    writeJson(CONFIG_FILE, next);
    return next;
}

module.exports = {
    listRecruitment, getRecruitment, saveRecruitment, deleteRecruitment,
    listRecruitmentPosts, getRecruitmentPost, saveRecruitmentPost, deleteRecruitmentPost,
    listNotify, getNotify, saveNotify, deleteNotify,
    listRaidsheets, getRaidsheet, saveRaidsheet, deleteRaidsheet,
    getConfig, saveConfig,
};
