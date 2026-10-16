const { SlashCommandBuilder } = require("discord.js");
const { card } = require("../../utils/discord/card");
const { adoptMessage, refreshOverviews } = require("../../services/events/raidOverview");
const store = require("../../stores/raidOverviewStore");

// The "Update Events" button of the old overview messages. Such a message is registered and
// redrawn in the new design (no buttons, refreshes itself, services/events/raidOverview.js);
// as a slash command it redraws the overviews of the channel's category.
module.exports = {
    name: "update-events",
    description: "Aktualisiert die Raid-Übersicht dieser Kategorie",
    group: "raids",
    defaultAccess: "everyone",
    data: new SlashCommandBuilder()
        .setName("update-events")
        .setDescription("Update the raid overview of the current category"),
    async execute(interaction) {
        if (!interaction.channel.parent) {
            return interaction.reply(card({
                kind: "warn", title: "Keine Kategorie", text: "Dieser Befehl muss in einem Kanal mit einer Kategorie ausgeführt werden.", ephemeral: true,
            }));
        }
        const categoryId = interaction.channel.parent.id;
        const clicked = interaction.message && interaction.message.id;
        if (clicked) {
            // a click on an old overview: it becomes a self-updating one
            await interaction.deferUpdate();
            await adoptMessage({
                guildId: interaction.guildId || (interaction.guild && interaction.guild.id) || "",
                channelId: interaction.channel.id,
                messageId: clicked,
                categoryId,
            });
            return undefined;
        }
        const own = store.listOverviews().filter((o) => o.categoryId === categoryId);
        for (const overview of own) await refreshOverviews({ onlyStale: false, messageId: overview.messageId });
        return interaction.reply(card({
            kind: own.length ? "ok" : "warn",
            title: "Raid-Übersicht",
            text: own.length ? "Die Übersicht wurde neu gezeichnet." : "Für diese Kategorie gibt es noch keine Übersicht. „/createoverview“ postet eine.",
            ephemeral: true,
        }));
    },
};
