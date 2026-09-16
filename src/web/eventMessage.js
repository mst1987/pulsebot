// The bot's own signup message for an EventHelper event, in the event's channel —
// the counterpart of Raid-Helper's widget. An embed with the date and the role
// counts against the planned composition, and one "Anmelden" button.
//
// Posted when the event is created (eventCreate.js) and edited whenever its
// roster changes (signupStore.onSignupsChanged → startEventMessageSync). Where
// the message sits is remembered on the event (eventStore.setEventMessage).
//
// The button's customId is `event-signup:<eventId>`; until the signup dialog in
// Discord exists (#258) its handler answers with a link into the web
// (commands/setup/eventSignup.js).
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
const { embedAccentColor } = require("../config/variables");
const { getEvent, setEventMessage } = require("./eventStore");
const { listSignups, onSignupsChanged } = require("./signupStore");
const discord = require("./discord");

const SIGNUP_BUTTON_PREFIX = "event-signup";
const EDIT_DEBOUNCE_MS = 2000;

/** customId of the signup button under an event message. */
function signupButtonId(eventId) {
    return `${SIGNUP_BUTTON_PREFIX}:${eventId}`;
}

/**
 * How many are coming per role, and how many said otherwise.
 * @returns {{ tank: number, healer: number, dps: number, attending: number, tentative: number, bench: number, absence: number }}
 */
function rosterCounts(signups) {
    const out = { tank: 0, healer: 0, dps: 0, attending: 0, tentative: 0, bench: 0, absence: 0 };
    for (const s of signups || []) {
        const status = String((s && s.status) || "signed");
        if (status === "signed" || status === "late") {
            out.attending += 1;
            if (s.role === "tank") out.tank += 1;
            else if (s.role === "healer") out.healer += 1;
            else out.dps += 1;
        } else if (out[status] !== undefined) {
            out[status] += 1;
        }
    }
    return out;
}

/** "3 / 6" — or just "3" when nothing is planned for the role. */
function against(n, target) {
    return target > 0 ? `${n} / ${target}` : String(n);
}

/**
 * The message payload for an event and its signups (pure — no Discord call).
 * @param {object} event   an eventStore event
 * @param {object[]} signups signupStore signups
 */
function buildEventMessage(event, signups) {
    const c = rosterCounts(signups);
    const comp = event.composition || {};
    const tanks = comp.tank || 0;
    const healers = comp.healer || 0;
    const dpsTarget = event.size ? Math.max(0, event.size - tanks - healers) : 0;
    const start = Number(event.startTime) || 0;

    const lines = [];
    if (start) lines.push(`🗓️ <t:${start}:F> · <t:${start}:R>`);
    if (event.leaderId) lines.push(`Raidleitung: <@${event.leaderId}>`);
    const description = String(event.description || "").trim();
    if (description) lines.push("", description.slice(0, 1500));

    const embed = new EmbedBuilder()
        .setColor(embedAccentColor)
        .setTitle(String(event.title || "Raid").slice(0, 256))
        .setDescription(lines.join("\n") || "​")
        .addFields(
            { name: "🛡️ Tanks", value: against(c.tank, tanks), inline: true },
            { name: "💚 Heiler", value: against(c.healer, healers), inline: true },
            { name: "⚔️ DD", value: against(c.dps, dpsTarget), inline: true },
        );
    const other = [
        c.tentative ? `${c.tentative} vorläufig` : "",
        c.bench ? `${c.bench} Ersatzbank` : "",
        c.absence ? `${c.absence} abgemeldet` : "",
    ].filter(Boolean);
    const footer = [`${event.size ? against(c.attending, event.size) : c.attending} angemeldet`, ...other];
    embed.setFooter({ text: footer.join(" · ") });
    if (event.signupDeadline) {
        embed.addFields({ name: "Anmeldeschluss", value: `<t:${event.signupDeadline}:F>`, inline: false });
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(signupButtonId(event.id)).setLabel("Anmelden").setStyle(ButtonStyle.Primary),
    );
    return { content: "", embeds: [embed], components: [row] };
}

async function textChannel(channelId) {
    const client = discord.getClient();
    if (!client) throw new Error("Bot nicht verbunden.");
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) throw new Error("Channel nicht gefunden oder kein Textkanal.");
    return channel;
}

/**
 * Post the event's message into its channel and remember where it sits.
 * @returns {Promise<{ channelId: string, messageId: string }>}
 */
async function postEventMessage(eventId) {
    const event = getEvent(eventId);
    if (!event) throw new Error("Event nicht gefunden.");
    const channel = await textChannel(event.channelId);
    const posted = await channel.send(buildEventMessage(event, listSignups(event.id)));
    const where = { channelId: channel.id, messageId: posted.id };
    setEventMessage(event.id, where);
    return where;
}

/**
 * Bring the event's message up to date: edit it in place, or post it anew when
 * there is none yet or it was deleted in Discord.
 * @returns {Promise<{ channelId: string, messageId: string, reposted: boolean }|null>} null for an unknown event
 */
async function refreshEventMessage(eventId) {
    const event = getEvent(eventId);
    if (!event) return null;
    if (event.message) {
        try {
            const channel = await textChannel(event.message.channelId);
            const message = await channel.messages.fetch(event.message.messageId);
            await message.edit(buildEventMessage(event, listSignups(event.id)));
            return { ...event.message, reposted: false };
        } catch (e) {
            // A message deleted by hand is re-posted; anything else is reported.
            if (!(e && (e.code === 10008 || /unknown message/i.test(e.message || "")))) throw e;
        }
    }
    const where = await postEventMessage(event.id);
    return { ...where, reposted: true };
}

const pending = new Map();
let unsubscribe = null;

/**
 * Keep every event message current: a roster change schedules one edit per
 * event, a burst of changes within EDIT_DEBOUNCE_MS collapses into one.
 * Idempotent; returns the stop function.
 */
function startEventMessageSync({ debounceMs = EDIT_DEBOUNCE_MS } = {}) {
    if (unsubscribe) return unsubscribe;
    const off = onSignupsChanged((eventId) => {
        clearTimeout(pending.get(eventId));
        const timer = setTimeout(() => {
            pending.delete(eventId);
            refreshEventMessage(eventId).catch((e) => console.error(`[eventMessage] ${eventId}:`, e.message));
        }, debounceMs);
        if (timer.unref) timer.unref();
        pending.set(eventId, timer);
    });
    unsubscribe = () => {
        off();
        for (const t of pending.values()) clearTimeout(t);
        pending.clear();
        unsubscribe = null;
    };
    return unsubscribe;
}

module.exports = {
    SIGNUP_BUTTON_PREFIX, signupButtonId, rosterCounts, buildEventMessage,
    postEventMessage, refreshEventMessage, startEventMessageSync,
};
