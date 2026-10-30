// Attendance of one character for the bot's /anwesenheit (issue #265) — the same
// rules and the same sources as the roster page (rosterAttendance.js), without
// building the whole roster (gear issues, links, every other character) for a
// single answer. Always within one game version (#740): the caller names it
// (the command: the channel's category's version, or the one picked).
const { buildAttendanceContext, attendanceFor } = require("./rosterAttendance");
const { mainVersionFor } = require("../versions/mainVersion");
const { isCategoryActive } = require("../categories/categoryLifecycle");
const { listAllAssignments } = require("../../stores/raiderCharactersStore");
const { annotatedCharacters } = require("./characterInfo");
const { listAll } = require("../../stores/lootStore");
const { lootOfGuild } = require("../loot/lootServer");
const { buildVersionContext, versionsOfCharacter } = require("./characterVersions");
const { listKnownCategories } = require("../categories/categoryNames");
const { splitPlayer, characterKeyOf } = require("../../utils/loot/lootImport");

/**
 * The characters of the loot of one server (#919) - `undefined` for all of it.
 * Loot of another server is no evidence here: neither a name nor a category.
 */
function lootCharacters(guildId) {
    return guildId === undefined ? annotatedCharacters() : annotatedCharacters({ rows: lootOfGuild(listAll(), guildId) });
}

/**
 * Every character name the roster knows (loot and assignments), for autocomplete -
 * with `versionId` only those that play that game version (#741), with
 * `guildId` only the loot of that server (#919).
 * @param {{ versionId?: string, guildId?: string }} [opts]
 * @returns {string[]}
 */
function knownCharacterNames({ versionId = "", guildId } = {}) {
    const names = new Map();
    const seen = new Set(); // a name is judged once, by the strongest evidence (its loot), not again by its category
    const ctx = versionId ? buildVersionContext() : null;
    const plays = (name, items, categoryIds) => !ctx || versionsOfCharacter(ctx, { name, items, categoryIds }).includes(versionId);
    for (const c of lootCharacters(guildId)) {
        const key = characterKeyOf(c.character);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        if (plays(c.character, c.items, c.categoryIds)) names.set(key, c.character);
    }
    for (const [categoryId, map] of Object.entries(listAllAssignments())) {
        for (const name of Object.values(map)) {
            const key = characterKeyOf(name);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            if (plays(name, [], [categoryId])) names.set(key, String(name).trim());
        }
    }
    return [...names.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * One character's attendance per raid category, the categories it raids in
 * found the way the roster finds them (assignment or loot there) - those with
 * raids of the version counted, or that play it today (a category just switched
 * to it: "keine gezählten Raids" until its first raid there).
 *
 * @param {{ ctx?: object, versionId?: string }} opts  a context built for the version, or the version
 *   (one of them is required, #740)
 * @returns {{ character: string, versionId: string, categories: {id, name, attended, total, pct, missed}[] }}
 */
function characterAttendance(guildId, name, { ctx, versionId } = {}) {
    const key = characterKeyOf(name);
    const character = splitPlayer(String(name || "").trim()).character;
    const context = ctx || buildAttendanceContext(guildId, { versionId });
    const version = context.versionId || versionId;
    if (!key) return { character, versionId: version, categories: [] };

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
    const loot = lootCharacters(guildId).find((c) => characterKeyOf(c.character) === key);
    for (const id of (loot && loot.categoryIds) || []) categoryIds.add(id);

    const names = new Map(listKnownCategories(guildId).map((c) => [c.id, c.name]));
    // only categories of this version: nights of it, or playing it today
    const nights = context.raidsByCategory instanceof Map ? context.raidsByCategory : new Map();
    const ofVersion = (id) => !version || nights.has(id) || mainVersionFor({ categoryId: id }) === version;
    // only active categories (#744): a deactivated or closed one is history (roster page, archive)
    const categories = [...categoryIds].filter((id) => ofVersion(id) && isCategoryActive(id)).map((id) => {
        const { attended, total, pct, missed } = attendanceFor(context, id, character, userIdsByCategory.get(id) || []);
        return { id, name: names.get(id) || "Unbekannte Kategorie", attended, total, pct, missed };
    }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    return { character: (loot && loot.character) || character, versionId: version, categories };
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
