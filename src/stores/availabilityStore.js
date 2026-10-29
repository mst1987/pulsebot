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
//             raid is never touched twice), createdBy, createdAt,
//             via ("panel" = entered in Discord, "web" = the web dialog, "" =
//             older entries, all from Discord) }
//   panel = { categoryId, guildId, channelId, messageId, postedAt, postedBy, hash }
//   links = { [categoryId]: [{ label, url, emoji? }] } — the link buttons of a
//           category's raider organizer (WCL invite, info sheet …), at most
//           MAX_LINKS, kept apart from the panel so posting anew keeps them
//   features = { [categoryId]: { nextRaid?, attendance?, evaluation?, guildBank?, links? } }
//           — the sections of a category's raider organizer that are switched
//           off (#969); only `false` is stored, a missing key means "on", so a
//           category nobody touched shows every section
//
// Old entries are pruned once their last day is long over; nothing else
// removes them except the raider or the orga.
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");
const { newId } = require("../utils/ids");
const { checkButtonEmoji, parseButtonEmoji } = require("../utils/discord/buttonEmoji");

const KINDS = ["absence", "presence"];
/** Where an entry was made: Discord (a category's panel or /availability) or the web dialog. */
const VIAS = ["panel", "web"];
const COMMENT_MAX = 100;
/** How many entries one raider may have at once. */
const MAX_ENTRIES = 20;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Link buttons per category (one Discord action row) and the longest label Discord shows. */
const MAX_LINKS = 5;
const LINK_LABEL_MAX = 40;
/** The sections of the raider organizer that can be switched off per category, in the panel's order. */
const FEATURE_KEYS = ["nextRaid", "attendance", "evaluation", "guildBank", "links"];

function plainObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

const store = createJsonStore({
    file: settingsPath("availability.json"),
    defaults: () => ({ entries: [], panels: [], links: {}, features: {} }),
    normalize: (data) => ({
        entries: Array.isArray(data && data.entries) ? data.entries.filter((e) => e && e.id && e.userId) : [],
        panels: Array.isArray(data && data.panels) ? data.panels.filter((p) => p && p.channelId && p.messageId) : [],
        links: data && data.links && typeof data.links === "object" && !Array.isArray(data.links) ? data.links : {},
        features: plainObject(data && data.features),
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
        via: VIAS.includes(entry.via) ? entry.via : "",
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
 * A raider's character got another name (raiderProfileStore.editCharacter): his
 * attendance entries with it sign the raids up with the new name from now on.
 * `nameKey` is the old name in lower case without realm, `versionId` the
 * character's game version (an entry of another version keeps its name).
 * @returns {number} how many entries changed
 */
function renameCharacter(userId, nameKey, toName, { versionId = "" } = {}) {
    const uid = str(userId);
    const from = str(nameKey).toLowerCase();
    const name = str(toName);
    if (!uid || !from || !name) return 0;
    const data = store.read();
    let changed = 0;
    for (const e of data.entries) {
        if (str(e.userId) !== uid || !str(e.character) || str(e.character).toLowerCase().split("-")[0] !== from) continue;
        if (versionId && str(e.versionId) && str(e.versionId) !== versionId) continue;
        e.character = name;
        changed += 1;
    }
    if (changed) store.write(data);
    return changed;
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

/**
 * Remember a posted panel (replaces the category's earlier one). `hash` is
 * the fingerprint of what the message shows (availabilityPanel.js), so a
 * deploy that changes the text can tell which panels are stale.
 */
function setPanel(panel = {}, { now = Date.now() } = {}) {
    const entry = {
        categoryId: str(panel.categoryId),
        guildId: str(panel.guildId),
        channelId: str(panel.channelId),
        messageId: str(panel.messageId),
        postedBy: str(panel.postedBy),
        postedAt: now,
        hash: str(panel.hash),
    };
    const data = store.read();
    data.panels = [...data.panels.filter((p) => str(p.categoryId) !== entry.categoryId), entry];
    store.write(data);
    return { ...entry };
}

/** Note that a category's panel now shows the content with this `hash`; false when there is no panel. */
function markPanelDrawn(categoryId, hash) {
    const data = store.read();
    const hit = data.panels.find((p) => str(p.categoryId) === str(categoryId));
    if (!hit) return false;
    hit.hash = str(hash);
    store.write(data);
    return true;
}

/**
 * Check a category's links: `{ value: [{ label, url }] }` or `{ error }`
 * (German). Rows without both a label and an address are dropped quietly — an
 * empty row in the editor is not a mistake.
 */
function checkLinks(list) {
    const rows = (Array.isArray(list) ? list : [])
        .map((l) => ({ label: str(l && l.label), url: str(l && l.url), emoji: str(l && l.emoji) }))
        .filter((l) => l.label || l.url);
    if (rows.length > MAX_LINKS) return { error: `Höchstens ${MAX_LINKS} Links je Kategorie.` };
    for (const l of rows) {
        if (!l.label) return { error: `Der Link „${l.url}“ braucht einen Text.` };
        if ([...l.label].length > LINK_LABEL_MAX) return { error: `„${l.label}“ ist zu lang (höchstens ${LINK_LABEL_MAX} Zeichen).` };
        if (!/^https?:\/\/[^\s<>()]+$/i.test(l.url)) return { error: `„${l.label}“ braucht eine Adresse mit https://.` };
        const emoji = checkButtonEmoji(l.emoji);
        if (emoji.error) return { error: `Link „${l.label}“: ${emoji.error}` };
    }
    return { value: rows.map(withEmoji) };
}

/** A link as stored: `emoji` only when there is one, so old links keep their shape. */
const withEmoji = (l) => (l.emoji ? { label: l.label, url: l.url, emoji: l.emoji } : { label: l.label, url: l.url });

/** Stored links read back: blank rows dropped, an unreadable emoji left out. */
function readLinks(list) {
    return (Array.isArray(list) ? list : [])
        .map((l) => withEmoji({ label: str(l && l.label), url: str(l && l.url), emoji: parseButtonEmoji(str(l && l.emoji)) ? str(l.emoji) : "" }))
        .filter((l) => l.label && l.url);
}

/** A category's links, in their order. */
function getLinks(categoryId) {
    return readLinks(store.read().links[str(categoryId)]);
}

/** Every category's links: `{ [categoryId]: [{ label, url }] }`. */
function listLinks() {
    const out = {};
    for (const id of Object.keys(store.read().links)) {
        const list = getLinks(id);
        if (list.length) out[id] = list;
    }
    return out;
}

/** Replace a category's links (checked by checkLinks); an empty list removes them. `{ links }` or `{ error }`. */
function setLinks(categoryId, list) {
    const cat = str(categoryId);
    if (!cat) return { error: "Keine Kategorie gewählt." };
    const checked = checkLinks(list);
    if (checked.error) return checked;
    const data = store.read();
    if (checked.value.length) data.links[cat] = checked.value;
    else delete data.links[cat];
    store.write(data);
    return { links: checked.value };
}

/**
 * Stored switches read back against `keys`: every key true unless stored as `false`;
 * unknown keys are dropped. Shared with the Orga-Zentrale (orgaHubStore).
 */
function readFeatures(stored, keys) {
    const raw = plainObject(stored);
    return Object.fromEntries(keys.map((k) => [k, raw[k] !== false]));
}

/**
 * Check switches against `keys`: `{ value: { key: boolean } }` (only the keys given) or
 * `{ error }` (German) for an unknown key or a value that is not true/false.
 */
function checkFeatures(input, keys) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "Die Schalter fehlen." };
    const value = {};
    for (const [key, on] of Object.entries(input)) {
        if (!keys.includes(key)) return { error: `Den Bereich „${key}“ gibt es nicht.` };
        if (typeof on !== "boolean") return { error: `Der Schalter „${key}“ muss an oder aus sein.` };
        value[key] = on;
    }
    return { value };
}

/**
 * Change switches of `map[categoryId]` in place: the given keys are merged over the stored
 * ones, only `false` stays stored, an all-on category is removed. `{ features }` or `{ error }`.
 */
function mergeFeatures(map, categoryId, input, keys) {
    const cat = str(categoryId);
    if (!cat) return { error: "Keine Kategorie gewählt." };
    const checked = checkFeatures(input, keys);
    if (checked.error) return checked;
    const next = { ...readFeatures(map[cat], keys), ...checked.value };
    const off = Object.fromEntries(keys.filter((k) => next[k] === false).map((k) => [k, false]));
    if (Object.keys(off).length) map[cat] = off;
    else delete map[cat];
    return { features: next };
}

/** A category's sections of the raider organizer: `{ nextRaid: true, … }`, a missing key = on. */
function getFeatures(categoryId) {
    return readFeatures(store.read().features[str(categoryId)], FEATURE_KEYS);
}

/** Every category with at least one section switched off: `{ [categoryId]: { key: boolean } }`. */
function listFeatures() {
    const out = {};
    for (const id of Object.keys(store.read().features)) out[id] = getFeatures(id);
    return out;
}

/** Switch sections of a category's raider organizer (only the keys given change). `{ features }` or `{ error }`. */
function setFeatures(categoryId, input) {
    const data = store.read();
    const result = mergeFeatures(data.features, categoryId, input, FEATURE_KEYS);
    if (result.error) return result;
    store.write(data);
    return result;
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
    KINDS, VIAS, MAX_ENTRIES, COMMENT_MAX,
    listEntries, getEntry, addEntry, removeEntry, renameCharacter, markApplied, prune, entryProblem,
    listPanels, getPanel, setPanel, markPanelDrawn, removePanel, useFile,
    MAX_LINKS, LINK_LABEL_MAX, checkLinks, readLinks, getLinks, listLinks, setLinks,
    FEATURE_KEYS, readFeatures, checkFeatures, mergeFeatures, getFeatures, listFeatures, setFeatures,
};
