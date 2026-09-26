const { SlashCommandBuilder } = require("discord.js");
const { createRaidhelperClient } = require("../../utils/raidhelperClient");
const messages = require("../../config/messages");
const { publicBaseUrl } = require("../../utils/publicUrl");
const { botReply, formatSpecs, formatSignUps } = require("../../utils/helper");
const { ownEventInChannel } = require("../../web/eventSources");
const { RAIDHELPER_BOT_ID } = require("../../config/constants");

// Legacy: signs up at the Raid-Helper event of this channel with Raid-Helper
// spec names. An own EventHelper event (#291) is not signed up for here — the
// signup has rules this command cannot ask (character, deadline, raider role),
// so it points at the two ways that know them: the "Anmelden …" select under
// the event message and the web page.
module.exports = {
    name: "signup",
    description: "Meldet dich zum Raid in diesem Kanal an",
    group: "signup",
    defaultAccess: "everyone",
    data: new SlashCommandBuilder()
        .setName("signup")
        .setDescription("Sign up to the raid in this channel")
        .addStringOption((o) => o.setName("specs").setDescription("Specs to sign up with, comma-separated (e.g. Combat,Fire,RestoDruid)").setRequired(true)),
    async execute(interaction) {
        const own = ownEventInChannel(interaction.channel && interaction.channel.id);
        if (own) {
            const base = publicBaseUrl();
            const link = base ? `\n[Im Web anmelden](${base}/signups?event=${encodeURIComponent(own.id)})` : "";
            return botReply(
                interaction,
                "Anmeldung über den EventHelper",
                `**${own.title}** läuft über den EventHelper. Melde dich mit „Anmelden …“ unter der Event-Nachricht in diesem Kanal an – dort wählst du Charakter und Spec.${link}`
            );
        }

        const raidhelper = createRaidhelperClient();

        let raidId;
        let raid;
        const channelMessages = await interaction.channel.messages.fetch();
        const botMessages = channelMessages.filter(
            (msg) => msg.author.id === RAIDHELPER_BOT_ID
        );

        for (const [key] of botMessages) {
            const event = await raidhelper.getEvent(key);
            if (event && event.id) {
                raid = event;
                raidId = key;
                break;
            }
        }

        // No Raidhelper event in this channel: tell the user instead of throwing.
        if (!raid) {
            return botReply(
                interaction,
                messages.signup.errorTitle,
                messages.signup.errorMessage
            );
        }

        try {
            const signedUpSpecs = formatSpecs(
                interaction.options.getString("specs"),
                raid.templateId
            );
            const formattedSignUps = formatSignUps(interaction, signedUpSpecs);
            await raidhelper.signUpToRaid(raidId, signedUpSpecs, interaction.user.id);

            await botReply(
                interaction,
                messages.signup.successTitle,
                messages.signup.successMessage.replace(
                    "___replace___",
                    formattedSignUps
                )
            );
        } catch (error) {
            console.log(error);
            await botReply(interaction, messages.signup.errorTitle, `Signup at Raid-Helper failed: ${error.message}`);
        }
    },
};
