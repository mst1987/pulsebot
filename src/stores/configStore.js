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
    normalizeConfig, normalizeDiscordServers, normalizeRaidhelperRetirement, normalizeCategorySignupSource,
    normalizeCategorySetupDms, normalizeCategoryLanguage, normalizeCategoryAttendance, normalizeCategoryFlags, normalizeCategoryVoiceChannel, normalizeCategoryAnnounce,
    normalizeCategorySignupNotes, normalizeCategoryRaidTemplate, normalizeCategorySheets, normalizeCategoryPlanning, normalizeTopItems,
    normalizeRoleSync, normalizeCategoryReminders, normalizeMainVersion, normalizeCategoryVersion, normalizeVersionSettings, normalizeBotLanguage,
} = require("./configSchema");
const { planningOf } = require("../services/events/planning");

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
    ["categorySheets", normalizeCategorySheets],
    ["categoryPlanning", normalizeCategoryPlanning],
];

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
        // Keep the fallback key in step, so clearing every event server later
        // falls back to the server that was last in use, not to an older one.
        const first = next.discordServers.eventGuilds[0];
        if (first) next.guildId = first.guildId;
    }
    if (partial.warcraftlogsV2) next.warcraftlogsV2 = { ...current.warcraftlogsV2, ...partial.warcraftlogsV2 };
    if (partial.categoryLootTool) next.categoryLootTool = { ...current.categoryLootTool, ...partial.categoryLootTool };
    if (partial.raidhelperRetirement !== undefined) next.raidhelperRetirement = normalizeRaidhelperRetirement(partial.raidhelperRetirement);
    for (const [key, normalize] of MERGED_CATEGORY_MAPS) {
        if (partial[key]) next[key] = normalize({ ...current[key], ...partial[key] });
    }
    // Replaced whole, like the top items: a category left out has no default.
    if (partial.categoryRaidTemplate !== undefined) next.categoryRaidTemplate = normalizeCategoryRaidTemplate(partial.categoryRaidTemplate);
    // #541: the main version replaces the stored one; the category map is sent
    // whole (a category back on the main version is left out), like the templates.
    if (partial.mainVersion !== undefined) next.mainVersion = normalizeMainVersion(partial.mainVersion);
    if (partial.botLanguage !== undefined) next.botLanguage = normalizeBotLanguage(partial.botLanguage);
    if (partial.categoryVersion !== undefined) next.categoryVersion = normalizeCategoryVersion(partial.categoryVersion);
    // #542: merged per version and per field (a block sent for one version leaves the others alone), then normalised.
    if (partial.versionSettings && typeof partial.versionSettings === "object") {
        const merged = { ...current.versionSettings };
        for (const [id, block] of Object.entries(partial.versionSettings)) merged[id] = { ...(merged[id] || {}), ...(block || {}) };
        next.versionSettings = normalizeVersionSettings(merged);
    }
    // A list, not a map: what is sent replaces the stored one (that is how an
    // item gets removed again), it is only cleaned up on the way in.
    if (partial.topItems !== undefined) next.topItems = normalizeTopItems(partial.topItems);
    // Both replace the stored value as a whole, like topItems.
    if (partial.roleSync !== undefined) next.roleSync = normalizeRoleSync(partial.roleSync);
    if (partial.categoryReminders !== undefined) next.categoryReminders = normalizeCategoryReminders(partial.categoryReminders);
    store.write(next);
    return getConfig();
}

module.exports = { getConfig, saveConfig, resolveEventSheetLink, readStored, writeStored, useFile };
