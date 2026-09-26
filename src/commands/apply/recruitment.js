const {
    MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder,
} = require("discord.js");
const { listRecruitment, saveRecruitmentPost } = require("../../web/recruitmentStore");
const { embedAccentColor } = require("../../config/variables");

module.exports = {
    name: "recruitment",
    description: "Postet eine im Admin-Menü gepflegte Recruitment-Vorlage in einen Channel",
    group: "recruitment",
    defaultAccess: "admins",
    data: new SlashCommandBuilder()
        .setName("recruitment")
        .setDescription("Postet eine im Admin-Menü gepflegte Recruitment-Vorlage in einen Channel")
        .addStringOption((o) => o.setName("vorlage").setDescription("Name der Recruitment-Vorlage (im Admin-Menü angelegt)").setRequired(true))
        .addChannelOption((o) => o.setName("channel").setDescription("Ziel-Channel für die Recruitment-Nachricht").setRequired(true)),
    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const wanted = interaction.options.getString("vorlage");
        const targetChannel = interaction.options.getChannel("channel");

        const templates = listRecruitment();
        if (!templates.length) {
            return interaction.editReply(
                "Es sind noch keine Recruitment-Vorlagen angelegt. Erstelle sie im Gildenmenü unter /recruitment."
            );
        }

        const template = templates.find((t) => (t.name || "").toLowerCase() === wanted.toLowerCase());
        if (!template) {
            const names = templates.map((t) => `• ${t.name}`).join("\n");
            return interaction.editReply(`Keine Vorlage mit dem Namen „${wanted}" gefunden.\n\nVerfügbare Vorlagen:\n${names}`);
        }

        if (!template.title && !template.body) {
            return interaction.editReply("Diese Vorlage hat weder Titel noch Text — bitte im Admin-Menü ausfüllen.");
        }

        const embed = new EmbedBuilder().setColor(embedAccentColor);
        if (template.title) embed.setTitle(template.title);
        if (template.body) embed.setDescription(template.body);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("apply")
                .setLabel(template.buttonLabel || "Jetzt bewerben")
                .setStyle(ButtonStyle.Success)
        );

        try {
            const posted = await targetChannel.send({ embeds: [embed], components: [row] });
            // track the posted message so it can be edited from the admin menu later
            saveRecruitmentPost({
                guildId: targetChannel.guildId,
                channelId: targetChannel.id,
                messageId: posted.id,
                channelName: targetChannel.name,
                title: template.title,
                body: template.body,
                buttonLabel: template.buttonLabel,
                source: "command",
            });
            return interaction.editReply(`Recruitment-Nachricht „${template.name}" gepostet in ${targetChannel}: ${posted.url}`);
        } catch (error) {
            console.error("recruitment post failed:", error.message);
            return interaction.editReply(
                "Konnte die Nachricht nicht im Ziel-Channel posten (fehlende Berechtigungen oder kein Textkanal?)."
            );
        }
    },
};
