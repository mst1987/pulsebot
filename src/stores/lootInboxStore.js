// The inbox between the WoW addon and the loot history.
//
// The companion sync tool uploads raid sessions as the addon writes them; they
// land here as *pending* instead of straight in the loot store, so a human still
// decides which Raid-Helper event a session belongs to before it becomes history.
//
// Two things make repeated uploads of the same raid painless — and the sync tool
// does upload repeatedly, because the addon's SavedVariables still hold the whole
// raid night on every flush:
//
//   - A pending session is keyed by its `sessionId`. Re-uploading it merges the
//     new items into the existing entry rather than adding a second card, so the
//     inbox shows one row per raid that simply grows during the evening.
//   - Once a session is resolved (accepted or dismissed) that decision is
//     remembered. A later upload of an accepted session skips the inbox entirely
//     and appends straight to the event it was accepted into — which is what
//     makes the last hour of a raid arrive without anyone clicking again. A
//     dismissed session stays dismissed instead of popping back up.
//
// Items are deduped on (source, rawId) — the same key the loot store uses — so
// none of this can double-count an award.
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");
const { newId } = require("../utils/ids");

const INBOX_FILE = settingsPath("loot-inbox.json");

// How many resolved sessions to remember. Only needs to outlive the window in
// which the sync tool might still re-upload a raid, but is cheap to keep long.
const MAX_RESOLVED = 500;

const store = createJsonStore({
    file: INBOX_FILE,
    defaults: () => ({ pending: [], resolved: [] }),
    normalize: (data) => {
        return {
            pending: Array.isArray(data.pending) ? data.pending : [],
            resolved: Array.isArray(data.resolved) ? data.resolved : [],
        };
    },
});

function readState() {
    return store.read();
}

function writeState(state) {
    store.write({
        pending: state.pending,
        resolved: state.resolved.slice(-MAX_RESOLVED),
    });
}

const itemKey = (it) => `${it.source}::${it.rawId}`;

/** Merge `incoming` into `existing`, keeping the first row seen per (source, rawId). */
function mergeItems(existing, incoming) {
    const seen = new Set(existing.map(itemKey));
    const out = existing.slice();
    for (const it of incoming) {
        const key = itemKey(it);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(it);
    }
    return out;
}

/** All pending sessions, newest raid first. */
function listPending() {
    return readState().pending
        .slice()
        .sort((a, b) => (b.startedAt || b.receivedAt || 0) - (a.startedAt || a.receivedAt || 0));
}

/** A single pending session by its inbox id, or null. */
function getPending(id) {
    return readState().pending.find((s) => s.id === String(id || "")) || null;
}

/**
 * How a session was resolved before, or null if it is new to us.
 * @returns {null | { sessionId, action: "accepted"|"dismissed", eventId, eventLabel, categoryId, at }}
 */
function resolutionFor(sessionId) {
    const key = String(sessionId || "");
    if (!key) return null;
    const { resolved } = readState();
    // Last decision wins — a session can be dismissed and later accepted.
    for (let i = resolved.length - 1; i >= 0; i -= 1) {
        if (resolved[i].sessionId === key) return resolved[i];
    }
    return null;
}

/**
 * Add an uploaded session to the inbox, merging into an existing pending entry
 * with the same sessionId. `meta` carries what the upload knew about itself
 * (instance, realm, reporter, which token sent it) and the suggested event match.
 * @returns {{ entry: object, added: number, created: boolean }}
 */
function upsertPending(session, meta = {}) {
    const state = readState();
    const sessionId = String(session.sessionId || "");
    const items = Array.isArray(session.items) ? session.items : [];
    const existing = state.pending.find((s) => s.sessionId === sessionId);
    const now = Date.now();

    if (existing) {
        const before = existing.items.length;
        existing.items = mergeItems(existing.items, items);
        existing.itemCount = existing.items.length;
        existing.updatedAt = now;
        // A raid that is still running reports a later end each time.
        existing.endedAt = Math.max(existing.endedAt || 0, session.endedAt || 0);
        if (!existing.instance && session.instance) existing.instance = session.instance;
        // The match is recomputed on every upload: an event created *after* the
        // first upload should still be found.
        if (meta.match !== undefined) existing.match = meta.match;
        writeState(state);
        return { entry: existing, added: existing.items.length - before, created: false };
    }

    const entry = {
        id: newId(),
        sessionId,
        receivedAt: now,
        updatedAt: now,
        startedAt: session.startedAt || 0,
        endedAt: session.endedAt || 0,
        instance: session.instance || "",
        items,
        itemCount: items.length,
        realm: meta.realm || "",
        reporter: meta.reporter || "",
        addonVersion: meta.addonVersion || "",
        tokenId: meta.tokenId || "",
        tokenName: meta.tokenName || "",
        match: meta.match || null,
    };
    state.pending.push(entry);
    writeState(state);
    return { entry, added: items.length, created: true };
}

/**
 * Take a session out of the inbox and remember the decision.
 * @param {string} id      inbox entry id
 * @param {"accepted"|"dismissed"} action
 * @param {object} link    { eventId, eventLabel, categoryId } for an accept
 * @returns {object|null}  the removed entry, or null if the id was unknown
 */
function resolvePending(id, action, link = {}) {
    const state = readState();
    const idx = state.pending.findIndex((s) => s.id === String(id || ""));
    if (idx === -1) return null;
    const [entry] = state.pending.splice(idx, 1);
    state.resolved.push({
        sessionId: entry.sessionId,
        action,
        eventId: link.eventId || "",
        eventLabel: link.eventLabel || "",
        categoryId: link.categoryId || "",
        // What the inbox's "Verknüpft" list shows for an accepted session: the
        // raid it was, when it started and how much came with the first accept.
        contentLabel: link.contentLabel || "",
        startedAt: entry.startedAt || 0,
        itemCount: entry.itemCount || (entry.items || []).length,
        appended: 0,
        at: Date.now(),
    });
    writeState(state);
    return entry;
}

/**
 * Count items that a later upload appended to an accepted session by itself —
 * the "+6 nachgeliefert" in the inbox's list of linked sessions. Only the last
 * decision on the session is touched, the same one resolutionFor() answers with.
 * @returns {boolean} whether an accepted resolution was found
 */
function noteAppended(sessionId, added) {
    const key = String(sessionId || "");
    const n = Number(added) || 0;
    if (!key || n <= 0) return false;
    const state = readState();
    for (let i = state.resolved.length - 1; i >= 0; i -= 1) {
        const r = state.resolved[i];
        if (r.sessionId !== key) continue;
        if (r.action !== "accepted") return false;
        r.appended = (Number(r.appended) || 0) + n;
        r.lastAppendedAt = Date.now();
        writeState(state);
        return true;
    }
    return false;
}

/**
 * Accepted sessions, newest decision first, one per session: the quiet list
 * under the inbox cards that says which raids keep flowing in by themselves.
 */
function listLinked(limit = 10) {
    const seen = new Set();
    const out = [];
    const { resolved } = readState();
    for (let i = resolved.length - 1; i >= 0 && out.length < limit; i -= 1) {
        const r = resolved[i];
        if (seen.has(r.sessionId)) continue;
        seen.add(r.sessionId);
        if (r.action !== "accepted") continue;
        out.push({
            sessionId: r.sessionId,
            eventId: r.eventId || "",
            eventLabel: r.eventLabel || "",
            contentLabel: r.contentLabel || "",
            startedAt: r.startedAt || 0,
            itemCount: r.itemCount || 0,
            appended: Number(r.appended) || 0,
            at: r.at || 0,
        });
    }
    return out;
}

/** How many sessions are waiting — for the badge in the nav. */
function pendingCount() {
    return readState().pending.length;
}

module.exports = {
    listPending, getPending, upsertPending, resolvePending, resolutionFor, pendingCount, noteAppended, listLinked,
};
