// The global log-channel list of before #921 (config.logChannelIds) handed to
// the servers: serverSettings[guildId].logChannels (logChannelSettings.js).
//
// Which server a channel lies on only Discord knows (nothing stores it), so
// this runs once the bot is online (bot.js ClientReady), not with the start
// migrations in settingsMigration.js. The rules:
//
//   - a channel goes to the server it lies on; one whose server holds no
//     settings block (no configured server, no link target) goes to the first
//     server instead, with a warning line, so getConfig() does not drop it;
//   - a channel the bot no longer sees (deleted, no access) goes to the first
//     server, so an admin still finds and removes it;
//   - its version: the main version of the channel's category, else the main
//     version (mainVersionFor).
//
// logChannelIds goes in the very write that stores the new lists, and only
// after the stored file is read back with every channel in place; a lookup
// that fails for another reason (network, rate limit) leaves everything as it
// is for the next start. Idempotent: without logChannelIds nothing happens.
const configStore = require("../../stores/configStore");
const { serverSettingGuildIds, mergeServerSettings } = require("../../stores/configSchema");
const { firstServerId } = require("../discord/serverOf");
const { mainVersionFor } = require("../events/mainVersion");
const { normalizeLogChannels } = require("./logChannelSettings");

// Discord API codes of a channel the bot cannot see any more.
const GONE_CODES = new Set([10003, 50001, 50013]);

/**
 * Where a channel lies, through the bot's client: { guildId, parentId }, null
 * when the bot no longer sees it. Any other error is thrown on.
 */
async function lookupWithClient(client, channelId) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel || !channel.guildId) return null;
        return { guildId: String(channel.guildId), parentId: String(channel.parentId || "") };
    } catch (error) {
        if (GONE_CODES.has(Number(error && error.code))) return null;
        throw error;
    }
}

const asServerSettings = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

/**
 * A failed read-back undone on the file as it is now: logChannelIds set again
 * and each server's added channels taken out (those it held before stay). A
 * block or map the run created and left empty goes again.
 * @param {object} stored the file now
 * @param {object} before the file the run patched
 * @param {Record<string, {channelId: string}[]>} additions
 */
function undoMove(stored, before, additions) {
    const had = asServerSettings(before.serverSettings);
    const settings = { ...asServerSettings(stored.serverSettings) };
    for (const [guildId, list] of Object.entries(additions)) {
        const block = settings[guildId];
        if (!block || typeof block !== "object") continue;
        const kept = new Set(normalizeLogChannels(had[guildId] && had[guildId].logChannels).map((c) => c.channelId));
        const added = new Set(list.map((c) => c.channelId).filter((id) => !kept.has(id)));
        const rest = { ...block, logChannels: normalizeLogChannels(block.logChannels).filter((c) => !added.has(c.channelId)) };
        if (!rest.logChannels.length && !(had[guildId] && "logChannels" in had[guildId])) delete rest.logChannels;
        if (Object.keys(rest).length || had[guildId]) settings[guildId] = rest;
        else delete settings[guildId];
    }
    const out = { ...stored, logChannelIds: before.logChannelIds, serverSettings: settings };
    if (!Object.keys(settings).length && !("serverSettings" in before)) delete out.serverSettings;
    return out;
}

/**
 * Hand logChannelIds to the servers. Never throws for a single channel; a
 * failed lookup ends the run without writing.
 * @param {{ lookup: (channelId: string) => Promise<{guildId: string, parentId?: string}|null> }} opts
 * @returns {Promise<string[]>} the log lines (German, like the start migrations)
 */
async function migrateLogChannels({ lookup }) {
    const stored = configStore.readStored();
    if (!Object.prototype.hasOwnProperty.call(stored, "logChannelIds")) return [];
    const ids = [...new Set((Array.isArray(stored.logChannelIds) ? stored.logChannelIds : []).map((id) => String(id || "").trim()).filter(Boolean))];
    const config = configStore.getConfig();
    const firstGuildId = firstServerId(config);
    const known = serverSettingGuildIds(config.discordServers, config.guildId);
    const lines = [];

    if (ids.length && !firstGuildId) {
        return [`config.json: WARNUNG ${ids.length} Log-Kanal/-Kanäle nicht verteilt - kein Discord-Server eingerichtet (#921)`];
    }

    const additions = {};
    const placed = [];
    for (const channelId of ids) {
        let where;
        try {
            where = await lookup(channelId);
        } catch (error) {
            return [`config.json: Log-Kanäle nicht verteilt, Discord-Abfrage fehlgeschlagen (${error.message}) - nächster Start versucht es erneut (#921)`];
        }
        let guildId = where && where.guildId ? String(where.guildId) : "";
        const versionId = mainVersionFor({ categoryId: where ? where.parentId : "", config });
        if (!guildId) {
            guildId = firstGuildId;
            lines.push(`config.json: Log-Kanal ${channelId} nicht mehr sichtbar - dem ersten Server ${guildId} zugeordnet (#921)`);
        } else if (!known.has(guildId)) {
            lines.push(`config.json: WARNUNG Log-Kanal ${channelId} liegt auf ${guildId}, der kein eingerichteter Server ist - dem ersten Server ${firstGuildId} zugeordnet (#921)`);
            guildId = firstGuildId;
        }
        (additions[guildId] = additions[guildId] || []).push({ channelId, versionId });
        placed.push({ guildId, channelId });
    }

    // The web server already runs while the lookups wait: the file is read
    // again after them and the patch applied without another await up to the
    // write, so nothing saved in the meantime is overwritten.
    const fresh = configStore.readStored();
    if (!Object.prototype.hasOwnProperty.call(fresh, "logChannelIds")) return [];
    // Lists already set on a server stay first; a channel they hold is not added twice.
    const current = asServerSettings(fresh.serverSettings);
    const patch = {};
    for (const [guildId, list] of Object.entries(additions)) {
        const before = current[guildId] && Array.isArray(current[guildId].logChannels) ? current[guildId].logChannels : [];
        patch[guildId] = { logChannels: normalizeLogChannels([...before, ...list]) };
    }
    const next = { ...fresh, serverSettings: mergeServerSettings(current, patch) };
    delete next.logChannelIds;
    configStore.writeStored(next);

    // Read back: a channel that did not arrive (a block getConfig() dropped)
    // brings logChannelIds back and takes the moved channels out again - only
    // those, the rest of the file stays as it is.
    const after = configStore.getConfig();
    const missing = placed.filter(({ guildId, channelId }) => {
        const block = (after.serverSettings || {})[guildId];
        return !block || !normalizeLogChannels(block.logChannels).some((c) => c.channelId === channelId);
    });
    if (missing.length) {
        configStore.writeStored(undoMove(configStore.readStored(), fresh, additions));
        return [`config.json: WARNUNG Log-Kanäle nicht verteilt, ${missing.map((m) => m.channelId).join(", ")} kam nicht an - logChannelIds bleibt (#921)`];
    }
    const counts = Object.entries(additions).map(([g, list]) => `${g}: ${list.length}`);
    lines.unshift(`config.json: ${ids.length} Log-Kanal/-Kanäle ihren Servern zugeordnet (#921)${counts.length ? ` - ${counts.join(", ")}` : ""}`);
    return lines;
}

/**
 * bot.js after login: the migration with the bot's client, every line logged
 * (a warning line also as a warning). Never throws.
 */
async function runLogChannelMigration(client, { log = console.log, warn = console.error } = {}) {
    try {
        const lines = await migrateLogChannels({ lookup: (id) => lookupWithClient(client, id) });
        for (const line of lines) log(`[settings] Migration: ${line}`);
        for (const line of lines) if (/WARNUNG|fehlgeschlagen/.test(line)) warn(`[settings] Migration: ${line}`);
        return lines;
    } catch (error) {
        warn(`[settings] Migration der Log-Kanäle fehlgeschlagen: ${error.message}`);
        return [];
    }
}

module.exports = { migrateLogChannels, runLogChannelMigration, lookupWithClient };
