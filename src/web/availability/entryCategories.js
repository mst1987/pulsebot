// The raid categories an absence or attendance can be limited to (the web's
// "Abwesenheit / Anwesenheit eintragen" dialog; in Discord the organizer panel
// of each category does the same). The same set as the raids the entries
// cover (services/signups/availability.js raidsInRange): the active categories
// (config.categoryIds) — or, when none are set, every category of a coming own
// raid. Named and pictured like the category tabs of "Meine Anwesenheit"
// (raiderAttendance.js): the Discord name, else the name its events were
// created with; the final-boss icon of the raid it mostly runs, "" = none known.
const eventStore = require("../../stores/eventStore");
const settingsStore = require("../../stores/settingsStore");
const { buildAttendanceContext, categoryInfo } = require("../../services/characters/rosterAttendance");
const { mainVersionFor } = require("../../services/events/mainVersion");
const { eventCategoryNames } = require("./raiderAttendance");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/** The ids an entry may name: the active categories, else those of the coming own raids. */
function entryCategoryIds({ now = Date.now(), config } = {}) {
    const cfg = config || settingsStore.getConfig();
    const active = (Array.isArray(cfg.categoryIds) ? cfg.categoryIds : []).map(str).filter(Boolean);
    if (active.length) return [...new Set(active)];
    const coming = eventStore.listEvents("", { sinceSeconds: Math.floor(now / 1000) })
        .filter((e) => e && e.status !== "cancelled")
        .map((e) => str(e.categoryId))
        .filter(Boolean);
    return [...new Set(coming)];
}

/** The icon of each category, from one attendance context per game version the categories play. */
function iconsOf(ids, versions, now) {
    const ctxByVersion = new Map();
    const out = {};
    for (const id of ids) {
        const version = versions[id];
        try {
            if (!ctxByVersion.has(version)) ctxByVersion.set(version, buildAttendanceContext("", { now, versionId: version }));
            out[id] = categoryInfo(ctxByVersion.get(version), id).icon || "";
        } catch {
            // no reports or logs to read: the client shows the neutral raid icon
            out[id] = "";
        }
    }
    return out;
}

/**
 * The categories, in the configured order: `{ id, name, icon, versionId }` —
 * `versionId` is the version the category plays (an attendance there needs a
 * character of it, availability.presenceVersionProblem).
 * @param {{ now?: number, config?: object, categoryNames?: Object<string,string> }} opts
 */
function entryCategories({ now = Date.now(), config, categoryNames = {} } = {}) {
    const cfg = config || settingsStore.getConfig();
    const ids = entryCategoryIds({ now, config: cfg });
    if (!ids.length) return [];
    const versions = Object.fromEntries(ids.map((id) => [id, mainVersionFor({ categoryId: id, config: cfg })]));
    const fallback = eventCategoryNames(now);
    const icons = iconsOf(ids, versions, now);
    return ids.map((id) => ({
        id,
        name: str(categoryNames[id]) || str(fallback.get(id)),
        icon: icons[id],
        versionId: versions[id],
    }));
}

module.exports = { entryCategories, entryCategoryIds };
