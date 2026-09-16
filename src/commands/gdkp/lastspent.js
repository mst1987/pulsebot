const messages = require("../../config/messages");
const GDKP = require("../../classes/gdkp");
const { getItemsToShow } = require("../../utils/responses");
const { botReply } = require("../../utils/helper");
const { getWednesdayWeeksAgo } = require("../../utils/date");

module.exports = {
    name: "lastspent",
    description: "Zeigt, was du im letzten GDKP ausgegeben hast",
    group: "auctions",
    defaultAccess: "everyone",
    async execute(interaction, client) {
        const gdkp = new GDKP();
        let totalItems = await gdkp.getTotalItems(interaction.user.id);
        if (!totalItems) {
            await botReply(
                interaction,
                messages.lastspent.errorTitle,
                messages.lastspent.errorMessage
            );
        } else {
            const formattedItems = getItemsToShow(
                interaction,
                totalItems,
                getWednesdayWeeksAgo(2),
                getWednesdayWeeksAgo(1)
            );
            await botReply(
                interaction,
                messages.lastspent.successTitle,
                formattedItems
            );
        }
    },
};