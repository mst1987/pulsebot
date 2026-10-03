// Confirm / Cancel of a placed raider — one service for both ways in: the
// raider's own click under the setup message (setupConfirmBot.js) and the orga
// setting it in the setup editor (POST /api/raids/setup/confirm).
//
// Stored on the event as `setupPost.confirmations { userId: { status, at, by } }`
// — `by` is who set it (the raider themselves, or the orga member). It is the
// answer for the evening, not for one version of the setup: a later change of
// the lineup keeps it (setupCore.confirmationsFor shows it while the raider
// stands in a group). After every change the posted message is brought up to
// date, so the mark shows at once in Discord.
const eventStore = require("../../stores/eventStore");
const { approvedSetupOf, CONFIRM_STATUSES } = require("./setupCore");
const { postOrEditSetupMessage } = require("./setupMessage");

/**
 * Set (or with `status` "" clear) one raider's confirmation and refresh the
 * posted message. Only somebody placed in a group of the approved setup — the
 * bench never shows the mark, so confirming there would do nothing visible.
 * @param {{ by?: string, now?: number }} opts `by` = who set it (default: the raider)
 * @returns {Promise<{ status?: string, refreshed?: object, code?: string, error?: string }>}
 */
async function setConfirmation(eventId, userId, status, { by = "", now = Date.now() } = {}) {
    if (status !== "" && !CONFIRM_STATUSES.includes(status)) return { code: "invalid", error: "Unbekannte Aktion." };
    const event = eventStore.getEvent(eventId);
    if (!event) return { code: "not_found", error: "Event nicht gefunden." };
    const approved = approvedSetupOf(event);
    if (!approved) return { code: "no_approved_setup", error: "Es gibt noch kein gepostetes Setup." };
    const uid = String(userId || "");
    const placed = (approved.groups || []).some((g) => (g.slots || []).some((s) => String(s.userId) === uid));
    if (!uid || !placed) return { code: "not_placed", error: "Steht in diesem Setup nicht in einer Gruppe." };
    const confirmations = { ...((event.setupPost && event.setupPost.confirmations) || {}) };
    if (status) confirmations[uid] = { status, at: now, by: String(by || uid) };
    else delete confirmations[uid];
    eventStore.setEventSetupPost(event.id, { confirmations });
    // only an existing message is edited — the orga's mark never posts one by itself
    const refreshed = event.setupPost && event.setupPost.messageId ? await postOrEditSetupMessage(eventId, { userId: by || uid }) : null;
    return { status, refreshed };
}

module.exports = { setConfirmation };
