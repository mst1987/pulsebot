// Parser for the guild bank scan our own WoW addon writes (EventHelperSync,
// eventhelper-addon#16) and its sync tool uploads to POST /api/ingest/guildbank.
//
// Wire format `eventhelper-guildbank` v1:
//
//   { format: "eventhelper-guildbank", version: 1, generatedAt,
//     client: { project, build },
//     guild: { name, realm, faction },
//     scannedBy, scannedAt, money,
//     tabs: [{ index, name, items: [{ itemId, count, slot }] }] }
//
// Times are unix seconds (Lua's time()), money is copper. Unknown fields are
// ignored, so a newer addon that only adds fields still uploads; a higher
// `version` is refused rather than half-read (same rule as the loot envelope in
// utils/loot/lootImport.js).
//
// The result is what the stock store keeps of a scan: the bank's identity
// (game version, realm, guild — together the key), the scan's facts and the
// items summed up per item id with their count per tab. Slots are not kept:
// nothing downstream asks for them.
const { VERSIONS } = require("../../config/gameVersions");

const GB_FORMAT = "eventhelper-guildbank";
const GB_VERSION = 1;

const NAME_MAX = 60;
const TAB_NAME_MAX = 40;
const MAX_TAB_INDEX = 20;
const MAX_COUNT = 1_000_000;
// More than a bank can hold (8 tabs x 98 slots in the newest clients) — a cap
// against a malformed upload, not a game rule.
const MAX_ITEM_ROWS = 2000;

class GuildBankParseError extends Error {
    constructor(message) {
        super(message);
        this.name = "GuildBankParseError";
    }
}

const str = (v, max = NAME_MAX) => String(v === undefined || v === null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

/** A positive whole number up to `max`, else 0. */
function posInt(v, max) {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 && n <= max ? n : 0;
}

/** Unix seconds (or ms, tolerated) -> ms; 0 when missing. */
function toMs(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n > 1e12 ? Math.round(n) : Math.round(n * 1000);
}

// What the addon may call a client: our own version ids, WoW's project names
// and WOW_PROJECT_ID numbers. Forever runs on a modern (mainline) client.
const PROJECT_ALIASES = {
    tbc: "tbc", bcc: "tbc", "tbc-anniversary": "tbc", anniversary: "tbc", "burning-crusade": "tbc",
    burning_crusade: "tbc", "burning crusade": "tbc", 5: "tbc",
    classic: "classic", era: "classic", vanilla: "classic", "classic-era": "classic", 2: "classic",
    forever: "forever", "wow-forever": "forever", mainline: "forever", retail: "forever", 1: "forever",
};

/**
 * The game version id (config/gameVersions) of a scan's client: `client.project`
 * first, else the build number ("2.5.5" is TBC, "1.15.x" Classic). "" when
 * neither says it — the caller decides the fallback.
 */
function versionOfClient(client) {
    const c = client && typeof client === "object" ? client : {};
    const project = String(c.project === undefined || c.project === null ? "" : c.project).trim().toLowerCase();
    if (project) {
        if (VERSIONS.some((v) => v.id === project)) return project;
        if (PROJECT_ALIASES[project]) return PROJECT_ALIASES[project];
    }
    const build = String(c.build || "").trim();
    if (/^2\.\d/.test(build)) return "tbc";
    if (/^1\.1[0-5]\./.test(build)) return "classic";
    return "";
}

/** "Alliance" | "Horde" | "" — the token UnitFactionGroup gives, its German label tolerated. */
function normalizeFaction(raw) {
    const s = String(raw || "").trim().toLowerCase();
    if (s === "alliance" || s === "allianz") return "Alliance";
    if (s === "horde") return "Horde";
    return "";
}

/** Realm as part of a key: lower case without blanks, apostrophes or dashes ("Die Aldor" -> "diealdor"). */
function realmKey(realm) {
    return String(realm || "").toLowerCase().replace(/[\s'’-]+/g, "");
}

/** Guild name as part of a key: lower case, blanks collapsed. */
function guildKey(name) {
    return String(name || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * The key of a guild bank: game version + realm + guild, e.g.
 * "tbc:spineshatter:die gilde". The same guild on two clients is two banks.
 */
function bankKeyOf(gameVersion, realm, guild) {
    return `${String(gameVersion || "").trim().toLowerCase()}:${realmKey(realm)}:${guildKey(guild)}`;
}

/** Tabs as `[{ index, name }]` and the items summed up per id: `{ [itemId]: { count, tabs: { [index]: count } } }`. */
function collectTabs(rawTabs) {
    const tabs = new Map();
    const items = {};
    let rows = 0;
    for (const t of Array.isArray(rawTabs) ? rawTabs : []) {
        if (!t || typeof t !== "object") continue;
        const index = posInt(t.index, MAX_TAB_INDEX);
        if (!index) continue;
        if (!tabs.has(index)) tabs.set(index, { index, name: str(t.name, TAB_NAME_MAX) });
        for (const row of Array.isArray(t.items) ? t.items : []) {
            if (rows >= MAX_ITEM_ROWS) break;
            if (!row || typeof row !== "object") continue;
            const itemId = posInt(row.itemId, 10_000_000);
            const count = posInt(row.count, MAX_COUNT);
            if (!itemId || !count) continue;
            rows += 1;
            const entry = items[itemId] || (items[itemId] = { count: 0, tabs: {} });
            entry.count = Math.min(MAX_COUNT, entry.count + count);
            entry.tabs[index] = Math.min(MAX_COUNT, (entry.tabs[index] || 0) + count);
        }
    }
    return { tabs: [...tabs.values()].sort((a, b) => a.index - b.index), items };
}

/**
 * Parse an `eventhelper-guildbank` upload (object or JSON text).
 * @param {object|string} body
 * @param {{ fallbackVersion?: string }} [opts] the version of a scan whose client says none (the main version)
 * @returns {{ format: string, version: number, generatedAt: number, gameVersion: string, versionGuessed: boolean, build: string,
 *   project: string, guild: string, realm: string, faction: string, key: string, scannedBy: string,
 *   scannedAt: number, money: number, tabs: Array<{index:number,name:string}>,
 *   items: Object<string, {count:number, tabs:Object<string,number>}> }}
 *   `versionGuessed` says the client named no known version and `fallbackVersion` stood in.
 * @throws {GuildBankParseError} with a German message
 */
function parseGuildBankScan(body, { fallbackVersion = "" } = {}) {
    let data = body;
    if (typeof data === "string") {
        try {
            data = JSON.parse(data.trim());
        } catch {
            throw new GuildBankParseError("Konnte den Gildenbank-Scan nicht als JSON lesen.");
        }
    }
    if (!data || typeof data !== "object" || data.format !== GB_FORMAT) {
        throw new GuildBankParseError(`Kein Gildenbank-Scan — erwartet wird ein Objekt mit "format": "${GB_FORMAT}".`);
    }
    const version = Number(data.version) || 0;
    if (version > GB_VERSION) {
        throw new GuildBankParseError(
            `Der Scan stammt aus einer neueren Addon-Version (Format v${version}, unterstützt wird v${GB_VERSION}). Bitte den Bot aktualisieren.`
        );
    }
    const guildBlock = data.guild && typeof data.guild === "object" ? data.guild : {};
    const guild = str(guildBlock.name);
    const realm = str(guildBlock.realm);
    if (!guild || !realm) throw new GuildBankParseError("Der Scan nennt keine Gilde oder keinen Realm.");
    if (data.tabs !== undefined && !Array.isArray(data.tabs)) {
        throw new GuildBankParseError("Unerwartetes Gildenbank-Format — „tabs\" ist keine Liste.");
    }
    const client = data.client && typeof data.client === "object" ? data.client : {};
    const ownVersion = versionOfClient(client);
    const gameVersion = ownVersion || String(fallbackVersion || "").trim().toLowerCase();
    if (!gameVersion) throw new GuildBankParseError("Der Scan nennt keine bekannte Client-Version (client.project).");
    const { tabs, items } = collectTabs(data.tabs);
    const money = Number(data.money);
    return {
        format: GB_FORMAT,
        version,
        generatedAt: toMs(data.generatedAt),
        gameVersion,
        versionGuessed: !ownVersion,
        project: str(client.project, 30),
        build: str(client.build, 30),
        guild,
        realm,
        faction: normalizeFaction(guildBlock.faction),
        key: bankKeyOf(gameVersion, realm, guild),
        scannedBy: str(data.scannedBy),
        scannedAt: toMs(data.scannedAt),
        money: Number.isFinite(money) && money > 0 ? Math.floor(money) : 0,
        tabs,
        items,
    };
}

module.exports = {
    parseGuildBankScan, versionOfClient, normalizeFaction, bankKeyOf, realmKey, guildKey,
    GuildBankParseError, GB_FORMAT, GB_VERSION,
};
