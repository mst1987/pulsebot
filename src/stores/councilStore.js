// Which raiders the loot council does not plan with any more.
//
// A roster built from loot and log history keeps everyone who ever raided —
// including the raider who left the guild in April and the alt somebody brought
// once. They are not wrong to be *in* the data, but a council planning tonight's
// drops should not have to scroll past them, and least of all should they win
// the "hat am längsten nichts bekommen" comparison by virtue of not raiding at
// all. Their drought grows forever, so without this they end up on top of the
// list they have no business being on.
//
// Deliberately an explicit list rather than an automatic rule ("nobody who has
// not raided in 60 days"): the difference between "gone" and "was ill for two
// months" is one only a person knows, and guessing it wrong drops a raider who
// is coming back.
//
// Excluding is reversible and remembers why and when, so a council in three
// months can tell a deliberate decision from an accident.

const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");
const { characterKeyOf } = require("../utils/loot/lootImport");

const EXCLUDED_FILE = settingsPath("council-excluded.json");

const store = createJsonStore({
    file: EXCLUDED_FILE,
    defaults: () => ({}),
    normalize: (data) => (data && typeof data.excluded === "object" && !Array.isArray(data.excluded) ? data.excluded : {}),
});

function readAll() {
    return store.read();
}

function writeAll(excluded) {
    store.write({ excluded });
}

/**
 * The excluded characters as `{ [characterKey]: { character, reason, at, by } }`.
 * Keyed like lootStore/characterStore, so "Devihra-Thunderstrike" and "devihra"
 * are the same raider.
 */
function listExcluded() {
    return readAll();
}

/** Whether this character is currently excluded. */
function isExcluded(character) {
    const key = characterKeyOf(character);
    return !!(key && readAll()[key]);
}

/** The set of excluded keys, for filtering a whole roster in one pass. */
function excludedKeys() {
    return new Set(Object.keys(readAll()));
}

/**
 * Stop planning with a character. Returns the stored entry, or null for a blank
 * name. Re-excluding someone refreshes the note rather than erroring.
 */
function exclude(character, { reason = "", by = "" } = {}) {
    const key = characterKeyOf(character);
    if (!key) return null;
    const all = readAll();
    all[key] = {
        character: String(character || "").trim(),
        reason: String(reason || "").trim(),
        at: Date.now(),
        by: String(by || "").trim(),
    };
    writeAll(all);
    return all[key];
}

/** Plan with them again. Returns true when something was actually removed. */
function include(character) {
    const key = characterKeyOf(character);
    if (!key) return false;
    const all = readAll();
    if (!all[key]) return false;
    delete all[key];
    writeAll(all);
    return true;
}

// ── Als was jemand eingeplant ist ────────────────────────────────────────────
//
// Ein Heiler spielt hin und wieder Offspec, und dann ist er für diesen Abend
// ein DPS — mit Casterset, BiS-Liste und Simulation eines DPS. Aus den Daten
// geht das nicht hervor: dort steht die Spec, mit der er zuletzt geloggt oder
// importiert wurde, und die ist genau dann falsch, wenn es darauf ankommt.
//
// Eine Entscheidung des Raidleads also, kein Rateschluss — und damit die zweite
// Sache, die der Council selbst über einen Raider festhält. Sie überschreibt
// nur die *Rolle*; welche Spec das ist, folgt daraus (specForRole in
// config/casterSpecs.js).

const ROLES_FILE = settingsPath("council-roles.json");

const rolesStore = createJsonStore({
    file: ROLES_FILE,
    defaults: () => ({}),
    normalize: (data) => (data && typeof data.roles === "object" && !Array.isArray(data.roles) ? data.roles : {}),
});

function readRoles() {
    return rolesStore.read();
}

function writeRoles(roles) {
    rolesStore.write({ roles });
}

/** All role decisions as `{ [characterKey]: { character, role, at, by } }`. */
function listRoles() {
    return readRoles();
}

/** The role a character is planned as, or "" when nobody decided. */
function plannedRole(character) {
    const key = characterKeyOf(character);
    const entry = key ? readRoles()[key] : null;
    return entry ? entry.role : "";
}

/** Key -> role, for resolving a whole roster in one pass. */
function plannedRoles() {
    const out = new Map();
    for (const [key, entry] of Object.entries(readRoles())) {
        if (entry && entry.role) out.set(key, entry.role);
    }
    return out;
}

/**
 * Plan this character as a caster or a healer. An empty role takes the decision
 * back, and the page falls to what the data says again.
 */
function setRole(character, role, { by = "" } = {}) {
    const key = characterKeyOf(character);
    if (!key) return null;
    const all = readRoles();
    const wanted = String(role || "").trim();
    if (!wanted) {
        if (all[key]) { delete all[key]; writeRoles(all); }
        return null;
    }
    all[key] = {
        character: String(character || "").trim(),
        role: wanted,
        at: Date.now(),
        by: String(by || "").trim(),
    };
    writeRoles(all);
    return all[key];
}

// ── Die Ansicht je Raid-Kategorie ────────────────────────────────────────────
//
// Welche Filter der Council für eine Kategorie benutzt — Rolle, Tiers, Raids,
// BiS-Liste und Spielversion. Früher stand das nur im Browser des Lesers
// (localStorage), und das Addon im Spiel bekam einen anderen Stand als die
// Seite. Jetzt hält der Server es je Kategorie fest: die Seite liest und
// schreibt es, GET /api/ingest/council?v=2 rechnet jede Loot-Council-Kategorie
// mit genau dieser Ansicht (web/loot/councilView.js). Ohne gespeicherte
// Ansicht gelten die Vorgaben der Seite (VIEW_DEFAULTS).

const VIEWS_FILE = settingsPath("council-views.json");

/** What the page shows for a category nobody set a view for. */
const VIEW_DEFAULTS = Object.freeze({ role: "caster", tiers: [], contents: [], bisTier: "", version: "" });
// "" = every role ("Alle" on the page).
const VIEW_ROLES = ["caster", "healer", ""];
const ID_RE = /^[a-z0-9_-]{1,32}$/i;

const idList = (raw) => [...new Set((Array.isArray(raw) ? raw : [])
    .map((v) => String(v || "").trim())
    .filter((v) => ID_RE.test(v)))].slice(0, 32);

/**
 * A view as the page sends it, cleaned: unknown roles fall back to the default,
 * ids are short plain strings, `version` is "" (main version), "all" or an id.
 */
function normalizeView(raw) {
    const v = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const role = typeof v.role === "string" && VIEW_ROLES.includes(v.role.trim()) ? v.role.trim() : VIEW_DEFAULTS.role;
    const bisTier = String(v.bisTier || "").trim();
    const version = String(v.version || "").trim();
    return {
        role,
        tiers: idList(v.tiers),
        contents: idList(v.contents),
        bisTier: ID_RE.test(bisTier) ? bisTier : "",
        version: ID_RE.test(version) ? version : "",
    };
}

const viewsStore = createJsonStore({
    file: VIEWS_FILE,
    defaults: () => ({}),
    normalize: (data) => {
        const raw = data && typeof data.views === "object" && !Array.isArray(data.views) ? data.views : {};
        const out = {};
        for (const [catId, entry] of Object.entries(raw)) {
            const key = String(catId).trim();
            if (!key || !entry || typeof entry !== "object") continue;
            out[key] = { ...normalizeView(entry), at: Number(entry.at) || 0, by: String(entry.by || "") };
        }
        return out;
    },
});

/** Every stored view as `{ [categoryId]: { role, tiers, contents, bisTier, version, at, by } }`. */
function listViews() {
    return viewsStore.read();
}

/**
 * The view a category's council uses: the stored one, else VIEW_DEFAULTS.
 * `stored` says which, so a reader can tell "never set" from "set to the defaults".
 */
function viewFor(categoryId) {
    const key = String(categoryId || "").trim();
    const entry = key ? viewsStore.read()[key] : null;
    if (!entry) return { ...VIEW_DEFAULTS, tiers: [], contents: [], stored: false };
    const { role, tiers, contents, bisTier, version } = entry;
    return { role, tiers, contents, bisTier, version, stored: true };
}

/** Store a category's view. Returns the stored entry, or null for a blank category. */
function setView(categoryId, view, { by = "" } = {}) {
    const key = String(categoryId || "").trim();
    if (!key) return null;
    const all = viewsStore.read();
    all[key] = { ...normalizeView(view), at: Date.now(), by: String(by || "").trim() };
    viewsStore.write({ views: all });
    return all[key];
}

/** Drop everything — tests only. */
function reset() {
    store.remove();
    rolesStore.remove();
    viewsStore.remove();
}

module.exports = {
    listExcluded, isExcluded, excludedKeys, exclude, include, reset, EXCLUDED_FILE,
    listRoles, plannedRole, plannedRoles, setRole, ROLES_FILE,
    listViews, viewFor, setView, normalizeView, VIEW_DEFAULTS, VIEWS_FILE,
};
