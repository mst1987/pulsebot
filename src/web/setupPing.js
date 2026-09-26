// "Alle pingen": the orga pings everyone placed in any group of the approved
// setup — a plain heads-up that the setup is posted, not an invite
// instruction like "Invite callen" (inviteCall.js, groups 1–5 only). Every
// group counts here, the bench never does: nobody is confirmed for a spot
// there. One service for the button under the setup message (setupPingBot.js).
//
// Only own events: their setup is ours (setupEditor.js); a Raid-Helper event's
// raid plan lives at Raid-Helper.
const eventStore = require("../stores/eventStore");
const discord = require("../services/discord/discord");
const { approvedSetupOf, PING_TEXT_MAX, pingTextOf } = require("./setupCore");
const { fail } = require("./http/apiResult");

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
    return { userIds, text: String(text || "").trim() || pingTextOf(event) };
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
    return { message: `${count} Raider aus dem Setup gepingt.`, count, url: posted && posted.url };
}

module.exports = { saveSetupPingText, setupPingPlan, callSetupPing };
