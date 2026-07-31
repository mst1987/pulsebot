// The guild roster: every known character, tagged with the raid categories
// (Discord category = one recurring raid series, e.g. "Montagsraid", "Pug") it
// belongs to, plus what the admin wants to see at a glance for each — the
// Warcraft-Logs link, the gear issues from its latest evaluation, and the loot
// it received.
//
// Two sources say which character raids where, and both are needed:
//   1. the manual raider->character-per-category assignments (see
//      raiderCharactersStore.js) — the authoritative "wer spielt in diesem Raid
//      welchen Char", and the only source for someone who hasn't won loot yet
//   2. the imported loot — a character that got loot in a raid demonstrably
//      raided there, even without an assignment
// Everything else (class/spec, colours, icons) is read from the caches the loot
// history already fills, so this never hits an external API.
const { annotatedCharacters } = require("./characterInfo");
const { listAllAssignments } = require("./raiderCharactersStore");
const { characterMap } = require("./characterStore");
const { latestIssuesByCharacter } = require("./charGearIssues");
const { characterKey: lootCharacterKey, splitPlayer } = require("../utils/lootImport");
const { CLASS_COLORS, classSpecIconUrl } = require("../utils/setupView");
const { applyArmoryUrlTemplate, applyWclUrlTemplate } = require("../config/variables");
const { listKnownCategories } = require("./categoryNames");

// How much loot a roster row carries for its hover panel. The overview shows
// the newest pieces, not a full history — the character page has that.
const MAX_LOOT_PREVIEW = 20;

function charKey(character) {
    return lootCharacterKey(splitPlayer(character).character);
}

// Fill a {char} URL template (armory / WCL) for a character name — same helper
// apiRoutes/history.js uses for the character detail page.
function fillCharTemplate(tpl, character) {
    return String(tpl || "").replace("{char}", encodeURIComponent(String(character || "").trim()));
}

/**
 * Assemble the roster of one guild.
 *
 * @param {string} guildId  active guild — only used to resolve category names
 * @returns {{chars: object[], categories: {id: string, name: string}[]}}
 */
function buildRoster(guildId) {
    const rows = new Map();

    const ensure = (name) => {
        const key = charKey(name);
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
            if (uid && !row.raiderIds.includes(uid)) row.raiderIds.push(uid);
        }
    }

    // 3. annotate: class/spec for the rows loot didn't cover, links, gear issues
    const known = characterMap();
    const issuesByKey = latestIssuesByCharacter();
    const chars = [...rows.values()].map((row) => {
        const info = known[row.key] || {};
        const className = row.className || info.className || "";
        const spec = row.spec || info.spec || "";
        const gear = issuesByKey[row.key] || null;
        return {
            ...row,
            className,
            spec,
            source: row.source || info.source || "",
            classColor: CLASS_COLORS[className] || "",
            iconUrl: className ? classSpecIconUrl(className, spec) : "",
            armoryUrl: fillCharTemplate(applyArmoryUrlTemplate, row.character),
            wclUrl: fillCharTemplate(applyWclUrlTemplate, row.character),
            gear,
        };
    });
    chars.sort((a, b) => a.character.localeCompare(b.character));

    // Names, not a pick list: a category that Discord no longer offers (gateway
    // offline, category deleted) still has to label the rows it owns instead of
    // leaving a raw snowflake in the table — see categoryNames.js.
    return { chars, categories: listKnownCategories(guildId) };
}

module.exports = { buildRoster, MAX_LOOT_PREVIEW };
