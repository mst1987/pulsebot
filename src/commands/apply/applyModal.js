const { ChannelType, ThreadAutoArchiveDuration } = require("discord.js");
const { pendingApplications } = require("../../utils/applicationState");
const { applicationChannelId, officerRoleId } = require("../../config/variables");

const CLASS_DISPLAY = {
    warrior: "Warrior",
    paladin: "Paladin",
    deathknight: "Death Knight",
    hunter: "Hunter",
    rogue: "Rogue",
    priest: "Priest",
    shaman: "Shaman",
    mage: "Mage",
    warlock: "Warlock",
    druid: "Druid",
};

const CLASS_ICONS = {
    warrior: "warrior",
    paladin: "paladin",
    deathknight: "deathknight",
    hunter: "hunter",
    rogue: "rogue",
    priest: "priest",
    shaman: "shaman",
    mage: "mage",
    warlock: "warlock",
    druid: "druid",
};

function getEmojiString(guildEmojis, iconName) {
    if (!guildEmojis || !iconName) return "";
    const emoji = guildEmojis.find((e) => e.name.toLowerCase() === iconName.toLowerCase());
    return emoji ? `<:${emoji.name}:${emoji.id}> ` : "";
}

module.exports = {
    name: "apply-modal",
    description: "Bewerbungs-Modal Submit",
    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true });

        const characterName = interaction.fields.getTextInputValue("characterName");
        const armoryLink = interaction.fields.getTextInputValue("armoryLink", false) || "";
        const logsLink = interaction.fields.getTextInputValue("logsLink", false) || "";
        const additionalInfo = interaction.fields.getTextInputValue("additionalInfo", false) || "";

        const pending = pendingApplications.get(interaction.user.id);
        const guildEmojis = interaction.guild?.emojis.cache;

        const classes = pending
            ? pending.classes
                .map((c) => `${getEmojiString(guildEmojis, CLASS_ICONS[c])}${CLASS_DISPLAY[c] || c}`)
                .join("\n")
            : "Unbekannt";
        pendingApplications.delete(interaction.user.id);

        try {
            const channel = await client.channels.fetch(applicationChannelId);
            const thread = await channel.threads.create({
                name: `Bewerbung - ${characterName}`,
                autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
                type: ChannelType.PublicThread,
            });

            const fields = [
                { name: "Charakter", value: characterName, inline: true },
                { name: "Klasse(n)", value: classes, inline: true },
            ];

            if (armoryLink) fields.push({ name: "Armory", value: armoryLink, inline: false });
            if (logsLink) fields.push({ name: "WarcraftLogs", value: logsLink, inline: false });
            if (additionalInfo) fields.push({ name: "Weitere Infos", value: additionalInfo, inline: false });

            const embed = {
                title: `Neue Bewerbung von ${interaction.member?.displayName || interaction.user.username}`,
                color: 0x9b59b6,
                fields,
                footer: {
                    text: `Discord: ${interaction.user.username} | ${new Date().toLocaleDateString("de-DE")}`,
                },
            };

            await thread.send({
                content: `<@&${officerRoleId}> Neue Bewerbung eingegangen!`,
                embeds: [embed],
            });

            await interaction.editReply({
                content: "Deine Bewerbung wurde eingereicht! Wir melden uns bei dir.",
            });
        } catch (error) {
            console.error("Error creating application thread:", error);
            await interaction.editReply({
                content: "Fehler beim Einreichen der Bewerbung. Bitte versuche es erneut oder kontaktiere einen Officer.",
            });
        }
    },
};
