const { ActionRowBuilder } = require("discord.js");
const Legendary = require("../../classes/legendary");
const {
    checkForPermission,
    findServerEmoji,
    botFollowup,
} = require("../../utils/helper");
const { getAuctionMessage } = require("../../utils/responses");

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

        const row = new ActionRowBuilder();
        const customEmoji = findServerEmoji(interaction, "SNIFFA");
        row.addComponents(
            new ButtonBuilder()
            .setCustomId("bid-5k")
            .setLabel("Bid +5.000g")
            .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
            .setCustomId("bid-10k")
            .setLabel("Bid +10.000g")
            .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
            .setCustomId("bid-custom")
            .setLabel("Bid eingeben")
            .setStyle(ButtonStyle.Success)
        );

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

        response = await legendary.createAuction(auctionData);
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
            const newMessage = await targetMessage.edit({ embeds: [embed] });
        } else {
            botFollowup(interaction, response.message, 0, false, row);
        }
    },
};