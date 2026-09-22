// "Ping everyone" under the setup message: a click opens a modal with the
// ping text — pre-filled with the orga's own text if they set one (web or a
// previous use of this modal, setupPing.js's `pingTextOf`), else the default —
// editable right there. Submitting it saves that text on the event and posts
// the ping at once: one step instead of a separate preview, since the modal's
// own submit already is the confirmation (the way a typed "LÖSCHEN" is
// elsewhere in the bot).
//
//   setup-ping:<eventId>   the button click -> opens the modal
//   setup-ping:<eventId>   the modal submit -> saves the text, posts
//
// Access is `/event`'s (accessOf in the command file): the orga, checked by
// the router on every click. Everyone else sees the button and gets told no.
const {
    MessageFlags, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require("discord.js");
const eventStore = require("./eventStore");
const { setupPingPlan, callSetupPing, saveSetupPingText, pingTextOf, PING_TEXT_MAX } = require("./setupPing");

const PING_PREFIX = "setup-ping";
const EVENT_ID = /^eh-[a-z0-9]{1,40}$/;
const FIELD_ID = "text";

const COLOR_OK = 0x57a55a;
const COLOR_ERR = 0xe5534b;

const pingId = (eventId) => `${PING_PREFIX}:${eventId}`;

/** `{ eventId }`; "" when the customId names no own event. */
function parsePingId(customId) {
    const [, eventId = ""] = String(customId || "").split(":");
    return { eventId: EVENT_ID.test(eventId) ? eventId : "" };
}

/** The button row under the setup message, beside "Call invites". */
function pingButtonRow(eventId) {
    return { type: 1, components: [{ type: 2, style: 2, custom_id: pingId(eventId), label: "Ping everyone" }] };
}

/** The modal: one field, the ping text, pre-filled with the event's own or the default. */
function pingModal(event) {
    const field = new TextInputBuilder()
        .setCustomId(FIELD_ID).setLabel("Nachricht").setStyle(TextInputStyle.Paragraph)
        .setRequired(true).setMaxLength(PING_TEXT_MAX).setValue(pingTextOf(event));
    return new ModalBuilder().setCustomId(pingId(event.id)).setTitle("Alle pingen").addComponents(new ActionRowBuilder().addComponents(field));
}

const notice = (text, tone) => ({ content: "", embeds: [{ description: text, color: tone === "ok" ? COLOR_OK : COLOR_ERR }] });

/** Handle the button (opens the modal) and its submit (saves the text, posts); `guildId` is the server the click came from. */
async function handlePingComponent(interaction, guildId) {
    const { eventId } = parsePingId(interaction.customId);
    const event = eventId ? eventStore.getEvent(eventId) : null;
    const userId = String((interaction.user && interaction.user.id) || "");

    if (!interaction.isModalSubmit()) {
        if (!event || event.guildId !== guildId) {
            return interaction.reply({ content: "⚠️ Event nicht gefunden.", flags: MessageFlags.Ephemeral });
        }
        const plan = setupPingPlan(event, userId);
        if (plan.error) return interaction.reply({ content: `⚠️ ${plan.error.message}`, flags: MessageFlags.Ephemeral });
        return interaction.showModal(pingModal(event));
    }

    const text = interaction.fields.getTextInputValue(FIELD_ID);
    if (eventId) saveSetupPingText(eventId, text);
    const member = interaction.member || {};
    const user = interaction.user || {};
    const result = await callSetupPing({
        guildId, eventId, userId, text, byName: member.displayName || user.globalName || user.username || "",
    });
    return interaction.reply({
        ...notice(result.error ? `⚠️ ${result.error.message}` : `✅ ${result.message}`, result.error ? "err" : "ok"),
        flags: MessageFlags.Ephemeral,
    });
}

module.exports = { PING_PREFIX, pingId, parsePingId, pingButtonRow, pingModal, handlePingComponent };
