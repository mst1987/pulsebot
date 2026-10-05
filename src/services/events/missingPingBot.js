// "Fehlende pingen" under the signup message (Oct 2026): the orga's button at the
// end of the status row (eventMessage.js draws it only for a category with
// raider roles). A click shows who is missing first — ephemerally, only to the
// one who clicked — and pings only after "Jetzt pingen".
//
//   event-missing:<eventId>       the button on the signup message → the preview
//   event-missing:<eventId>:go    "Jetzt pingen" → the ping in the event channel
//   event-missing:<eventId>:no    "Abbrechen"
//
// Who is missing is missingPing.findMissingRaiders — the same derivation as the
// raid detail's "Fehlende pingen" and "Event verwalten" (role holders of the
// category without a reaction to the event); the ping itself is
// missingPing.pingMissingRaiders with target "event" (discord.postMissingPing,
// a card with the mentions). It re-derives the list, so a raider who signed up
// between the preview and the click is not pinged.
//
// Access is `/event`'s (accessOf in commands/event/missingPingButton.js): the
// orga, checked by the router on every click (botAccess.guardInteraction) —
// a component cannot be hidden per viewer, so everyone sees the button and a
// raider is told no.
//
// Against a double ping: "Jetzt pingen" first replaces the preview by a card
// without buttons, one ping per event runs at a time, and a ping logged on the
// event (`action: "ping"`, also Event verwalten's) in the last two minutes
// refuses another one. The answers are orga texts and stay German.
const { ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const eventStore = require("../../stores/eventStore");
const { card } = require("../../utils/discord/card");
const { findMissingRaiders, pingMissingRaiders } = require("./missingPing");
const { MISSING_PREFIX } = require("./eventMessage");

const EVENT_ID = /^eh-[a-z0-9]{1,40}$/;
/** Names shown in the preview; the rest is "+N weitere". */
const MAX_NAMES = 25;
/** A second ping of the same event within this window is refused. */
const COOLDOWN_MS = 2 * 60 * 1000;

// Events whose ping is being posted right now (one process — the bot is one).
const inFlight = new Set();

/** `{ eventId, step }` — eventId "" when the customId names no own event; step "", "go" or "no". */
function parseMissingId(customId) {
    const [, eventId = "", step = ""] = String(customId || "").split(":");
    return { eventId: EVENT_ID.test(eventId) ? eventId : "", step };
}

const stepId = (eventId, step) => [MISSING_PREFIX, eventId, step].filter(Boolean).join(":");

/** A name as plain text — no markdown or mention sneaking in. */
const plain = (text) => String(text || "").replace(/([\\*_~`|>[\]()#-])/g, "\\$1").replace(/@/g, "@\u200b");

/** The small line above the heading: the raid and its start, short. */
function kickerOf(event) {
    const start = Number(event && event.startTime) || 0;
    return [event && event.title, start ? `<t:${start}:d> <t:${start}:t>` : ""].filter(Boolean).join(" · ");
}

/** The names, the first MAX_NAMES of them, then "+N weitere". */
function namesLine(missing) {
    const names = missing.slice(0, MAX_NAMES).map((m) => plain(m.displayName || m.id));
    const rest = missing.length - names.length;
    return `${names.join(" · ")}${rest > 0 ? `\n+${rest} weitere` : ""}`;
}

/** The card a click answers with, ephemeral. */
const answer = (spec) => card({ ...spec, ephemeral: true });

/** The same card as an edit: an edit cannot change whether a message is ephemeral, so the flag stays out. */
const asEdit = (payload) => ({ ...payload, flags: payload.flags & ~MessageFlags.Ephemeral });

/** The preview: who is missing, how many, and the two buttons. */
function previewCard(event, missing) {
    const n = missing.length;
    return answer({
        kind: "warn",
        kicker: kickerOf(event),
        title: n === 1 ? "1 Raider fehlt" : `${n} Raider fehlen`,
        text: namesLine(missing),
        buttons: [
            new ButtonBuilder().setCustomId(stepId(event.id, "go")).setLabel("Jetzt pingen").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(stepId(event.id, "no")).setLabel("Abbrechen").setStyle(ButtonStyle.Secondary),
        ],
        note: "Raider-Rolle der Kategorie, aber keine Reaktion auf den Raid · gepingt wird im Event-Kanal",
    });
}

const allThereCard = (event) => answer({
    kind: "ok", kicker: kickerOf(event), title: "Alle haben reagiert", text: "Niemand mit Raider-Rolle fehlt — kein Ping nötig.",
});

const errorCard = (event, message) => answer({ kind: "error", kicker: event ? kickerOf(event) : "", title: "Geht gerade nicht", text: message });

/** The last ping of the event within COOLDOWN_MS (its log entry), else null. */
function recentPing(event, now = Date.now()) {
    const log = Array.isArray(event && event.log) ? event.log : [];
    return log.filter((l) => l && l.action === "ping" && now - Number(l.at) < COOLDOWN_MS).pop() || null;
}

/** Who acts, as the event log names them. */
function actorOf(interaction) {
    const user = interaction.user || {};
    const member = interaction.member || {};
    return { by: String(user.id || ""), byName: member.displayName || user.globalName || user.username || "" };
}

/** The button on the signup message: defer (the member list can take a while), then the preview. */
async function showPreview(interaction, guildId, event) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const found = await findMissingRaiders({ guildId, eventId: event.id });
    if (found.error) return interaction.editReply(asEdit(errorCard(event, found.error.message)));
    if (!found.missing.length) return interaction.editReply(asEdit(allThereCard(event)));
    return interaction.editReply(asEdit(previewCard(event, found.missing)));
}

/** "Jetzt pingen": the buttons go at once, then the ping, then how it went. */
async function confirmPing(interaction, guildId, event, now = Date.now()) {
    const last = recentPing(event, now);
    if (last || inFlight.has(event.id)) {
        const when = last ? ` <t:${Math.floor(Number(last.at) / 1000)}:R>` : " gerade";
        return interaction.update(asEdit(answer({
            kind: "warn", kicker: kickerOf(event), title: "Schon gepingt",
            text: `Die Fehlenden wurden${when} gepingt${last && last.byName ? ` (von ${plain(last.byName)})` : ""} — nicht noch einmal.`,
        })));
    }
    inFlight.add(event.id);
    try {
        await interaction.update(asEdit(answer({ kind: "info", kicker: kickerOf(event), title: "Pinge die Fehlenden …" })));
        const result = await pingMissingRaiders({ guildId, eventId: event.id, target: "event" });
        if (result.error) return interaction.editReply(asEdit(errorCard(event, result.error.message)));
        if (!result.count) return interaction.editReply(asEdit(allThereCard(event)));
        const actor = actorOf(interaction);
        eventStore.appendEventLog(event.id, { action: "ping", ...actor, detail: `${result.count} Raider · Anmelde-Nachricht` });
        return interaction.editReply(asEdit(answer({
            kind: "ok", kicker: kickerOf(event), title: `${result.count} Raider gepingt`,
            text: event.channelId ? `Im Event-Kanal <#${event.channelId}>.` : "",
        })));
    } finally {
        inFlight.delete(event.id);
    }
}

/** Every click of the three; `guildId` is the event server the click came from (componentRoute). */
async function handleMissingComponent(interaction, guildId) {
    const { eventId, step } = parseMissingId(interaction.customId);
    const event = eventId ? eventStore.getEvent(eventId) : null;
    if (!event || event.guildId !== guildId) {
        const gone = errorCard(null, "Das Event gibt es nicht (mehr) oder es gehört zu einem anderen Server.");
        return step ? interaction.update(asEdit(gone)) : interaction.reply(gone);
    }
    if (step === "no") {
        return interaction.update(asEdit(answer({ kind: "info", kicker: kickerOf(event), title: "Abgebrochen", text: "Niemand wurde gepingt." })));
    }
    if (step === "go") return confirmPing(interaction, guildId, event);
    return showPreview(interaction, guildId, event);
}

module.exports = {
    MISSING_PREFIX, handleMissingComponent,
    // only for the tests: not part of the module's API
    _internal: { parseMissingId, namesLine, previewCard, recentPing, inFlight, MAX_NAMES, COOLDOWN_MS },
};
