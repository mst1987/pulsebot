const Legendary = require("../../classes/legendary");
const { botReply } = require("../../utils/helper");

module.exports = {
    name: "deleteauction",
    description: "Löscht die Auktion dieses Kanals",
    group: "auctions",
    defaultAccess: "admins",
    async execute(interaction, client) {
        const legendary = new Legendary();
        const response = await legendary.deleteAuction(interaction.channel.id);

        if (response.type === "success") {
            botReply(interaction, "Auktion gelöscht", response.message);
        } else {
            botReply(interaction, "Fehler", "Ein Fehler ist vorgefallen...");
        }
    },
};