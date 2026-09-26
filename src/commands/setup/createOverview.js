const { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } = require("discord.js");
const {
    showAllEvents,
    botReply,
} = require("../../utils/helper");

module.exports = {
    name: "createoverview",
    description: "Postet die Event-Übersicht mit Buttons für diese Kategorie",
    group: "raids",
    defaultAccess: "admins",
    data: new SlashCommandBuilder()
        .setName("createoverview")
        .setDescription("Creates an event overview for the current category"),
    async execute(interaction) {
        try {
            if (!interaction.channel.parent) {
                return botReply(interaction, "Fehler", "Dieser Befehl muss in einem Kanal mit einer Kategorie ausgeführt werden.");
            }
            const categoryId = interaction.channel.parent.id;
            const row = new ActionRowBuilder();
            //const customEmoji = findServerEmoji(interaction, "SNIFFA");
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId("update-events")
                    .setLabel("Update Events")
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId("show-signups")
                    .setLabel("Show my Signups")
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId("show-mysetups")
                    .setLabel("Show my Setups")
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId("show-allsetups")
                    .setLabel("Show All Setups")
                    .setStyle(ButtonStyle.Danger)
            );

            const formattedRaids = await showAllEvents(interaction, categoryId);
            botReply(
                interaction,
                interaction.channel.parent.name,
                formattedRaids,
                0,
                false,
                [row]
            );
        } catch (error) {
            console.log(error);
        }
    },
};
