// Which language the bot writes in (utils/i18n/botText.js translates):
//
//   serverLang(config)   the server language of Einstellungen (config.botLanguage),
//                        German by default — every PUBLIC message uses it: the
//                        event and setup message, the talk overview, panels,
//                        announcements, the Discord event. A message in a channel
//                        is one and the same for everybody, so it cannot follow a
//                        single reader.
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

function langOf(userId, { config } = {}) {
    return userPrefs.getLang(userId) || serverLang(config);
}

/** The language of whoever clicked or typed: `langOf(interaction.user.id)`. */
function langOfInteraction(interaction, opts) {
    return langOf(interaction && interaction.user ? interaction.user.id : "", opts);
}

module.exports = { serverLang, langOf, langOfInteraction };
