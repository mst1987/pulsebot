const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
} = require("discord.js");
const {
    botReply,
    formatNumberWithDots,
    getUserNickname,
    isNumber,
} = require("./helper");
const Legendary = require("../classes/legendary");
const { DateTime } = require("luxon");
const { getTargetMessage } = require("./legendary");
const { getAuctionMessage } = require("./responses");
const { formatTimestampToDateString } = require("./date");

module.exports = {
    showBidModal,
    showConfirmationModal,
    bidForLegendary,
};
async function showBidModal(interaction) {
    const modal = new ModalBuilder()
        .setCustomId("bidModal")
        .setTitle("Geben Sie Ihr Gebot ein");

    const bidInput = new TextInputBuilder()
        .setCustomId("bidAmount")
        .setLabel("Gebot (in Gold)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("z.B. 15000")
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(10);

    const firstActionRow = new ActionRowBuilder().addComponents(bidInput);
    modal.addComponents(firstActionRow);

    await interaction.showModal(modal);
}

async function showConfirmationModal(interaction, bid) {
    const modal = new ModalBuilder()
        .setCustomId("confirmBidModal")
        .setTitle("Bestätigen Sie Ihr Gebot");

    const confirmInput = new TextInputBuilder()
        .setCustomId("confirmBid")
        .setLabel(`Bist du sicher, dass du ${bid} Gold bieten möchtest?`)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Ja oder Nein")
        .setRequired(true);

    const firstActionRow = new ActionRowBuilder().addComponents(confirmInput);
    modal.addComponents(firstActionRow);

    await interaction.showModal(modal);
}

async function bidForLegendary(interaction, bid = null) {
    const role = interaction.member.roles.cache.find(
        (role) => role.id === "1144865420386517053"
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

        let gold = 0;
        if (bid) gold = bid;
        else gold = interaction.options.getString("gold");

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
                await updateHighestBids(interaction, targetMessage, legendary, client);
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
          )}**: <t:${Math.round(Number(response.legendary.endtime / 1000))}:R>`,
                    0,
                    false
                );
            }
        } else {
            botReply(interaction, "Gebot nicht akzeptiert!", response.message);
        }
    }
}