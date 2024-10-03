const { Legendary } = require("../../utils/legendaryClass");
const { isNumber, formatNumberWithDots } = require("../../utils/formatters");
const { botReply, botFollowup } = require("../../utils/messageHelpers");

module.exports = {
    name: "bid",
    description: "Place a bid in an auction",
    async execute(interaction, client) {
        const role = interaction.member.roles.cache.find(
            (role) => role.id === legendaryID
        );
        if (!role) {
            botReply(
                interaction,
                "Fehlende Berechtigung",
                "Dir fehlt die Legendary Rolle diesen Befehl auszuführen."
            );
            return;
        } else {
            const legendary = new Legendary();
            if (!legendary.getAuction(interaction.channel.id)) {
                botReply(
                    interaction,
                    "Auktion Info",
                    "Keine Auktion aktiv für diesen Channel"
                );
                return;
            }

            const gold = interaction.options.getString("gold");
            if (!isNumber(Number(gold))) {
                botReply(interaction, "Bid Info", "Goldwert muss eine Zahl sein!");
                return;
            }
            if (gold > 5000000) {
                botReply(
                    interaction,
                    "Vertippt?",
                    `Wolltest du wirklich **${formatNumberWithDots(gold)}g** bieten?`
                );
                return;
            }

            const bidData = {
                username: interaction.user.tag,
                userid: interaction.user.id,
                gold: gold,
                timestamp: DateTime.now().setZone("Europe/Paris").toMillis(),
                legendary: interaction.channel.id,
            };

            response = await legendary.bid(bidData);

            if (response.type === "success") {
                const nickname = await getUserNickname(interaction);

                botReply(
                    interaction,
                    `**${formatNumberWithDots(Number(bidData.gold))}g**`,
                    `geboten von ${nickname}`,
                    0,
                    false
                );

                const targetMessage = await getTargetMessage(
                    client,
                    highestBidsChannelId,
                    highestBidsMessageId
                );
                if (targetMessage) {
                    await updateHighestBids(
                        interaction,
                        targetMessage,
                        legendary,
                        client
                    );
                }

                if (response.extended) {
                    const channelMessage = await getTargetMessage(
                        client,
                        response.legendary.channel,
                        response.legendary.messageid
                    );
                    if (channelMessage) {
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
                        await channelMessage.edit({ embeds: [embed] });
                    }
                    await botFollowup(
                        interaction,
                        `Die Auktion wurde verlängert und endet nun **${formatTimestampToDateString(
              Math.round(Number(response.legendary.endtime))
            )}**: <t:${Math.round(
              Number(response.legendary.endtime / 1000)
            )}:R>`,
                        0,
                        false
                    );
                }
            } else {
                botReply(interaction, "Gebot nicht akzeptiert!", response.message);
            }
        }
    },
};