const Legendary = require("../../classes/legendary");
const {
    checkForPermission,
    findServerEmoji,
    botReply,
} = require("../../utils/helper");
const { getAuctionMessage } = require("../../utils/responses");

module.exports = {
    name: "updateauction",
    description: "Update an existing auction",
    async execute(interaction, client) {
        if (!checkForPermission(interaction)) return;

        const legendary = new Legendary();
        let auctionData = {};
        auctionData.channel = interaction.channel.id;
        console.log(interaction.options);
        if (interaction.options.getString("name"))
            auctionData.name = interaction.options.getString("name");
        if (interaction.options.getString("raid"))
            auctionData.raid = interaction.options.getString("raid");
        if (interaction.options.getString("endtime"))
            auctionData.endtime = toTimestamp(
                interaction.options.getString("endtime")
            );
        if (interaction.options.getString("mingold"))
            auctionData.mingold = interaction.options.getString("mingold");
        if (interaction.options.getString("increment"))
            auctionData.increment = interaction.options.getString("increment");

        response = await legendary.updateAuction(auctionData);
        if (response.type === "success") {
            const channel = await client.channels.fetch(auctionData.channel);
            if (channel) {
                const targetMessage = await channel.messages.fetch(
                    response.legendary.messageid
                );
                if (targetMessage) {
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
                    botReply(
                        interaction,
                        `Auktion updated`,
                        `Auktion wurde erfolgreich updated`
                    );
                }
            }
        } else {
            botReply(interaction, "Fehler", "Ein Fehler ist vorgefallen...");
        }
    },
};