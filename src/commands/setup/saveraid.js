const Raidhelper = require("../../classes/raidhelper");
const messages = require("../../config/messages");
const {
    checkForPermission,
    getRaidInfosFromChannel,
    botReply,
} = require("../../utils/helper");

module.exports = {
    name: "saveraid",
    description: "Save Raid to pulse gdkp",
    async execute(interaction, client) {
        const raidhelper = new Raidhelper();
        if (!checkForPermission(interaction)) return;
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