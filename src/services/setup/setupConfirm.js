// Confirm / Cancel of a placed raider — one service for both ways in: the
// raider's own click under the setup message (setupConfirmBot.js) and the orga
// setting it in the setup editor (POST /api/raids/setup/confirm, …/confirm-all).
//
// Stored on the event as `setupPost.confirmations { userId: { status, at, by } }`
// — `by` is who set it (the raider themselves, or the orga member). It is the
// answer for the evening, not for one version of the setup: a later change of
// the lineup keeps it (setupCore.confirmationsFor shows it while the raider
// stands in a group).
//
// The posted message follows every change, never posts a first one. A
// raider's click waits for the edit (in the event's edit queue, so concurrent
// clicks never land out of order); the orga's marks only schedule it
// (`edit: "later"`): several quick clicks become one edit a moment after the
// last, and the editor gets its answer at once.
const eventStore = require("../../stores/eventStore");
const { approvedSetupOf, confirmationsFor, CONFIRM_STATUSES } = require("./setupCore");
const { editSetupMessageQueued, scheduleSetupEdit } = require("./setupMessage");

function placedIds(approved) {
    return new Set((approved.groups || []).flatMap((g) => (g.slots || []).map((s) => String(s.userId))));
}

function loadApproved(eventId) {
    const event = eventStore.getEvent(eventId);
    if (!event) return { failed: { code: "not_found", error: "Event nicht gefunden." } };
    const approved = approvedSetupOf(event);
    if (!approved) return { failed: { code: "no_approved_setup", error: "Es gibt noch kein gepostetes Setup." } };
    return { event, approved };
}

/** Bring the posted message along: now (awaited, in the queue) or a moment later, bundled. */
async function follow(event, { by, edit }) {
    if (!event.setupPost || !event.setupPost.messageId) return null;
    if (edit === "later") {
        scheduleSetupEdit(event.id, { userId: by });
        return { scheduled: true };
    }
    return editSetupMessageQueued(event.id, { userId: by });
}

/**
 * Set (or with `status` "" clear) one raider's confirmation. Only somebody
 * placed in a group of the approved setup — the bench never shows the mark,
 * so confirming there would do nothing visible.
 * @param {{ by?: string, now?: number, edit?: "now"|"later" }} opts `by` = who set it (default: the raider)
 * @returns {Promise<{ status?: string, confirmations?: object, refreshed?: object, code?: string, error?: string }>}
 */
async function setConfirmation(eventId, userId, status, { by = "", now = Date.now(), edit = "now" } = {}) {
    if (status !== "" && !CONFIRM_STATUSES.includes(status)) return { code: "invalid", error: "Unbekannte Aktion." };
    const { event, approved, failed } = loadApproved(eventId);
    if (failed) return failed;
    const uid = String(userId || "");
    if (!uid || !placedIds(approved).has(uid)) return { code: "not_placed", error: "Steht in diesem Setup nicht in einer Gruppe." };
    const confirmations = { ...((event.setupPost && event.setupPost.confirmations) || {}) };
    if (status) confirmations[uid] = { status, at: now, by: String(by || uid) };
    else delete confirmations[uid];
    const saved = eventStore.setEventSetupPost(event.id, { confirmations });
    const refreshed = await follow(event, { by: by || uid, edit });
    return { status, confirmations: confirmationsFor(saved || event, approved), refreshed };
}

/**
 * "Alle bestätigen": everybody in a group who has not answered yet gets the
 * check, set by the orga. A "Cancel" stays — that raider said no; the orga
 * changes it one by one if they must.
 * @returns {Promise<{ count?: number, confirmations?: object, code?: string, error?: string }>}
 */
async function confirmAll(eventId, { by = "", now = Date.now(), edit = "later" } = {}) {
    const { event, approved, failed } = loadApproved(eventId);
    if (failed) return failed;
    const confirmations = { ...((event.setupPost && event.setupPost.confirmations) || {}) };
    const shown = confirmationsFor(event, approved);
    let count = 0;
    for (const uid of placedIds(approved)) {
        if (shown[uid]) continue;
        confirmations[uid] = { status: "confirmed", at: now, by: String(by) };
        count += 1;
    }
    if (!count) return { count, confirmations: shown };
    const saved = eventStore.setEventSetupPost(event.id, { confirmations });
    await follow(event, { by, edit });
    return { count, confirmations: confirmationsFor(saved || event, approved) };
}

module.exports = { setConfirmation, confirmAll };
