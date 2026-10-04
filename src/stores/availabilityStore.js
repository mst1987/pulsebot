// Absences and attendances of raiders: "I am away from … to …" and "I am there
// from … to … with this character" (services/signups/availability.js applies
// them to the raids of that period). Plus the panel messages the orga posted
// per raid category, whose buttons open the same in Discord.
//
// `data/settings/availability.json` = { entries: [entry], panels: [panel] }
//
//   entry = { id, userId, kind: "absence" | "presence", from, to ("yyyy-MM-dd",
//             server time, both days included), categoryId ("" = every raid
//             category), comment (absence), character, spec, versionId
//             (presence: the character the raids are signed up with), skip
//             (event ids deselected when it was entered), applied ({ [eventId]:
//             { at, ok, error? } } — every raid it was applied to once, so a
//             raid is never touched twice), createdBy, createdAt }
//   panel = { categoryId, guildId, channelId, messageId, postedAt, postedBy }
//
// Old entries are pruned once their last day is long over; nothing else
// removes them except the raider or the orga.
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");
const { newId } = require("../utils/ids");

const KINDS = ["absence", "presence"];
const COMMENT_MAX = 100;
/** How many entries one raider may have at once. */
const MAX_ENTRIES = 20;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const store = createJsonStore({
    file: settingsPath("availability.json"),
    defaults: () => ({ entries: [], panels: [] }),
    normalize: (data) => ({
        entries: Array.isArray(data && data.entries) ? data.entries.filter((e) => e && e.id && e.userId) : [],
        panels: Array.isArray(data && data.panels) ? data.panels.filter((p) => p && p.channelId && p.messageId) : [],
    }),
});

/** Tests point the store at a file of their own; null = the default again. */
const useFile = store.useFile;

const str = (v) => String(v === undefined || v === null ? "" : v).trim();
const ids = (list) => [...new Set((Array.isArray(list) ? list : []).map(str).filter(Boolean))];

function complete(entry) {
    return {
        id: str(entry.id),
        userId: str(entry.userId),
        kind: KINDS.includes(entry.kind) ? entry.kind : "absence",
        from: str(entry.from),
        to: str(entry.to),
        categoryId: str(entry.categoryId),
        comment: str(entry.comment).slice(0, COMMENT_MAX),
        character: str(entry.character),
        spec: str(entry.spec),
        versionId: str(entry.versionId),
        skip: ids(entry.skip),
        applied: entry.applied && typeof entry.applied === "object" && !Array.isArray(entry.applied) ? { ...entry.applied } : {},
        createdBy: str(entry.createdBy),
        createdAt: Number(entry.createdAt) || 0,
    };
}

/**
 * Check an entry's own fields (not the profile — that is the service's): kind,
 * the two days, their order. Returns the error or "".
 */
function entryProblem(input) {
    if (!KINDS.includes(input.kind)) return "Unbekannte Art – Abwesenheit oder Anwesenheit.";
    if (!DAY.test(input.from) || !DAY.test(input.to)) return "Bitte ein gültiges Von- und Bis-Datum angeben.";
    if (input.to < input.from) return "Das Bis-Datum liegt vor dem Von-Datum.";
    if (input.kind === "presence" && (!input.character || !input.spec)) return "Für eine Anwesenheit bitte Charakter und Spec wählen.";
    return "";
}

/** Every entry (of one raider when `userId` is given), earliest first. */
function listEntries({ userId = "" } = {}) {
    const uid = str(userId);
    return store.read().entries
        .map(complete)
        .filter((e) => !uid || e.userId === uid)
        .sort((a, b) => a.from.localeCompare(b.from) || a.createdAt - b.createdAt);
}

function getEntry(id) {
    const hit = store.read().entries.find((e) => e.id === str(id));
    return hit ? complete(hit) : null;
}

/** Store a new entry. Returns `{ entry }` or `{ error }`. */
function addEntry(input = {}, { now = Date.now() } = {}) {
    const entry = complete({ ...input, id: newId(), applied: {}, createdAt: now });
    if (!entry.userId) return { error: "Kein Raider." };
    const problem = entryProblem({ ...entry, kind: input.kind });
    if (problem) return { error: problem };
    const data = store.read();
    if (data.entries.filter((e) => e.userId === entry.userId).length >= MAX_ENTRIES) {
        return { error: `Höchstens ${MAX_ENTRIES} Einträge – lösche zuerst einen alten.` };
    }
    data.entries.push(entry);
    store.write(data);
    return { entry };
}

/** Remove an entry. Returns the removed entry or null. */
function removeEntry(id) {
    const data = store.read();
    const hit = data.entries.find((e) => e.id === str(id));
    if (!hit) return null;
    data.entries = data.entries.filter((e) => e !== hit);
    store.write(data);
    return complete(hit);
}

/**
 * Note that an entry was applied to a raid (successfully or not). Returns
 * false when it already was — the caller then leaves the raid alone.
 */
function markApplied(entryId, eventId, result = {}, { now = Date.now() } = {}) {
    const data = store.read();
    const hit = data.entries.find((e) => e.id === str(entryId));
    const eid = str(eventId);
    if (!hit || !eid) return false;
    hit.applied = hit.applied && typeof hit.applied === "object" ? hit.applied : {};
    if (hit.applied[eid]) return false;
    hit.applied[eid] = { at: now, ok: result.ok === true, ...(result.error ? { error: str(result.error).slice(0, 200) } : {}) };
    store.write(data);
    return true;
}

/** Drop entries whose last day lies more than `maxAgeDays` back. Returns how many were dropped. */
function prune(today, maxAgeDays = 30) {
    const cutoff = new Date(`${today}T00:00:00Z`);
    if (Number.isNaN(cutoff.getTime())) return 0;
    cutoff.setUTCDate(cutoff.getUTCDate() - maxAgeDays);
    const limit = cutoff.toISOString().slice(0, 10);
    const data = store.read();
    const kept = data.entries.filter((e) => !(str(e.to) && str(e.to) < limit));
    const dropped = data.entries.length - kept.length;
    if (dropped) store.write({ ...data, entries: kept });
    return dropped;
}

/** The posted panel messages, one per raid category at most. */
function listPanels() {
    return store.read().panels.map((p) => ({ ...p }));
}

function getPanel(categoryId) {
    const hit = store.read().panels.find((p) => str(p.categoryId) === str(categoryId));
    return hit ? { ...hit } : null;
}

/** Remember a posted panel (replaces the category's earlier one). */
function setPanel(panel = {}, { now = Date.now() } = {}) {
    const entry = {
        categoryId: str(panel.categoryId),
        guildId: str(panel.guildId),
        channelId: str(panel.channelId),
        messageId: str(panel.messageId),
        postedBy: str(panel.postedBy),
        postedAt: now,
    };
    const data = store.read();
    data.panels = [...data.panels.filter((p) => str(p.categoryId) !== entry.categoryId), entry];
    store.write(data);
    return { ...entry };
}

function removePanel(categoryId) {
    const data = store.read();
    const hit = data.panels.find((p) => str(p.categoryId) === str(categoryId));
    if (!hit) return null;
    data.panels = data.panels.filter((p) => p !== hit);
    store.write(data);
    return { ...hit };
}

module.exports = {
    KINDS, MAX_ENTRIES, COMMENT_MAX,
    listEntries, getEntry, addEntry, removeEntry, markApplied, prune, entryProblem,
    listPanels, getPanel, setPanel, removePanel, useFile,
};
