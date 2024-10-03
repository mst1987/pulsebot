const { showAllEvents } = require("../../utils/helper");

module.exports = {
    name: "show-allsetups",
    description: "Show all setups",
    async execute(interaction, client) {
        console.log("updateevents");
        await interaction.update({
            embeds: [{
                title: interaction.channel.parent.name,
                description: await showAllEvents(interaction, categoryId),
            }, ],
        });
    },
};