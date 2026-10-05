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
const { ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const { card } = require("../../utils/discord/card");
const eventStore = require("../../stores/eventStore");
const { invitePlan, callInvite, INVITE_GROUPS } = require("./inviteCall");
const { INVITE_PREFIX, inviteId } = require("./setupCore");

const EVENT_ID = /^eh-[a-z0-9]{1,40}$/;


/** `{ field, eventId }`; eventId "" when it is no own id. */
function parseInviteId(customId) {
    const [, field = "", eventId = ""] = String(customId || "").split(":");
    return { field, eventId: EVENT_ID.test(eventId) ? eventId : "" };
}

/** A one-line answer (the card replaces the message it sits on, so no ephemeral flag here). */
const notice = (text, tone) => card({ kind: tone === "ok" ? "ok" : "error", title: text });

/** The private preview: who, what, and the one button that posts it. */
function previewMessage(event, plan) {
    return card({
        kind: "info",
        title: `Invite callen · ${event.title || "Raid"}`,
        text: [
            `Pingt **${plan.userIds.length} Raider** aus Gruppe 1–${INVITE_GROUPS} im Event-Kanal mit:`,
            `\`${plan.text}\``,
        ].join("\n"),
        buttons: [new ButtonBuilder().setCustomId(inviteId("c", event.id)).setLabel("Jetzt pingen").setStyle(ButtonStyle.Primary)],
    });
}

/** Handle both buttons; `guildId` is the server the click came from. */
async function handleInviteComponent(interaction, guildId) {
    const { field, eventId } = parseInviteId(interaction.customId);
    const event = eventId ? eventStore.getEvent(eventId) : null;
    const userId = String((interaction.user && interaction.user.id) || "");
    if (field === "p") {
        const plan = event && event.guildId === guildId ? invitePlan(event, userId) : { error: { message: "Event nicht gefunden." } };
        const payload = plan.error ? notice(plan.error.message, "err") : previewMessage(event, plan);
        return interaction.reply({ ...payload, flags: payload.flags | MessageFlags.Ephemeral });
    }
    if (field === "c") {
        const member = interaction.member || {};
        const user = interaction.user || {};
        const result = await callInvite({ guildId, eventId, userId, byName: member.displayName || user.globalName || user.username || "" });
        return interaction.update(result.error ? notice(result.error.message, "err") : notice(result.message, "ok"));
    }
    return interaction.reply(card({ kind: "error", title: "Diese Aktion gibt es nicht.", ephemeral: true }));
}

module.exports = { INVITE_PREFIX, parseInviteId, previewMessage, handleInviteComponent };
