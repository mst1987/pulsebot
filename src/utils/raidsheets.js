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

module.exports = { matchRaidsheet };
