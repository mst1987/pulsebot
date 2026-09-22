// "Alle pingen" in Discord: a button under the setup message (setupMessage.js)
// beside "Call invites". The click answers privately with a preview — how
// many raiders across the whole setup, and the line that would go out — and
// only "Jetzt pingen" posts it, so a stray click never pings the whole raid.
//
//   setup-ping:p:<eventId>   the public button → private preview
//   setup-ping:c:<eventId>   "Jetzt pingen" in the preview → post (setupPing.js)
//
// Access is `/event`'s (accessOf in the command file): the orga, checked by
// the router on every click. Everyone else sees the button and gets told no.
const { MessageFlags } = require("discord.js");
const eventStore = require("./eventStore");
const { setupPingPlan, callSetupPing } = require("./setupPing");

const PING_PREFIX = "setup-ping";
const EVENT_ID = /^eh-[a-z0-9]{1,40}$/;

const COLOR = 0x38bdf8;
const COLOR_OK = 0x57a55a;
const COLOR_ERR = 0xe5534b;

const pingId = (field, eventId) => `${PING_PREFIX}:${field}:${eventId}`;

/** `{ field, eventId }`; eventId "" when it is no own id. */
function parsePingId(customId) {
    const [, field = "", eventId = ""] = String(customId || "").split(":");
    return { field, eventId: EVENT_ID.test(eventId) ? eventId : "" };
}

/** The button row under the setup message, beside "Call invites". */
function pingButtonRow(eventId) {
    return { type: 1, components: [{ type: 2, style: 2, custom_id: pingId("p", eventId), label: "Ping everyone" }] };
}

const notice = (text, tone) => ({ content: "", embeds: [{ description: text, color: tone === "ok" ? COLOR_OK : COLOR_ERR }], components: [] });

/** The private preview: who, what, and the one button that posts it. */
function previewMessage(event, plan) {
    return {
        content: "",
        embeds: [{
            title: `Alle pingen · ${event.title || "Raid"}`,
            color: COLOR,
            description: [
                `Pingt **${plan.userIds.length} Raider** aus dem Setup im Event-Kanal mit:`,
                `\`${plan.text}\``,
            ].join("\n"),
        }],
        components: [{ type: 1, components: [{ type: 2, style: 1, custom_id: pingId("c", event.id), label: "Jetzt pingen" }] }],
    };
}

/** Handle both buttons; `guildId` is the server the click came from. */
async function handlePingComponent(interaction, guildId) {
    const { field, eventId } = parsePingId(interaction.customId);
    const event = eventId ? eventStore.getEvent(eventId) : null;
    const userId = String((interaction.user && interaction.user.id) || "");
    if (field === "p") {
        const plan = event && event.guildId === guildId ? setupPingPlan(event, userId) : { error: { message: "Event nicht gefunden." } };
        const payload = plan.error ? notice(`⚠️ ${plan.error.message}`, "err") : previewMessage(event, plan);
        return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    }
    if (field === "c") {
        const member = interaction.member || {};
        const user = interaction.user || {};
        const result = await callSetupPing({ guildId, eventId, userId, byName: member.displayName || user.globalName || user.username || "" });
        return interaction.update(result.error ? notice(`⚠️ ${result.error.message}`, "err") : notice(`✅ ${result.message}`, "ok"));
    }
    return interaction.reply({ content: "Diese Aktion gibt es nicht.", flags: MessageFlags.Ephemeral });
}

module.exports = { PING_PREFIX, pingId, parsePingId, pingButtonRow, previewMessage, handlePingComponent };
