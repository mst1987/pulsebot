// /event anlegen (#260): step 1 of creating an event from Discord — an
// ephemeral message with the selects. The selects and buttons are
// eventCreateStep.js, the modal is eventCreateModal.js, the logic is
// web/eventDraft.js and the creation itself web/eventCreate.js.
//
// /event verwalten (#288): the actions for an EventHelper event — the one named
// in `event` (autocomplete), else the one of the current channel. Its buttons
// are eventManageStep.js, its modals eventManageForm.js, the logic
// web/eventManageBot.js on top of web/eventManage.js. The message context menu
// "Event verwalten" (eventManageContext.js) opens the same message.
const { guildFor, initialState, stepMessage } = require("../../web/eventDraft");
const { openPayload } = require("../../web/eventManageBot");
const { listEvents } = require("../../web/eventStore");
const { whenLabel } = require("../../web/eventManage");
const { respondChoices } = require("../../utils/botLookup");

// Events that started more than a day ago are no longer offered.
const LOOKBACK_SECONDS = 24 * 3600;

module.exports = {
    name: "event",
    description: "Event anlegen und verwalten: anlegen per Vorlage; verschieben, Anmeldung schließen, Raider eintragen, absagen.",
    // Creating events is the orga's job; the role gets it in Einstellungen → Berechtigungen → Bot-Befehle.
    group: "raids",
    defaultAccess: "admins",
    async execute(interaction) {
        const sub = interaction.options && typeof interaction.options.getSubcommand === "function"
            ? interaction.options.getSubcommand(false)
            : "";
        if (sub !== "anlegen" && sub !== "verwalten") return interaction.reply({ content: "Diese Aktion gibt es nicht.", ephemeral: true });

        const { guildId, error } = guildFor(interaction);
        if (error) return interaction.reply({ content: error, ephemeral: true });

        if (sub === "verwalten") {
            const eventId = typeof interaction.options.getString === "function" ? String(interaction.options.getString("event") || "").trim() : "";
            const channelId = String(interaction.channelId || (interaction.channel && interaction.channel.id) || "");
            const opened = openPayload(guildId, { eventId, channelId });
            if (opened.error) return interaction.reply({ content: opened.error, ephemeral: true });
            return interaction.reply({ ...opened.payload, ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });
        const channel = interaction.channel || {};
        const parentId = String(channel.parentId || (channel.parent && channel.parent.id) || "");
        const { payload } = await stepMessage(guildId, initialState(guildId, parentId));
        return interaction.editReply(payload);
    },
    /** `event` of /event verwalten: the server's EventHelper events from yesterday on, soonest first. */
    async autocomplete(interaction) {
        const guildId = String(interaction.guildId || (interaction.guild && interaction.guild.id) || "");
        const since = Math.floor(Date.now() / 1000) - LOOKBACK_SECONDS;
        const events = guildId ? listEvents(guildId, { sinceSeconds: since }).sort((a, b) => a.startTime - b.startTime) : [];
        return respondChoices(interaction, events.map((e) => ({
            name: `${e.title} · ${whenLabel(e.startTime)}${e.status === "cancelled" ? " · abgesagt" : ""}`,
            value: e.id,
        })));
    },
};
