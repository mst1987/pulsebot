// The sections of a raid category (#738): which game version it played when.
//
// Every active category plays one fixed version (config.categoryVersion, pinned
// by the start-up migration). Switching it to another version is a deliberate
// step that starts a new section instead of re-reading the past:
//
//   config.categoryEras[categoryId] = [{ versionId, from, name }, …]   oldest first
//
//   versionId  the version the category played in that section
//   from       ms since the epoch the section began (0 = "always")
//   name       the Discord category name at the switch — what a closed
//              section's raids are called after a rename (#744)
//
// A category never switched has no list; it reads as one section "since
// always" in the version it plays today. Raids keep their own stored version
// (#737) — the sections only say which version the category ran at a time,
// and which name its older raids carry.
//
// templateVersionProblem() is the one rule for "a template of another version
// creates no event in this category" (series, default template, Discord modal).
const { rulesFor } = require("../../config/gameVersions");
const { mainVersionFor, knownVersion } = require("./mainVersion");

/** The stored config (configStore, not the settingsStore facade — see mainVersion.js' configOf). */
function configOf(config) {
    if (config && typeof config === "object") return config;
    try {
        return require("../../stores/configStore").getConfig() || {};
    } catch {
        return {};
    }
}

/** ms of a time given as unix seconds or ms; `Date.now()` without one. */
function toMs(time) {
    if (time === undefined || time === null || time === "") return Date.now();
    const n = Number(time) || 0;
    return n > 0 && n < 1e12 ? n * 1000 : n;
}

/**
 * Every section of a category, oldest first. Without a stored history: one
 * section since always in the version it plays today.
 * @returns {{ versionId: string, from: number, name: string }[]}
 */
function erasOf(categoryId, { config } = {}) {
    const cfg = configOf(config);
    const id = String(categoryId || "").trim();
    const map = cfg.categoryEras && typeof cfg.categoryEras === "object" && !Array.isArray(cfg.categoryEras) ? cfg.categoryEras : {};
    const stored = (Array.isArray(map[id]) ? map[id] : [])
        .filter((e) => e && knownVersion(e.versionId))
        .map((e) => ({ versionId: e.versionId, from: Number(e.from) || 0, name: String(e.name || "") }))
        .sort((a, b) => a.from - b.from);
    return stored.length ? stored : [{ versionId: mainVersionFor({ categoryId: id, config: cfg }), from: 0, name: "" }];
}

/**
 * The section a category was in at `time` (unix seconds or ms; now without
 * one). A time before the first recorded section belongs to the first one.
 */
function categoryEraAt(categoryId, time, { config } = {}) {
    const eras = erasOf(categoryId, { config });
    const at = toMs(time);
    let hit = eras[0];
    for (const era of eras) if (era.from <= at) hit = era;
    return { ...hit, current: hit === eras[eras.length - 1] };
}

/**
 * The category name a raid shows (#744): the name of its section when that
 * section is closed and recorded one, else `liveName` — the name the category
 * has in Discord now (or the one stored with the raid). So after "TBC Montag"
 * became "Forever Montag", the TBC raids keep "TBC Montag" and the new ones
 * read "Forever Montag". Everything else keys on the category id; this is
 * display only.
 * @param {string} categoryId
 * @param {number} time       the raid's start (unix seconds or ms)
 * @param {string} liveName   the current name ("" when unknown)
 */
function categoryNameAt(categoryId, time, liveName = "", { config } = {}) {
    const fallback = String(liveName || "");
    const id = String(categoryId || "").trim();
    if (!id || !time) return fallback;
    const cfg = configOf(config);
    const stored = cfg.categoryEras && typeof cfg.categoryEras === "object" ? cfg.categoryEras[id] : null;
    if (!Array.isArray(stored) || stored.length < 2) return fallback; // never switched: one section, the live name
    const era = categoryEraAt(id, time, { config: cfg });
    return !era.current && era.name ? era.name : fallback;
}

/** The section a category is in now — the last one. */
function currentEra(categoryId, { config } = {}) {
    const eras = erasOf(categoryId, { config });
    return { ...eras[eras.length - 1], current: true };
}

/**
 * The history after a switch to `toVersion` at `at` (pure): a category without
 * one first gets its old section ("since always", in `fromVersion`); the open
 * section is closed under the name the category has now, and the new one
 * starts with that name too. The same version again changes nothing.
 * @param {{ versionId: string, from: number, name: string }[]} stored  the stored list ([] = none)
 */
function switchEras(stored, { fromVersion, toVersion, at = Date.now(), name = "" }) {
    const eras = (Array.isArray(stored) ? stored : []).map((e) => ({ versionId: e.versionId, from: Number(e.from) || 0, name: String(e.name || "") }));
    if (!eras.length) eras.push({ versionId: fromVersion, from: 0, name: "" });
    const open = eras[eras.length - 1];
    if (open.versionId === toVersion) return eras;
    const label = String(name || "").trim();
    if (label) open.name = label;
    eras.push({ versionId: toVersion, from: Math.max(Number(at) || 0, open.from + 1), name: label || open.name });
    return eras;
}

/**
 * Why a raid template cannot create an event in a category (#738): its
 * version is not the one the category plays. "" when it fits — also without a
 * template, a category or a template version (nothing to compare).
 * @param {{ template?: { name?: string, versionId?: string } | null, categoryId?: string, config?: object }} p
 */
function templateVersionProblem({ template, categoryId, config } = {}) {
    const templateVersion = knownVersion(template && template.versionId);
    const cat = String(categoryId || "").trim();
    if (!templateVersion || !cat) return "";
    const categoryVersion = mainVersionFor({ categoryId: cat, config: configOf(config) });
    if (templateVersion === categoryVersion) return "";
    const label = (id) => (rulesFor(id) || {}).label || id;
    const name = String((template && template.name) || "").trim();
    return `Die Raid-Vorlage${name ? ` „${name}“` : ""} ist für ${label(templateVersion)}, die Kategorie spielt ${label(categoryVersion)}.`;
}

module.exports = { erasOf, categoryEraAt, categoryNameAt, currentEra, switchEras, templateVersionProblem };
