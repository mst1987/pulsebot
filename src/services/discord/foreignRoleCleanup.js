// The rights per server (#925) after the migration: settingsMigration copied the
// global role grants and orga roles onto every server, so each server's block
// also holds the roles of the other servers. Those never match there (a member
// of server B carries no role of server A), but they clutter the rights page.
//
// This step takes them out once the bot is online (bot.js ClientReady) - only
// Discord knows which server a role belongs to. A role id leaves a server's
// block only when all of these hold:
//
//   - that server is available (guild.available !== false) and its role cache
//     is loaded and not empty, and the role is not in it;
//   - the role demonstrably exists on ANOTHER configured server that is
//     available (found in its loaded role cache).
//
// Anything unsure (server offline, cache empty, role found nowhere - maybe a
// deleted role, maybe one Discord did not deliver) stays as it is. The file is
// read fresh right before the write, so a change saved meanwhile is kept.
// Idempotent: a second run finds nothing more to remove and writes nothing.
const configStore = require("../../stores/configStore");
const { serverSettingGuildIds, normalizeConfig } = require("../../stores/configSchema");

const isMap = (value) => value && typeof value === "object" && !Array.isArray(value);

/** The loaded role ids of a guild the client holds; null = unavailable or not loaded (unsure). */
function loadedRoleIds(client, guildId) {
    const guild = client && client.guilds && client.guilds.cache && client.guilds.cache.get(guildId);
    if (!guild || guild.available === false) return null;
    const cache = guild.roles && guild.roles.cache;
    if (!cache || typeof cache.keys !== "function" || !cache.size) return null;
    return new Set([...cache.keys()].map(String));
}

/**
 * The foreign role ids of one server's block: in its rights, not on the server,
 * found on another available configured server.
 */
function foreignRolesOf(block, own, others) {
    const ids = new Set([
        ...Object.keys(isMap(block.rolePermissions) ? block.rolePermissions : {}),
        ...(Array.isArray(block.orgaRoleIds) ? block.orgaRoleIds : []),
    ].map(String));
    return [...ids].filter((id) => !own.has(id) && others.some((roles) => roles.has(id)));
}

/**
 * Take the roles of other servers out of each server's rights.
 * @param {import("discord.js").Client} client
 * @param {{ log?: (line: string) => void, warn?: (line: string) => void }} [opts]
 * @returns {{ removed: Record<string, string[]> }}
 */
function cleanForeignRoles(client, { log = () => {}, warn = () => {} } = {}) {
    try {
        const stored = configStore.readStored();
        const blocks = isMap(stored.serverSettings) ? stored.serverSettings : {};
        const cfg = normalizeConfig(stored);
        const guildIds = [...serverSettingGuildIds(cfg.discordServers, cfg.guildId)].map(String);
        const roles = new Map(guildIds.map((gid) => [gid, loadedRoleIds(client, gid)]));
        const removed = {};
        for (const gid of guildIds) {
            const own = roles.get(gid);
            const block = blocks[gid];
            if (!own || !isMap(block)) continue;
            const others = guildIds.filter((o) => o !== gid).map((o) => roles.get(o)).filter(Boolean);
            const foreign = foreignRolesOf(block, own, others);
            if (foreign.length) removed[gid] = foreign;
        }
        if (!Object.keys(removed).length) return { removed };

        // read fresh: only the roles found above leave, everything else as saved now
        const now = configStore.readStored();
        const nowBlocks = isMap(now.serverSettings) ? { ...now.serverSettings } : {};
        for (const [gid, ids] of Object.entries(removed)) {
            const block = isMap(nowBlocks[gid]) ? { ...nowBlocks[gid] } : null;
            if (!block) continue;
            const drop = new Set(ids);
            if (isMap(block.rolePermissions)) {
                block.rolePermissions = Object.fromEntries(Object.entries(block.rolePermissions).filter(([id]) => !drop.has(String(id))));
            }
            if (Array.isArray(block.orgaRoleIds)) block.orgaRoleIds = block.orgaRoleIds.filter((id) => !drop.has(String(id)));
            nowBlocks[gid] = block;
        }
        configStore.writeStored({ ...now, serverSettings: nowBlocks });
        const total = Object.values(removed).reduce((n, ids) => n + ids.length, 0);
        log("config.json: Rechte je Server (#925) - " + total + " Rollen anderer Server aus "
            + Object.keys(removed).length + " Server-Rechten entfernt");
        return { removed };
    } catch (error) {
        warn("config.json: Rollen anderer Server (#925) nicht bereinigt: " + error.message);
        return { removed: {} };
    }
}

module.exports = { cleanForeignRoles, loadedRoleIds, foreignRolesOf };
