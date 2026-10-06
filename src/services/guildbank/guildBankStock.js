// Guild bank stock: taking a scan in (POST /api/ingest/guildbank) and which
// Discord server a bank belongs to (Einstellungen, /api/settings/guild-banks).
//
// A bank is known by game version + realm + guild. A bank seen for the first
// time goes to the one event server when exactly one is configured; with
// several it belongs to no server yet and waits for an assignment ("Wartet auf
// Zuordnung") — it is stored all the same, so nothing scanned is lost. An
// ingest token bound to a server (`token.guildId`; tokens carry none today)
// assigns a new bank right away. Only an event server can own a bank: that is
// where the requests are made.
//
// Errors use the `{ code, error }` form (web/http/apiResult.js sendFailure),
// messages in German.
const store = require("../../stores/guildBankStockStore");
const { parseGuildBankScan } = require("../../utils/guildbank/guildBankScan");
const itemMeta = require("./itemMeta");
const { mainVersionFor } = require("../events/mainVersion");
const guildRoles = require("../discord/guildRoles");
const discord = require("../discord/discord");
const { getConfig } = require("../../stores/settingsStore");

/** The server an ingest token is bound to, "" when none. */
function serverOfToken(token) {
    return String((token && token.guildId) || "").trim();
}

/**
 * The one event server when exactly one is configured, else "". A bank seen
 * for the first time goes there right away — with several servers nobody can
 * know which guild it belongs to, so it waits for the assignment.
 */
function onlyEventServer(config = getConfig()) {
    const ids = guildRoles.eventGuildIds(config || getConfig());
    return ids.length === 1 ? ids[0] : "";
}

/**
 * Parse and store an uploaded scan. Fills what the local item tables know at
 * once and returns the items that still need a Wowhead lookup (`lookups`) —
 * the caller queues them after answering (itemMeta.queueLookups).
 * @throws {GuildBankParseError} for an upload that is no readable scan
 * @returns {{ scan, status: "created"|"updated"|"stale", bank, newItems: number[], lookups: number[] }}
 */
function ingestScan(body, { token = {}, now = Date.now(), config } = {}) {
    const scan = parseGuildBankScan(body, { fallbackVersion: mainVersionFor({ config }) });
    const guildId = serverOfToken(token) || (store.getBank(scan.key) ? "" : onlyEventServer(config));
    const result = store.recordScan(scan, { now, guildId, uploadedBy: (token && token.name) || "" });
    if (result.status === "stale") return { scan, ...result, lookups: [] };
    itemMeta.applyLocalMeta(scan.gameVersion, result.newItems, { now });
    return { scan, ...result, lookups: store.itemsWithoutWowheadMeta(scan.key) };
}

/** The servers a bank can be assigned to: every event server, with its name and label. */
function bankServers(config = getConfig()) {
    const entries = (config && config.discordServers && Array.isArray(config.discordServers.eventGuilds))
        ? config.discordServers.eventGuilds : [];
    const labels = new Map(entries.map((e) => [String((e && e.guildId) || ""), String((e && e.label) || "")]));
    const names = new Map(discord.listGuilds().map((g) => [g.id, g.name]));
    return guildRoles.eventGuildIds(config).map((guildId) => ({
        guildId,
        name: names.get(guildId) || "",
        label: labels.get(guildId) || "",
    }));
}

/**
 * Assign a bank to an event server; "" takes the assignment back.
 * @returns {{ bank: object } | { code: string, error: string }}
 */
function assignBank(key, guildId, { config = getConfig() } = {}) {
    const id = String(guildId || "").trim();
    if (id && !guildRoles.eventGuildIds(config).includes(id)) {
        return { code: "invalid", error: "Nur ein Event-Server kann eine Gildenbank bekommen." };
    }
    const bank = store.assignBank(key, id);
    if (!bank) return { code: "not_found", error: "Gildenbank nicht gefunden." };
    return { bank };
}

/** Forget a bank. @returns {{ ok: true } | { code, error }} */
function removeBank(key) {
    return store.removeBank(key) ? { ok: true } : { code: "not_found", error: "Gildenbank nicht gefunden." };
}

module.exports = { ingestScan, bankServers, assignBank, removeBank, serverOfToken, onlyEventServer };
