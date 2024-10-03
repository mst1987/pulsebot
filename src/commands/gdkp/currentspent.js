const messages = require("../../config/messages");
const GDKP = require("../../classes/gdkp");
const { getItemsToShow } = require("../../utils/responses");
const { botReply } = require("../../utils/helper");
const { getWednesdayWeeksAgo } = require("../../functions/date");

module.exports = {
    name: "currentspent",
    description: "Show current spent items",
    async execute(interaction, client) {
        const gdkp = new GDKP();
        let totalItems = await gdkp.getTotalItems(interaction.user.id);
        if (!totalItems) {
            await botReply(
                interaction,
                messages.currentspent.errorTitle,
                messages.currentspent.errorMessage
            );
        } else {
            const formattedItems = getItemsToShow(
                interaction,
                totalItems,
                getWednesdayWeeksAgo(1),
                new Date()
            );
            await botReply(
                interaction,
                messages.currentspent.successTitle,
                formattedItems
            );
        }
    },
};