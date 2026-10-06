// Which language the bot writes in (utils/i18n/botText.js translates):
//
//   serverLang(config)   the server language of Einstellungen (config.botLanguage),
//                        German by default — every PUBLIC message uses it: the
//                        event and setup message, the talk overview, panels,
//                        announcements, the Discord event. A message in a channel
//                        is one and the same for everybody, so it cannot follow a
//                        single reader.
//   eventLang(event)     what an event posts in a channel goes in its category's
//                        language (categoryLang: config.categoryLanguage, else
//                        serverLang) — PuGs in English, the guild's raids in German.
//   langOf(userId)       what only that raider reads — dialogs, answers, modals,
//                        DMs: their own choice (userPrefsStore, set with
//                        /language or the DE/EN switch of the web menu), else
//                        the server language.
const userPrefs = require("../../stores/userPrefsStore");
const settingsStore = require("../../stores/settingsStore");
const { normalizeLang } = require("../../utils/i18n/botText");

function serverLang(config) {
    return normalizeLang((config || settingsStore.getConfig()).botLanguage);
}

/**
 * The language of one category's public messages: its own (Einstellungen ›
 * Kategorien, `config.categoryLanguage` — a PuG category in English beside
 * German guild raids), else the server language.
 */
function categoryLang(categoryId, config) {
    const cfg = config || settingsStore.getConfig();
    const own = String(((cfg && cfg.categoryLanguage) || {})[String(categoryId || "")] || "").trim().toLowerCase();
    return own === "de" || own === "en" ? own : serverLang(cfg);
}

/** The language of everything an event posts in a channel: its category's (categoryLang). */
function eventLang(event, config) {
    return categoryLang(event && event.categoryId, config);
}

function langOf(userId, { config } = {}) {
    return userPrefs.getLang(userId) || serverLang(config);
}

/** The language of whoever clicked or typed: `langOf(interaction.user.id)`. */
function langOfInteraction(interaction, opts) {
    return langOf(interaction && interaction.user ? interaction.user.id : "", opts);
}

module.exports = { serverLang, categoryLang, eventLang, langOf, langOfInteraction };
