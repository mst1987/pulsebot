// The admin config, data/settings/config.json (#420).
//
// getConfig() runs on nearly every request, so its result is kept: the file is
// read and normalised again only when the base store sees a new file version
// (mtime/size/inode - an edit by hand counts), and every write drops the kept
// value. Every caller gets its own copy, so changing what getConfig() returned
// can never change what the next caller sees.
//
// The shape - defaults and normalisers - is configSchema.js; upgrades of an old
// file run once at start (settingsMigration.js), never on a read.
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");
const { normalizeCategoryLootSystem } = require("../services/loot/lootSystem");
const { normalizeCategoryMessageLook } = require("../services/events/embedLook");
const {
    normalizeConfig, normalizeDiscordServers, normalizeRaidhelperRetirement, normalizeVersionLaunch, normalizeCategorySignupSource,
    normalizeCategorySetupDms, normalizeCategoryLanguage, normalizeCategoryAttendance, normalizeCategoryFlags, normalizeCategoryVoiceChannel, normalizeCategoryAnnounce,
    normalizeCategorySignupNotes, normalizeCategorySignupCharacters, normalizeCategoryRaidTemplate, normalizeCategorySheets, normalizeCategoryPlanning,
    normalizeRoleSync, roleSyncContext, normalizeCategoryReminders, normalizeMainVersion, normalizeCategoryVersion, normalizeCategoryEras, normalizeVersionSettings,
    normalizeDiscordVisuals, normalizeDungeonRecords, mergeServerSettings,
} = require("./configSchema");
const { planningOf } = require("../services/events/planning");
const { normalizeBackupSettings } = require("../services/backup/backupConfig");

const FILE = settingsPath("config.json");

// What a missing file reads as. Computed once: it only depends on the env
// defaults, which do not change while the process runs.
let freshConfig = null;
const fresh = () => structuredClone(freshConfig || (freshConfig = normalizeConfig({})));

// The normalised config, kept until the file changes (jsonStore's `cache`).
const store = createJsonStore({ file: FILE, defaults: fresh, normalize: normalizeConfig, cache: true });
// The file as it is stored, for the few writers that must keep its exact
// content (raidsheets, the start-up migration). Not cached: rarely read.
const rawStore = createJsonStore({ file: FILE, defaults: {} });

/** The current admin config, merged over the defaults (a copy of it). */
function getConfig() {
    return store.read();
}

/** config.json as stored, not normalised ({} when missing or unreadable). */
function readStored() {
    const stored = rawStore.read();
    return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
}

/** Replace config.json with `value` as it is; the kept config is dropped. */
function writeStored(value) {
    store.write(value);
}

/**
 * The global top-item list of before #952 as the file holds it, while the start
 * migration has not moved it yet (no `topItemsLegacy`), else undefined. getConfig()
 * hides it, so a save writes it back from here - a migration that failed or has
 * not run yet still finds it on the next start.
 */
function pendingTopItems() {
    const stored = readStored();
    if (Object.prototype.hasOwnProperty.call(stored, "topItemsLegacy")) return undefined;
    return Array.isArray(stored.topItems) ? stored.topItems : undefined;
}

/** `next` with the stored top items of before kept (pendingTopItems) and no other global list. */
function withPendingTopItems(next) {
    const out = { ...next };
    delete out.topItems;
    const pending = pendingTopItems();
    if (pending) out.topItems = pending;
    return out;
}

/** Tests: read and write another file; null = config.json again. */
function useFile(file) {
    store.useFile(file);
    rawStore.useFile(file);
}

/**
 * Which sheet a raid should link: the copy the app created for this very raid
 * if there is one, otherwise the fixed sheet assigned to its category. Returns
 * null when neither exists - and always for a category that plans with the raid
 * plan instead (planningOf(), src/services/events/planning.js): a raid gets the
 * raid plan or a sheet, never both.
 *
 * @param {object|null} eventSheet  the eventSheetStore record for the raid
 * @param {string} categoryId       the raid channel's Discord category
 * @returns {null | { url, name, source: "event" | "category" }}
 */
function resolveEventSheetLink(eventSheet, categoryId) {
    const config = getConfig();
    if (planningOf(categoryId, config) !== "sheet") return null;
    if (eventSheet && eventSheet.url) {
        return { url: eventSheet.url, name: eventSheet.sheetName || "", source: "event" };
    }
    const assigned = config.categorySheets[String(categoryId || "").trim()];
    if (assigned && assigned.url) {
        return { url: assigned.url, name: assigned.name || "", source: "category" };
    }
    return null;
}

/**
 * The per-category maps a save merges into the stored one and then normalises,
 * so a category the request leaves out keeps its value and one set back to the
 * default drops out:
 * - categoryLootSystem: "" (like the loot addon) drops the category again;
 * - categorySignupSource: `current` already carries the categories pinned for an
 *   install from before #291 (signupSourcesOf), so a save writes them down;
 * - categorySetupDms, categoryDiscordEvent (#305): a category switched off drops out;
 * - categoryAttendance: a category's object is replaced whole, one back at the defaults drops out;
 * - categoryLanguage: "" = back to the server language, the category drops out;
 * - categoryVoiceChannel (#305), categorySignupNoteChannel (#335): "" = back to the default;
 * - categoryMessageLook: merged per category, one back at the defaults drops out;
 * - categoryAnnounce (#306), categorySignupNotes ("optional" drops out);
 * - categorySignupCharacters: 8 (the default) drops the category again;
 * - categorySheets: an emptied url drops the sheet;
 * - categoryPlanning: raid plan or sheet, a category not sent keeps its mode.
 */
const MERGED_CATEGORY_MAPS = [
    ["categoryLootSystem", normalizeCategoryLootSystem],
    ["categorySignupSource", normalizeCategorySignupSource],
    ["categorySetupDms", normalizeCategorySetupDms],
    ["categoryLanguage", normalizeCategoryLanguage],
    ["categoryAttendance", normalizeCategoryAttendance],
    ["categoryDiscordEvent", normalizeCategoryFlags],
    ["categoryVoiceChannel", normalizeCategoryVoiceChannel],
    ["categoryMessageLook", normalizeCategoryMessageLook],
    ["categoryAnnounce", normalizeCategoryAnnounce],
    ["categorySignupNotes", normalizeCategorySignupNotes],
    ["categorySignupNoteChannel", normalizeCategoryVoiceChannel],
    ["categorySignupCharacters", normalizeCategorySignupCharacters],
    ["categorySheets", normalizeCategorySheets],
    ["categoryPlanning", normalizeCategoryPlanning],
];

// Blocks a PATCH sends only partly: the fields sent are merged over the stored
// block (a secret left out stays — the credentials' "omit = keep").
const MERGED_FIELDS = ["blizzard", "anthropic", "warcraftlogsV2", "github", "categoryLootTool"];

/**
 * Small blocks merged per field before they are normalised: the drawn pictures
 * (a switch sent alone leaves the others as they are) and the dungeon record
 * post (the switch sent alone keeps the channel).
 */
const MERGED_BLOCKS = [
    ["discordVisuals", normalizeDiscordVisuals],
    ["dungeonRecords", normalizeDungeonRecords],
];

/** `next[key]` = the stored block with the sent fields over it, normalised; nothing sent leaves it alone. */
function mergeBlock(next, current, sent, key, normalize) {
    if (sent && typeof sent === "object") next[key] = normalize({ ...current[key], ...sent });
}

/** `next.discordServers` (and `next.guildId`) from the stored block with the sent one over it. */
function mergeDiscordServers(next, current, sent) {
    const merged = { ...current.discordServers, ...sent };
    // An empty stored list works on the implicit main server (guildId, also one
    // sent in the same save), which the page lists as a server; adding one more
    // must not drop it - that took the main server's rights and loops away on
    // prod (Oct 2026).
    const stored = (current.discordServers && current.discordServers.servers) || [];
    const main = String(next.guildId || "").trim();
    if (!stored.length && main && Array.isArray(merged.servers) && merged.servers.length
        && !merged.servers.some((s) => s && String(s.guildId).trim() === main)) {
        merged.servers = [{ guildId: main, label: "" }, ...merged.servers];
    }
    next.discordServers = normalizeDiscordServers(merged, { fallbackGuildId: current.guildId });
    // Keep the fallback key in step, so clearing every server later falls
    // back to the server that was last in use, not to an older one.
    const first = next.discordServers.servers[0];
    if (first) next.guildId = first.guildId;
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
    // The addon list (#818) is replaced only by an edit of it, which says so with
    // `addonDownloadsCustomized`; a save that just carries a list along (an
    // unrelated one) leaves the stored list as it is - it can never wipe the page.
    if (partial.addonDownloads !== undefined && typeof partial.addonDownloadsCustomized !== "boolean") {
        next.addonDownloads = current.addonDownloads;
    }
    for (const key of MERGED_FIELDS) {
        if (partial[key]) next[key] = { ...current[key], ...partial[key] };
    }
    if (partial.discordServers) mergeDiscordServers(next, current, partial.discordServers);
    if (partial.raidhelperRetirement !== undefined) next.raidhelperRetirement = normalizeRaidhelperRetirement(partial.raidhelperRetirement);
    // #745: replaced whole — the route sends the marks of every version.
    if (partial.versionLaunch !== undefined) next.versionLaunch = normalizeVersionLaunch(partial.versionLaunch);
    for (const [key, normalize] of MERGED_CATEGORY_MAPS) {
        if (partial[key]) next[key] = normalize({ ...current[key], ...partial[key] });
    }
    // Replaced whole, like the top items: a category left out has no default.
    if (partial.categoryRaidTemplate !== undefined) next.categoryRaidTemplate = normalizeCategoryRaidTemplate(partial.categoryRaidTemplate);
    // #541: the main version replaces the stored one; the category map is sent
    // whole (a category back on the main version is left out), like the templates.
    if (partial.mainVersion !== undefined) next.mainVersion = normalizeMainVersion(partial.mainVersion);
    for (const [key, normalize] of MERGED_BLOCKS) mergeBlock(next, current, partial[key], key, normalize);
    if (partial.categoryVersion !== undefined) next.categoryVersion = normalizeCategoryVersion(partial.categoryVersion);
    // #738: the section history is replaced whole (the settings route appends a section on a switch).
    if (partial.categoryEras !== undefined) next.categoryEras = normalizeCategoryEras(partial.categoryEras);
    // #542: merged per version and per field (a block sent for one version leaves the others alone), then normalised.
    if (partial.versionSettings && typeof partial.versionSettings === "object") {
        const merged = { ...current.versionSettings };
        for (const [id, block] of Object.entries(partial.versionSettings)) merged[id] = { ...(merged[id] || {}), ...(block || {}) };
        next.versionSettings = normalizeVersionSettings(merged);
    }
    // #917: merged per server and per key like versionSettings; getConfig() drops unknown servers and keys.
    if (partial.serverSettings) {
        next.serverSettings = mergeServerSettings(current.serverSettings, partial.serverSettings);
    }
    // The top items are per server since #952 (serverSettings[guildId].topItems):
    // a global list sent by an old client is never written (the start migration
    // would take it for the list of before); the stored one of before stays
    // until the migration moved it (withPendingTopItems, at the write below).
    // Both replace the stored value as a whole.
    // Role-sync pairs are checked against the servers after this save (#896): a
    // pair whose server was just removed is dropped with it.
    if (partial.roleSync !== undefined || partial.discordServers) {
        next.roleSync = normalizeRoleSync(partial.roleSync !== undefined ? partial.roleSync : current.roleSync, roleSyncContext(next.discordServers));
    }
    if (partial.categoryReminders !== undefined) next.categoryReminders = normalizeCategoryReminders(partial.categoryReminders);
    // Merged per field, the retention per rule and the restore probe's slot per field, then normalised (#691, #694).
    if (partial.backup && typeof partial.backup === "object") {
        const cur = current.backup || {};
        const part = (key) => ({ ...(cur[key] || {}), ...((partial.backup && partial.backup[key]) || {}) });
        next.backup = normalizeBackupSettings({
            ...cur, ...partial.backup, retention: part("retention"), restoreTest: part("restoreTest"),
        });
    }
    store.write(withPendingTopItems(next));
    return getConfig();
}

/**
 * Remove one category from the config (#744: "Kategorie abschließen"): out of
 * `categoryIds` and out of every map named in `keys`. saveConfig() merges most
 * category maps, so a key can only be dropped here. Returns the config as
 * getConfig() reads it, and the keys that held an entry.
 * @param {string} categoryId
 * @param {string[]} keys  the category maps to clear (config keys)
 * @returns {{ config: object, removed: string[] }}
 */
function dropCategoryEntries(categoryId, keys = []) {
    const id = String(categoryId || "").trim();
    const current = getConfig();
    if (!id) return { config: current, removed: [] };
    const next = { ...current };
    const removed = [];
    if (Array.isArray(current.categoryIds) && current.categoryIds.map(String).includes(id)) {
        next.categoryIds = current.categoryIds.filter((c) => String(c) !== id);
        removed.push("categoryIds");
    }
    for (const key of keys) {
        const map = current[key];
        if (!map || typeof map !== "object" || Array.isArray(map) || !Object.prototype.hasOwnProperty.call(map, id)) continue;
        const rest = { ...map };
        delete rest[id];
        next[key] = rest;
        removed.push(key);
    }
    if (removed.length) store.write(withPendingTopItems(next));
    return { config: getConfig(), removed };
}

module.exports = { getConfig, saveConfig, dropCategoryEntries, resolveEventSheetLink, readStored, writeStored, useFile };
