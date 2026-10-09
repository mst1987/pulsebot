// The roster migration's input (#653, run by settingsMigration.js at start):
// which raid categories become a roster, with which server, name, version,
// roles and members. Pure - the stores are read by the caller and handed in.
//
// A category is migrated when it has expected raider roles
// (config.categoryRoles) or character assignments (raider-characters.json).
// Its members are the assigned raiders, status "core", the character as their
// first one (characterKeyOf(name, version), the name kept for display).
//
// Server of a category - nothing stored names it directly, so the first of:
//   1. the category name snapshot (category-names.json, guildId -> categories;
//      services/discord/categoryNames.js writes it on every live read),
//   2. a stored event of that category (own events and Raid-Helper events
//      carry guildId + categoryId),
//   3. the first configured event server (discordServers.eventGuilds, else the
//      old single guildId) - the "primary event server" other per-server code
//      falls back to as well (guildRoles.eventGuildId).
// None at all leaves "" (listRosters("") still lists it; the roster page can
// set it later).
//
// Name: the snapshot's name, else the newest stored event's categoryName,
// else the category id.
const { characterKeyOf } = require("../../utils/loot/lootImport");
const { mainVersionFor } = require("../events/mainVersion");

const isMap = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v) => String(v === null || v === undefined ? "" : v).trim();

/** The first configured event server of a config, "" for none. */
function primaryEventGuild(config) {
    const servers = (config && config.discordServers) || {};
    const list = Array.isArray(servers.eventGuilds) ? servers.eventGuilds : [];
    const first = list.map((e) => str(e && e.guildId)).find(Boolean);
    return first || str(config && config.guildId);
}

/**
 * Server and name of every category the stored data knows:
 * `Map<categoryId, { guildId, name }>`. `snapshot` = category-names.json's
 * `guilds`, `events` = stored events (newest first wins the name).
 */
function categoryFacts({ snapshot = {}, events = [] } = {}) {
    const facts = new Map();
    const note = (categoryId, guildId, name) => {
        const cat = str(categoryId);
        if (!cat) return;
        const have = facts.get(cat) || { guildId: "", name: "" };
        facts.set(cat, { guildId: have.guildId || str(guildId), name: have.name || str(name) });
    };
    for (const [guildId, names] of Object.entries(isMap(snapshot) ? snapshot : {})) {
        for (const [categoryId, name] of Object.entries(isMap(names) ? names : {})) note(categoryId, guildId, name);
    }
    const sorted = (Array.isArray(events) ? events : []).slice().sort((a, b) => (Number(b && b.startTime) || 0) - (Number(a && a.startTime) || 0));
    for (const e of sorted) if (e) note(e.categoryId, e.guildId, e.categoryName);
    return facts;
}

/**
 * The categories to migrate, in a stable order (configured categories first,
 * then the rest as found): `[{ categoryId, guildId, name, versionId, roleIds,
 * members: { [userId]: { key, name } } }]`.
 * @param {object} input
 * @param {object} input.config       the normalised config (categoryRoles, categoryVersion, categoryIds, servers)
 * @param {object} input.assignments  raider-characters.json: { [categoryId]: { [userId]: name } }
 * @param {object} [input.snapshot]   category-names.json `guilds`
 * @param {object[]} [input.events]   stored events ({ guildId, categoryId, categoryName, startTime })
 */
function categoriesToMigrate({ config = {}, assignments = {}, snapshot = {}, events = [] } = {}) {
    const roles = isMap(config.categoryRoles) ? config.categoryRoles : {};
    const chars = isMap(assignments) ? assignments : {};
    const facts = categoryFacts({ snapshot, events });
    const fallbackGuild = primaryEventGuild(config);
    const configured = (Array.isArray(config.categoryIds) ? config.categoryIds : []).map(str);
    const candidates = [...new Set([...configured, ...Object.keys(roles), ...Object.keys(chars)].map(str).filter(Boolean))];
    const out = [];
    for (const categoryId of candidates) {
        const roleIds = (Array.isArray(roles[categoryId]) ? roles[categoryId] : []).map(str).filter(Boolean);
        const map = isMap(chars[categoryId]) ? chars[categoryId] : {};
        const versionId = mainVersionFor({ categoryId, config });
        const members = {};
        for (const [userId, name] of Object.entries(map)) {
            const uid = str(userId);
            const charName = str(name);
            const key = characterKeyOf(charName, versionId);
            if (uid && key) members[uid] = { key, name: charName };
        }
        if (!roleIds.length && !Object.keys(members).length) continue;
        const fact = facts.get(categoryId) || {};
        out.push({ categoryId, guildId: fact.guildId || fallbackGuild, name: fact.name || categoryId, versionId, roleIds, members });
    }
    return out;
}

/** The log line of the migration: how many rosters, per roster its name, members and roles. "" for none. */
function migrationLine(created) {
    if (!created.length) return "";
    const list = created.map((r) => `${r.name} (${r.members} Mitglied(er), ${r.roleIds} Rolle(n)${r.guildId ? "" : ", ohne Server"})`).join(", ");
    return `rosters.json: ${created.length} Roster aus den Raid-Kategorien übernommen (Rollen + Charakter-Zuordnungen, #653) - ${list}`;
}

module.exports = { categoriesToMigrate, categoryFacts, primaryEventGuild, migrationLine };
