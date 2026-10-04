// The small, shared bottom layer of an own event's setup (#424): what the
// setup message, its Discord buttons, the ping and the editor all read. Pure —
// no store, no Discord client, and no require back into any setup module, so
// the layers stay one-way:
//
//   setupCore  <-  setupEditor / setupPing / inviteCall / setupMessage  <-  *Bot.js
//
// A *Bot.js module (the button handlers) may require everything below it; the
// setup message never requires a *Bot.js — it builds its button row from here.
//
// Its texts sit on the public setup message, so they take the server language
// (the caller passes it: services/discord/botLanguage.js `serverLang`).
const { tr, normalizeLang } = require("../../utils/i18n/botText");

// The button labels as de/en pairs ("Cancel" is "Absagen" here, not the "Abbrechen" of a dialog).
const BUTTON_LABELS = {
    confirm: { de: "Bestätigen", en: "Confirm" },
    cancel: { de: "Absagen", en: "Cancel" },
    invite: { de: "Invites callen", en: "Call invites" },
    ping: { de: "Alle pingen", en: "Ping everyone" },
};
const buttonLabel = (lang, key) => BUTTON_LABELS[key][normalizeLang(lang)];

// ---- the approved lineup ------------------------------------------------------

/** The last approved lineup of an event, or null. Never a draft. */
function approvedSetupOf(event) {
    const setup = event && event.setup;
    return setup && setup.approved && Array.isArray(setup.approved.groups) ? setup.approved : null;
}

/**
 * The explicit bench and the pool ("Angemeldet") of a stored setup (#517). A
 * setup stored before #517 has no `pool`: its bench was everybody left over, so
 * there only the entries the orga locked count as the explicit bench and the
 * rest is the pool.
 */
function benchAndPool(setup) {
    const bench = Array.isArray(setup && setup.bench) ? setup.bench.filter(Boolean) : [];
    if (setup && Array.isArray(setup.pool)) return { bench, pool: setup.pool.filter(Boolean) };
    return { bench: bench.filter((b) => b.locked), pool: bench.filter((b) => !b.locked).map((b) => ({ ...b, locked: false })) };
}

/**
 * Whether the setup message and its DMs carry the bench (#517): the orga's last
 * choice when posting ("Bench mitposten"), off by default. The pool is never posted.
 */
function benchPosted(event) {
    return !!(event && event.setupPost && event.setupPost.bench === true);
}

// ---- "Ping everyone" ------------------------------------------------------------

/** The line everyone reads without the orga ever setting their own — in English here, tr() gives the server language. */
const PING_TEXT = "📋 The setup is up — you're in!";
// Kept in sync with eventStore.js's setEventSetupPingText.
const PING_TEXT_MAX = 300;

/** The orga's own text if they set one (web or the Discord modal), else the default in the language. */
function pingTextOf(event, lang = "de") {
    return (event && event.setupPingText) || tr(lang, PING_TEXT);
}

// ---- Confirm / Cancel ---------------------------------------------------------

const CONFIRM_STATUSES = ["confirmed", "declined"];

/**
 * The confirmations of everybody placed in a group of the approved lineup,
 * plain `{ userId: status }`. A confirmation is the raider's (or the orga's)
 * answer for the evening, not for one version: it stays through every later
 * change of the setup, a move to another group included. Who is no longer in
 * a group has none shown — and gets it back on their return.
 */
function confirmationsFor(event, approved) {
    if (!approved) return {};
    const stored = (event && event.setupPost && event.setupPost.confirmations) || {};
    const placed = new Set((approved.groups || []).flatMap((g) => (g.slots || []).map((s) => String(s.userId))));
    const out = {};
    for (const [userId, entry] of Object.entries(stored)) {
        if (entry && CONFIRM_STATUSES.includes(entry.status) && placed.has(userId)) out[userId] = entry.status;
    }
    return out;
}

// ---- the button row under the setup message -------------------------------------

const CONFIRM_PREFIX = "setup-confirm";
const INVITE_PREFIX = "invite-call";
const PING_PREFIX = "setup-ping";

const confirmId = (field, eventId) => `${CONFIRM_PREFIX}:${field}:${eventId}`;
const inviteId = (field, eventId) => `${INVITE_PREFIX}:${field}:${eventId}`;
const pingId = (eventId) => `${PING_PREFIX}:${eventId}`;

/** Confirm / Cancel (setupConfirmBot.js) — every raider reads it, so it is in the server language. */
function confirmButtonRow(eventId, lang = "de") {
    return {
        type: 1,
        components: [
            { type: 2, style: 3, custom_id: confirmId("y", eventId), label: buttonLabel(lang, "confirm") },
            { type: 2, style: 4, custom_id: confirmId("n", eventId), label: buttonLabel(lang, "cancel") },
        ],
    };
}

/**
 * "Call invites" (inviteCallBot.js). The label sits on a message every raider
 * reads, so it is in the server language; the private preview behind it is the
 * orga's and stays German, like the other orga texts in the bot.
 */
function inviteButtonRow(eventId, lang = "de") {
    return { type: 1, components: [{ type: 2, style: 2, custom_id: inviteId("p", eventId), label: buttonLabel(lang, "invite"), emoji: { name: "📣" } }] };
}

/** "Ping everyone" (setupPingBot.js), beside "Call invites". */
function pingButtonRow(eventId, lang = "de") {
    return { type: 1, components: [{ type: 2, style: 2, custom_id: pingId(eventId), label: buttonLabel(lang, "ping") }] };
}

module.exports = {
    approvedSetupOf, benchAndPool, benchPosted,
    PING_TEXT, PING_TEXT_MAX, pingTextOf,
    CONFIRM_STATUSES, confirmationsFor,
    CONFIRM_PREFIX, INVITE_PREFIX, PING_PREFIX, confirmId, inviteId, pingId,
    confirmButtonRow, inviteButtonRow, pingButtonRow,
};
