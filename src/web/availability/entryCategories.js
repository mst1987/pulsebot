// The raid categories an absence or attendance can be limited to (the web's
// "Abwesenheit / Anwesenheit eintragen" dialog; in Discord the organizer panel
// of each category does the same). The same set as the raids the entries
// cover (services/signups/availability.js raidsInRange): the active categories
// (config.categoryIds) — or, when none are set, every category of a coming own
// raid. Named like the category tabs of "Meine Anwesenheit" (raiderAttendance.js):
// the Discord name, else the name its events were created with — a category
// neither knows is left out of the list (a bare Discord id helps nobody), but
// stays a valid choice (entryCategoryIds). Pictured with the final-boss icon of
// the newest raid its events' titles name, "" = none known: read from the event
// store alone, no reports or logs (this runs on every open of the dialog).
const eventStore = require("../../stores/events/eventStore");
const settingsStore = require("../../stores/settings/settingsStore");
const { CONTENT_ICONS } = require("../../services/characters/rosterAttendance");
const { contentsForText } = require("../../config/data/raidContent");
const { mainVersionFor } = require("../../services/versions/mainVersion");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/** How far back the events are read that name and picture a category. */
const LOOKBACK_DAYS = 120;

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

/** The events that name and picture a category: those of the last LOOKBACK_DAYS on, not cancelled. */
function recentEvents(now) {
    return eventStore.listEvents("", { sinceSeconds: Math.floor(now / 1000) - LOOKBACK_DAYS * 86400 })
        .filter((e) => e && e.status !== "cancelled");
}

/** Per category of `ids`: the name the first-listed of its events was created with (Map id -> name). */
function namesFrom(events, ids) {
    const wanted = new Set(ids);
    const names = new Map();
    for (const e of events) {
        const id = str(e.categoryId);
        if (wanted.has(id) && !names.has(id) && str(e.categoryName)) names.set(id, str(e.categoryName));
    }
    return names;
}

/**
 * The names categories get where Discord knows none (on a dev server always): the
 * name their events were created with - the same as the dialog's list
 * (entryCategories). `{ id: name }` for the ids it knows; one read of the event
 * store, none when `ids` is empty.
 */
function eventCategoryNames(ids, { now = Date.now() } = {}) {
    const list = [...new Set((ids || []).map(str).filter(Boolean))];
    if (!list.length) return {};
    return Object.fromEntries(namesFrom(recentEvents(now), list));
}

/**
 * Per category of `ids`: the name its events were created with and the icon of the
 * newest raid content their titles name (in the order of the rule sets, as the
 * roster's category heads pick it: rosterAttendance.categoryInfo).
 */
function eventFacts(ids, versions, now) {
    const wanted = new Set(ids);
    const events = recentEvents(now);
    const names = namesFrom(events, ids);
    const found = new Map();
    for (const e of events) {
        const id = str(e.categoryId);
        if (!wanted.has(id)) continue;
        if (!found.has(id)) found.set(id, new Set());
        // the title within the event's own version (#740), as categoryInfo reads it
        for (const c of contentsForText(str(e.title), { versionId: str(e.versionId) || versions[id] })) found.get(id).add(c);
    }
    const order = Object.keys(CONTENT_ICONS);
    const icons = {};
    for (const id of ids) {
        const contents = order.filter((c) => (found.get(id) || new Set()).has(c));
        icons[id] = CONTENT_ICONS[contents[contents.length - 1]] || "";
    }
    return { names, icons };
}

/**
 * The named categories, in the configured order: `{ id, name, icon, versionId }` —
 * `versionId` is the version the category plays (an attendance there needs a
 * character of it, availability.presenceVersionProblem).
 * @param {{ now?: number, config?: object, categoryNames?: Object<string,string> }} opts
 */
function entryCategories({ now = Date.now(), config, categoryNames = {} } = {}) {
    const cfg = config || settingsStore.getConfig();
    const ids = entryCategoryIds({ now, config: cfg });
    if (!ids.length) return [];
    const versions = Object.fromEntries(ids.map((id) => [id, mainVersionFor({ categoryId: id, config: cfg })]));
    const { names, icons } = eventFacts(ids, versions, now);
    return ids
        .map((id) => ({
            id,
            name: str(categoryNames[id]) || str(names.get(id)),
            icon: icons[id],
            versionId: versions[id],
        }))
        .filter((c) => c.name);
}

module.exports = { entryCategories, entryCategoryIds, eventCategoryNames };
