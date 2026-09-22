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
const eventStore = require("./eventStore");
const { approvedSetupOf } = require("./setupEditor");

const CONFIRM_PREFIX = "setup-confirm";
const EVENT_ID = /^eh-[a-z0-9]{1,40}$/;
const STATUS_OF_FIELD = { y: "confirmed", n: "declined" };

const confirmId = (field, eventId) => `${CONFIRM_PREFIX}:${field}:${eventId}`;

/** `{ field, eventId }`; eventId "" when it is no own id. */
function parseConfirmId(customId) {
    const [, field = "", eventId = ""] = String(customId || "").split(":");
    return { field, eventId: EVENT_ID.test(eventId) ? eventId : "" };
}

/** The button row under the setup message — every raider reads it, so it is English. */
function confirmButtonRow(eventId) {
    return {
        type: 1,
        components: [
            { type: 2, style: 3, custom_id: confirmId("y", eventId), label: "Confirm" },
            { type: 2, style: 4, custom_id: confirmId("n", eventId), label: "Cancel" },
        ],
    };
}

/**
 * Record a raider's own confirmation and refresh the posted message. A stale
 * confirmation (from before the lineup last changed) never counts — dropped
 * here, not just hidden, so an old click can't resurface after a re-approval.
 * @returns {Promise<{ status?: string, code?: string, error?: string }>}
 */
async function setConfirmation(eventId, userId, field) {
    const status = STATUS_OF_FIELD[field];
    if (!status) return { code: "invalid", error: "Unbekannte Aktion." };
    const event = eventStore.getEvent(eventId);
    if (!event) return { code: "not_found", error: "Event nicht gefunden." };
    const approved = approvedSetupOf(event);
    if (!approved) return { code: "no_approved_setup", error: "Es gibt noch kein freigegebenes Setup." };
    // A group placement only — the bench never shows the mark, so confirming
    // there would silently do nothing visible.
    const placed = (approved.groups || []).some((g) => (g.slots || []).some((s) => String(s.userId) === String(userId)));
    if (!placed) return { code: "not_placed", error: "Du stehst in diesem Setup nicht in einer Gruppe." };
    // Lazy: setupMessage requires this file back for the button row.
    const { postOrEditSetupMessage } = require("./setupMessage");
    const prior = (event.setupPost && event.setupPost.confirmations) || {};
    const kept = Object.fromEntries(Object.entries(prior).filter(([, v]) => Number(v && v.version) === Number(approved.version)));
    eventStore.setEventSetupPost(event.id, { confirmations: { ...kept, [String(userId)]: { status, version: approved.version } } });
    const refreshed = await postOrEditSetupMessage(eventId, { userId });
    return { status, refreshed };
}

/** The confirmations of the currently approved version, plain `{ userId: status }`. */
function confirmationsFor(event, approved) {
    if (!approved) return {};
    const stored = (event && event.setupPost && event.setupPost.confirmations) || {};
    const out = {};
    for (const [userId, entry] of Object.entries(stored)) {
        if (entry && Number(entry.version) === Number(approved.version)) out[userId] = entry.status;
    }
    return out;
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

module.exports = {
    CONFIRM_PREFIX, confirmId, parseConfirmId, confirmButtonRow, setConfirmation, confirmationsFor, handleConfirmComponent,
};
