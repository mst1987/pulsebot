// "Alle pingen": the orga pings everyone placed in any group of the approved
// setup — a plain heads-up that the setup is posted, not an invite
// instruction like "Invite callen" (inviteCall.js, groups 1–5 only). Every
// group counts here, the bench never does: nobody is confirmed for a spot
// there. One service for the button under the setup message (setupPingBot.js).
//
// Only own events: their setup is ours (setupEditor.js); a Raid-Helper event's
// raid plan lives at Raid-Helper.
const eventStore = require("../../stores/eventStore");
const discord = require("../discord/discord");
const { approvedSetupOf, PING_TEXT_MAX, pingTextOf } = require("./setupCore");
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
 * @param {{ text?: string }} opts an explicit text overrides the stored/default one
 * @returns {{ userIds: string[], text: string } | { error: object }}
 */
function setupPingPlan(event, userId, { text } = {}) {
    if (!event) return fail(404, "not_found", "Event nicht gefunden.");
    if (event.status === "cancelled") return fail(400, "cancelled", "Das Event ist abgesagt — da wird niemand mehr gepingt.");
    const approved = approvedSetupOf(event);
    if (!approved) return fail(400, "no_setup", "Für diesen Raid ist noch kein Setup freigegeben.");
    const userIds = [...new Set((approved.groups || []).flatMap((g) => (g.slots || []).map((s) => String(s.userId || ""))))]
        .filter((id) => id && id !== String(userId));
    if (!userIds.length) return fail(400, "nobody", "Im Setup steht niemand außer dir.");
    return { userIds, text: String(text || "").trim() || pingTextOf(event, eventLang(event)) };
}

/**
 * Post the ping into the event channel and log it on the event.
 * @param {{ guildId: string, eventId: string, userId: string, byName?: string, text?: string }} p
 * @returns {Promise<{ message: string, count: number, url?: string } | { error: object }>}
 */
async function callSetupPing({ guildId, eventId, userId, byName = "", text } = {}) {
    const event = eventStore.getEvent(eventId);
    if (!event || (guildId && event.guildId && event.guildId !== String(guildId))) {
        return fail(404, "not_found", "Event nicht gefunden.");
    }
    const plan = setupPingPlan(event, userId, { text });
    if (plan.error) return plan;
    if (!event.channelId) return fail(400, "no_channel", "Das Event hat keinen Kanal.");
    let posted;
    try {
        posted = await discord.postMissingPing(event.channelId, plan.userIds, plan.text);
    } catch (e) {
        return fail(502, "post_failed", `Konnte nicht posten: ${e.message}`);
    }
    const count = plan.userIds.length;
    eventStore.appendEventLog(event.id, { action: "setupPing", by: String(userId || ""), byName, detail: `${count} Raider gepingt` });
    // the last ping is remembered, so a later change of the setup can keep its list true (refreshSetupPing)
    if (posted && posted.channelId) {
        eventStore.setEventSetupPost(event.id, {
            ping: { channelId: String(posted.channelId), messageIds: posted.messageIds || [String(posted.messageId)], userIds: plan.userIds, by: String(userId || ""), text: plan.text },
        });
    }
    return { message: `${count} Raider aus dem Setup gepingt.`, count, url: posted && posted.url };
}

/**
 * After a live change of the setup: the last ping's message is edited to the
 * people placed now (setupPingPlan, the pinger left out as before). Nobody is
 * notified by an edit — newcomers are named, not pinged; who left the setup
 * disappears from the list. Nothing to do without a remembered ping, for a
 * cancelled event or when the list is the same.
 * @returns {Promise<{ edited?: boolean, skipped?: string, error?: string }>}
 */
async function refreshSetupPing(eventId) {
    const event = eventStore.getEvent(eventId);
    const ping = event && event.setupPost && event.setupPost.ping;
    if (!ping || !ping.channelId || !(ping.messageIds || []).length) return { skipped: "no_ping" };
    const plan = setupPingPlan(event, ping.by, { text: ping.text });
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

module.exports = { saveSetupPingText, setupPingPlan, callSetupPing, refreshSetupPing };
