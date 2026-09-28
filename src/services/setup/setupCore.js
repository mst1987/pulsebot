// The small, shared bottom layer of an own event's setup (#424): what the
// setup message, its Discord buttons, the ping and the editor all read. Pure —
// no store, no Discord client, and no require back into any setup module, so
// the layers stay one-way:
//
//   setupCore  <-  setupEditor / setupPing / inviteCall / setupMessage  <-  *Bot.js
//
// A *Bot.js module (the button handlers) may require everything below it; the
// setup message never requires a *Bot.js — it builds its button row from here.

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

/** The line everyone reads without the orga ever setting their own — raider-facing, so English. */
const PING_TEXT = "📋 The setup is up — you're in!";
// Kept in sync with eventStore.js's setEventSetupPingText.
const PING_TEXT_MAX = 300;

/** The orga's own text if they set one (web or the Discord modal), else the default. */
function pingTextOf(event) {
    return (event && event.setupPingText) || PING_TEXT;
}

// ---- Confirm / Cancel ---------------------------------------------------------

/** The confirmations of the currently approved version, plain `{ userId: status }`. */
function confirmationsFor(event, approved) {
    if (!approved) return {};
    const stored = (event && event.setupPost && event.setupPost.confirmations) || {};
    const out = {};
    for (const [userId, entry] of Object.entries(stored)) {
        if (entry && Number(entry.version) === Number(approved.version)) out[userId] = entry.status;
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

/** Confirm / Cancel (setupConfirmBot.js) — every raider reads it, so it is English. */
function confirmButtonRow(eventId) {
    return {
        type: 1,
        components: [
            { type: 2, style: 3, custom_id: confirmId("y", eventId), label: "Confirm" },
            { type: 2, style: 4, custom_id: confirmId("n", eventId), label: "Cancel" },
        ],
    };
}

/**
 * "Call invites" (inviteCallBot.js). The label sits on a message every raider
 * reads, so it is English; the private preview behind it is the orga's and
 * stays German, like the other orga texts in the bot.
 */
function inviteButtonRow(eventId) {
    return { type: 1, components: [{ type: 2, style: 2, custom_id: inviteId("p", eventId), label: "Call invites", emoji: { name: "📣" } }] };
}

/** "Ping everyone" (setupPingBot.js), beside "Call invites". */
function pingButtonRow(eventId) {
    return { type: 1, components: [{ type: 2, style: 2, custom_id: pingId(eventId), label: "Ping everyone" }] };
}

module.exports = {
    approvedSetupOf, benchAndPool, benchPosted,
    PING_TEXT, PING_TEXT_MAX, pingTextOf,
    confirmationsFor,
    CONFIRM_PREFIX, INVITE_PREFIX, PING_PREFIX, confirmId, inviteId, pingId,
    confirmButtonRow, inviteButtonRow, pingButtonRow,
};
