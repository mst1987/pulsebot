// Confirm / Cancel under the setup message, like Raid-Helper's composition
// confirmation: each raider placed in the approved lineup confirms or
// declines their own slot with one click, and the message marks their name
// with a checkmark or a cross. Declining only marks it — setupMessage.js
// never moves anybody, so a bench-rebalance stays the orga's call.
//
//   setup-confirm:y:<eventId>   Confirm
//   setup-confirm:n:<eventId>   Cancel
//
// Access is raider-facing (accessOf "event-signup" in the command file):
// anyone may click, but only the raider's own placement is ever touched —
// someone not in the lineup is told so, privately.
const { MessageFlags } = require("discord.js");
const { CONFIRM_PREFIX } = require("./setupCore");
const confirm = require("./setupConfirm");

const EVENT_ID = /^eh-[a-z0-9]{1,40}$/;
const STATUS_OF_FIELD = { y: "confirmed", n: "declined" };

/** `{ field, eventId }`; eventId "" when it is no own id. */
function parseConfirmId(customId) {
    const [, field = "", eventId = ""] = String(customId || "").split(":");
    return { field, eventId: EVENT_ID.test(eventId) ? eventId : "" };
}

/**
 * Record a raider's own confirmation and refresh the posted message — the
 * same service the orga's mark in the editor goes through (setupConfirm.js).
 * It stays through later changes of the setup.
 * @returns {Promise<{ status?: string, code?: string, error?: string }>}
 */
async function setConfirmation(eventId, userId, field) {
    const status = STATUS_OF_FIELD[field];
    if (!status) return { code: "invalid", error: "Unbekannte Aktion." };
    const result = await confirm.setConfirmation(eventId, userId, status, { by: userId });
    if (result.code === "not_placed") return { ...result, error: "Du stehst in diesem Setup nicht in einer Gruppe." };
    return result;
}

/** Handle a click of either button. */
async function handleConfirmComponent(interaction) {
    const { field, eventId } = parseConfirmId(interaction.customId);
    const userId = String((interaction.user && interaction.user.id) || "");
    if (!eventId || !STATUS_OF_FIELD[field]) {
        return interaction.reply({ content: "Diese Aktion gibt es nicht.", flags: MessageFlags.Ephemeral });
    }
    const result = await setConfirmation(eventId, userId, field);
    if (result.code) return interaction.reply({ content: `⚠️ ${result.error}`, flags: MessageFlags.Ephemeral });
    const text = field === "y" ? "✅ Confirmed — see you there!" : "❌ Marked as cancelled — the raid lead will rebench you.";
    return interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
}

module.exports = { CONFIRM_PREFIX, parseConfirmId, setConfirmation, handleConfirmComponent };
