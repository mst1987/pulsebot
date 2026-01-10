const Legendary = require("../../classes/legendary");
const {
    checkForPermission,
    findServerEmoji,
    botFollowup,
    botReply,
} = require("../../utils/helper");
const { getAuctionMessage } = require("../../utils/responses");
const { toTimestamp } = require("../../utils/date");
const { getBiddingButtonRow } = require("../../utils/auction");

module.exports = {
    name: "createauction",
    description: "Create a new auction",
    async execute(interaction, client) {
        if (!checkForPermission(interaction)) return;

        const legendary = new Legendary();
        const auction = await legendary.getAuction(interaction.channel.id);

        if (auction) {
            botReply(
                interaction,
                "Auktion Info",
                "Es gibt schon eine Auktion für den Channel"
            );
            return;
        }

        const row = getBiddingButtonRow(interaction);

        await interaction.reply({
            embeds: [{
                title: "title",
                description: "message",
            }, ],
            components: [row],
            ephemeral: false,
        });
        const replyMessage = await interaction.fetchReply();

        const auctionData = {
            name: interaction.options.getString("name"),
            raid: interaction.options.getString("raid"),
            channel: interaction.channel.id,
            messageid: replyMessage.id,
            endtime: toTimestamp(interaction.options.getString("endtime")),
            mingold: interaction.options.getString("mingold"),
            increment: interaction.options.getString("increment"),
        };

        try {
            const response = await legendary.createAuction(auctionData);

            if (response.type === "success") {
                const targetMessage = await interaction.channel.messages.fetch(
                    replyMessage.id
                );
                const embed = {
                    title: `${findServerEmoji(
                        interaction,
                        "poggies"
                    )} Auktion gestartet ${findServerEmoji(interaction, "poggies")}`,
                    description: `Auktion wurde gestartet\n\n${getAuctionMessage(
                        interaction,
                        response.legendary
                    )}`,
                };
                await targetMessage.edit({ embeds: [embed] });
            } else {
                botFollowup(interaction, response.message, 0, false, [row]);
            }
        } catch (error) {
            console.error("Error creating auction:", error.message);
            botFollowup(interaction, "Fehler beim Erstellen der Auktion", 0, false, [
                row,
            ]);
        }
    },
};