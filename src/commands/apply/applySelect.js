const { ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");
const { card } = require("../../utils/discord/card");
const { pendingApplications } = require("../../utils/recruitment/applicationState");
const { getClass } = require("../../config/applyClasses");

module.exports = {
    name: "apply-class",
    description: "Bewerbung Klassen-Auswahl",
    // A component of /apply: it needs the same access (services/discord/botAccess.js).
    accessOf: "apply",
    async execute(interaction) {
        const classValue = interaction.values[0];
        const cls = getClass(classValue);

        // Keeps the version the apply button set (#553).
        const pending = pendingApplications.get(interaction.user.id) || {};
        pendingApplications.set(interaction.user.id, {
            versionId: pending.versionId,
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

        await interaction.update(card({
            kicker: "Bewerbung",
            title: "Schritt 2",
            text: `Wähle deinen Spec für **${cls ? cls.label : classValue}**:`,
            buttons: [new ActionRowBuilder().addComponents(select)],
        }));
    },
};
