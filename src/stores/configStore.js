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
const { normalizeCategoryLootSystem } = require("../web/lootSystem");
const { normalizeCategoryMessageLook } = require("../services/events/embedLook");
const {
    normalizeConfig, normalizeDiscordServers, normalizeRaidhelperRetirement, normalizeCategorySignupSource,
    normalizeCategorySetupDms, normalizeCategoryFlags, normalizeCategoryVoiceChannel, normalizeCategoryAnnounce,
    normalizeCategorySignupNotes, normalizeCategoryRaidTemplate, normalizeCategorySheets, normalizeTopItems,
    normalizeRoleSync, normalizeCategoryReminders,
} = require("./configSchema");

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
    // Merged per category, then normalised: a category back at the defaults drops out.
    if (partial.categoryMessageLook) {
        next.categoryMessageLook = normalizeCategoryMessageLook({ ...current.categoryMessageLook, ...partial.categoryMessageLook });
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
    store.write(next);
    return getConfig();
}

module.exports = { getConfig, saveConfig, resolveEventSheetLink, readStored, writeStored, useFile };
