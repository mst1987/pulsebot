const { createRaidhelperClient } = require("../../utils/raidhelperClient");
const {
    getRaidInfosFromChannel,
    botReply,
} = require("../../utils/helper");

// Saves the raid of this channel at Pulse GDKP. Works for both sources (#291):
// an own EventHelper event with its approved setup, else the Raid-Helper event
// the Raid-Helper bot posted in this channel.
module.exports = {
    name: "saveraid",
    description: "Speichert den Raid dieses Kanals bei Pulse GDKP",
    group: "raids",
    defaultAccess: "admins",
    async execute(interaction, client) {
        const raidhelper = createRaidhelperClient();
        let raidInfos;
        try {
            raidInfos = await getRaidInfosFromChannel(interaction);
        } catch (error) {
            return botReply(interaction, "Fehler", `Raid konnte nicht gelesen werden: ${error.message}`);
        }
        if (!raidInfos) {
            return botReply(interaction, "Fehler", "In diesem Kanal gibt es kein Event – weder ein eigenes noch eins von Raid-Helper.");
        }
        if (raidInfos.source === "eventhelper" && !(raidInfos.setupData || []).length) {
            return botReply(interaction, "Fehler", "Das Event hat noch kein freigegebenes Setup. Erst im Web unter Raid-Details › Setup freigeben.");
        }
        let response;
        try {
            response = await raidhelper.saveRaid(raidInfos);
        } catch (error) {
            return botReply(interaction, "Fehler", `Fehler beim Anlegen des Raids: ${error.message}`);
        }
        if (response && response._id) {
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
