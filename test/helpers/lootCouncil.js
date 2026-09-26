// Shared rows for the web/loot/lootCouncil suites (test/web/lootCouncil.*.test.js):
// a loot row, a charGear entry and a worn item, all relative to one `now`.
const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

const lootRow = (over = {}) => ({
    characterKey: "devihra", character: "Devihra", itemId: 31064, itemName: "Hood of Absolution",
    itemIconUrl: "", itemQuality: 4, contentId: "bt", boss: "Illidan", categoryId: "cat-mo",
    reason: "mainspec", reasonLabel: "Mainspec", reasonTone: "mainspec",
    awardedAt: now - 3 * DAY, eventLabel: "Montagsraid", ...over,
});

// Mirrors what charGear.js hands out, profile included — the council reads it
// to warn when a raider was last logged wearing healing gear.
const gearOf = (items, over = {}) => ({
    key: "devihra", character: "Devihra", className: "Priest", seenAt: now - DAY,
    reportId: "r1", reportTitle: "Report", items,
    profile: { role: "caster", confident: true }, skippedReports: 0, roleMismatch: false,
    ...over,
});

const item = (slot, itemId, itemLevel = 140) => ({
    slot, itemId, itemLevel, gems: [], enchantId: 0, itemName: `Item ${itemId}`,
});

module.exports = { DAY, now, lootRow, gearOf, item };
