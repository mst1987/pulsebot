const { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } = require("discord.js");
const { card } = require("../../utils/discord/card");
const { applyButtonId } = require("../../utils/recruitment/applyVersion");
const { mainVersionFor } = require("../../services/events/mainVersion");

// Accepts a full message link or a bare message id (then read from the given fallback channel).
function parseMessageRef(input, fallbackChannelId) {
    const link = String(input).trim().match(/channels\/\d+\/(\d+)\/(\d+)/);
    if (link) return { channelId: link[1], messageId: link[2] };
    return { channelId: fallbackChannelId, messageId: String(input).replace(/\D/g, "") };
}

module.exports = {
    name: "createapplication",
    description: "Postet eine Nachricht mit Bewerben-Button in einen Channel",
    group: "recruitment",
    defaultAccess: "admins",
    data: new SlashCommandBuilder()
        .setName("createapplication")
        .setDescription("Postet eine Nachricht mit Bewerben-Button in einen Channel")
        .addStringOption((o) => o.setName("message_id").setDescription("Message-ID (aus diesem Channel) oder voller Nachrichten-Link").setRequired(true))
        .addChannelOption((o) => o.setName("channel").setDescription("Ziel-Channel für die Bewerbungs-Nachricht").setRequired(true)),
    async execute(interaction, client) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const messageInput = interaction.options.getString("message_id");
        const targetChannel = interaction.options.getChannel("channel");
        const ref = parseMessageRef(messageInput, interaction.channelId);

        let sourceMessage;
        try {
            const sourceChannel = await client.channels.fetch(ref.channelId);
            sourceMessage = await sourceChannel.messages.fetch(ref.messageId);
        } catch {
            return interaction.editReply(card({
                kind: "error",
                title: "Quell-Nachricht nicht gefunden",
                text: "Gib eine gültige Message-ID (aus diesem Channel) oder einen Nachrichten-Link an.",
            }));
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                // Applications through this button are for the main version (#553).
                .setCustomId(applyButtonId(mainVersionFor()))
                .setLabel("Jetzt bewerben")
                .setStyle(ButtonStyle.Success)
        );

        try {
            const posted = await targetChannel.send({
                content: sourceMessage.content || undefined,
                embeds: sourceMessage.embeds.map((e) => e.toJSON()),
                components: [row],
            });
            return interaction.editReply(card({
                kind: "ok",
                title: "Bewerbungs-Nachricht gepostet",
                text: `Gepostet in ${targetChannel}.`,
                buttons: posted.url ? [new ButtonBuilder().setLabel("Zur Nachricht").setStyle(ButtonStyle.Link).setURL(posted.url)] : [],
            }));
        } catch (error) {
            console.error("createapplication post failed:", error.message);
            return interaction.editReply(card({
                kind: "error",
                title: "Nachricht nicht gepostet",
                text: "Konnte die Nachricht nicht im Ziel-Channel posten (fehlende Berechtigungen oder kein Textkanal?).",
            }));
        }
    },
};
