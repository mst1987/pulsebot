const Raidhelper = require("../../classes/raidhelper");
const messages = require("../../config/messages");
const { botReply, formatSpecs, formatSignUps } = require("../../utils/helper");

module.exports = {
    name: "signup",
    description: "Signup",
    async execute(interaction, client) {
        const raidhelper = new Raidhelper();

        let raidId;
        let raid;
        const channelMessages = await interaction.channel.messages.fetch();
        const botMessages = channelMessages.filter(
            (msg) => msg.author.id === "579155972115660803"
        );

        for (const [key, value] of botMessages) {
            raid = await raidhelper.getEvent(key);
            if (raid) raidId = key;
            else
                await botReply(
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
        }
    },
};