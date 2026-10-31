// Absences and attendances of before the scope per server that held for every
// raid (no `categoryId`, no `scope`) get one server, once: the first server of
// the server list (config.discordServers.servers, in its order) the raider is a
// member of. Afterwards every entry names its server.
//
// Only Discord knows the membership, so this runs once the bot is online
// (bot.js ClientReady, not awaited), like logcheck/logChannelMigration.js - not
// with the start migrations in settingsMigration.js. The rules:
//
//   - one membership query per raider and server, in the server list's order,
//     stopping at the first "member" (never one per entry), one raider after
//     the other (1 vCPU);
//   - no server answers "member" for sure (not a member anywhere, unknown) ->
//     the first server (firstServerId), counted as a fallback in the log line -
//     but only when every configured server was reachable; otherwise the
//     raider's entries stay without server (hold everywhere), the mark is not
//     set and the next start asks again for just those entries;
//   - expired entries (kept KEEP_DAYS for the attendance) are moved as well;
//     entries with a category stay as they are;
//   - none of the configured servers reachable (bot not on them yet), no server
//     configured or a query that throws: nothing is written, the next start
//     tries again. Done, it leaves a mark (migrationMarkStore) and is skipped
//     from then on; it is idempotent (only entries still without server move).
//
// Until it has run, availabilityScope.scopeOf reads such an entry as null =
// every raid, as before.
const availabilityStore = require("../../stores/events/availabilityStore");
const migrationMarkStore = require("../../stores/settings/migrationMarkStore");
const configStore = require("../../stores/settings/configStore");
const discord = require("../discord/discord");
const { firstServerId } = require("../discord/servers/serverOf");

const MARK = "availabilityServers";

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/** The configured servers in the server list's order; the old single guildId without a list. */
function serverOrder(config) {
    const servers = config && config.discordServers && Array.isArray(config.discordServers.servers) ? config.discordServers.servers : [];
    const ids = [...new Set(servers.map((s) => str(s && s.guildId)).filter(Boolean))];
    const first = firstServerId(config);
    return ids.length ? ids : (first ? [first] : []);
}

/**
 * Give every entry that still holds everywhere its raider's first server.
 * @param {{ membership: (guildId: string, userId: string) => Promise<boolean|null>,
 *           reachable?: (guildId: string) => boolean, config?: object }} opts
 * @returns {Promise<string[]>} the log lines (German, like the start migrations)
 */
async function migrateAvailabilityServers({ membership, reachable = () => true, config = configStore.getConfig() }) {
    if (migrationMarkStore.isDone(MARK)) return [];
    const pending = availabilityStore.listUnscoped();
    if (!pending.length) {
        migrationMarkStore.markDone(MARK);
        return [];
    }
    const order = serverOrder(config);
    const first = firstServerId(config) || order[0] || "";
    if (!order.length || !first) {
        return [`availability.json: WARNUNG ${pending.length} Ab-/Anwesenheit(en) ohne Server nicht umgestellt - kein Discord-Server eingerichtet, nächster Start versucht es erneut`];
    }
    const open = order.filter((g) => reachable(g));
    if (!open.length) {
        return [`availability.json: ${pending.length} Ab-/Anwesenheit(en) ohne Server nicht umgestellt - der Bot erreicht keinen der Server, nächster Start versucht es erneut`];
    }

    const serverOfUser = new Map();
    for (const userId of [...new Set(pending.map((e) => e.userId))]) {
        let found = "";
        for (const guildId of open) {
            let answer;
            try {
                answer = await membership(guildId, userId);
            } catch (error) {
                return [`availability.json: Ab-/Anwesenheiten nicht umgestellt, Discord-Abfrage fehlgeschlagen (${error.message}) - nächster Start versucht es erneut`];
            }
            if (answer === true) {
                found = guildId;
                break;
            }
        }
        serverOfUser.set(userId, found);
    }

    // The web server already runs while the queries wait: the store is read again
    // (assignServers) and only entries that still hold everywhere change.
    // The fallback only when every configured server answered: a raider who may be
    // a member of an unreachable server stays without server (holds everywhere)
    // and is asked again on the next start.
    const allReachable = open.length === order.length;
    const assignments = {};
    let fallback = 0;
    let left = 0;
    for (const e of availabilityStore.listUnscoped()) {
        const found = serverOfUser.has(e.userId) ? serverOfUser.get(e.userId) : "";
        if (found) {
            assignments[e.id] = found;
        } else if (allReachable && serverOfUser.has(e.userId)) {
            assignments[e.id] = first;
            fallback += 1;
        } else {
            left += 1;
        }
    }
    const moved = availabilityStore.assignServers(assignments);
    if (!left) migrationMarkStore.markDone(MARK);
    const line = `availability.json: ${moved} Ab-/Anwesenheit(en) ohne Server dem ersten Server des Raiders zugeordnet, davon ${fallback} ohne sichere Mitgliedschaft dem ersten Server ${first} (Fallback)`;
    return [left
        ? `${line}; ${left} offen geblieben (nicht jeder Server erreichbar oder neu angelegt) - nächster Start versucht es erneut`
        : line];
}

/**
 * bot.js after login: the migration with the bot's guilds, every line logged
 * (a warning line also as a warning). Never throws.
 */
async function runAvailabilityMigration(client, { log = console.log, warn = console.error } = {}) {
    try {
        const cache = client && client.guilds && client.guilds.cache;
        const lines = await migrateAvailabilityServers({
            membership: (guildId, userId) => discord.guildMembership(guildId, userId),
            reachable: (guildId) => Boolean(cache && cache.has(guildId)),
        });
        for (const line of lines) log(`[settings] Migration: ${line}`);
        for (const line of lines) if (/WARNUNG|fehlgeschlagen/.test(line)) warn(`[settings] Migration: ${line}`);
        return lines;
    } catch (error) {
        warn(`[settings] Migration der Ab-/Anwesenheiten fehlgeschlagen: ${error.message}`);
        return [];
    }
}

module.exports = { MARK, migrateAvailabilityServers, runAvailabilityMigration, serverOrder };
