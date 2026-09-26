const { MessageFlags, SlashCommandBuilder } = require("discord.js");
﻿const { showAllEvents } = require("../../utils/helper");

module.exports = {
    name: "update-events",
    description: "Aktualisiert die Event-Übersicht dieser Kategorie",
    group: "raids",
    defaultAccess: "everyone",
    data: new SlashCommandBuilder()
        .setName("update-events")
        .setDescription("Update event overview for the current category"),
    async execute(interaction, client) {
        if (!interaction.channel.parent) {
            return interaction.reply({ content: "Dieser Befehl muss in einem Kanal mit einer Kategorie ausgeführt werden.", flags: MessageFlags.Ephemeral });
        }
        await interaction.update({
            embeds: [{
                title: interaction.channel.parent.name,
                description: await showAllEvents(
                    interaction,
                    interaction.channel.parent.id
                ),
            }, ],
        });
    },
};