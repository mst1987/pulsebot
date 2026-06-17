const { ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");
const { pendingApplications } = require("../../utils/applicationState");
const { getClass } = require("../../config/applyClasses");

module.exports = {
    name: "apply-class",
    description: "Bewerbung Klassen-Auswahl",
    async execute(interaction) {
        const classValue = interaction.values[0];
        const cls = getClass(classValue);

        pendingApplications.set(interaction.user.id, {
            class: classValue,
            className: cls ? cls.label : classValue,
            timestamp: Date.now(),
        });

        const specOptions = (cls ? cls.specs : []).map((s) => ({ label: s, value: s }));

        const select = new StringSelectMenuBuilder()
            .setCustomId("apply-spec")
            .setPlaceholder("Wähle deinen Spec")
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(specOptions);

        await interaction.update({
            content: `**Schritt 2:** Wähle deinen Spec für **${cls ? cls.label : classValue}**:`,
            components: [new ActionRowBuilder().addComponents(select)],
        });
    },
};
