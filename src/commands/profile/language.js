// /language - the raider's own bot language (German or English), or back to
// automatic: the bot then follows the raider's Discord client language. The
// same setting as the DE/EN switch of the web menu (userPrefsStore), so it
// follows the account everywhere. It covers what only the raider reads
// (dialogs, answers, DMs); messages in a channel are not personal and keep the
// language of the server or of the raid's category (services/discord/botLanguage.js).
const { SlashCommandBuilder } = require("discord.js");
const userPrefs = require("../../stores/userPrefsStore");
const { langOf, langOfInteraction } = require("../../services/discord/botLanguage");
const { tr } = require("../../utils/i18n/botText");
const { answerPayload } = require("../../utils/signup/signupReply");

const CHOICES = ["de", "en", "auto"];

module.exports = {
    name: "language",
    description: "Eigene Bot-Sprache wählen (Deutsch, Englisch oder automatisch nach Discord-Sprache)",
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
            .setDescription("German, English or automatic (your Discord language)")
            .setDescriptionLocalizations({ de: "Deutsch, Englisch oder automatisch (deine Discord-Sprache)" })
            .setRequired(true)
            .addChoices(
                { name: "Deutsch", value: "de" },
                { name: "English", value: "en" },
                { name: "Automatic (your Discord language)", name_localizations: { de: "Automatisch (deine Discord-Sprache)" }, value: "auto" },
            )),
    async execute(interaction) {
        const uid = interaction.user.id;
        const picked = String(interaction.options.getString("language") || "").trim();
        const auto = picked === "auto" || picked === "server";
        if (auto) userPrefs.clearLang(uid);
        else if (CHOICES.includes(picked)) userPrefs.setLang(uid, picked);
        const lang = auto ? langOfInteraction(interaction) : langOf(uid);
        const head = auto
            ? tr(lang, lang === "de" ? "Bot language: **automatic**, it now follows your Discord language (**German**)." : "Bot language: **automatic**, it now follows your Discord language (**English**).")
            : tr(lang, lang === "de" ? "Bot language: **German**." : "Bot language: **English**.");
        const note = tr(lang, "Applies to everything only you see: dialogs, answers and DMs. Messages in the channels are not personal: they are written in the language of the server or of the raid's category. The web menu follows the same setting.");
        return interaction.reply(answerPayload(`${head}\n${note}`, { lang }));
    },
};
