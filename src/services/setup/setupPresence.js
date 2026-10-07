// Who is in an event's setup editor right now, and what they just did — so two
// orga members working on one setup see each other (October 2026). In memory
// only, nothing is stored: every open editor sends a heartbeat every few
// seconds (POST /api/raids/setup/presence, raids write) with what it is doing —
// dragging or picking a raider, or editing a raider's signup — and drops out
// PRESENCE_TTL_MS after its last one. What a raider is held for is a soft lock:
// the other editors draw it and do not let it be taken, the server enforces
// nothing (the version check of the save still does).
//
// The activity is a short list per event of what changed and by whom ("Taccop
// hat Cherrylol in Gruppe 2 gesetzt"), written by the routes after a save, a
// fill or a post — the other editors show it and flash the raider who moved.
// Raiders never see any of it: every route is raids write.
const PRESENCE_TTL_MS = 15 * 1000;
const ACTIVITY_MAX = 20;
const ACTIVITY_TTL_MS = 10 * 60 * 1000;
/** More single moves than this in one change read as one line ("hat 12 Raider verschoben"). */
const MOVES_PER_ENTRY = 4;
const ACTION_KINDS = ["drag", "edit"];

/** eventId → Map(userId → { userId, name, seen, action }) */
const present = new Map();
/** eventId → [{ id, at, by, byName, kind, … }], newest last */
const activity = new Map();
let seq = 0;

const str = (v) => (v === undefined || v === null ? "" : String(v));

/** `{ kind: "drag"|"edit", userId }` or null — anything else from the page is dropped. */
function cleanAction(raw) {
    if (!raw || typeof raw !== "object" || !ACTION_KINDS.includes(raw.kind)) return null;
    const userId = str(raw.userId).trim();
    if (!userId || userId.length > 40) return null;
    return { kind: raw.kind, userId };
}

function prune(eventId, now) {
    const map = present.get(eventId);
    if (!map) return;
    for (const [id, p] of map) if (now - p.seen > PRESENCE_TTL_MS) map.delete(id);
    if (!map.size) present.delete(eventId);
}

/** A heartbeat: `user` is in the event's editor, doing `action` (or nothing in particular). */
function beat(eventId, user, { action = null, now = Date.now() } = {}) {
    const id = str(eventId);
    const userId = str(user && user.id);
    if (!id || !userId) return;
    if (!present.has(id)) present.set(id, new Map());
    present.get(id).set(userId, { userId, name: str(user.name) || userId, seen: now, action: cleanAction(action) });
    prune(id, now);
}

/** The editor was closed: gone at once instead of after the TTL. */
function leave(eventId, userId) {
    const map = present.get(str(eventId));
    if (!map) return;
    map.delete(str(userId));
    if (!map.size) present.delete(str(eventId));
}

/** Everybody in the event's editor right now, `exceptUserId` left out — oldest first, so the order stays put. */
function editorsOf(eventId, { exceptUserId = "", now = Date.now() } = {}) {
    const id = str(eventId);
    prune(id, now);
    const map = present.get(id);
    if (!map) return [];
    return [...map.values()]
        .filter((p) => p.userId !== str(exceptUserId))
        .map((p) => ({ userId: p.userId, name: p.name, action: p.action }));
}

/** Where a raider stands in a lineup: "g<index>", "bench", or nothing (= "Angemeldet"). */
function placesOf(setup) {
    const out = new Map();
    if (!setup) return out;
    for (const g of setup.groups || []) for (const s of g.slots || []) out.set(str(s.userId), { at: `g${g.index}`, group: Number(g.index), character: str(s.character) });
    for (const b of setup.bench || []) if (!out.has(str(b.userId))) out.set(str(b.userId), { at: "bench", character: str(b.character) });
    return out;
}

function push(eventId, entry, now) {
    const id = str(eventId);
    const list = (activity.get(id) || []).filter((e) => now - e.at <= ACTIVITY_TTL_MS);
    list.push({ id: ++seq, at: now, ...entry });
    activity.set(id, list.slice(-ACTIVITY_MAX));
}

/**
 * After a change of the lineup: who went where, as one entry per raider (at most
 * MOVES_PER_ENTRY, else one "moved n raiders" entry). A raider only out of the
 * bench of an old setup's pool is no move. `names` (userId → character) helps a
 * raider who left the setup: the new lineup no longer knows their character.
 */
function recordMoves(eventId, before, after, { by, byName, names = {}, now = Date.now() } = {}) {
    const was = placesOf(before);
    const is = placesOf(after);
    const moves = [];
    for (const userId of new Set([...was.keys(), ...is.keys()])) {
        const from = was.get(userId);
        const to = is.get(userId);
        if ((from && from.at) === (to && to.at)) continue;
        const character = (to && to.character) || (from && from.character) || str(names[userId]);
        moves.push({ userId, character, to: to ? (to.at === "bench" ? { bench: true } : { group: to.group }) : { pool: true } });
    }
    if (!moves.length) return [];
    const who = { by: str(by), byName: str(byName) };
    if (moves.length > MOVES_PER_ENTRY) {
        push(eventId, { ...who, kind: "many", count: moves.length, userIds: moves.map((m) => m.userId) }, now);
    } else {
        for (const m of moves) push(eventId, { ...who, kind: "move", ...m }, now);
    }
    return moves;
}

/** A change that is no single move: "fill" (Freie Plätze füllen), "propose" (alles neu), "post". */
function recordNote(eventId, kind, { by, byName, count = 0, now = Date.now() } = {}) {
    push(eventId, { by: str(by), byName: str(byName), kind, ...(count ? { count } : {}) }, now);
}

/** The activity of the last minutes, newest last; `since` = the last id the page has. */
function activityOf(eventId, { since = 0, now = Date.now() } = {}) {
    return (activity.get(str(eventId)) || []).filter((e) => e.id > Number(since || 0) && now - e.at <= ACTIVITY_TTL_MS);
}

function _resetForTests() {
    present.clear();
    activity.clear();
    seq = 0;
}

module.exports = {
    PRESENCE_TTL_MS, ACTIVITY_MAX, MOVES_PER_ENTRY,
    beat, leave, editorsOf, recordMoves, recordNote, activityOf, cleanAction, _resetForTests,
};
