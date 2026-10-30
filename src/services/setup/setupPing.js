// "Alle pingen": the orga pings everyone placed in any group of the approved
// setup — a plain heads-up that the setup is posted, not an invite
// instruction like "Invite callen" (inviteCall.js, groups 1–5 only). Every
// group counts here, the bench never does: nobody is confirmed for a spot
// there. Here: who is pinged with what (setupPingPlan) and the orga's text; the
// ping itself is part of the setup message since Oct 2026 (setupMessage.js
// callSetupPing, "Ping 3" of the design canvas). refreshSetupPing keeps a ping
// card of the time before - posted under the message as one of its own - true.
//
// Only own events: their setup is ours (setupEditor.js); a Raid-Helper event's
// raid plan lives at Raid-Helper.
const eventStore = require("../../stores/events/eventStore");
const discord = require("../discord/discord");
const { approvedSetupOf, confirmationsFor, unansweredOf, PING_OPEN_TEXT, PING_TEXT_MAX, pingTextOf } = require("./setupCore");
const { tr } = require("../../utils/i18n/botText");
const { fail } = require("../../web/http/apiResult");
const { eventLang } = require("../discord/botLanguage");

/** `event.setupPingText`, "" (clear) accepted, trimmed to the same length the store enforces. */
function saveSetupPingText(eventId, text) {
    return eventStore.setEventSetupPingText(eventId, String(text || "").trim().slice(0, PING_TEXT_MAX));
}

/**
 * Who would be pinged, and with what — pure, nothing is posted. Every group,
 * deduplicated; the caller is never pinged themselves (they just clicked the
 * button, or the setup was just posted on their approval).
 * `open` is "Ping unconfirmed": only who has neither confirmed nor cancelled
 * yet, with a reminder as the default text instead of the orga's stored one.
 * @param {{ text?: string, open?: boolean }} opts an explicit text overrides the stored/default one
 * @returns {{ userIds: string[], text: string, open?: true } | { error: object }}
 */
function setupPingPlan(event, userId, { text, open = false } = {}) {
    if (!event) return fail(404, "not_found", "Event nicht gefunden.");
    if (event.status === "cancelled") return fail(400, "cancelled", "Das Event ist abgesagt — da wird niemand mehr gepingt.");
    const approved = approvedSetupOf(event);
    if (!approved) return fail(400, "no_setup", "Für diesen Raid ist noch kein Setup freigegeben.");
    // without the answers, everybody placed counts as not answered
    const answers = open ? confirmationsFor(event, approved) : {};
    const userIds = unansweredOf(approved, answers).filter((id) => id !== String(userId));
    if (!userIds.length) {
        return open
            ? fail(400, "nobody_open", "Alle im Setup haben schon bestätigt oder abgesagt.")
            : fail(400, "nobody", "Im Setup steht niemand außer dir.");
    }
    const own = String(text || "").trim();
    if (open) return { userIds, text: own || tr(eventLang(event), PING_OPEN_TEXT), open: true };
    return { userIds, text: own || pingTextOf(event, eventLang(event)) };
}

/**
 * After a live change of the setup: a ping card of the time before (its own
 * message under the setup, `setupPost.ping.messageIds`) is edited to the
 * people placed now (setupPingPlan, the pinger left out as before). Nobody is
 * notified by an edit — newcomers are named, not pinged; who left the setup
 * disappears from the list. Nothing to do without such a card (a ping in the
 * setup message follows with the message), for a cancelled event or when the
 * list is the same.
 * @returns {Promise<{ edited?: boolean, skipped?: string, error?: string }>}
 */
async function refreshSetupPing(eventId) {
    const event = eventStore.getEvent(eventId);
    const ping = event && event.setupPost && event.setupPost.ping;
    if (!ping || !ping.channelId || !(ping.messageIds || []).length) return { skipped: "no_ping" };
    const plan = setupPingPlan(event, ping.by, { text: ping.text, open: !!ping.open });
    if (plan.error) return { skipped: plan.error.code || "no_plan" };
    if ([...plan.userIds].sort().join(",") === [...(ping.userIds || [])].sort().join(",")) return { skipped: "unchanged" };
    try {
        const { messageIds } = await discord.editPingMessages(ping.channelId, ping.messageIds, plan.userIds, plan.text);
        eventStore.setEventSetupPost(event.id, { ping: { ...ping, messageIds, userIds: plan.userIds } });
        return { edited: true };
    } catch (e) {
        return { error: (e && e.message) || "Discord hat nicht geantwortet." };
    }
}

module.exports = { saveSetupPingText, setupPingPlan, refreshSetupPing };
