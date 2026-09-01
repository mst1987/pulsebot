// Parsers for the loot exports used on the server, all normalized to a single
// loot-item shape so the store / history pages don't care which addon produced
// them.
//
//   RCLootcouncil  → a JSON array of loot entries (rich: item name, boss,
//                    response, class, the gear the player replaced, ML, …).
//   Gargul         → a small CSV `dateTime,character,itemID,offspec,id`
//                    (date, char without realm, item id, offspec flag, unique id).
//   EventHelper    → the "eventhelper-loot" envelope our own WoW addon writes: it
//                    reads *both* addons' in-game history and emits them as raid
//                    sessions with a real per-item unix timestamp. Uploaded by the
//                    companion sync tool, but also pasteable by hand.
//
// Normalized loot item:
//   { source, rawId, itemId, itemName, itemIconUrl, itemQuality, itemLink, player,
//     character, characterKey, realm, class, response, offspec, boss, instance,
//     note, replacedGear, awardedAt, awardedBy }
//
// `rawId` + `source` is the dedup key (stable across re-imports of the same log).
//
// `itemName`/`itemIconUrl` are only what the export itself carries — RCLootcouncil
// gives a name but no icon, Gargul gives neither, and neither says how rare the
// item is. enrichItemNames() fills in what's missing (including `itemQuality`)
// via a Wowhead lookup; call it once at import time, not on every read, since
// the same item ids repeat across a raid's loot.

// Wowhead links for TBC (Burning Crusade). Item names resolve in the tooltip even
// when an export (Gargul) only gives us the id.
function itemLink(itemId) {
    return itemId ? `https://www.wowhead.com/tbc/item=${itemId}` : "";
}

// "Naphfß-Thunderstrike" → { character: "Naphfß", realm: "Thunderstrike" }.
// WoW character names never contain "-", so the first "-" splits name/realm.
// Gargul names have no realm suffix → realm stays "".
function splitPlayer(raw) {
    const player = String(raw || "").trim();
    const dash = player.indexOf("-");
    if (dash === -1) return { player, character: player, realm: "" };
    return { player, character: player.slice(0, dash), realm: player.slice(dash + 1) };
}

// Case-insensitive grouping key for a character (used to build the per-char
// history). Kept simple: lowercased name, realm-independent.
function characterKey(character) {
    return String(character || "").trim().toLowerCase();
}

class LootParseError extends Error {
    constructor(message) {
        super(message);
        this.name = "LootParseError";
    }
}

// --- RCLootcouncil (JSON array) ------------------------------------------------

function normalizeRclcRow(r) {
    if (!r || (r.itemID === undefined && !r.itemName)) return null;
    const { player, character, realm } = splitPlayer(r.player);
    const itemId = Number(r.itemID) || null;
    const servertime = Number(r.servertime);
    const awardedAt = servertime
        ? servertime * 1000
        : Date.parse(`${String(r.date || "").replace(/\//g, "-")}T${r.time || "00:00:00"}`) || 0;
    const gear = [r.gear1, r.gear2]
        .map((g) => String(g || "").replace(/^\[|\]$/g, "").trim())
        .filter(Boolean);
    const responseId = r.responseID !== undefined ? String(r.responseID) : "";
    return {
        source: "rclc",
        rawId: String(r.id || `${itemId}-${r.servertime || ""}-${player}`),
        itemId,
        itemName: String(r.itemName || "").trim(),
        itemIconUrl: "",
        itemLink: itemLink(itemId),
        player,
        character,
        characterKey: characterKey(character),
        realm,
        class: String(r.class || "").trim(),
        response: String(r.response || "").trim(),
        offspec: responseId === "4" || /off\s*spec/i.test(String(r.response || "")),
        boss: String(r.boss || "").trim(),
        instance: String(r.instance || "").trim(),
        note: String(r.note || "").trim(),
        replacedGear: gear,
        awardedAt,
        awardedBy: splitPlayer(r.owner).player,
    };
}

function parseRclc(text) {
    let data;
    try {
        data = JSON.parse(String(text || "").trim());
    } catch {
        throw new LootParseError(
            "Konnte den RCLootcouncil-Export nicht als JSON lesen. Bitte den kompletten Export (JSON) einfügen."
        );
    }
    const rows = Array.isArray(data) ? data : (Array.isArray(data && data.loot) ? data.loot : null);
    if (!rows) {
        throw new LootParseError(
            "Unerwartetes RCLootcouncil-Format — erwartet wird eine JSON-Liste von Loot-Einträgen."
        );
    }
    return rows.map(normalizeRclcRow).filter(Boolean);
}

// --- Gargul (CSV) --------------------------------------------------------------

const GARGUL_REQUIRED = ["character", "itemid", "id"];

function parseCsvLine(line) {
    // The Gargul export has no quoting/embedded commas, but be defensive.
    return line.split(",").map((c) => c.trim());
}

function parseGargul(text) {
    const lines = String(text || "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
    if (!lines.length) throw new LootParseError("Der Gargul-Export ist leer.");

    const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
    const idx = {};
    header.forEach((h, i) => { idx[h] = i; });
    const missing = GARGUL_REQUIRED.filter((c) => idx[c] === undefined);
    if (missing.length) {
        throw new LootParseError(
            `Unerwartetes Gargul-Format — es fehlt die Spalte „${missing.join("\", \"")}". Kopfzeile erwartet: dateTime,character,itemID,offspec,id`
        );
    }

    const out = [];
    for (const line of lines.slice(1)) {
        const cols = parseCsvLine(line);
        const rawCharacter = cols[idx.character] || "";
        const itemId = Number(cols[idx.itemid]) || null;
        if (!rawCharacter || !itemId) continue;
        const { player, character, realm } = splitPlayer(rawCharacter);
        const offspec = idx.offspec !== undefined && String(cols[idx.offspec]).trim() === "1";
        const dateStr = idx.datetime !== undefined ? cols[idx.datetime] : "";
        const awardedAt = dateStr ? (Date.parse(`${dateStr}T00:00:00Z`) || 0) : 0;
        out.push({
            source: "gargul",
            rawId: String(cols[idx.id] || `${itemId}-${dateStr}-${player}`),
            itemId,
            itemName: "",
            itemIconUrl: "",
            itemLink: itemLink(itemId),
            player,
            character,
            characterKey: characterKey(character),
            realm,
            class: "",
            response: offspec ? "Off Spec" : "Main Spec",
            offspec,
            boss: "",
            instance: "",
            note: "",
            replacedGear: [],
            awardedAt,
            awardedBy: "",
        });
    }
    return out;
}

// --- EventHelper addon envelope ------------------------------------------------

// The wire format our own addon + sync tool speak. Bumped only on a breaking
// change; a payload from a newer addon than this server knows is refused rather
// than half-read, so a mismatch is visible instead of silently losing items.
const EH_FORMAT = "eventhelper-loot";
const EH_VERSION = 1;

// Which addon a row originally came from. Kept as the item's `source` so an
// addon-uploaded row and a hand-pasted RCLootcouncil/Gargul export of the *same*
// award share a dedup key (`source` + `rawId`) and collapse into one item —
// rawId is RCLootcouncil's `id` resp. Gargul's `checksum` in both paths.
const EH_SOURCES = new Set(["rclc", "gargul"]);

function normalizeEhRow(r) {
    if (!r || typeof r !== "object") return null;
    const itemId = Number(r.itemId) || null;
    if (!itemId) return null;
    const { player, character, realm } = splitPlayer(r.player);
    if (!character) return null;
    const source = EH_SOURCES.has(String(r.source)) ? String(r.source) : "eventhelper";
    const response = String(r.response || "").trim();
    // The addon resolves the offspec flag itself (Gargul's `OS`, RCLootcouncil's
    // responseID 4); the text check only backstops an older addon build.
    const offspec = r.offspec === true || /off\s*spec/i.test(response);
    // Unix seconds in the payload — everything downstream works in ms.
    const awardedAt = Math.round((Number(r.awardedAt) || 0) * 1000);
    return {
        source,
        rawId: String(r.rawId || `${itemId}-${r.awardedAt || ""}-${player}`),
        itemId,
        itemName: String(r.itemName || "").trim(),
        itemIconUrl: "",
        itemLink: itemLink(itemId),
        player,
        character,
        characterKey: characterKey(character),
        realm,
        class: String(r.class || "").trim(),
        response,
        offspec,
        boss: String(r.boss || "").trim(),
        instance: String(r.instance || "").trim(),
        note: String(r.note || "").trim(),
        replacedGear: Array.isArray(r.replacedGear)
            ? r.replacedGear.map((g) => String(g || "").trim()).filter(Boolean)
            : [],
        awardedAt,
        awardedBy: splitPlayer(r.awardedBy).player,
    };
}

/**
 * Parse the addon's envelope into its raid sessions, each with normalized loot
 * items. One upload can carry several sessions (the addon splits by raid night /
 * instance), which is exactly what lets the inbox match each one to its own
 * Raid-Helper event instead of lumping a week of raids together.
 *
 * @returns {{ meta: object, sessions: Array<{ sessionId, startedAt, endedAt, instance, items }> }}
 */
function parseEventHelperSessions(text) {
    let data = text;
    if (typeof data === "string") {
        try {
            data = JSON.parse(data.trim());
        } catch {
            throw new LootParseError("Konnte den EventHelper-Addon-Export nicht als JSON lesen.");
        }
    }
    if (!data || typeof data !== "object" || data.format !== EH_FORMAT) {
        throw new LootParseError(
            `Kein EventHelper-Addon-Export — erwartet wird ein Objekt mit "format": "${EH_FORMAT}".`
        );
    }
    const version = Number(data.version) || 0;
    if (version > EH_VERSION) {
        throw new LootParseError(
            `Der Export stammt aus einer neueren Addon-Version (Format v${version}, unterstützt wird v${EH_VERSION}). Bitte den Bot aktualisieren.`
        );
    }
    if (!Array.isArray(data.sessions)) {
        throw new LootParseError("Unerwartetes EventHelper-Format — „sessions\" fehlt oder ist keine Liste.");
    }
    const sessions = data.sessions.map((s, i) => {
        const items = (Array.isArray(s && s.items) ? s.items : []).map(normalizeEhRow).filter(Boolean);
        return {
            sessionId: String((s && s.sessionId) || `session-${i + 1}`),
            startedAt: Math.round((Number(s && s.startedAt) || 0) * 1000),
            endedAt: Math.round((Number(s && s.endedAt) || 0) * 1000),
            instance: String((s && s.instance) || "").trim(),
            items,
        };
    });
    const meta = {
        version,
        generatedAt: Math.round((Number(data.generatedAt) || 0) * 1000),
        realm: String(data.realm || "").trim(),
        reporter: splitPlayer(data.reporter).player,
        addonVersion: String((data.client && data.client.addon) || "").trim(),
        syncVersion: String((data.client && data.client.sync) || "").trim(),
    };
    return { meta, sessions };
}

/** The addon envelope flattened to a plain item list (the paste-it-by-hand path). */
function parseEventHelper(text) {
    return parseEventHelperSessions(text).sessions.flatMap((s) => s.items);
}

// --- one item, entered by hand -------------------------------------------------

// A row nobody exported: the raid lead picked the item and the raider in the
// admin menu, because the addon missed the award (a piece handed out after the
// raid, a night where nobody had the addon running, an item traded on).
//
// `source` is its own value rather than a borrowed "gargul"/"rclc": a hand-made
// row shares no dedup key with any export, and saying where a row came from is
// the point of the field. `rawId` is derived from what was entered instead of
// being random, so submitting the same award twice (a double click, a reload)
// is recognised as the duplicate it is — a raider genuinely winning the same
// item twice in one second is not a case worth breaking that for.
const MANUAL_SOURCE = "manual";

/**
 * Build the normalized loot item for a hand-entered award.
 * @param {object} entry { itemId, character, boss, instance, response, offspec, awardedAt, note, awardedBy }
 * @returns {object|null} the item, or null when item or character is missing
 */
function buildManualItem(entry) {
    const e = entry || {};
    const itemId = Number(e.itemId) || null;
    const { player, character, realm } = splitPlayer(e.character);
    if (!itemId || !character) return null;
    const response = String(e.response || "").trim();
    const offspec = e.offspec === true || /off\s*spec/i.test(response);
    const awardedAt = Number(e.awardedAt) || Date.now();
    return {
        source: MANUAL_SOURCE,
        rawId: `${itemId}-${characterKey(character)}-${awardedAt}`,
        itemId,
        itemName: String(e.itemName || "").trim(),
        itemIconUrl: String(e.itemIconUrl || "").trim(),
        itemLink: itemLink(itemId),
        player,
        character,
        characterKey: characterKey(character),
        realm,
        class: "",
        response,
        offspec,
        boss: String(e.boss || "").trim(),
        instance: String(e.instance || "").trim(),
        note: String(e.note || "").trim(),
        replacedGear: [],
        awardedAt,
        awardedBy: String(e.awardedBy || "").trim(),
    };
}

// --- dispatch ------------------------------------------------------------------

/**
 * Parse a loot export. `tool` is "rclc" | "gargul" | "eventhelper". When omitted
 * or "auto", the format is sniffed: a JSON object tagged with our own format is
 * the addon envelope, any other JSON is RCLootcouncil's array, everything else is
 * Gargul's CSV.
 */
function parseLoot(text, tool = "auto") {
    const t = String(tool || "auto").toLowerCase();
    if (t === "rclc") return parseRclc(text);
    if (t === "gargul") return parseGargul(text);
    if (t === "eventhelper") return parseEventHelper(text);
    // auto-detect
    const trimmed = String(text || "").trim();
    if (trimmed.startsWith("{")) {
        // Only our envelope is an object; an RCLootcouncil export is an array.
        // Sniffing on the raw text keeps this cheap and avoids parsing twice.
        if (trimmed.includes(`"${EH_FORMAT}"`)) return parseEventHelper(text);
        return parseRclc(text);
    }
    if (trimmed.startsWith("[")) return parseRclc(text);
    return parseGargul(text);
}

// The moment a loot export belongs to, so the import can be matched to a
// Raid-Helper event by date instead of asking the admin to pick one by hand.
// Uses the earliest awarded timestamp (the raid's first kill) — a Gargul date
// carries no time-of-day and normalizes to UTC midnight, which is still the
// earliest value once real RCLootcouncil times are mixed in. Returns null
// when no item has a usable timestamp.
function detectImportDate(items) {
    const times = (items || [])
        .map((i) => Number(i && i.awardedAt) || 0)
        .filter((t) => t > 0);
    return times.length ? Math.min(...times) : null;
}

// --- name/icon/quality enrichment ----------------------------------------------

const wowhead = require("./wowhead");

/** Does this row still need a Wowhead lookup? */
function needsLookup(it) {
    return !!(it && it.itemId && (!it.itemName || !it.itemIconUrl || !isQuality(it.itemQuality)));
}

/** A resolved quality is a number (Wowhead's 0-7 scale); anything else is "unknown". */
function isQuality(q) {
    return typeof q === "number" && q >= 0;
}

/**
 * Fill in `itemName`/`itemIconUrl`/`itemQuality` for items an export didn't
 * already carry — no addon exports any of the three completely (Gargul: none,
 * RCLootcouncil: the name only). Looks up each distinct item id at most once via
 * Wowhead, then mutates every matching item in place. Best-effort: a failed
 * lookup just leaves that item showing "Item <id>" in the default text colour
 * (still clickable via itemLink). Call once at import time — the result is
 * stored, so later reads never repeat the network round trip.
 *
 * `itemQuality` is what the item name is coloured with everywhere in the app
 * (see web-client's lib/itemQuality.ts); it is stored rather than derived on
 * read because nothing in the repo maps an item id to its quality offline.
 */
async function enrichItemNames(items) {
    const ids = [...new Set(
        (items || [])
            .filter(needsLookup)
            .map((it) => it.itemId)
    )];
    if (!ids.length) return items;
    const lookups = await Promise.all(ids.map((id) => wowhead.lookupItem(id)));
    const byId = new Map(ids.map((id, i) => [id, lookups[i]]));
    for (const it of items) {
        const found = it && it.itemId ? byId.get(it.itemId) : null;
        if (!found) continue;
        if (!it.itemName) it.itemName = found.name;
        if (!it.itemIconUrl) it.itemIconUrl = found.iconUrl;
        if (!isQuality(it.itemQuality) && isQuality(found.quality)) it.itemQuality = found.quality;
    }
    return items;
}

module.exports = {
    parseLoot, parseRclc, parseGargul, parseEventHelper, parseEventHelperSessions,
    buildManualItem, detectImportDate, enrichItemNames, needsLookup,
    splitPlayer, characterKey, itemLink, LootParseError,
    EH_FORMAT, EH_VERSION, MANUAL_SOURCE,
};
