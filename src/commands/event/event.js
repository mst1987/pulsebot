// /event anlegen (#260): step 1 of creating an event from Discord — an
// ephemeral message with the selects. The selects and buttons are
// eventCreateStep.js, the modal is eventCreateModal.js, the logic is
// web/eventDraft.js and the creation itself web/eventCreate.js.
const { guildFor, initialState, stepMessage } = require("../../web/eventDraft");

module.exports = {
    name: "event",
    description: "Event anlegen: Kategorie, Raid-Vorlage und Kanal wählen, dann Datum, Uhrzeit und Titel.",
    // Creating events is the orga's job; the role gets it in Einstellungen → Berechtigungen → Bot-Befehle.
    group: "raids",
    defaultAccess: "admins",
    async execute(interaction) {
        const sub = interaction.options && typeof interaction.options.getSubcommand === "function"
            ? interaction.options.getSubcommand(false)
            : "";
        if (sub !== "anlegen") return interaction.reply({ content: "Diese Aktion gibt es nicht.", ephemeral: true });

        const { guildId, error } = guildFor(interaction);
        if (error) return interaction.reply({ content: error, ephemeral: true });

        await interaction.deferReply({ ephemeral: true });
        const channel = interaction.channel || {};
        const parentId = String(channel.parentId || (channel.parent && channel.parent.id) || "");
        const { payload } = await stepMessage(guildId, initialState(guildId, parentId));
        return interaction.editReply(payload);
    },
};
