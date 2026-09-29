// Match a Raidhelper event to the raidsheet it belongs to, based on the
// keywords configured per raidsheet in the admin settings. Pure + testable.

/** Normalise a string for case-insensitive keyword matching. */
function norm(s) {
    return String(s || "").toLowerCase();
}

/**
 * Return the first raidsheet whose keywords appear in the event title, or null.
 * A raidsheet with no keywords never auto-matches (it must be picked manually).
 *
 * @param {Array} raidsheets  [{ id, name, keywords: string[] }]
 * @param {string} title      the event title (e.g. "GDKP Karazhan")
 */
function matchRaidsheet(raidsheets, title) {
    const hay = norm(title);
    if (!hay) return null;
    for (const sheet of raidsheets || []) {
        const keywords = (sheet.keywords || [])
            .map((k) => norm(k).trim())
            .filter(Boolean);
        if (keywords.some((kw) => hay.includes(kw))) return sheet;
    }
    return null;
}

/**
 * The raidsheet of an event of one game version (#542): a keyword match first,
 * else the version's own default sheet (versionSettings.raidsheetId). A sheet
 * that is another version's default never matches by keyword - a Forever
 * "Hyjal" must not land in the TBC Hyjal sheet once each has its own.
 *
 * @param {Array} raidsheets
 * @param {string} title
 * @param {{ ownId?: string, otherIds?: string[] }} [opts] the version's sheet, the other versions' sheets
 */
function pickRaidsheet(raidsheets, title, { ownId = "", otherIds = [] } = {}) {
    const list = raidsheets || [];
    const others = new Set((otherIds || []).filter((id) => id && id !== ownId));
    return matchRaidsheet(list.filter((s) => !others.has(s.id)), title)
        || (ownId ? list.find((s) => s.id === ownId) || null : null);
}

module.exports = { matchRaidsheet, pickRaidsheet };
