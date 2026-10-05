const { SlashCommandBuilder } = require("discord.js");
const { card } = require("../../utils/discord/card");
const { showAllEvents } = require("../../utils/raidhelper/channelEvents");

module.exports = {
    name: "update-events",
    description: "Aktualisiert die Event-Übersicht dieser Kategorie",
    group: "raids",
    defaultAccess: "everyone",
    data: new SlashCommandBuilder()
        .setName("update-events")
        .setDescription("Update event overview for the current category"),
    async execute(interaction) {
        if (!interaction.channel.parent) {
            return interaction.reply(card({
                kind: "warn", title: "Keine Kategorie", text: "Dieser Befehl muss in einem Kanal mit einer Kategorie ausgeführt werden.", ephemeral: true,
            }));
        }
        await interaction.update(card({
            title: interaction.channel.parent.name,
            text: await showAllEvents(interaction, interaction.channel.parent.id),
        }));
    },
};