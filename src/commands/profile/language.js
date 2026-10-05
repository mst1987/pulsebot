// /language — the raider's own bot language (German or English), or back to the
// server language. The same setting as the DE/EN switch of the web menu
// (userPrefsStore), so it follows the account everywhere. It covers what only
// the raider reads (dialogs, answers, DMs); messages in a channel keep the
// server language (services/discord/botLanguage.js).
const { SlashCommandBuilder } = require("discord.js");
const userPrefs = require("../../stores/userPrefsStore");
const { serverLang, langOf } = require("../../services/discord/botLanguage");
const { tr } = require("../../utils/i18n/botText");
const { answerPayload } = require("../../utils/signup/signupReply");

const CHOICES = ["de", "en", "server"];

module.exports = {
    name: "language",
    description: "Eigene Bot-Sprache wählen (Deutsch, Englisch oder die des Servers)",
    group: "signup",
    defaultAccess: "everyone",
    data: new SlashCommandBuilder()
        .setName("language")
        .setNameLocalizations({ de: "sprache" })
        .setDescription("Choose the language the bot uses with you")
        .setDescriptionLocalizations({ de: "Wähle, in welcher Sprache der Bot mit dir schreibt" })
        .addStringOption((o) => o
            .setName("language")
            .setNameLocalizations({ de: "sprache" })
            .setDescription("German, English or the server's language")
            .setDescriptionLocalizations({ de: "Deutsch, Englisch oder die Sprache des Servers" })
            .setRequired(true)
            .addChoices(
                { name: "Deutsch", value: "de" },
                { name: "English", value: "en" },
                { name: "Server language", name_localizations: { de: "Sprache des Servers" }, value: "server" },
            )),
    async execute(interaction) {
        const uid = interaction.user.id;
        const picked = String(interaction.options.getString("language") || "").trim();
        if (picked === "server") userPrefs.clearLang(uid);
        else if (CHOICES.includes(picked)) userPrefs.setLang(uid, picked);
        const lang = langOf(uid);
        const head = picked === "server"
            ? tr(lang, serverLang() === "de" ? "You now get the server language (**German**)." : "You now get the server language (**English**).")
            : tr(lang, lang === "de" ? "Bot language: **German**." : "Bot language: **English**.");
        const note = tr(lang, "Applies to everything only you see: dialogs, answers and DMs. Messages in the channels stay in the server language. The web menu follows the same setting.");
        return interaction.reply(answerPayload(`${head}\n${note}`, { lang }));
    },
};
