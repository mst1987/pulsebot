const { SlashCommandBuilder } = require("discord.js");
const { postOverview } = require("../../services/events/raidOverview");
const { botReply } = require("../../utils/discord/reply");

// Posts the raid overview of the channel's category (services/events/raidOverview.js):
// one card without buttons that redraws itself when a raid or a signup changes.
// The channel already holding an overview of this category gets that one edited, not a second.
module.exports = {
    name: "createoverview",
    description: "Postet die Raid-Übersicht dieser Kategorie (aktualisiert sich selbst)",
    group: "raids",
    defaultAccess: "admins",
    data: new SlashCommandBuilder()
        .setName("createoverview")
        .setDescription("Creates a self-updating raid overview for the current category"),
    async execute(interaction) {
        try {
            if (!interaction.channel.parent) {
                return botReply(interaction, "Fehler", "Dieser Befehl muss in einem Kanal mit einer Kategorie ausgeführt werden.");
            }
            await interaction.deferReply({ ephemeral: true });
            const result = await postOverview({
                guildId: interaction.guildId || (interaction.guild && interaction.guild.id) || "",
                channelId: interaction.channel.id,
                categoryId: interaction.channel.parent.id,
            });
            if (result.error) {
                return interaction.editReply({ content: `Die Übersicht konnte nicht gepostet werden: ${result.error}` });
            }
            const where = result.url ? ` ${result.url}` : "";
            return interaction.editReply({
                content: `${result.edited ? "Die Übersicht dieser Kategorie in diesem Kanal wurde neu gezeichnet." : "Die Übersicht ist gepostet."} Sie aktualisiert sich von selbst.${where}`,
            });
        } catch (error) {
            console.log(error);
        }
    },
};
