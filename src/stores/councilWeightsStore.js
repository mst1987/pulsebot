// How the loot council weighs (#668): what one item counts as ("Loot-Punkte"),
// how the four parts of the need score weigh against each other, and how long
// it takes until belonging ("Zugehörigkeit") counts in full.
//
//   data/settings/council-weights.json = {
//     global: Settings,                       // the server's weighting
//     categories: { [categoryId]: Settings }, // optional: a raid category's own, replaces global as a whole
//   }
//   Settings = {
//     classes: { trinket, bisWeapon, weapon, set, normal, frequent },  // 0..5, step 0.1
//     items: { [itemId]: { weight, name } },  // per-item exceptions (≤ 200), weight 0..5
//     need: { drought, share, need, tenure }, // 0..100 each; normalised to a sum of 100 when used
//     tenureDays,                             // 7..365: days until the tenure part is full
//     at, by,                                 // last change
//   }
//
// A category's settings replace the global ones *as a whole* rather than field
// by field: "this raid weighs differently" is one decision, and a half-inherited
// mix (own classes, global exceptions) would be impossible to read off the page.
// Nothing stored means the defaults (DEFAULTS), so a fresh install weighs
// exactly like the issue's table.
//
// Read by web/loot/lootCouncil.js (councilRoster) through weightsFor(); the item
// classes themselves are resolved in services/loot/itemWeights.js.
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");

const WEIGHTS_FILE = settingsPath("council-weights.json");

/** The item classes, in the order the settings page lists them. */
const CLASS_IDS = ["trinket", "bisWeapon", "weapon", "set", "normal", "frequent"];
/** The four parts of the need score. */
const NEED_IDS = ["drought", "share", "need", "tenure"];

const DEFAULTS = Object.freeze({
    classes: Object.freeze({ trinket: 2, bisWeapon: 2, weapon: 1.5, set: 1, normal: 1, frequent: 0.5 }),
    items: Object.freeze({}),
    need: Object.freeze({ drought: 45, share: 30, need: 10, tenure: 15 }),
    tenureDays: 90,
});

const LIMITS = Object.freeze({
    weightMax: 5,
    needMax: 100,
    tenureMin: 7,
    tenureMax: 365,
    items: 200,
    name: 80,
});

const isMap = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** An item weight: a number 0..5 on a 0.1 grid, else the fallback. */
function weightOf(raw, fallback) {
    const n = Number(raw);
    if (raw === null || raw === undefined || raw === "" || !Number.isFinite(n)) return fallback;
    return Math.round(clamp(n, 0, LIMITS.weightMax) * 10) / 10;
}

function normalizeClasses(raw) {
    const src = isMap(raw) ? raw : {};
    const out = {};
    for (const id of CLASS_IDS) out[id] = weightOf(src[id], DEFAULTS.classes[id]);
    return out;
}

function normalizeItems(raw) {
    const out = {};
    if (!isMap(raw)) return out;
    for (const [key, entry] of Object.entries(raw)) {
        if (Object.keys(out).length >= LIMITS.items) break;
        const id = Number(key);
        if (!Number.isInteger(id) || id <= 0) continue;
        const e = isMap(entry) ? entry : { weight: entry };
        const weight = weightOf(e.weight, null);
        if (weight === null) continue;
        out[String(id)] = { weight, name: String(e.name || "").trim().slice(0, LIMITS.name) };
    }
    return out;
}

/** The need weights as whole numbers 0..100; all zero falls back to the defaults (a score of nothing says nothing). */
function normalizeNeed(raw) {
    const src = isMap(raw) ? raw : {};
    const out = {};
    for (const id of NEED_IDS) {
        const n = Number(src[id]);
        out[id] = src[id] === undefined || src[id] === null || !Number.isFinite(n)
            ? DEFAULTS.need[id]
            : Math.round(clamp(n, 0, LIMITS.needMax));
    }
    if (!NEED_IDS.some((id) => out[id] > 0)) return { ...DEFAULTS.need };
    return out;
}

function normalizeTenureDays(raw) {
    const n = Number(raw);
    if (raw === undefined || raw === null || raw === "" || !Number.isFinite(n)) return DEFAULTS.tenureDays;
    return Math.round(clamp(n, LIMITS.tenureMin, LIMITS.tenureMax));
}

/** One settings block, cleaned: unknown fields drop out, every number is clamped. */
function normalizeSettings(raw) {
    const s = isMap(raw) ? raw : {};
    return {
        classes: normalizeClasses(s.classes),
        items: normalizeItems(s.items),
        need: normalizeNeed(s.need),
        tenureDays: normalizeTenureDays(s.tenureDays),
        at: Number(s.at) || 0,
        by: String(s.by || "").slice(0, 80),
    };
}

/** The defaults as a fresh settings block. */
function defaults() {
    return normalizeSettings({});
}

const store = createJsonStore({
    file: WEIGHTS_FILE,
    defaults: () => ({ global: null, categories: {} }),
    normalize: (data) => {
        const d = isMap(data) ? data : {};
        const categories = {};
        for (const [catId, entry] of Object.entries(isMap(d.categories) ? d.categories : {})) {
            const key = String(catId).trim();
            if (key && isMap(entry)) categories[key] = normalizeSettings(entry);
        }
        return { global: isMap(d.global) ? normalizeSettings(d.global) : null, categories };
    },
});

/** The server's settings (the defaults when nothing is stored). `stored` says which. */
function globalWeights() {
    const g = store.read().global;
    return g ? { ...g, stored: true } : { ...defaults(), stored: false };
}

/** A category's own settings, or null when it follows the server's. */
function categoryWeights(categoryId) {
    const key = String(categoryId || "").trim();
    if (!key) return null;
    return store.read().categories[key] || null;
}

/**
 * The settings the council uses for a category ("" = every category): its own
 * when it has some, else the server's. `scope` says which ("category" | "global").
 */
function weightsFor(categoryId = "") {
    const own = categoryWeights(categoryId);
    if (own) return { ...own, scope: "category" };
    const g = globalWeights();
    delete g.stored;
    return { ...g, scope: "global" };
}

/** Store the server's settings, or ("" category ignored) a category's own. Returns the stored block. */
function setWeights(categoryId, settings, { by = "", now = Date.now() } = {}) {
    const key = String(categoryId || "").trim();
    const clean = { ...normalizeSettings(settings), at: now, by: String(by || "").slice(0, 80) };
    store.update((data) => {
        if (key) data.categories[key] = clean;
        else data.global = clean;
        return data;
    });
    return clean;
}

/**
 * Back to the defaults: for the server, the stored block goes; for a category,
 * its own settings go and it follows the server's again.
 */
function resetWeights(categoryId = "") {
    const key = String(categoryId || "").trim();
    store.update((data) => {
        if (key) delete data.categories[key];
        else data.global = null;
        return data;
    });
}

/**
 * The need weights as shares of 1 (summing to 1) — what the score multiplies
 * by. The page edits whole numbers; normalising here means "30 / 30 / 30 / 10"
 * and "3 / 3 / 3 / 1" weigh the same, and no setting can push a score past 100.
 */
function effectiveNeedWeights(need) {
    const n = normalizeNeed(need);
    const sum = NEED_IDS.reduce((s, id) => s + n[id], 0);
    const out = {};
    for (const id of NEED_IDS) out[id] = n[id] / sum;
    return out;
}

/** Tests: another file (null = back to the default). */
function useFile(file) {
    store.useFile(file);
}

module.exports = {
    WEIGHTS_FILE, CLASS_IDS, NEED_IDS, DEFAULTS, LIMITS,
    normalizeSettings, defaults, globalWeights, categoryWeights, weightsFor, setWeights, resetWeights,
    effectiveNeedWeights, useFile,
};
