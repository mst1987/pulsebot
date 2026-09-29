// The game version of an imported loot row (#542): the version of the event it
// is filed under - an own event's own, a Raid-Helper event's category's, a
// hand-typed label's category's - so a Forever raid's loot links Forever's
// Wowhead and never the TBC one. Asked once per import, after the target event
// is known (the parse itself linked with the main version).
const { getEvent } = require("../../stores/eventStore");
const { versionOfEvent } = require("../events/mainVersion");
const { versionLinks } = require("../events/versionSettings");

/** The version of an import target `{ eventId, categoryId }`. */
function versionOfImport({ eventId = "", categoryId = "" } = {}) {
    const ev = eventId ? getEvent(String(eventId)) : null;
    return versionOfEvent({ versionId: ev ? ev.versionId : "", categoryId: (ev && ev.categoryId) || categoryId });
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

module.exports = { versionOfImport, relinkItems, linkItemsForImport };
