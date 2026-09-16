const { createRaidhelperClient } = require("../../utils/raidhelperClient");
const messages = require("../../config/messages");
const {
    getRaidInfosFromChannel,
    botReply,
} = require("../../utils/helper");

module.exports = {
    name: "saveraid",
    description: "Speichert den Raid dieses Kanals bei Pulse GDKP",
    group: "raids",
    defaultAccess: "admins",
    async execute(interaction, client) {
        const raidhelper = createRaidhelperClient();
        const raidInfos = await getRaidInfosFromChannel(interaction);
        const response = await raidhelper.saveRaid(raidInfos);
        if (response._id) {
            await botReply(
                interaction,
                "Save",
                `Raid gespeichert [hier](https://pulse-gdkp.de/raids/${response._id})`
            );
        } else {
            botReply(interaction, "Fehler", "Fehler beim Anlegen des Raids");
        }
    },
};