const messages = require("../../config/messages");
const GDKP = require("../../classes/gdkp");
const {
    botReply,
    getCharacterIcon,
    botFollowup,
} = require("../../utils/helper");

module.exports = {
    name: "totalspent",
    description: "Show total spent items",
    async execute(interaction, client) {
        const gdkp = new GDKP();
        let totalItems = await gdkp.getTotalItems(interaction.user.id);
        if (!totalItems) {
            await botReply(
                interaction,
                messages.totalspent.errorTitle,
                messages.totalspent.errorMessage
            );
        } else {
            totalItems = totalItems.sort((a, b) => a.player.localeCompare(b.player));

            let i = 0,
                j = -1;
            let formattedItems = [];
            totalItems.forEach((current) => {
                if (i % 15 === 0 || i === 0) {
                    formattedItems[++j] = [];
                }
                formattedItems[j].push(
                    `${getCharacterIcon(interaction, current.class)} ${
                        current.player
                    } - [${current.item}](${current.wowhead}) - ${current.gold}g`
                );
                i++;
            });
            const sumOfGold = totalItems.reduce(
                (totalGold, entry) => totalGold + entry.gold,
                0
            );
            await botReply(
                interaction,
                messages.totalspent.successTitle,
                `Gesamtausgaben: **${sumOfGold}g**\n\n${formattedItems[0].join("\n")}`
            );
            formattedItems.forEach(async(items, key) => {
                if (key > 0) {
                    await botFollowup(interaction, formattedItems[key].join("\n"));
                }
            });
        }
    },
};