const { SlashCommandBuilder } = require("discord.js");
const { postOverview } = require("../../services/events/raidOverview");
const { botReply } = require("../../utils/discord/reply");

// Posts the raid overview of the channel's category (services/events/raidOverview.js):
// one card without buttons that redraws itself when a raid or a signup changes.
// The channel already holding an overview of this category gets that one edited, not a second.
// With `scope: server` it lists the raids of every raid category of the server instead
// (a public channel like "raid-overview", which may sit in any category or none).
const SCOPE_SERVER = "server";

module.exports = {
    name: "createoverview",
    description: "Postet die Raid-Übersicht dieser Kategorie oder aller Raid-Kategorien des Servers (aktualisiert sich selbst)",
    group: "raids",
    defaultAccess: "admins",
    data: new SlashCommandBuilder()
        .setName("createoverview")
        .setDescription("Creates a self-updating raid overview for the current category")
        .addStringOption((o) => o
            .setName("scope")
            .setDescription("Which raids: this category (default) or all raid categories of the server")
            .setDescriptionLocalizations({ de: "Welche Raids: diese Kategorie (Standard) oder alle Raid-Kategorien des Servers" })
            .setRequired(false)
            .addChoices(
                { name: "Diese Kategorie", value: "category" },
                { name: "Alle Raid-Kategorien des Servers", value: SCOPE_SERVER },
            )),
    async execute(interaction) {
        try {
            const server = String((interaction.options && interaction.options.getString("scope")) || "").trim() === SCOPE_SERVER;
            if (!server && !interaction.channel.parent) {
                return botReply(interaction, "Fehler", "Dieser Befehl muss in einem Kanal mit einer Kategorie ausgeführt werden.");
            }
            await interaction.deferReply({ ephemeral: true });
            const guildId = interaction.guildId || (interaction.guild && interaction.guild.id) || "";
            const result = await postOverview(server
                ? { guildId, channelId: interaction.channel.id, scope: SCOPE_SERVER }
                : { guildId, channelId: interaction.channel.id, categoryId: interaction.channel.parent.id });
            if (result.error) {
                return interaction.editReply({ content: `Die Übersicht konnte nicht gepostet werden: ${result.error}` });
            }
            const where = result.url ? ` ${result.url}` : "";
            const redrawn = server
                ? "Die Übersicht aller Raid-Kategorien in diesem Kanal wurde neu gezeichnet."
                : "Die Übersicht dieser Kategorie in diesem Kanal wurde neu gezeichnet.";
            const posted = server ? "Die Übersicht aller Raid-Kategorien des Servers ist gepostet." : "Die Übersicht ist gepostet.";
            return interaction.editReply({
                content: `${result.edited ? redrawn : posted} Sie aktualisiert sich von selbst.${where}`,
            });
        } catch (error) {
            console.log(error);
        }
    },
};
