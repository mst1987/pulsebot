// Which language the bot writes in (utils/i18n/botText.js translates):
//
//   serverLang(config, guildId)  the language of one Discord server (#924:
//                        serverSettings[guildId].botLanguage, Einstellungen ›
//                        Discord-Server), else the global default
//                        (config.botLanguage), else German; no guildId = the
//                        global default — every PUBLIC message uses it: the
//                        event and setup message, the talk overview, panels,
//                        announcements, the Discord event. A message in a channel
//                        is one and the same for everybody, so it cannot follow a
//                        single reader.
//   eventLang(event)     what an event posts in a channel goes in its category's
//                        language (categoryLang: config.categoryLanguage, else
//                        the language of the raid's server) — PuGs in English,
//                        the guild's raids in German.
//   langOf(userId)       what only that raider reads — dialogs, answers, modals,
//                        DMs: their own choice (userPrefsStore, set with
//                        /language or the DE/EN switch of the web menu), else
//                        the Discord client language last seen (bot.js notes it
//                        on every interaction), else the language of the server
//                        the caller names (`guildId`), else the global default.
//   langOfInteraction    the same for whoever clicked or typed, but the locale
//                        of THIS interaction comes before the stored one, so
//                        even the very first click is answered right; the server
//                        language last is the one of the interaction's server.
const userPrefs = require("../../stores/userPrefsStore");
const settingsStore = require("../../stores/settingsStore");
const { normalizeLang } = require("../../utils/i18n/botText");
const { serverSetting } = require("./serverSettings");
const { guildOfEvent, storedCategoryGuilds } = require("./serverOf");

/** The global default every server without its own language speaks (#924); German when none is set. */
function defaultLang(config) {
    const cfg = config || settingsStore.getConfig();
    return normalizeLang((cfg && cfg.botLanguage) || "de");
}

/**
 * The language of one server's public messages: its own value, else the
 * global default, else German. No server given = the global default (never
 * the first server's own value).
 */
function serverLang(config, guildId) {
    const cfg = config || settingsStore.getConfig();
    const id = String(guildId || "").trim();
    if (!id) return defaultLang(cfg);
    return normalizeLang(serverSetting(id, "botLanguage", { config: cfg, fallback: defaultLang(cfg) }));
}

/**
 * The language of one category's public messages: its own (Einstellungen ›
 * Kategorien, `config.categoryLanguage` — a PuG category in English beside
 * German guild raids), else the language of its server (`guildId`, else the
 * server the category belongs to by the category snapshot, else the global default).
 */
function categoryLang(categoryId, config, guildId) {
    const cfg = config || settingsStore.getConfig();
    const key = String(categoryId || "");
    const own = String(((cfg && cfg.categoryLanguage) || {})[key] || "").trim().toLowerCase();
    if (own === "de" || own === "en") return own;
    const server = String(guildId || "").trim() || (key ? storedCategoryGuilds().get(key) : "");
    return serverLang(cfg, server);
}

/** The language of everything an event posts in a channel: its category's, else its server's (categoryLang). */
function eventLang(event, config) {
    return categoryLang(event && event.categoryId, config, event ? guildOfEvent(event) : "");
}

/** What only this raider reads; `guildId` = the server whose language is the last fallback. */
function langOf(userId, { config, guildId } = {}) {
    return userPrefs.getLang(userId) || userPrefs.getClientLang(userId) || serverLang(config, guildId);
}

/** The language of whoever clicked or typed: own choice, this interaction's Discord locale, stored client language, language of the interaction's server. */
function langOfInteraction(interaction, opts = {}) {
    const userId = interaction && interaction.user ? interaction.user.id : "";
    const guildId = opts.guildId || (interaction && interaction.guildId) || "";
    return userPrefs.getLang(userId)
        || userPrefs.localeToLang(interaction && interaction.locale)
        || langOf(userId, { ...opts, guildId });
}

module.exports = { defaultLang, serverLang, categoryLang, eventLang, langOf, langOfInteraction };
