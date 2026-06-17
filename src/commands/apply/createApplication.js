const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { checkForPermission } = require("../../utils/helper");

// Accepts a full message link or a bare message id (then read from the given fallback channel).
function parseMessageRef(input, fallbackChannelId) {
    const link = String(input).trim().match(/channels\/\d+\/(\d+)\/(\d+)/);
    if (link) return { channelId: link[1], messageId: link[2] };
    return { channelId: fallbackChannelId, messageId: String(input).replace(/\D/g, "") };
}

module.exports = {
    name: "createapplication",
    description: "Postet eine Nachricht mit Bewerben-Button in einen Channel",
    async execute(interaction, client) {
        if (!checkForPermission(interaction)) return;
        await interaction.deferReply({ ephemeral: true });

        const messageInput = interaction.options.getString("message_id");
        const targetChannel = interaction.options.getChannel("channel");
        const ref = parseMessageRef(messageInput, interaction.channelId);

        let sourceMessage;
        try {
            const sourceChannel = await client.channels.fetch(ref.channelId);
            sourceMessage = await sourceChannel.messages.fetch(ref.messageId);
        } catch {
            return interaction.editReply(
                "Quell-Nachricht nicht gefunden. Gib eine gültige Message-ID (aus diesem Channel) oder einen Nachrichten-Link an."
            );
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("apply")
                .setLabel("Jetzt bewerben")
                .setStyle(ButtonStyle.Success)
        );

        try {
            const posted = await targetChannel.send({
                content: sourceMessage.content || undefined,
                embeds: sourceMessage.embeds.map((e) => e.toJSON()),
                components: [row],
            });
            return interaction.editReply(`Bewerbungs-Nachricht gepostet in ${targetChannel}: ${posted.url}`);
        } catch (error) {
            console.error("createapplication post failed:", error.message);
            return interaction.editReply(
                "Konnte die Nachricht nicht im Ziel-Channel posten (fehlende Berechtigungen oder kein Textkanal?)."
            );
        }
    },
};
