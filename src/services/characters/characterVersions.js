// Which game version a character of the roster and the loot history belongs to
// (#543). A raider plays TBC and WoW Forever side by side, so the overviews
// separate them — filtered to the main version by default.
//
// Nothing is stored for it; the evidence, strongest first:
//   1. the raider profiles: a profile character carries its `versionId`
//      (matched by name — "Devi Res" is the Forever character "forever~devi res");
//   2. the loot: an item of an own event has that event's version, any other
//      item (Raid-Helper, a manual bucket) is TBC — stored records never move;
//   3. only when neither knows the character: the version its raid categories
//      play (services/events/mainVersion.js).
// A character with no evidence at all is TBC (LEGACY_VERSION), what everything
// before versions was.
const { LEGACY_VERSION, VERSIONS } = require("../../config/gameVersions");
const { knownVersion, mainVersionFor, visibleVersions } = require("../events/mainVersion");
const { nameKeyOf } = require("../../utils/loot/lootImport");
const profiles = require("../../stores/raiderProfileStore");
const eventStore = require("../../stores/eventStore");

/**
 * What the lookups need, read once per request.
 * @param {{ config?: object }} [opts]
 */
function buildVersionContext({ config } = {}) {
    const byName = new Map();
    for (const p of profiles.listProfiles()) {
        for (const c of p.characters) {
            const key = nameKeyOf(c.name);
            if (!byName.has(key)) byName.set(key, new Set());
            byName.get(key).add(c.versionId || LEGACY_VERSION);
        }
    }
    return { byName, eventCache: new Map(), config };
}

/** The version of the event a loot item came from: an own event's, else TBC. */
function eventVersion(ctx, eventId) {
    const id = String(eventId || "");
    if (!id) return LEGACY_VERSION;
    if (!ctx.eventCache.has(id)) {
        const event = eventStore.isOwnEventId(id) ? eventStore.getEvent(id) : null;
        ctx.eventCache.set(id, (event && knownVersion(event.versionId)) || LEGACY_VERSION);
    }
    return ctx.eventCache.get(id);
}

/**
 * The versions one character belongs to, sorted as the rule sets are.
 * @param {object} ctx  buildVersionContext()
 * @param {{ name: string, items?: { eventId?: string }[], categoryIds?: string[] }} row
 * @returns {string[]}
 */
function versionsOfCharacter(ctx, { name, items = [], categoryIds = [] }) {
    const out = new Set(ctx.byName.get(nameKeyOf(name)) || []);
    for (const it of items || []) out.add(eventVersion(ctx, it && it.eventId));
    if (!out.size) for (const id of categoryIds || []) out.add(mainVersionFor({ categoryId: id, config: ctx.config }));
    if (!out.size) out.add(LEGACY_VERSION);
    return VERSIONS.map((v) => v.id).filter((id) => out.has(id));
}

/**
 * The version picker of a list: every version that has characters, plus the
 * main version (the default filter), each `{ id, label, short, count }`.
 */
function versionChoices(rows, mainVersion, { config } = {}) {
    const counts = new Map();
    for (const r of rows) for (const v of r.versionIds || []) counts.set(v, (counts.get(v) || 0) + 1);
    // Other versions hidden (#563): never offered, whatever rows there are.
    const visible = new Set(visibleVersions(config));
    return VERSIONS
        .filter((v) => visible.has(v.id))
        .filter((v) => counts.has(v.id) || v.id === mainVersion)
        .map((v) => ({ id: v.id, label: v.label, short: v.short || v.label, count: counts.get(v.id) || 0 }));
}

module.exports = { buildVersionContext, eventVersion, versionsOfCharacter, versionChoices };
