const { SlashCommandBuilder } = require("discord.js");
const { card } = require("../../utils/discord/card");
const { adoptMessage, refreshOverviews } = require("../../services/events/overview/raidOverview");
const store = require("../../stores/raidOverviewStore");

// The "Update Events" button of the old overview messages. Such a message is registered and
// redrawn in the new design (no buttons, refreshes itself, services/events/overview/raidOverview.js);
// as a slash command it redraws the overviews of the channel's category plus the server-wide
// overview of the channel, if one lives there.
module.exports = {
    name: "update-events",
    description: "Aktualisiert die Raid-Übersicht dieser Kategorie",
    group: "raids",
    defaultAccess: "everyone",
    data: new SlashCommandBuilder()
        .setName("update-events")
        .setDescription("Update the raid overview of the current category"),
    async execute(interaction) {
        const parent = interaction.channel.parent;
        const clicked = interaction.message && interaction.message.id;
        // a server-wide overview (/createoverview scope:server) may live in a channel without a category
        const serverOverview = clicked ? null : store.findServerInChannel(interaction.channel.id);
        if (!parent && !serverOverview) {
            return interaction.reply(card({
                kind: "warn", title: "Keine Kategorie", text: "Dieser Befehl muss in einem Kanal mit einer Kategorie ausgeführt werden.", ephemeral: true,
            }));
        }
        if (clicked) {
            const categoryId = parent.id;
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
        // acknowledge first: redrawing edits Discord messages and can take longer than 3 seconds
        await interaction.deferReply({ ephemeral: true });
        const own = parent
            ? store.listOverviews().filter((o) => !store.isServerOverview(o) && o.categoryId === parent.id)
            : [];
        const redraw = serverOverview ? [...own, serverOverview] : own;
        for (const overview of redraw) await refreshOverviews({ onlyStale: false, messageId: overview.messageId });
        let text = "Für diese Kategorie gibt es noch keine Übersicht. „/createoverview“ postet eine.";
        if (redraw.length === 1) text = "Die Übersicht wurde neu gezeichnet.";
        if (redraw.length > 1) text = "Die Übersichten wurden neu gezeichnet.";
        return interaction.editReply(card({ kind: redraw.length ? "ok" : "warn", title: "Raid-Übersicht", text }));
    },
};
