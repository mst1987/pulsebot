// Loot-Council profiles (#676, docs/loot-council.md "Profile je Roster"): a
// named set of council settings — the weighting of #668 and the view (role,
// tiers, raids, BiS list, version) — that a roster with loot system
// Loot-Council uses. As many as the orga wants ("Main-Raid T6", "PuG-Nacht").
//
//   data/settings/council-profiles.json = {
//     profiles: { [id]: {
//       id, name,                 // name ≤ 40, unique (case-insensitive)
//       weights: Settings,        // as councilWeightsStore (classes, items, need, tenureDays)
//       view: { role, tiers, contents, bisTier, version },   // as councilViewSchema.normalizeView
//       at, by,                   // last change
//     } },
//     defaultId,                  // the profile a roster without its own uses ("Standard")
//     categories: { [categoryId]: profileId },  // a category WITHOUT roster keeps its profile here
//     migrated: true,             // the one-off migration from council-weights.json / council-views.json ran
//   }
//
// Which profile applies is services/loot/councilProfiles.js: the roster's own
// (`roster.lootProfileId`), else the category's entry here, else the default.
// Nothing stored means one virtual profile "Standard" with the defaults, so a
// fresh install weighs exactly like #668's table.
//
// The migration (settingsMigration.js → migrateLegacy): the server weighting
// becomes "Standard" (the default); every category with its own weighting or
// a stored view becomes a profile of its own, named after the category and
// assigned to that category's roster (or kept in `categories` when it has
// none). A category that only had a view gets the server's weighting copied,
// one that only had a weighting the default view — so no number changes
// (golden test in test/stores/councilProfilesStore.migration.test.js).
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");
const { newId } = require("../utils/ids");
const councilWeights = require("./councilWeightsStore");
const { normalizeView, VIEW_DEFAULTS } = require("./councilViewSchema");

const PROFILES_FILE = settingsPath("council-profiles.json");
const DEFAULT_ID = "standard";
const DEFAULT_NAME = "Standard";
const LIMITS = Object.freeze({ name: 40, profiles: 50, by: 80 });
const ID_RE = /^[a-z0-9_-]{1,40}$/i;

const isMap = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const idOf = (v) => {
    const s = str(v);
    return ID_RE.test(s) ? s : "";
};
const nameOf = (v) => str(v).replace(/\s+/g, " ").slice(0, LIMITS.name);
const sameName = (a, b) => a.toLocaleLowerCase("de") === b.toLocaleLowerCase("de");

class ProfileError extends Error {
    constructor(code, message) {
        super(message || code);
        this.name = "ProfileError";
        this.code = code;
    }
}

/** The weighting of a profile without the store's bookkeeping (at/by live on the profile). */
function weightsOf(raw) {
    const { classes, items, need, tenureDays } = councilWeights.normalizeSettings(raw);
    return { classes, items, need, tenureDays };
}

function viewOf(raw) {
    return normalizeView(isMap(raw) ? raw : VIEW_DEFAULTS);
}

/** One profile, or null without a valid id. */
function normalizeProfile(raw, id = raw && raw.id) {
    if (!isMap(raw)) return null;
    const pid = idOf(id);
    if (!pid) return null;
    return {
        id: pid,
        name: nameOf(raw.name) || (pid === DEFAULT_ID ? DEFAULT_NAME : pid),
        weights: weightsOf(raw.weights),
        view: viewOf(raw.view),
        at: Number(raw.at) || 0,
        by: str(raw.by).slice(0, LIMITS.by),
    };
}

/** The whole file: profiles by id, a default that exists, category entries pointing at known profiles only. */
function normalizeFile(data) {
    const src = isMap(data) ? data : {};
    const profiles = {};
    for (const [id, raw] of Object.entries(isMap(src.profiles) ? src.profiles : {})) {
        if (Object.keys(profiles).length >= LIMITS.profiles) break;
        const p = normalizeProfile(raw, id);
        if (p) profiles[p.id] = p;
    }
    const ids = Object.keys(profiles);
    const wanted = idOf(src.defaultId);
    const defaultId = profiles[wanted] ? wanted : (profiles[DEFAULT_ID] ? DEFAULT_ID : (ids[0] || DEFAULT_ID));
    const categories = {};
    for (const [catId, pid] of Object.entries(isMap(src.categories) ? src.categories : {})) {
        const key = str(catId);
        if (key && profiles[str(pid)]) categories[key] = str(pid);
    }
    return { profiles, defaultId, categories, migrated: src.migrated === true };
}

const store = createJsonStore({
    file: PROFILES_FILE,
    defaults: () => ({ profiles: {}, defaultId: DEFAULT_ID, categories: {}, migrated: false }),
    normalize: normalizeFile,
});

/** "Standard" with the defaults — what a store without profiles answers. */
function virtualDefault() {
    return { id: DEFAULT_ID, name: DEFAULT_NAME, weights: weightsOf({}), view: viewOf(VIEW_DEFAULTS), at: 0, by: "" };
}

/** The file with the default written down (every write keeps "Standard" on disk). */
function withDefault(data) {
    if (!data.profiles[data.defaultId]) {
        data.profiles[DEFAULT_ID] = virtualDefault();
        data.defaultId = DEFAULT_ID;
    }
    return data;
}

function readAll() {
    return store.read();
}

function writeAll(data) {
    store.write(normalizeFile(withDefault(data)));
}

/** The id of the default profile. */
function defaultProfileId() {
    return readAll().defaultId;
}

/** The default profile (the virtual "Standard" while nothing is stored). `stored` says which. */
function defaultProfile() {
    const data = readAll();
    const p = data.profiles[data.defaultId];
    return p ? { ...p, stored: true } : { ...virtualDefault(), stored: false };
}

/** One profile by id (the default also while it is only virtual), or null. */
function getProfile(id) {
    const key = str(id);
    if (!key) return null;
    const data = readAll();
    if (data.profiles[key]) return { ...data.profiles[key], stored: true };
    return key === data.defaultId ? defaultProfile() : null;
}

/** Every profile, the default first, then by name. */
function listProfiles() {
    const data = readAll();
    const list = Object.values(data.profiles).map((p) => ({ ...p, stored: true }));
    if (!data.profiles[data.defaultId]) list.push({ ...virtualDefault(), stored: false });
    return list.sort((a, b) => (a.id === data.defaultId ? -1 : b.id === data.defaultId ? 1 : a.name.localeCompare(b.name, "de")));
}

/** A free name: `name`, else "name (2)", "name (3)" … (the migration's category names may repeat). */
function freeName(data, name, exceptId = "") {
    const taken = (n) => Object.values(data.profiles).some((p) => p.id !== exceptId && sameName(p.name, n));
    if (!taken(name)) return name;
    for (let i = 2; ; i += 1) {
        const suffix = ` (${i})`;
        const candidate = `${name.slice(0, LIMITS.name - suffix.length)}${suffix}`;
        if (!taken(candidate)) return candidate;
    }
}

/** A checked new name: throws invalid_name / name_too_long / name_taken. */
function checkedName(data, raw, exceptId = "") {
    if (typeof raw !== "string") throw new ProfileError("invalid_name", "Name fehlt.");
    const name = raw.trim().replace(/\s+/g, " ");
    if (!name) throw new ProfileError("invalid_name", "Name fehlt.");
    if (name.length > LIMITS.name) throw new ProfileError("name_too_long", `Höchstens ${LIMITS.name} Zeichen.`);
    if (Object.values(data.profiles).some((p) => p.id !== exceptId && sameName(p.name, name))) {
        throw new ProfileError("name_taken", "Diesen Namen hat schon ein Profil.");
    }
    return name;
}

function makeId(data) {
    for (;;) {
        const id = `p-${newId(4)}`;
        if (!data.profiles[id]) return id;
    }
}

/**
 * A new profile: a copy of `copyFrom` (weights and view) or the defaults.
 * Throws ProfileError invalid_name, name_too_long, name_taken, profile_limit, not_found (copyFrom).
 */
function createProfile({ name, copyFrom = "" } = {}, { by = "", now = Date.now() } = {}) {
    const data = withDefault(readAll());
    const clean = checkedName(data, name);
    if (Object.keys(data.profiles).length >= LIMITS.profiles) throw new ProfileError("profile_limit", `Höchstens ${LIMITS.profiles} Profile.`);
    const source = copyFrom ? data.profiles[str(copyFrom)] : null;
    if (copyFrom && !source) throw new ProfileError("not_found", "Profil nicht gefunden.");
    const id = makeId(data);
    data.profiles[id] = normalizeProfile({
        id,
        name: clean,
        weights: source ? source.weights : {},
        view: source ? source.view : VIEW_DEFAULTS,
        at: now,
        by,
    }, id);
    writeAll(data);
    return getProfile(id);
}

/**
 * Change a profile: `name`, `weights` (replaced whole) and/or `view` (replaced
 * whole). Throws ProfileError not_found, invalid_name, name_too_long, name_taken.
 */
function updateProfile(id, patch = {}, { by = "", now = Date.now() } = {}) {
    const data = withDefault(readAll());
    const key = str(id);
    const current = data.profiles[key];
    if (!current) throw new ProfileError("not_found", "Profil nicht gefunden.");
    const p = isMap(patch) ? patch : {};
    const next = { ...current };
    if (p.name !== undefined) next.name = checkedName(data, p.name, key);
    if (p.weights !== undefined) next.weights = weightsOf(p.weights);
    if (p.view !== undefined) next.view = viewOf(p.view);
    next.at = now;
    next.by = str(by).slice(0, LIMITS.by);
    data.profiles[key] = normalizeProfile(next, key);
    writeAll(data);
    return getProfile(key);
}

/**
 * Delete a profile nobody uses. `inUse(id)` asks the rosters (the store does not
 * know them); a category entry counts as use too, the default is never deleted.
 * Throws ProfileError not_found, profile_default, profile_in_use.
 */
function deleteProfile(id, { inUse = () => false } = {}) {
    const data = readAll();
    const key = str(id);
    if (key === data.defaultId) throw new ProfileError("profile_default", "Das Standard-Profil bleibt.");
    if (!data.profiles[key]) throw new ProfileError("not_found", "Profil nicht gefunden.");
    if (Object.values(data.categories).includes(key) || inUse(key)) throw new ProfileError("profile_in_use", "Das Profil wird noch benutzt.");
    delete data.profiles[key];
    writeAll(data);
    return true;
}

/** The profile a category without roster keeps (`categories`), "" for none. */
function categoryProfileId(categoryId) {
    return readAll().categories[str(categoryId)] || "";
}

/** Every category entry `{ [categoryId]: profileId }`. */
function categoryProfiles() {
    return { ...readAll().categories };
}

/** Set ("" removes) a category's profile. Throws ProfileError not_found for an unknown profile. */
function setCategoryProfile(categoryId, profileId) {
    const cat = str(categoryId);
    if (!cat) return false;
    const data = withDefault(readAll());
    const pid = str(profileId);
    if (pid && !data.profiles[pid]) throw new ProfileError("not_found", "Profil nicht gefunden.");
    if (pid) data.categories[cat] = pid;
    else delete data.categories[cat];
    writeAll(data);
    return true;
}

/** Whether the one-off migration already ran. */
function isMigrated() {
    return readAll().migrated;
}

/**
 * The one-off migration from #668's files. Idempotent: once `migrated` is
 * stored it does nothing.
 * @param {{
 *   global: object|null,                     // council-weights.json `global` (null = never set)
 *   categories: { [categoryId]: object },    // council-weights.json `categories`
 *   views: { [categoryId]: object },         // council-views.json
 *   nameOf: (categoryId: string) => string,  // the category's name ("" = unknown)
 *   rosterFor: (categoryId: string) => { id: string } | null,
 *   assign: (rosterId: string, profileId: string) => void,
 * }} legacy
 * @returns {{ ran: boolean, created: { id, name, categoryId, rosterId }[] }}
 */
function migrateLegacy(legacy = {}, { now = Date.now() } = {}) {
    const data = readAll();
    if (data.migrated) return { ran: false, created: [] };
    const globalWeights = isMap(legacy.global) ? legacy.global : null;
    if (!data.profiles[DEFAULT_ID]) {
        data.profiles[DEFAULT_ID] = normalizeProfile({
            id: DEFAULT_ID,
            name: DEFAULT_NAME,
            weights: globalWeights || {},
            view: VIEW_DEFAULTS,
            at: globalWeights ? Number(globalWeights.at) || now : 0,
            by: globalWeights ? globalWeights.by : "",
        }, DEFAULT_ID);
        data.defaultId = DEFAULT_ID;
    }
    const ownWeights = isMap(legacy.categories) ? legacy.categories : {};
    const views = isMap(legacy.views) ? legacy.views : {};
    const catIds = [...new Set([...Object.keys(ownWeights), ...Object.keys(views)].map(str).filter(Boolean))];
    const created = [];
    for (const categoryId of catIds) {
        const id = idOf(`cat-${categoryId}`) || makeId(data);
        if (data.profiles[id]) continue;
        const weights = isMap(ownWeights[categoryId]) ? ownWeights[categoryId] : (globalWeights || {});
        const view = isMap(views[categoryId]) ? views[categoryId] : VIEW_DEFAULTS;
        const name = freeName(data, nameOf((legacy.nameOf && legacy.nameOf(categoryId)) || "") || categoryId);
        data.profiles[id] = normalizeProfile({ id, name, weights, view, at: now, by: "migration" }, id);
        const roster = legacy.rosterFor ? legacy.rosterFor(categoryId) : null;
        if (roster && roster.id && legacy.assign) legacy.assign(roster.id, id);
        else data.categories[categoryId] = id;
        created.push({ id, name, categoryId, rosterId: roster && roster.id ? roster.id : "" });
    }
    data.migrated = true;
    writeAll(data);
    return { ran: true, created };
}

/** Tests: another file (null = back to the default). */
function useFile(file) {
    store.useFile(file);
}

module.exports = {
    PROFILES_FILE, DEFAULT_ID, DEFAULT_NAME, LIMITS, ProfileError,
    normalizeProfile, normalizeFile, listProfiles, getProfile, defaultProfile, defaultProfileId,
    createProfile, updateProfile, deleteProfile, categoryProfileId, categoryProfiles, setCategoryProfile,
    isMigrated, migrateLegacy, useFile,
};
