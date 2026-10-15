// "Ping everyone" under the setup message: a click opens a modal with the
// ping text — pre-filled with the orga's own text if they set one (web or a
// previous use of this modal, setupPing.js's `pingTextOf`), else the default —
// editable right there. Submitting it saves that text on the event and posts
// the ping at once: one step instead of a separate preview, since the modal's
// own submit already is the confirmation (the way a typed "LÖSCHEN" is
// elsewhere in the bot).
//
// "Ping unconfirmed" beside it works the same for who has neither confirmed
// nor cancelled yet: its modal is pre-filled with a reminder and its text is
// never saved — the stored one stays the setup's own for "Ping everyone".
//
//   setup-ping:<eventId>        the button click -> opens the modal
//   setup-ping:<eventId>        the modal submit -> saves the text, posts
//   setup-ping:<eventId>:open   the same for "Ping unconfirmed" (nothing saved)
//
// Access is `/event`'s (accessOf in the command file): the orga, checked by
// the router on every click. Everyone else sees the button and gets told no.
const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const { card } = require("../../utils/discord/card");
const eventStore = require("../../stores/eventStore");
const { setupPingPlan, saveSetupPingText } = require("./setupPing");
const { callSetupPing } = require("./setupMessage");
const { PING_PREFIX, PING_TEXT_MAX, pingTextOf, pingId } = require("./setupCore");
const { eventLang } = require("../discord/botLanguage");

const EVENT_ID = /^eh-[a-z0-9]{1,40}$/;
const FIELD_ID = "text";


/** `{ eventId, open }`; eventId "" when the customId names no own event, `open` for "Ping unconfirmed". */
function parsePingId(customId) {
    const [, eventId = "", mode = ""] = String(customId || "").split(":");
    return { eventId: EVENT_ID.test(eventId) ? eventId : "", open: mode === "open" };
}

/**
 * The modal: one field, the ping text, pre-filled with the event's own or the default —
 * with `open` the reminder (`text`, setupPing.setupPingPlan's) and how many it reaches.
 */
function pingModal(event, { open = false, text = "", count = 0 } = {}) {
    const field = new TextInputBuilder()
        .setCustomId(FIELD_ID).setLabel("Nachricht").setStyle(TextInputStyle.Paragraph)
        .setRequired(true).setMaxLength(PING_TEXT_MAX).setValue(open ? text : pingTextOf(event, eventLang(event)));
    return new ModalBuilder()
        .setCustomId(pingId(event.id, open)).setTitle(open ? `Unbestätigte pingen (${count})` : "Alle pingen")
        .addComponents(new ActionRowBuilder().addComponents(field));
}

const notice = (text, tone) => card({ kind: tone === "ok" ? "ok" : tone === "warn" ? "warn" : "error", title: text, ephemeral: true });

/** Handle the button (opens the modal) and its submit (saves the text, posts); `guildId` is the server the click came from. */
async function handlePingComponent(interaction, guildId) {
    const { eventId, open } = parsePingId(interaction.customId);
    const event = eventId ? eventStore.getEvent(eventId) : null;
    const userId = String((interaction.user && interaction.user.id) || "");

    if (!interaction.isModalSubmit()) {
        if (!event || event.guildId !== guildId) {
            return interaction.reply(notice("Event nicht gefunden.", "warn"));
        }
        const plan = setupPingPlan(event, userId, { open });
        if (plan.error) return interaction.reply(notice(plan.error.message, "warn"));
        return interaction.showModal(pingModal(event, { open, text: plan.text, count: plan.userIds.length }));
    }

    const text = interaction.fields.getTextInputValue(FIELD_ID);
    if (eventId && !open) saveSetupPingText(eventId, text);
    const member = interaction.member || {};
    const user = interaction.user || {};
    const result = await callSetupPing({
        guildId, eventId, userId, text, byName: member.displayName || user.globalName || user.username || "",
        ...(open ? { open: true } : {}),
    });
    return interaction.reply(notice(result.error ? result.error.message : result.message, result.error ? "err" : "ok"));
}

module.exports = { PING_PREFIX, parsePingId, pingModal, handlePingComponent };
