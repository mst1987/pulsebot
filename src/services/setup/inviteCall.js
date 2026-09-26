// "Invite callen": the orga pings the raiders of groups 1–5 of the approved
// setup in the event channel with "/w <Charakter> inv" — <Charakter> being the
// character the caller raids with, so everyone knows whom to whisper for the
// invite. One service for the raid detail (POST /api/raids/invite-call) and the
// button under the setup message in Discord (inviteCallBot.js), so both ping
// exactly the same people with the same line.
//
// Only own events: their setup is ours (setupEditor.js); a Raid-Helper event's
// raid plan lives at Raid-Helper. Groups 6–8 and the bench are not pinged — the
// invite goes out to the raid, the rest waits.
const eventStore = require("../../stores/eventStore");
const signupStore = require("../../stores/signupStore");
const discord = require("../discord/discord");
const { approvedSetupOf } = require("./setupCore");
const { fail } = require("../../web/http/apiResult");

/** Groups 1 to this one are called to the invite. */
const INVITE_GROUPS = 5;

/**
 * The character the caller raids with: their place in the approved setup (any
 * group or the bench), else the character they signed up with. "" when neither.
 */
function inviteCharacterOf(event, approved, userId) {
    const uid = String(userId || "");
    if (!uid) return "";
    const placed = [
        ...((approved && approved.groups) || []).flatMap((g) => g.slots || []),
        ...((approved && approved.bench) || []),
    ].find((s) => String(s.userId) === uid && s.character);
    if (placed) return String(placed.character);
    const signup = event ? signupStore.getSignup(event.id, uid) : null;
    return signup && signup.character ? String(signup.character) : "";
}

/** The line everyone reads: "/w Naphfß inv". */
function inviteText(character) {
    return `/w ${character} inv`;
}

/**
 * Who would be pinged and with what — pure, nothing is posted. The caller is
 * never pinged themselves.
 * @returns {{ userIds: string[], character: string, text: string, groups: number[] } | { error: object }}
 */
function invitePlan(event, userId) {
    if (!event) return fail(404, "not_found", "Event nicht gefunden.");
    if (event.status === "cancelled") return fail(400, "cancelled", "Das Event ist abgesagt — da wird niemand mehr eingeladen.");
    const approved = approvedSetupOf(event);
    if (!approved) return fail(400, "no_setup", "Für diesen Raid ist noch kein Setup freigegeben.");
    const character = inviteCharacterOf(event, approved, userId);
    if (!character) {
        return fail(400, "no_character", "Du bist für diesen Raid mit keinem Charakter angemeldet — ohne ihn weiß niemand, wen er anflüstern soll.");
    }
    const groups = (approved.groups || [])
        .filter((g) => Number(g.index) >= 1 && Number(g.index) <= INVITE_GROUPS && (g.slots || []).length)
        .sort((a, b) => a.index - b.index);
    const userIds = [...new Set(groups.flatMap((g) => g.slots.map((s) => String(s.userId || ""))))]
        .filter((id) => id && id !== String(userId));
    if (!userIds.length) return fail(400, "nobody", `In Gruppe 1–${INVITE_GROUPS} steht niemand außer dir.`);
    return { userIds, character, text: inviteText(character), groups: groups.map((g) => g.index) };
}

/**
 * Post the invite call into the event channel and log it on the event.
 * @param {{ guildId: string, eventId: string, userId: string, byName?: string }} p
 * @returns {Promise<{ message: string, count: number, text: string, url?: string } | { error: object }>}
 */
async function callInvite({ guildId, eventId, userId, byName = "" }) {
    const event = eventStore.getEvent(eventId);
    if (!event || (guildId && event.guildId && event.guildId !== String(guildId))) {
        return fail(404, "not_found", "Event nicht gefunden.");
    }
    const plan = invitePlan(event, userId);
    if (plan.error) return plan;
    if (!event.channelId) return fail(400, "no_channel", "Das Event hat keinen Kanal.");
    let posted;
    try {
        posted = await discord.postMissingPing(event.channelId, plan.userIds, plan.text);
    } catch (e) {
        return fail(502, "post_failed", `Konnte nicht posten: ${e.message}`);
    }
    const count = plan.userIds.length;
    eventStore.appendEventLog(event.id, { action: "invite", by: String(userId || ""), byName, detail: `${count} Raider · ${plan.text}` });
    return {
        message: `${count} Raider aus Gruppe 1–${INVITE_GROUPS} gepingt: ${plan.text}`,
        count,
        text: plan.text,
        url: posted && posted.url,
    };
}

module.exports = { INVITE_GROUPS, inviteCharacterOf, inviteText, invitePlan, callInvite };
