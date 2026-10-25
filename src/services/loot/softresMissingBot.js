// "Who is missing?" on the softres card (Oct 2026, softresStatus.js draws the
// button). Everybody may click it: the answer is an ephemeral card "N still
// missing" with the names, read fresh from softres.it — the card in the channel
// is brought up to date on the way. Under the names "Ping now" pings them in the
// event channel; that one is the orga's only.
//
//   softres-missing:<eventId>   the button on the softres card → the list (everyone)
//   softres-ping:<eventId>      "Ping now" under the list → the ping (the orga,
//                               access as "Fehlende pingen": accessOf "event")
//
// The list goes to exactly one person, so "Ping now" is only on it when the clicker
// passes the same Bot-Befehle rule the router checks for the ping button (`mayPing`);
// the router (botAccess.guardInteraction) still guards the click itself. Against a double ping: the list's buttons go at once, one ping per
// event runs at a time, and a second one within two minutes is refused.
// The list is a raider text (tr + eventLang), the ping's answers are orga texts
// and stay German; the ping in the channel speaks the event's language.
const { ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const { card } = require("../../utils/discord/card");
const { getEventSoftres } = require("../../stores/eventSoftresStore");
const discord = require("../discord/discord");
const { eventLang } = require("../discord/botLanguage");
const { tr } = require("../../utils/i18n/botText");
const { eventVersionTag } = require("../events/versionTag");
const { ruleFor, resolveBotAccess, eventMemberRoles, eventGuildId } = require("../discord/botAccess");
const { getConfig } = require("../../stores/configStore");
const { SOFTRES_MISSING_PREFIX, SOFTRES_PING_PREFIX, resolveEvent, readStatus, refreshSoftresCard } = require("./softresStatus");

/** Own events (eh-…) and Raid-Helper events (numeric ids). */
const EVENT_ID = /^(eh-[a-z0-9]{1,40}|\d{1,25})$/;
/** Names shown in the list; the rest is "+N more". */
const MAX_NAMES = 25;
/** A second ping of the same event within this window is refused. */
const COOLDOWN_MS = 2 * 60 * 1000;

// Events whose ping is being posted right now, and the last ping per event (one process).
const inFlight = new Set();
const lastPing = new Map();

function resetCooldowns() {
    inFlight.clear();
    lastPing.clear();
}

/** The event id of a customId, "" when it names none. */
function parseEventId(customId) {
    const [, eventId = ""] = String(customId || "").split(":");
    return EVENT_ID.test(eventId) ? eventId : "";
}

/** A name as plain text — no markdown or mention sneaking in. */
const plain = (text) => String(text || "").replace(/([\\*_~`|>[\]()#-])/g, "\\$1").replace(/@/g, "@\u200b");

/** The small line above the heading: the raid and its start, short. */
function kickerOf(event) {
    const start = Number(event && event.startTime) || 0;
    return [event && event.title, start ? `<t:${start}:d> <t:${start}:t>` : "", eventVersionTag(event)].filter(Boolean).join(" · ");
}

function namesLine(missing, lang) {
    const names = missing.slice(0, MAX_NAMES).map((m) => plain(m.label || m.userId));
    const rest = missing.length - names.length;
    return `${names.join(" · ")}${rest > 0 ? `\n${tr(lang, "+{count} more", { count: rest })}` : ""}`;
}

const answer = (spec) => card({ ...spec, ephemeral: true });
/** An edit cannot change whether a message is ephemeral, so the flag stays out. */
const asEdit = (payload) => ({ ...payload, flags: payload.flags & ~MessageFlags.Ephemeral });

/** Why there is no count, for the raider. */
function noCountText(status, lang) {
    if (status.reason === "hidden") return tr(lang, "The soft reserves of this list are hidden — the bot cannot see who has entered.");
    if (status.reason === "nobody_expected") return tr(lang, "Nobody is signed up for this raid yet.");
    if (status.reason === "no_softres") return tr(lang, "This raid has no softres list.");
    return tr(lang, "softres.it cannot be reached right now — please try again later.");
}

/**
 * Whether the clicker may press "Ping now": the rule of the ping button (accessOf "event"),
 * resolved like botAccess.guardInteraction does. Never throws — on doubt the button stays away.
 */
async function mayPing(interaction) {
    try {
        const config = getConfig();
        const commands = (interaction.client && interaction.client.commands) || (discord.getClient && (discord.getClient() || {}).commands);
        const rule = ruleFor(SOFTRES_PING_PREFIX, { commands, config });
        if (rule.mode === "everyone") return true;
        const userId = String(interaction.user && interaction.user.id);
        const roleIds = await eventMemberRoles(interaction, eventGuildId(config));
        return resolveBotAccess(SOFTRES_PING_PREFIX, { id: userId, roleIds }, { commands, config }).allowed;
    } catch {
        return false;
    }
}

/** The list a click on "Who is missing?" answers with; `canPing` = the clicker is orga. */
function missingCard(event, status, lang, canPing = false) {
    const kicker = kickerOf(event);
    if (!status.ok) return answer({ kind: "info", kicker, title: tr(lang, "No count available"), text: noCountText(status, lang) });
    const n = status.missing.length;
    if (!n) return answer({ kind: "ok", kicker, title: tr(lang, "Everyone has entered their soft reserves"), text: `${status.filled} / ${status.expected}` });
    return answer({
        kind: "warn",
        kicker,
        title: n === 1 ? tr(lang, "1 still missing") : tr(lang, "{n} still missing", { n }),
        text: namesLine(status.missing, lang),
        ...(canPing
            ? { buttons: [new ButtonBuilder().setCustomId(`${SOFTRES_PING_PREFIX}:${event.id}`).setLabel(tr(lang, "Ping now")).setStyle(ButtonStyle.Primary)] }
            : { note: tr(lang, "Only the orga can ping them.") }),
    });
}

/** An error answer; with `lang` (the raider's "Who is missing?") the title is translated, the ping's orga answers stay German. */
const errorCard = (event, message, lang) => answer({
    kind: "error", kicker: event ? kickerOf(event) : "", title: lang ? tr(lang, "Not possible right now") : "Geht gerade nicht", text: message,
});

/** "Who is missing?": defer first (softres.it is a web request), then the list. */
async function showMissing(interaction, eventId, event) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const lang = eventLang(event);
    const status = await readStatus(eventId, { event });
    await refreshSoftresCard(eventId, { status });
    const canPing = status.ok && status.missing.length > 0 ? await mayPing(interaction) : false;
    return interaction.editReply(asEdit(missingCard(event, status, lang, canPing)));
}

/** "Ping now": the buttons go at once, then a fresh read, then the ping in the event channel. */
async function confirmPing(interaction, eventId, event, now = Date.now()) {
    const last = lastPing.get(eventId);
    if ((last && now - last.at < COOLDOWN_MS) || inFlight.has(eventId)) {
        const when = last ? ` <t:${Math.floor(last.at / 1000)}:R>` : " gerade";
        return interaction.update(asEdit(answer({
            kind: "warn", kicker: kickerOf(event), title: "Schon gepingt",
            text: `Die Fehlenden wurden${when} an Softres erinnert — nicht noch einmal.`,
        })));
    }
    inFlight.add(eventId);
    try {
        await interaction.update(asEdit(answer({ kind: "info", kicker: kickerOf(event), title: "Pinge die Fehlenden …" })));
        const status = await readStatus(eventId, { event });
        if (!status.ok) return interaction.editReply(asEdit(errorCard(event, "Die Softres-Liste lässt sich gerade nicht auszählen.")));
        if (!status.missing.length) {
            return interaction.editReply(asEdit(answer({ kind: "ok", kicker: kickerOf(event), title: "Alle haben eingetragen", text: "Kein Ping nötig." })));
        }
        const sr = getEventSoftres(eventId);
        const text = tr(eventLang(event), "Please enter your soft reserves: {url}", { url: (sr && sr.url) || "" });
        await discord.postMissingPing(event.channelId, status.missing.map((m) => m.userId), text);
        lastPing.set(eventId, { at: now });
        await refreshSoftresCard(eventId, { status });
        const n = status.missing.length;
        return interaction.editReply(asEdit(answer({
            kind: "ok", kicker: kickerOf(event), title: n === 1 ? "1 Raider gepingt" : `${n} Raider gepingt`,
            text: event.channelId ? `Im Event-Kanal <#${event.channelId}>.` : "",
        })));
    } catch (e) {
        // Some chunks went out before the error: that was a ping, the cooldown holds.
        if (e && Array.isArray(e.sentMessageIds) && e.sentMessageIds.length) lastPing.set(eventId, { at: now });
        return interaction.editReply(asEdit(errorCard(event, e.message)));
    } finally {
        inFlight.delete(eventId);
    }
}

/** Both buttons; `guildId` is the event server the click came from (componentRoute). */
async function handleSoftresComponent(interaction, guildId) {
    const isPing = String(interaction.customId || "").startsWith(`${SOFTRES_PING_PREFIX}:`);
    const eventId = parseEventId(interaction.customId);
    const { event } = eventId ? resolveEvent(eventId) : { event: null };
    if (!event || (event.guildId && event.guildId !== guildId)) {
        if (isPing) return interaction.update(asEdit(errorCard(null, "Das Event gibt es nicht (mehr) oder es gehört zu einem anderen Server.")));
        // "Who is missing?" is a raider's click: the answer in the bot's language.
        const lang = eventLang(event);
        return interaction.reply(errorCard(null, tr(lang, "This event no longer exists or belongs to another server."), lang));
    }
    const ev = { ...event, id: eventId };
    return isPing ? confirmPing(interaction, eventId, ev) : showMissing(interaction, eventId, ev);
}

module.exports = {
    SOFTRES_MISSING_PREFIX, SOFTRES_PING_PREFIX, handleSoftresComponent,
    // only for the tests: not part of the module's API
    _internal: { parseEventId, namesLine, missingCard, mayPing, resetCooldowns, inFlight, lastPing, MAX_NAMES, COOLDOWN_MS },
};
