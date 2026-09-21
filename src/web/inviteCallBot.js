// "Invite callen" in Discord: a button under the setup message in the event
// channel (setupMessage.js). The click answers privately with what would go
// out — how many raiders of groups 1–5, and the line "/w <Charakter> inv" — and
// only "Jetzt pingen" posts it, so a stray click never pings the raid.
//
//   invite-call:p:<eventId>   the public button → private preview
//   invite-call:c:<eventId>   "Jetzt pingen" in the preview → post (inviteCall.js)
//
// Access is `/event`'s (accessOf in the command file): the orga, checked by the
// router on every click. Everyone else sees the button and gets told no.
const { MessageFlags } = require("discord.js");
const eventStore = require("./eventStore");
const { invitePlan, callInvite, INVITE_GROUPS } = require("./inviteCall");

const INVITE_PREFIX = "invite-call";
const EVENT_ID = /^eh-[a-z0-9]{1,40}$/;

const COLOR = 0x38bdf8;
const COLOR_OK = 0x57a55a;
const COLOR_ERR = 0xe5534b;

const inviteId = (field, eventId) => `${INVITE_PREFIX}:${field}:${eventId}`;

/** `{ field, eventId }`; eventId "" when it is no own id. */
function parseInviteId(customId) {
    const [, field = "", eventId = ""] = String(customId || "").split(":");
    return { field, eventId: EVENT_ID.test(eventId) ? eventId : "" };
}

/**
 * The button row under the setup message. The label sits on a message every
 * raider reads, so it is English; the private preview behind it is the orga's
 * and stays German, like the other orga texts in the bot.
 */
function inviteButtonRow(eventId) {
    return { type: 1, components: [{ type: 2, style: 2, custom_id: inviteId("p", eventId), label: "Call invites", emoji: { name: "📣" } }] };
}

const notice = (text, tone) => ({ content: "", embeds: [{ description: text, color: tone === "ok" ? COLOR_OK : COLOR_ERR }], components: [] });

/** The private preview: who, what, and the one button that posts it. */
function previewMessage(event, plan) {
    return {
        content: "",
        embeds: [{
            title: `Invite callen · ${event.title || "Raid"}`,
            color: COLOR,
            description: [
                `Pingt **${plan.userIds.length} Raider** aus Gruppe 1–${INVITE_GROUPS} im Event-Kanal mit:`,
                `\`${plan.text}\``,
            ].join("\n"),
        }],
        components: [{ type: 1, components: [{ type: 2, style: 1, custom_id: inviteId("c", event.id), label: "Jetzt pingen" }] }],
    };
}

/** Handle both buttons; `guildId` is the server the click came from. */
async function handleInviteComponent(interaction, guildId) {
    const { field, eventId } = parseInviteId(interaction.customId);
    const event = eventId ? eventStore.getEvent(eventId) : null;
    const userId = String((interaction.user && interaction.user.id) || "");
    if (field === "p") {
        const plan = event && event.guildId === guildId ? invitePlan(event, userId) : { error: { message: "Event nicht gefunden." } };
        const payload = plan.error ? notice(`⚠️ ${plan.error.message}`, "err") : previewMessage(event, plan);
        return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    }
    if (field === "c") {
        const member = interaction.member || {};
        const user = interaction.user || {};
        const result = await callInvite({ guildId, eventId, userId, byName: member.displayName || user.globalName || user.username || "" });
        return interaction.update(result.error ? notice(`⚠️ ${result.error.message}`, "err") : notice(`✅ ${result.message}`, "ok"));
    }
    return interaction.reply({ content: "Diese Aktion gibt es nicht.", flags: MessageFlags.Ephemeral });
}

module.exports = { INVITE_PREFIX, inviteId, parseInviteId, inviteButtonRow, previewMessage, handleInviteComponent };
