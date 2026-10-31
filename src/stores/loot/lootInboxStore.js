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
const { settingsPath } = require("../../config/paths");
const { createJsonStore } = require("../jsonStore");
const { newId } = require("../../utils/ids");

const INBOX_FILE = settingsPath("loot-inbox.json");

// How many resolved sessions to remember. Only needs to outlive the window in
// which the sync tool might still re-upload a raid, but is cheap to keep long.
const MAX_RESOLVED = 500;

// How long a dismissed upload stays visible (and restorable) in the inbox's
// "Verworfen" tab (#1002). Its decision is remembered longer (MAX_RESOLVED), so a
// later upload of the same raid stays dismissed after the card is gone.
const DISMISS_KEEP_MS = 14 * 24 * 60 * 60 * 1000;

const store = createJsonStore({
    file: INBOX_FILE,
    defaults: () => ({ pending: [], resolved: [], dismissed: [] }),
    normalize: (data) => {
        return {
            pending: Array.isArray(data.pending) ? data.pending : [],
            resolved: Array.isArray(data.resolved) ? data.resolved : [],
            dismissed: Array.isArray(data.dismissed) ? data.dismissed : [],
        };
    },
});

function readState() {
    return store.read();
}

/** Dismissed uploads still inside the 14-day window. */
function keptDismissed(list, now = Date.now()) {
    return (list || []).filter((d) => (Number(d.dismissedAt) || 0) > now - DISMISS_KEEP_MS);
}

function writeState(state) {
    store.write({
        pending: state.pending,
        resolved: state.resolved.slice(-MAX_RESOLVED),
        dismissed: keptDismissed(state.dismissed),
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
        // The server of the upload key (#994); a key assigned later fills it in.
        if (meta.guildId) existing.guildId = String(meta.guildId);
        // A matching raid created later ends the waiting (#1002).
        if (meta.waiting !== undefined) Object.assign(existing, waitingFields(meta));
        if (meta.gameVersion) existing.gameVersion = String(meta.gameVersion);
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
        // The server of the upload key (#994), "" for a key without one.
        guildId: meta.guildId ? String(meta.guildId) : "",
        match: meta.match || null,
        // The game version the upload named (#1002), "" for an older addon.
        gameVersion: meta.gameVersion ? String(meta.gameVersion) : "",
        ...waitingFields(meta),
    };
    state.pending.push(entry);
    writeState(state);
    return { entry, added: items.length, created: true };
}

/**
 * An upload without one clear raid waits for the orga (#1002): `waiting` with
 * the servers whose orga sees it (every candidate's server, else the key's).
 */
function waitingFields(meta) {
    const waiting = !!meta.waiting;
    const servers = waiting && Array.isArray(meta.servers)
        ? [...new Set(meta.servers.map(String).filter(Boolean))]
        : [];
    return { waiting, servers };
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
    const at = Date.now();
    state.resolved.push({
        // The inbox id, so a second accept of the same card can say "already
        // assigned" (409) instead of "not found" (#1002).
        id: entry.id,
        sessionId: entry.sessionId,
        action,
        eventId: link.eventId || "",
        eventLabel: link.eventLabel || "",
        categoryId: link.categoryId || "",
        // The Discord server it was accepted on (#919): appended loot keeps it.
        guildId: link.guildId || "",
        // What the inbox's "Verknüpft" list shows for an accepted session: the
        // raid it was, when it started and how much came with the first accept.
        contentLabel: link.contentLabel || "",
        startedAt: entry.startedAt || 0,
        itemCount: entry.itemCount || (entry.items || []).length,
        appended: 0,
        at,
    });
    // A dismissed card stays restorable for 14 days (#1002).
    if (action === "dismissed") {
        state.dismissed = state.dismissed.filter((d) => d.sessionId !== entry.sessionId);
        state.dismissed.push({ ...entry, dismissedAt: at, dismissedBy: link.by || "" });
    }
    writeState(state);
    return entry;
}

/** The last decision on an inbox id, or null (#1002). */
function resolvedById(id) {
    const key = String(id || "");
    if (!key) return null;
    const { resolved } = readState();
    for (let i = resolved.length - 1; i >= 0; i -= 1) {
        if (resolved[i].id === key) return resolved[i];
    }
    return null;
}

/** Dismissed uploads of the last 14 days, newest decision first (#1002). */
function listDismissed(now = Date.now()) {
    return keptDismissed(readState().dismissed, now)
        .slice()
        .sort((a, b) => (b.dismissedAt || 0) - (a.dismissedAt || 0));
}

/** A dismissed upload by its inbox id (inside the 14 days), or null. */
function getDismissed(id) {
    const key = String(id || "");
    return listDismissed().find((d) => d.id === key) || null;
}

/**
 * Bring a dismissed upload back into the inbox (#1002): it waits again where it
 * waited before, and the dismissal is forgotten so the next upload merges in.
 * @returns {object|null} the restored entry, or null when it is unknown or older than 14 days
 */
function restorePending(id) {
    const state = readState();
    const key = String(id || "");
    const kept = keptDismissed(state.dismissed);
    const found = kept.find((d) => d.id === key);
    if (!found) return null;
    state.dismissed = kept.filter((d) => d.id !== key);
    state.resolved = state.resolved.filter((r) => !(r.sessionId === found.sessionId && r.action === "dismissed"));
    const { dismissedAt, dismissedBy, ...entry } = found; // eslint-disable-line no-unused-vars
    entry.updatedAt = Date.now();
    if (!state.pending.some((s) => s.sessionId === entry.sessionId)) state.pending.push(entry);
    writeState(state);
    return entry;
}

/** Drop dismissed uploads past the 14 days now (also happens on every write). */
function pruneDismissed(now = Date.now()) {
    const state = readState();
    const kept = keptDismissed(state.dismissed, now);
    const removed = state.dismissed.length - kept.length;
    if (removed > 0) {
        store.write({ ...state, dismissed: kept });
    }
    return removed;
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
 * Forget every session whose last decision accepted it into `eventId` — called
 * when that event's loot is cleared. Otherwise the next upload would append the
 * whole raid straight back into the event that was just emptied; forgotten, the
 * session arrives as a new inbox card and someone decides again.
 * @returns {number} how many sessions were unlinked
 */
function unlinkEvent(eventId) {
    const id = String(eventId || "");
    if (!id) return 0;
    const state = readState();
    const lastBySession = new Map();
    for (const r of state.resolved) lastBySession.set(r.sessionId, r);
    const unlinked = new Set();
    for (const [sessionId, r] of lastBySession) {
        if (r.action === "accepted" && r.eventId === id) unlinked.add(sessionId);
    }
    if (!unlinked.size) return 0;
    state.resolved = state.resolved.filter((r) => !unlinked.has(r.sessionId));
    writeState(state);
    return unlinked.size;
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

module.exports = {
    listPending, getPending, upsertPending, resolvePending, resolutionFor, noteAppended, listLinked, unlinkEvent,
    resolvedById, listDismissed, getDismissed, restorePending, pruneDismissed, DISMISS_KEEP_MS,
    // tests: another file (null = back to the default)
    useFile: store.useFile,
};
