// One awarded piece of loot, as the "Latest Loot" views render it: the trimmed
// loot row the history pages already use, plus who won it and how they play.
//
// Two consumers share this: the dashboard's card (the newest few top-item
// awards) and the Historie-&-Loot tab of the same name (all awards, filterable
// and paged). Both therefore show identical rows — the tab is the card's full
// version, not a second implementation of it.
const { listAll: listAllLoot, charLootPreview } = require("./lootStore");
const { characterMap } = require("./characterStore");
const { getConfig } = require("./settingsStore");
const { characterProfile } = require("../utils/setupView");
const { CONTENTS } = require("../config/tbcContent");
const { reasonCatalog } = require("../utils/lootReasons");

// How many awards one page of the Historie tab holds.
const PAGE_SIZE = 25;

// Filter value for loot whose raid the content table doesn't know — never
// silently filed under a raid, so it stays findable (same rule and value as the
// "Items" tab, see LootItemsTab.tsx).
const UNKNOWN_CONTENT = "__unknown__";

/** The item ids configured as top items (Einstellungen → Loot). */
function topItemIds() {
    return new Set((getConfig().topItems || []).map((it) => Number(it.id)).filter(Boolean));
}

/**
 * One stored loot row as an award: the trimmed shape plus the winner's name and
 * their class/spec look. Colour and icon are resolved server-side like every
 * other class colour in the app (see ClassSpec.tsx) — a character nobody has
 * resolved yet simply keeps empty fields and renders uncoloured.
 */
function awardRow(it, known) {
    const info = known[it.characterKey] || null;
    const look = info ? characterProfile(info.className, info.spec) : null;
    return {
        ...charLootPreview(it),
        character: it.character,
        realm: it.realm || "",
        boss: it.boss || "",
        className: (look && look.className) || "",
        spec: (info && info.spec) || "",
        classColor: (look && look.classColor) || "",
        specIconUrl: (look && look.iconUrl) || "",
    };
}

// Matches the free-text search against what the row is read by: the item name,
// the winner, and the item id (the only handle a not-yet-named Gargul row has).
function matchesSearch(it, needle) {
    if (!needle) return true;
    const hay = `${it.itemName || ""} ${it.character || ""} ${it.itemId || ""}`.toLowerCase();
    return hay.includes(needle);
}

function matchesContent(it, contentId) {
    if (!contentId) return true;
    if (contentId === UNKNOWN_CONTENT) return !it.contentId;
    return it.contentId === contentId;
}

/**
 * Awards, newest first, filtered and cut into pages.
 *
 * `topOnly` (the default) keeps only the drops the guild flagged as top items —
 * matched by item id, the one field every export carries. With no top items
 * configured that is deliberately empty rather than "everything".
 *
 * Returns the page plus what the filter bar needs: the totals, and the contents
 * and reasons that actually occur in the current scope — offering a raid the
 * guild has never set foot in is noise (same rule as lootStats()).
 *
 * @param {object} [opts] { topOnly, search, categoryId, contentId, reason, page, pageSize }
 */
function listAwards({
    topOnly = true, search = "", categoryId = "", contentId = "", reason = "",
    page = 1, pageSize = PAGE_SIZE,
} = {}) {
    const ids = topItemIds();
    const scoped = topOnly
        ? listAllLoot().filter((it) => ids.has(Number(it.itemId)))
        : listAllLoot();

    const needle = String(search || "").trim().toLowerCase();
    const filtered = scoped.filter((it) => (
        matchesSearch(it, needle)
        && (!categoryId || it.categoryId === categoryId)
        && matchesContent(it, contentId)
        && (!reason || it.reason === reason)
    ));

    const size = Math.max(1, Number(pageSize) || PAGE_SIZE);
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / size));
    const current = Math.min(Math.max(1, Number(page) || 1), totalPages);
    const rows = filtered.slice((current - 1) * size, current * size);
    // Only read the character store when there is something to annotate.
    const known = rows.length ? characterMap() : {};

    const usedContents = new Set(scoped.map((it) => it.contentId).filter(Boolean));
    const usedReasons = new Set(scoped.map((it) => it.reason).filter(Boolean));
    return {
        items: rows.map((it) => awardRow(it, known)),
        page: current,
        pageSize: size,
        total,
        totalPages,
        topItemCount: ids.size,
        contents: CONTENTS.filter((c) => usedContents.has(c.id)),
        reasons: reasonCatalog().filter((r) => usedReasons.has(r.id)),
        unknownContentCount: scoped.filter((it) => !it.contentId).length,
    };
}

module.exports = { listAwards, awardRow, topItemIds, PAGE_SIZE, UNKNOWN_CONTENT };
