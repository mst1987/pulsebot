// The rights per server (#925): role grants and orga roles belong to the block
// of the server the role lives on. The migration puts the old global ones on the
// home server only (settingsMigration), but a block can still hold a role of
// another server - an earlier copy onto every server, or a save on the wrong
// server. Such a role never matches there (a member of server B carries no role
// of server A) and it is missing on the server it belongs to.
//
// This step runs once the bot is online (bot.js ClientReady) - only Discord
// knows which server a role belongs to. It MOVES such a role instead of deleting
// it: the entry goes into the block of the server the role lives on, unless that
// block already has one (the target wins), and leaves the wrong block. A role id
// leaves a server's block only when all of these hold:
//
//   - that server is available (guild.available !== false) and its role cache
//     is loaded and not empty, and the role is not in it;
//   - the role demonstrably exists on ANOTHER configured server that is
//     available (found in its loaded role cache) - that server is the target.
//
// Anything unsure (server offline, cache empty, role found nowhere - maybe a
// deleted role, maybe one Discord did not deliver) stays as it is. The file is
// read fresh right before the write, so a change saved meanwhile is kept.
// Idempotent: a second run finds nothing more to move and writes nothing.
const configStore = require("../../../stores/configStore");
const { serverSettingGuildIds, normalizeConfig } = require("../../../stores/configSchema");

const isMap = (value) => value && typeof value === "object" && !Array.isArray(value);
const clone = (value) => JSON.parse(JSON.stringify(value));

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
 * Move the roles of other servers into the block of the server they live on.
 * @param {import("discord.js").Client} client
 * @param {{ log?: (line: string) => void, warn?: (line: string) => void }} [opts]
 * @returns {{ removed: Record<string, string[]>, moved: Record<string, Record<string, string>> }}
 *   removed: per server the ids taken out of its block; moved: per server id -> target server
 *   for the entries that went into the target block (the rest the target already had).
 */
function cleanForeignRoles(client, { log = () => {}, warn = () => {} } = {}) {
    try {
        const stored = configStore.readStored();
        const blocks = isMap(stored.serverSettings) ? stored.serverSettings : {};
        const cfg = normalizeConfig(stored);
        const guildIds = [...serverSettingGuildIds(cfg.discordServers, cfg.guildId)].map(String);
        const roles = new Map(guildIds.map((gid) => [gid, loadedRoleIds(client, gid)]));
        const removed = {};
        const owners = {};
        for (const gid of guildIds) {
            const own = roles.get(gid);
            const block = blocks[gid];
            if (!own || !isMap(block)) continue;
            const others = guildIds.filter((o) => o !== gid && roles.get(o));
            const foreign = foreignRolesOf(block, own, others.map((o) => roles.get(o)));
            if (!foreign.length) continue;
            removed[gid] = foreign;
            owners[gid] = Object.fromEntries(foreign.map((id) => [id, others.find((o) => roles.get(o).has(id))]));
        }
        if (!Object.keys(removed).length) return { removed, moved: {} };

        // read fresh: only the roles found above move, everything else as saved now
        const now = configStore.readStored();
        const nowBlocks = isMap(now.serverSettings) ? { ...now.serverSettings } : {};
        const copied = new Set();
        const blockOf = (gid) => {
            if (!copied.has(gid)) {
                nowBlocks[gid] = isMap(nowBlocks[gid]) ? { ...nowBlocks[gid] } : {};
                const block = nowBlocks[gid];
                if (isMap(block.rolePermissions)) block.rolePermissions = { ...block.rolePermissions };
                if (Array.isArray(block.orgaRoleIds)) block.orgaRoleIds = [...block.orgaRoleIds];
                copied.add(gid);
            }
            return nowBlocks[gid];
        };
        const moved = {};
        for (const [gid, ids] of Object.entries(removed)) {
            if (!isMap(nowBlocks[gid])) continue;
            const block = blockOf(gid);
            for (const id of ids) {
                const target = owners[gid][id];
                const grant = isMap(block.rolePermissions)
                    ? Object.entries(block.rolePermissions).find(([key]) => String(key) === id) : null;
                const orga = Array.isArray(block.orgaRoleIds) && block.orgaRoleIds.some((o) => String(o) === id);
                let took = false;
                if (grant || orga) {
                    const into = blockOf(target);
                    if (grant) {
                        if (!isMap(into.rolePermissions)) into.rolePermissions = {};
                        if (!Object.keys(into.rolePermissions).some((key) => String(key) === id)) {
                            into.rolePermissions[id] = clone(grant[1]);
                            took = true;
                        }
                        delete block.rolePermissions[grant[0]];
                    }
                    if (orga) {
                        if (!Array.isArray(into.orgaRoleIds)) into.orgaRoleIds = [];
                        if (!into.orgaRoleIds.some((o) => String(o) === id)) {
                            into.orgaRoleIds.push(id);
                            took = true;
                        }
                        block.orgaRoleIds = block.orgaRoleIds.filter((o) => String(o) !== id);
                    }
                }
                if (took) (moved[gid] = moved[gid] || {})[id] = target;
            }
        }
        configStore.writeStored({ ...now, serverSettings: nowBlocks });
        const total = Object.values(removed).reduce((n, ids) => n + ids.length, 0);
        const movedCount = Object.values(moved).reduce((n, ids) => n + Object.keys(ids).length, 0);
        log("config.json: Rechte je Server (#925) - " + total + " Rollen anderer Server aus "
            + Object.keys(removed).length + " Server-Rechten genommen, davon " + movedCount
            + " in den Block ihres Servers verschoben (der Rest war dort schon eingetragen)");
        return { removed, moved };
    } catch (error) {
        warn("config.json: Rollen anderer Server (#925) nicht bereinigt: " + error.message);
        return { removed: {}, moved: {} };
    }
}

module.exports = { cleanForeignRoles, loadedRoleIds, foreignRolesOf };
