// The guild roster: every known character, tagged with the raid categories
// (Discord category = one recurring raid series, e.g. "Montagsraid", "Pug") it
// belongs to, plus what the admin wants to see at a glance for each — the
// Warcraft-Logs link, the gear issues from its latest evaluation, the loot it
// received, the role it plays and how often it was there (rosterAttendance.js).
//
// Two sources say which character raids where, and both are needed:
//   1. the manual raider->character-per-category assignments (see
//      raiderCharactersStore.js) — the authoritative "wer spielt in diesem Raid
//      welchen Char", and the only source for someone who hasn't won loot yet
//   2. the imported loot — a character that got loot in a raid demonstrably
//      raided there, even without an assignment
// Everything else (class/spec, colours, icons) is read from the caches the loot
// history already fills, so this never hits an external API.
const { annotatedCharacters } = require("../../services/characters/characterInfo");
const { listAllAssignments } = require("../../stores/raiderCharactersStore");
const { characterMap } = require("../../stores/characterStore");
const { latestIssuesByCharacter } = require("./charGearIssues");
const { splitPlayer, characterKeyOf } = require("../../utils/loot/lootImport");
const { CLASS_COLORS, classSpecIconUrl } = require("../../utils/setup/setupView");
const { armoryUrlFor, wclUrlFor } = require("./charLinks");
const { listKnownCategories } = require("../../services/discord/categoryNames");
const { buildAttendanceContext, attendanceFor, categoryInfo, roleFor } = require("../../services/characters/rosterAttendance");

// How much loot a roster row carries for its hover panel. The overview shows
// the newest pieces, not a full history — the character page has that.
const MAX_LOOT_PREVIEW = 20;


/**
 * Assemble the roster of one guild.
 *
 * @param {string} guildId  active guild — resolves category names and limits
 *                          the raid events attendance counts
 * @returns {{chars: object[], categories: {id: string, name: string}[],
 *            categoryInfo: Object<string, {raids: number, contents: string[], icon: string}>}}
 */
function buildRoster(guildId) {
    const rows = new Map();

    const ensure = (name) => {
        const key = characterKeyOf(name);
        if (!key) return null;
        if (!rows.has(key)) {
            rows.set(key, {
                key,
                character: splitPlayer(name).character,
                realm: "",
                categoryIds: [],
                // Which source put this character on the roster — an assigned
                // char with no loot yet is a normal case (new raider), not a
                // data error, and the UI says so instead of showing a blank row.
                assigned: false,
                raiderIds: [],
                // category id -> the raiders assigned to this character there;
                // attendance compares their Raid-Helper signups per category.
                raiderIdsByCategory: {},
                lootCount: 0,
                items: [],
                className: "",
                spec: "",
                source: "",
            });
        }
        return rows.get(key);
    };

    const addCategory = (row, categoryId) => {
        const id = String(categoryId || "").trim();
        if (id && !row.categoryIds.includes(id)) row.categoryIds.push(id);
    };

    // 1. everyone who ever received loot, with the categories they got it in
    for (const c of annotatedCharacters()) {
        const row = ensure(c.character);
        if (!row) continue;
        row.character = c.character || row.character;
        row.realm = c.realm || "";
        row.lootCount = c.count || 0;
        row.items = (c.items || []).slice(0, MAX_LOOT_PREVIEW);
        row.className = c.className || "";
        row.spec = c.spec || "";
        row.source = c.source || "";
        for (const id of c.categoryIds || []) addCategory(row, id);
    }

    // 2. the manual per-category assignments
    for (const [categoryId, map] of Object.entries(listAllAssignments())) {
        for (const [userId, characterName] of Object.entries(map)) {
            const row = ensure(characterName);
            if (!row) continue;
            addCategory(row, categoryId);
            row.assigned = true;
            const uid = String(userId || "").trim();
            if (!uid) continue;
            if (!row.raiderIds.includes(uid)) row.raiderIds.push(uid);
            const list = row.raiderIdsByCategory[categoryId] || (row.raiderIdsByCategory[categoryId] = []);
            if (!list.includes(uid)) list.push(uid);
        }
    }

    // 3. annotate: class/spec for the rows loot didn't cover, links, gear
    //    issues, role and attendance per category
    const known = characterMap();
    const issuesByKey = latestIssuesByCharacter();
    const ctx = buildAttendanceContext(guildId);
    const chars = [...rows.values()].map(({ raiderIdsByCategory, ...row }) => {
        const info = known[row.key] || {};
        const className = row.className || info.className || "";
        const spec = row.spec || info.spec || "";
        const gear = issuesByKey[row.key] || null;
        const attendance = {};
        for (const id of row.categoryIds) {
            // The row carries the verdict and the missed nights (its tooltip);
            // the night-by-night list belongs to the character page.
            const summary = attendanceFor(ctx, id, row.character, raiderIdsByCategory[id] || []);
            delete summary.raids;
            attendance[id] = summary;
        }
        return {
            ...row,
            className,
            spec,
            source: row.source || info.source || "",
            classColor: CLASS_COLORS[className] || "",
            iconUrl: className ? classSpecIconUrl(className, spec) : "",
            armoryUrl: armoryUrlFor(row.character),
            wclUrl: wclUrlFor(row.character),
            gear,
            role: roleFor(ctx, row.character, className, spec),
            attendance,
        };
    });
    chars.sort((a, b) => a.character.localeCompare(b.character));

    const info = {};
    for (const id of new Set(chars.flatMap((c) => c.categoryIds))) info[id] = categoryInfo(ctx, id);

    // Names, not a pick list: a category that Discord no longer offers (gateway
    // offline, category deleted) still has to label the rows it owns instead of
    // leaving a raw snowflake in the table — see categoryNames.js.
    return { chars, categories: listKnownCategories(guildId), categoryInfo: info };
}

/**
 * One character's roster facts for the character page: role, the categories it
 * raids in with their attendance night by night.
 */
function rosterCharacter(guildId, name) {
    const key = characterKeyOf(name);
    if (!key) return null;
    const roster = buildRoster(guildId);
    const row = roster.chars.find((c) => c.key === key);
    if (!row) return null;
    const ctx = buildAttendanceContext(guildId);
    const assignments = listAllAssignments();
    const attendance = {};
    for (const id of row.categoryIds) {
        const userIds = Object.entries(assignments[id] || {})
            .filter(([, charName]) => characterKeyOf(charName) === key)
            .map(([userId]) => userId);
        attendance[id] = attendanceFor(ctx, id, row.character, userIds);
    }
    const names = new Map(roster.categories.map((c) => [c.id, c.name]));
    return {
        character: row.character,
        role: row.role,
        categories: row.categoryIds.map((id) => ({ id, name: names.get(id) || id, ...(roster.categoryInfo[id] || {}) })),
        attendance,
    };
}

module.exports = { buildRoster, rosterCharacter, MAX_LOOT_PREVIEW };
