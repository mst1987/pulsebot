// What the "Roster anlegen" dialog and the roster settings offer (#657):
// the raid categories of the server (with the roster that has one already),
// the game versions, the server's Discord roles (whether the bot can hand each
// out), the Kader of the Kaderplaner (counts only, for a reader of `kader`),
// the slots a category's raid template suggests, and the Loot-Council profiles
// with the loot systems (#676: names and ids only).
const discord = require("../discord/discord");
const { canManageRoles } = require("../discord/roleSync");
const { roleBelowBot } = require("../discord/memberRoles");
const { listKnownCategories } = require("../discord/categoryNames");
const { listStoredEvents } = require("../events/eventSources");
const { mainVersionFor, visibleVersions } = require("../events/mainVersion");
const { publicVersions } = require("../../config/gameVersions");
const { getRaidTemplate } = require("../../stores/raidTemplateStore");
const rosterStore = require("../../stores/rosterStore");
const { kaderChoices } = require("./rosterCreate");
const { listProfiles, defaultProfileId } = require("../../stores/councilProfilesStore");
const { LOOT_SYSTEMS } = require("../loot/lootSystem");

/**
 * The raid categories of a server: the ones marked for events
 * (config.categoryIds), every category a stored raid of this server ran in and
 * every category a roster names - with a known name, in Discord's order.
 * `rosterId`: the roster that category has (one per category), else null.
 */
function rosterCategories(guildId, config = {}) {
    const ids = new Set((config.categoryIds || []).map((id) => String(id).trim()).filter(Boolean));
    for (const ev of listStoredEvents(guildId)) if (ev && ev.categoryId) ids.add(String(ev.categoryId));
    const rosterOf = new Map();
    for (const r of rosterStore.listRosters("")) {
        if (!r.categoryId) continue;
        rosterOf.set(r.categoryId, r);
        if (!guildId || r.guildId === guildId) ids.add(r.categoryId);
    }
    return listKnownCategories(guildId)
        .filter((c) => ids.has(c.id) && c.name)
        .map((c) => {
            const roster = rosterOf.get(c.id) || null;
            return {
                id: c.id,
                name: c.name,
                versionId: mainVersionFor({ categoryId: c.id, config }),
                rosterId: roster ? roster.id : null,
                rosterName: roster ? roster.name : "",
            };
        });
}

/**
 * The roles of a server, highest first: `{ id, name, color, position, manageable }`
 * - `manageable`: not managed by an integration and below the bot's highest
 * role (whether the bot has "Rollen verwalten" at all is `canManageRoles`).
 */
function serverRoles(guildId) {
    const guild = guildId ? discord.getGuild(guildId) : null;
    if (!guild || !guild.roles || !guild.roles.cache) return [];
    return [...guild.roles.cache.values()]
        .filter((r) => r.id !== guild.id)
        .sort((a, b) => (b.rawPosition || 0) - (a.rawPosition || 0))
        .map((r) => ({
            id: String(r.id),
            name: String(r.name || ""),
            color: r.color ? r.hexColor : "",
            position: Number(r.rawPosition || r.position || 0),
            manageable: roleBelowBot(guild, r),
        }));
}

/**
 * The slots a category's default raid template suggests:
 * `{ [categoryId]: { total, tank, healer, bench: 0, templateId, templateName } }`
 * - only categories whose template has a size.
 */
function templateSlots(categories, config = {}) {
    const map = config.categoryRaidTemplate || {};
    const out = {};
    for (const c of categories) {
        const template = map[c.id] ? getRaidTemplate(map[c.id]) : null;
        if (!template || !template.size) continue;
        const comp = template.composition || {};
        out[c.id] = {
            total: template.size,
            tank: Number(comp.tank) || 0,
            healer: Number(comp.healer) || 0,
            bench: 0,
            templateId: template.id,
            templateName: template.name || template.id,
        };
    }
    return out;
}

/** The Kader (counts only) with the roster each one is linked to: `rosterId` / `rosterName`, null / "" for none. */
function kaderOptions(guildId) {
    const rosters = rosterStore.listRosters(guildId);
    return kaderChoices(guildId).map((k) => {
        const linked = rosters.find((r) => r.kaderId === k.id) || null;
        return { ...k, rosterId: linked ? linked.id : null, rosterName: linked ? linked.name : "" };
    });
}

/** The Loot-Council profiles to pick from (#676): id, name, whether it is the default. */
function lootProfileOptions() {
    const def = defaultProfileId();
    return listProfiles().map((p) => ({ id: p.id, name: p.name, isDefault: p.id === def }));
}

/**
 * Everything the dialog needs.
 * @param {{ guildId: string, config?: object, canSeeKader?: boolean }} opts
 */
function rosterOptions({ guildId = "", config = {}, canSeeKader = false } = {}) {
    const categories = rosterCategories(guildId, config);
    const visible = new Set(visibleVersions(config));
    return {
        guildId,
        categories,
        versions: publicVersions().filter((v) => visible.has(v.id)).map((v) => ({ id: v.id, label: v.label, short: v.short })),
        defaultVersion: mainVersionFor({ config }),
        roles: serverRoles(guildId),
        canManageRoles: guildId ? canManageRoles(guildId) : false,
        online: !!(guildId && discord.isOnline() && discord.getGuild(guildId)),
        kaders: canSeeKader ? kaderOptions(guildId) : [],
        templateSlots: templateSlots(categories, config),
        lootSystems: [...LOOT_SYSTEMS],
        lootProfiles: lootProfileOptions(),
    };
}

module.exports = { rosterOptions, rosterCategories, serverRoles, templateSlots };
