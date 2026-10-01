// Who is in which Kader right now (docs/kaderplaner.md, "Live"). Every open
// Kader page reports itself with its poll (GET /api/kader/live): which Kader,
// which page, and the player whose interview, discussion or account dialog is
// open. The answer names everybody else in the same Kader of the same server.
//
// In memory only — the bot runs as one process (ecosystem.config.js), nothing
// is written to disk or logged. An entry holds the user id and display name,
// the Kader, the page, the player, whether it is being edited and when it was
// last seen; it is gone TTL_MS after the last poll (a closed tab, a lost
// network) or at once when the page leaves. One person in several tabs counts
// once (the newest tab wins).
const TTL_MS = 25000;
/** A safety cap: an entry per open tab; the oldest goes first when it is reached. */
const MAX_ENTRIES = 2000;
const SUBS = ["pool", "vorauswahl", "uebersicht", "roster", "fragen", "setups"];
const WHATS = ["interview", "drawer", "account"];
const ID = /^[\w-]{1,40}$/;

const entries = new Map();

const clean = (v) => (typeof v === "string" && ID.test(v) ? v : "");
const keyOf = (guildId, userId, tab) => `${guildId}|${userId}|${tab}`;

function prune(now) {
    for (const [k, e] of entries) if (now - e.at > TTL_MS) entries.delete(k);
}

/**
 * Notes a page: `{ guildId, kaderId, userId, name, tab, sub, playerId, what, edit }`.
 * Anything malformed is dropped (an unknown page, an id that is no id); without
 * a tab id nothing is noted.
 */
function beat(input, now = Date.now()) {
    const tab = clean(input.tab);
    const kaderId = clean(input.kaderId);
    const userId = String(input.userId || "");
    if (!tab || !kaderId || !userId) return;
    const key = keyOf(input.guildId, userId, tab);
    if (!entries.has(key) && entries.size >= MAX_ENTRIES) {
        prune(now);
        if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value);
    }
    const playerId = clean(input.playerId);
    const what = playerId && WHATS.includes(input.what) ? input.what : "";
    entries.set(key, {
        guildId: String(input.guildId || ""),
        kaderId,
        userId,
        name: String(input.name || "").slice(0, 60),
        sub: SUBS.includes(input.sub) ? input.sub : "",
        playerId: what ? playerId : "",
        what,
        edit: !!what && input.edit === true,
        at: now,
    });
}

/** The page of one tab is gone (it left the Kader or closed). */
function leave({ guildId, userId, tab }) {
    entries.delete(keyOf(guildId, String(userId || ""), clean(tab)));
}

/**
 * Everybody in one Kader of one server except `except` (the caller), one
 * entry per person (their newest tab), sorted by name:
 * `[{ userId, name, sub, playerId, what, edit }]`.
 */
function present({ guildId, kaderId, except = "" }, now = Date.now()) {
    prune(now);
    const byUser = new Map();
    for (const e of entries.values()) {
        if (e.guildId !== String(guildId || "") || e.kaderId !== kaderId || e.userId === except) continue;
        const known = byUser.get(e.userId);
        if (!known || e.at > known.at) byUser.set(e.userId, e);
    }
    return [...byUser.values()]
        .sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId))
        .map(({ userId, name, sub, playerId, what, edit }) => ({ userId, name, sub, playerId, what, edit }));
}

/** Tests: forget everybody. */
function reset() {
    entries.clear();
}

module.exports = { TTL_MS, MAX_ENTRIES, beat, leave, present, reset };
