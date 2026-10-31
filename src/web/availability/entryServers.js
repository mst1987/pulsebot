// The servers an absence or attendance can be entered for (the web dialog's
// blocks, one per server): the configured servers in the order of the server
// list, only those the raider is a member of, each with the raid categories of
// that server (entryCategories.js, placed by categoryGuild.displayServerOf).
//
// One membership lookup per server (discord.guildMembership, bounded wait), run
// side by side. "Not knowable" (null: bot offline, server unreachable) keeps the
// server - only a definite "not a member" hides it, so a Discord hiccup never
// empties the dialog. The category context (categoryGuild.categoryContext) is
// read once, and only when there is a category to place.
const settingsStore = require("../../stores/settings/settingsStore");
const discord = require("../../services/discord/discord");
const { serverChoices } = require("../../services/discord/roles/guildRoles");
const { categoryContext, displayServerOf } = require("../../services/categories/categoryGuild");
const { entryCategories } = require("./entryCategories");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/**
 * @param {string} userId the raider the entry is for
 * @param {{ now?: number, config?: object, categoryNames?: Object<string,string> }} [opts]
 * @returns {Promise<Array<{ guildId, name, icon, categories: Array<{ id, name, icon, versionId }> }>>}
 */
async function entryServers(userId, { now = Date.now(), config, categoryNames = {} } = {}) {
    const cfg = config || settingsStore.getConfig();
    const servers = serverChoices(cfg);
    if (!servers.length) return [];
    const uid = str(userId);
    const member = await Promise.all(servers.map((s) => (uid ? discord.guildMembership(s.guildId, uid) : null)));
    const cats = entryCategories({ now, config: cfg, categoryNames });
    const ctx = cats.length ? categoryContext(cfg) : null;
    return servers
        .filter((_, i) => member[i] !== false)
        .map((s) => ({
            guildId: s.guildId,
            name: str(s.name) || str(s.label) || s.guildId,
            icon: str(s.iconUrl),
            categories: ctx ? cats.filter((c) => displayServerOf(c.id, ctx) === s.guildId) : [],
        }));
}

/** guildId -> shown name of every configured server (no Discord call beyond the cache). */
function serverNames(config) {
    const cfg = config || settingsStore.getConfig();
    return Object.fromEntries(serverChoices(cfg).map((s) => [s.guildId, str(s.name) || str(s.label) || s.guildId]));
}

module.exports = { entryServers, serverNames };
