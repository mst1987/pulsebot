// The numbers behind the Roster page's header band — "51 Charaktere · 19 mit
// Gear-Problemen" turned into something a raid lead can read at a glance.
//
// A pure fold over the rows buildRoster() already assembled: no store, no
// Discord, no API. That keeps it testable and guarantees the header can never
// disagree with the table below it — both describe the same array.
//
// It stays on the *whole* roster on purpose. The header describes the guild,
// the filter bar underneath narrows the table; a headline that shrinks while
// you type would answer a different question than the one it asks.

// Beyond this many segments the strip's slices get too thin to hit, and the
// legend wraps into a second block that competes with the tiles. Ten fits
// TBC's nine classes plus the "Unbekannt" bucket, so a normal roster is never
// folded; anything past that goes into one "Weitere" segment instead of
// growing more colours — the table below is the exhaustive view.
const MAX_CLASS_SEGMENTS = 10;

/** A character counts as evaluated once a gear report mentions it. */
function isEvaluated(c) {
    return !!(c && c.gear);
}

function issueCount(c) {
    return isEvaluated(c) ? Number(c.gear.issueCount) || 0 : 0;
}

/**
 * How the roster splits across the WoW classes, biggest first.
 *
 * Colours are the ones buildRoster() already put on the row (CLASS_COLORS) —
 * never recomputed here, so the strip, the table cell and the character page
 * always paint a class the same way. Characters whose class nobody knows yet
 * are collected under an explicit "Unbekannt" bucket rather than dropped: a
 * distribution that silently omits rows misstates the roster's size.
 *
 * @param {object[]} chars  roster rows
 * @returns {{className: string, classColor: string, count: number}[]}
 */
function classDistribution(chars) {
    const byClass = new Map();
    for (const c of chars || []) {
        const className = String((c && c.className) || "").trim();
        const key = className || "Unbekannt";
        const entry = byClass.get(key) || { className: key, classColor: "", count: 0, known: !!className };
        entry.count += 1;
        // First non-empty colour wins — rows of the same class carry the same
        // one. The "Unbekannt" bucket stays colourless whatever its rows say:
        // it is not a class, and the UI paints it with the muted token.
        if (className && !entry.classColor && c.classColor) entry.classColor = c.classColor;
        byClass.set(key, entry);
    }
    const list = [...byClass.values()].sort((a, b) => {
        // Unknown always last: it is the absence of a class, not a big one.
        if (a.known !== b.known) return a.known ? -1 : 1;
        if (b.count !== a.count) return b.count - a.count;
        return a.className.localeCompare(b.className);
    });
    const head = list.slice(0, MAX_CLASS_SEGMENTS).map(({ className, classColor, count }) => ({ className, classColor, count }));
    const tail = list.slice(MAX_CLASS_SEGMENTS);
    if (tail.length) {
        head.push({
            className: "Weitere",
            classColor: "",
            count: tail.reduce((n, e) => n + e.count, 0),
        });
    }
    return head;
}

/**
 * The header's stat block for a roster.
 *
 * @param {object[]} chars  rows as returned by buildRoster()
 * @returns {{
 *   total: number, assigned: number, fromLootOnly: number,
 *   categories: number, uncategorized: number, loot: number,
 *   evaluated: number, withIssues: number, clean: number,
 *   issues: number, highIssues: number,
 *   classes: {className: string, classColor: string, count: number}[]
 * }}
 */
function rosterStats(chars) {
    const rows = Array.isArray(chars) ? chars : [];
    const categoryIds = new Set();
    let assigned = 0;
    let uncategorized = 0;
    let loot = 0;
    let evaluated = 0;
    let withIssues = 0;
    let issues = 0;
    let highIssues = 0;

    for (const c of rows) {
        if (c.assigned) assigned += 1;
        const ids = Array.isArray(c.categoryIds) ? c.categoryIds : [];
        if (!ids.length) uncategorized += 1;
        for (const id of ids) categoryIds.add(id);
        loot += Number(c.lootCount) || 0;
        if (!isEvaluated(c)) continue;
        evaluated += 1;
        const n = issueCount(c);
        if (n) withIssues += 1;
        issues += n;
        highIssues += (c.gear.issues || []).filter((i) => i && i.severity === "high").length;
    }

    return {
        total: rows.length,
        assigned,
        fromLootOnly: rows.length - assigned,
        categories: categoryIds.size,
        uncategorized,
        loot,
        evaluated,
        withIssues,
        clean: evaluated - withIssues,
        issues,
        highIssues,
        classes: classDistribution(rows),
    };
}

module.exports = { rosterStats, classDistribution, MAX_CLASS_SEGMENTS };
