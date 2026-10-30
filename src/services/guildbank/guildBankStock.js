// Guild bank stock: taking a scan in (POST /api/ingest/guildbank) and which
// Discord server a bank belongs to (Einstellungen, /api/settings/guild-banks).
//
// A bank is known by game version + realm + guild. A bank seen for the first
// time goes to the one raid server when exactly one has raids set up; with
// several it belongs to no server yet and waits for an assignment ("Wartet auf
// Zuordnung") — it is stored all the same, so nothing scanned is lost. An
// ingest token bound to a server (`token.guildId`, #994; older tokens carry none)
// assigns a new bank right away; it is refused (`other_server`) for a bank of
// another server, and a known bank without a server stays without one. Only a
// raid server can own a bank: that is where the requests are made.
//
// A scan whose client names no game version (#737) is never filed under the
// main version: it goes to the bank already known for its realm and guild
// (one version only), else it is refused with a parse error the uploader sees
// and the log names.
//
// Errors use the `{ code, error }` form (web/http/apiResult.js sendFailure),
// messages in German.
const store = require("../../stores/guildBankStockStore");
const { parseGuildBankScan, bankKeyOf, GuildBankParseError } = require("../../utils/guildbank/guildBankScan");
const itemMeta = require("./itemMeta");
const guildRoles = require("../discord/guildRoles");
const discord = require("../discord/discord");
const { raidServerIds } = require("../discord/botCheck");
const { getConfig } = require("../../stores/settingsStore");

/** The server an ingest token is bound to, "" when none. */
function serverOfToken(token) {
    return String((token && token.guildId) || "").trim();
}

/**
 * The one raid server, else "". Only servers with raids set up count (the
 * first server, a stored raid event, a configured raid category on it —
 * botCheck.raidServerIds), so a server that only shows lists changes nothing.
 * A bank seen for the first time goes there right away — with several raid
 * servers nobody can know which guild it belongs to, so it waits for the
 * assignment.
 */
function onlyEventServer(config = getConfig()) {
    const cfg = config || getConfig();
    const ids = raidServerIds(cfg);
    return ids.length === 1 ? ids[0] : "";
}

/**
 * Parse and store an uploaded scan. Fills what the local item tables know at
 * once and returns the items that still need a Wowhead lookup (`lookups`) —
 * the caller queues them after answering (itemMeta.queueLookups).
 * @throws {GuildBankParseError} for an upload that is no readable scan
 * @returns {{ scan, status: "created"|"updated"|"stale", bank, newItems: number[], lookups: number[] }
 *   | { code: "other_server", error: string, scan }}  nothing stored for the latter
 */
/**
 * The game version of a scan without one (#737): the version of the bank
 * already stored for that realm and guild — "" when there is none, or banks of
 * several versions (then nobody can tell which client scanned it).
 */
function versionOfKnownBank({ realm, guild }) {
    const rest = bankKeyOf("", realm, guild); // ":<realm>:<guild>"
    const versions = new Set(store.listBanks()
        .filter((b) => b.key && b.gameVersion && b.key.slice(b.key.indexOf(":")) === rest)
        .map((b) => b.gameVersion));
    return versions.size === 1 ? [...versions][0] : "";
}

function ingestScan(body, { token = {}, now = Date.now(), config } = {}) {
    let scan;
    try {
        scan = parseGuildBankScan(body, { fallbackVersion: versionOfKnownBank });
    } catch (e) {
        if (e instanceof GuildBankParseError) console.warn(`[guildbank] Scan abgelehnt: ${e.message}`);
        throw e;
    }
    // A key with a server (#994) never writes into another server's bank. Each
    // game version is a bank of its own (key version:realm:guild), so the own
    // server's bank of another version is no conflict. A known bank without a
    // server (waiting, or taken back) takes the scan but stays without one.
    const own = serverOfToken(token);
    const known = store.getBank(scan.key);
    if (own && known && String(known.guildId || "") && String(known.guildId) !== own) {
        console.warn(`[guildbank] Scan abgelehnt: Bank ${scan.key} gehört zu einem anderen Server.`);
        return { code: "other_server", error: "Diese Gildenbank gehört zu einem anderen Discord-Server.", scan };
    }
    const guildId = known ? "" : (own || onlyEventServer(config));
    const result = store.recordScan(scan, { now, guildId, uploadedBy: (token && token.name) || "" });
    if (result.status === "stale") return { scan, ...result, lookups: [] };
    // new items and those with stale (German) meta: the local tables name them at once
    const lookups = store.itemsWithoutWowheadMeta(scan.key);
    itemMeta.applyLocalMeta(scan.gameVersion, lookups, { now });
    return { scan, ...result, lookups };
}

/** The servers a bank can be assigned to: every raid server, with its name and label. */
function bankServers(config = getConfig()) {
    const names = new Map(discord.listGuilds().map((g) => [g.id, g.name]));
    return guildRoles.eventGuildIds(config).map((guildId) => ({
        guildId,
        name: names.get(guildId) || "",
        label: guildRoles.serverLabel(guildId, config),
    }));
}

/**
 * Assign a bank to a raid server; "" takes the assignment back.
 * @returns {{ bank: object } | { code: string, error: string }}
 */
function assignBank(key, guildId, { config = getConfig() } = {}) {
    const id = String(guildId || "").trim();
    if (id && !guildRoles.eventGuildIds(config).includes(id)) {
        return { code: "invalid", error: "Nur ein Server aus der Serverliste kann eine Gildenbank bekommen." };
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
