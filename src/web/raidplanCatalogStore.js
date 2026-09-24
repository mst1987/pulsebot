// The raid plan catalog (docs/raidplan.md): the mobs (bosses' adds, council members, trash) that can be tanked or
// marked, and the spells that are handed out as assignments (curses, kicks, misdirects ...).
//
// Two layers, kept apart: the DEFAULTS in code (raidplanCatalogDefaults.js) and what the admin changed in
// data/settings/raidplan-catalog.json:
//   { mobs: { <id>: entry }, spells: { <id>: entry }, hiddenMobs: [id], hiddenSpells: [id] }
// An entry stored under a default's id OVERRIDES it (all its fields); a new one gets a `c:` id; hiding a default
// takes it off the lists; "reset" removes the override / the hiding, so the default is back. A plan refers to an
// entry by its id and keeps a snapshot of its name and icon (raidplanAssign.js), so a deleted entry still shows.
//
//   mob   { id, name, kind: boss | add | trash | other, instanceId, bossKey, icon, note }
//   spell { id, name, nameEn, icon, type, classes: [class id], note }
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const defaults = require("./raidplanCatalogDefaults");
const { instanceById } = require("../config/gameVersions");
const { ASSIGN_TYPES } = require("./raidplanAssign");

const DEFAULT_FILE = path.join(__dirname, "..", "..", "data", "settings", "raidplan-catalog.json");
const LIMITS = { mobs: 400, spells: 300, name: 60, note: 200 };
const KINDS = ["boss", "add", "trash", "other"];
const CLASS_IDS = ["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock", "Druid"];
// a Wowhead icon name (spell_fire_fireball) or a boss icon (boss:<encounter id>) or a mob's portrait (mob:<NPC id>), "" = the generic enemy icon
const ICON = /^([a-z0-9_'\-]{2,64}|(?:boss|mob):\d{1,6})$/;

let file = DEFAULT_FILE;

/** Tests point the store at a file of their own. */
function useFile(f) {
    file = f || DEFAULT_FILE;
}

const str = (v) => String(v === null || v === undefined ? "" : v).trim();

function readAll() {
    try {
        const d = JSON.parse(fs.readFileSync(file, "utf8"));
        const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
        return { mobs: obj(d.mobs), spells: obj(d.spells), hiddenMobs: Array.isArray(d.hiddenMobs) ? d.hiddenMobs : [], hiddenSpells: Array.isArray(d.hiddenSpells) ? d.hiddenSpells : [] };
    } catch {
        return { mobs: {}, spells: {}, hiddenMobs: [], hiddenSpells: [] };
    }
}

function writeAll(data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const cleanIcon = (v) => (ICON.test(str(v).toLowerCase()) ? str(v).toLowerCase() : "");

function cleanMob(raw, id) {
    const r = raw && typeof raw === "object" ? raw : {};
    const instanceId = instanceById(str(r.instanceId)) ? str(r.instanceId) : "";
    const bossKey = /^[a-z0-9]+\/[a-z0-9-]+$/.test(str(r.bossKey)) && str(r.bossKey).startsWith(`${instanceId}/`) ? str(r.bossKey) : "";
    return {
        id, name: str(r.name).slice(0, LIMITS.name), kind: KINDS.includes(r.kind) ? r.kind : "add",
        instanceId, bossKey, icon: cleanIcon(r.icon), note: str(r.note).slice(0, LIMITS.note), ...versionsOf(r),
    };
}

function cleanSpell(raw, id) {
    const r = raw && typeof raw === "object" ? raw : {};
    return {
        id, name: str(r.name).slice(0, LIMITS.name), nameEn: str(r.nameEn).slice(0, LIMITS.name), icon: cleanIcon(r.icon),
        type: ASSIGN_TYPES.includes(r.type) ? r.type : "other",
        classes: [...new Set((Array.isArray(r.classes) ? r.classes : []).map(str).filter((c) => CLASS_IDS.includes(c)))],
        note: str(r.note).slice(0, LIMITS.note),
        ...versionsOf(r),
    };
}

/** The optional `versions` of an entry: known game version ids only; nothing when it is every version. */
function versionsOf(r) {
    const v = [...new Set((Array.isArray(r && r.versions) ? r.versions : []).map(str).filter((x) => /^[a-z0-9]{2,12}$/.test(x)))];
    return v.length ? { versions: v } : {};
}

/** Whether an entry exists in a game version (an entry without `versions` exists in all; no version asked = all). */
function inVersion(entry, versionId) {
    return !versionId || !Array.isArray(entry.versions) || entry.versions.length === 0 || entry.versions.includes(versionId);
}

/** The visible entries: defaults (overridden or not, unless hidden) and the admin's own; each says where it comes from. */
function merged(defaultList, stored, hidden, clean) {
    const out = [];
    for (const d of defaultList) {
        if (hidden.includes(d.id)) continue;
        const o = stored[d.id];
        out.push(o ? { ...clean(o, d.id), source: "override" } : { ...d, source: "default" });
    }
    for (const [id, o] of Object.entries(stored)) {
        if (defaultList.some((d) => d.id === id)) continue;
        const e = clean(o, id);
        if (e.name) out.push({ ...e, source: "custom" });
    }
    return out;
}

function listMobs() {
    const d = readAll();
    return merged(defaults.MOBS, d.mobs, d.hiddenMobs, cleanMob);
}

function listSpells() {
    const d = readAll();
    return merged(defaults.SPELLS, d.spells, d.hiddenSpells, cleanSpell);
}

const getMob = (id) => listMobs().find((m) => m.id === str(id)) || null;
const getSpell = (id) => listSpells().find((s) => s.id === str(id)) || null;

/** Hidden defaults, for the admin ("Ausgeblendet", to bring them back). */
function hiddenEntries() {
    const d = readAll();
    return {
        mobs: defaults.MOBS.filter((m) => d.hiddenMobs.includes(m.id)).map((m) => ({ ...m, source: "hidden" })),
        spells: defaults.SPELLS.filter((s) => d.hiddenSpells.includes(s.id)).map((s) => ({ ...s, source: "hidden" })),
    };
}

/** What the plan editor and the read view get: every visible mob and spell. */
function catalogView(versionId = "") {
    return { mobs: listMobs().filter((m) => inVersion(m, versionId)), spells: listSpells().filter((s) => inVersion(s, versionId)) };
}

/** The classes that can cast a type of assignment, from the visible spells of that type (in the order they first appear). */
function classesOf(type, versionId = "") {
    const out = [];
    for (const s of listSpells()) if (s.type === type && inVersion(s, versionId)) for (const c of s.classes) if (!out.includes(c)) out.push(c);
    return out;
}

/** The visible spells of a type, in list order. */
const spellsOfType = (type, versionId = "") => listSpells().filter((s) => s.type === type && inVersion(s, versionId));

/**
 * Creates (no `id`), or changes (`id`; a default's id makes an override) a mob or a spell. Returns
 * `{ entry }` or `{ code, error }`.
 */
function save(kind, input, { now = Date.now() } = {}) {
    void now;
    const isMob = kind === "mobs";
    const body = input && typeof input === "object" ? input : {};
    const data = readAll();
    const list = isMob ? data.mobs : data.spells;
    const defaultList = isMob ? defaults.MOBS : defaults.SPELLS;
    let id = str(body.id);
    if (id) {
        if (!defaultList.some((d) => d.id === id) && !list[id]) return { code: "not_found", error: "Eintrag nicht gefunden." };
    } else {
        if (Object.keys(list).length >= (isMob ? LIMITS.mobs : LIMITS.spells)) return { code: "invalid", error: "Der Katalog ist voll." };
        id = `c:${crypto.randomBytes(5).toString("hex")}`;
    }
    const current = (isMob ? getMob(id) : getSpell(id)) || {};
    const entry = (isMob ? cleanMob : cleanSpell)({ ...current, ...body }, id);
    if (!entry.name) return { code: "invalid", error: "Der Name fehlt." };
    list[id] = entry;
    if (isMob) data.hiddenMobs = data.hiddenMobs.filter((x) => x !== id); else data.hiddenSpells = data.hiddenSpells.filter((x) => x !== id);
    writeAll(data);
    return { entry: { ...entry, source: defaultList.some((d) => d.id === id) ? "override" : "custom" } };
}

/** Deletes an own entry; a default is hidden instead (it can be brought back by reset). */
function remove(kind, id) {
    const isMob = kind === "mobs";
    const data = readAll();
    const list = isMob ? data.mobs : data.spells;
    const key = str(id);
    const isDefault = (isMob ? defaults.MOBS : defaults.SPELLS).some((d) => d.id === key);
    if (!isDefault && !list[key]) return { code: "not_found", error: "Eintrag nicht gefunden." };
    delete list[key];
    if (isDefault) {
        const hidden = isMob ? data.hiddenMobs : data.hiddenSpells;
        if (!hidden.includes(key)) hidden.push(key);
    }
    writeAll(data);
    return { removed: true, hidden: isDefault };
}

/** Back to the default: the override goes, a hidden default is shown again. */
function reset(kind, id) {
    const isMob = kind === "mobs";
    const data = readAll();
    const key = str(id);
    if (!(isMob ? defaults.MOBS : defaults.SPELLS).some((d) => d.id === key)) return { code: "invalid", error: "Nur Standardeinträge lassen sich zurücksetzen." };
    delete (isMob ? data.mobs : data.spells)[key];
    if (isMob) data.hiddenMobs = data.hiddenMobs.filter((x) => x !== key); else data.hiddenSpells = data.hiddenSpells.filter((x) => x !== key);
    writeAll(data);
    return { reset: true };
}

module.exports = { inVersion, useFile, LIMITS, KINDS, CLASS_IDS, ICON, cleanIcon, listMobs, listSpells, getMob, getSpell, hiddenEntries, catalogView, classesOf, spellsOfType, save, remove, reset };
