// The game version of an imported loot row (#542): the version of the event it
// is filed under - an own event's own, a scanned Raid-Helper raid's stored one
// (#737), else (a raid not scanned yet, a hand-typed label) the category's -
// so a Forever raid's loot links Forever's
// Wowhead and never the TBC one. Asked once per import, after the target event
// is known (the parse itself linked with the main version).
const { getEvent } = require("../../stores/events/eventStore");
const { versionOfEvent } = require("../versions/mainVersion");
const { versionLinks } = require("../versions/versionSettings");
const { enrichItemNames } = require("../../utils/loot/lootImport");

/** The version of an import target `{ eventId, categoryId }`. */
function versionOfImport({ eventId = "", categoryId = "" } = {}) {
    const ev = eventId ? getEvent(String(eventId)) : null;
    return versionOfEvent({ id: String(eventId || ""), versionId: ev ? ev.versionId : "", categoryId: (ev && ev.categoryId) || categoryId });
}

/** Set every item's Wowhead link to the one of `versionId` ("" when it has no Wowhead path); mutates and returns `items`. */
function relinkItems(items, versionId) {
    const links = versionLinks(versionId);
    for (const it of items || []) if (it && it.itemId) it.itemLink = links.wowheadItem(it.itemId);
    return items;
}

/** Relink `items` for the version of the event they are filed under; returns the items. */
function linkItemsForImport(items, target) {
    return relinkItems(items, versionOfImport(target));
}

/** Fill in names/icons/qualities from the Wowhead section of the version `target` is filed under. */
function enrichForImport(items, target) {
    return enrichItemNames(items, { versionId: versionOfImport(target) });
}

/**
 * Link and fill in the `items` of an upload waiting in the inbox: no event yet, so the
 * version the upload named (#1002), else the one of its suggested raid, else the main
 * version. The main version's Wowhead section does not know another version's items
 * (Forever answers 404 for a TBC raid's), so asking it first leaves them without an icon.
 */
function enrichForUpload(items, { gameVersion = "", match = null } = {}) {
    const versionId = gameVersion || versionOfImport((match && match.suggested) || {});
    relinkItems(items, versionId);
    return enrichItemNames(items, { versionId });
}

module.exports = { versionOfImport, relinkItems, linkItemsForImport, enrichForImport, enrichForUpload };
