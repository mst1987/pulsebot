// Attendance of one character for the bot's /anwesenheit (issue #265) — the same
// rules and the same sources as the roster page (rosterAttendance.js), without
// building the whole roster (gear issues, links, every other character) for a
// single answer.
const { buildAttendanceContext, attendanceFor } = require("./rosterAttendance");
const { listAllAssignments } = require("./raiderCharactersStore");
const { annotatedCharacters } = require("./characterInfo");
const { listKnownCategories } = require("./categoryNames");
const { splitPlayer, characterKeyOf } = require("../utils/loot/lootImport");

/**
 * Every character name the roster knows (loot and assignments), for autocomplete.
 * @returns {string[]}
 */
function knownCharacterNames() {
    const names = new Map();
    for (const c of annotatedCharacters()) {
        const key = characterKeyOf(c.character);
        if (key && !names.has(key)) names.set(key, c.character);
    }
    for (const map of Object.values(listAllAssignments())) {
        for (const name of Object.values(map)) {
            const key = characterKeyOf(name);
            if (key && !names.has(key)) names.set(key, String(name).trim());
        }
    }
    return [...names.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * One character's attendance per raid category, the categories it raids in
 * found the way the roster finds them (assignment or loot there).
 *
 * @returns {{ character: string, categories: {id, name, attended, total, pct, missed}[] }}
 */
function characterAttendance(guildId, name, { ctx } = {}) {
    const key = characterKeyOf(name);
    const character = splitPlayer(String(name || "").trim()).character;
    if (!key) return { character, categories: [] };

    const userIdsByCategory = new Map();
    for (const [categoryId, map] of Object.entries(listAllAssignments())) {
        for (const [userId, charName] of Object.entries(map)) {
            if (characterKeyOf(charName) !== key) continue;
            const list = userIdsByCategory.get(categoryId) || [];
            list.push(String(userId));
            userIdsByCategory.set(categoryId, list);
        }
    }
    const categoryIds = new Set(userIdsByCategory.keys());
    const loot = annotatedCharacters().find((c) => characterKeyOf(c.character) === key);
    for (const id of (loot && loot.categoryIds) || []) categoryIds.add(id);

    const context = ctx || buildAttendanceContext(guildId);
    const names = new Map(listKnownCategories(guildId).map((c) => [c.id, c.name]));
    const categories = [...categoryIds].map((id) => {
        const { attended, total, pct, missed } = attendanceFor(context, id, character, userIdsByCategory.get(id) || []);
        return { id, name: names.get(id) || "Unbekannte Kategorie", attended, total, pct, missed };
    }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    return { character: (loot && loot.character) || character, categories };
}

/** The number a reply leads with: attended of counted nights over all categories. */
function overall(categories) {
    const attended = categories.reduce((n, c) => n + c.attended, 0);
    const total = categories.reduce((n, c) => n + c.total, 0);
    return { attended, total, pct: total ? Math.round((attended / total) * 100) : null };
}

/**
 * The embed fields of one character: one field per category ("8/11 · 73 %",
 * the last missed nights with their reason). At most `max` categories.
 */
function attendanceFields(categories, { max = 4, missedShown = 3 } = {}) {
    return categories.slice(0, max).map((c) => {
        const head = c.total ? `**${c.attended}/${c.total}** · ${c.pct} %` : "keine gezählten Raids";
        const missed = c.missed.slice(0, missedShown).map((m) => `❌ <t:${m.startTime}:d> ${m.reason}`);
        return { name: c.name, value: [head, ...missed].join("\n"), inline: false };
    });
}

module.exports = { knownCharacterNames, characterAttendance, overall, attendanceFields };
