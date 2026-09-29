const { MessageFlags, ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");
const { CLASSES } = require("../../config/applyClasses");
const { pendingApplications } = require("../../utils/recruitment/applicationState");
const { versionOfApplyButton } = require("../../utils/recruitment/applyVersion");

module.exports = {
    name: "apply",
    description: "Bewerben-Button unter der Recruitment-Nachricht",
    group: "recruitment",
    defaultAccess: "everyone",
    kind: "button",
    async execute(interaction) {
        // The game version of this application (#553): the one its button names
        // ("apply:<versionId>"), TBC for a button from before. A fresh start of
        // the flow drops whatever an earlier, unfinished one left behind.
        pendingApplications.set(interaction.user.id, {
            versionId: versionOfApplyButton(interaction.customId),
            timestamp: Date.now(),
        });

        const guildEmojis = interaction.guild?.emojis.cache;

        const options = CLASSES.map(({ label, value, icon }) => {
            const option = { label, value };
            if (guildEmojis) {
                const emoji = guildEmojis.find((e) => e.name.toLowerCase() === icon.toLowerCase());
                if (emoji) option.emoji = { id: emoji.id, name: emoji.name };
            }
            return option;
        });

        const select = new StringSelectMenuBuilder()
            .setCustomId("apply-class")
            .setPlaceholder("Wähle deine Klasse")
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(options);

        await interaction.reply({
            content: "**Schritt 1:** Wähle deine Klasse:",
            components: [new ActionRowBuilder().addComponents(select)],
            flags: MessageFlags.Ephemeral,
        });
    },
};
