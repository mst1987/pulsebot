// Parsers for the two loot-addon exports used on the server, both normalized to
// a single loot-item shape so the store / history pages don't care which addon
// produced them.
//
//   RCLootcouncil  → a JSON array of loot entries (rich: item name, boss,
//                    response, class, the gear the player replaced, ML, …).
//   Gargul         → a small CSV `dateTime,character,itemID,offspec,id`
//                    (date, char without realm, item id, offspec flag, unique id).
//
// Normalized loot item:
//   { source, rawId, itemId, itemName, itemIconUrl, itemLink, player, character,
//     characterKey, realm, class, response, offspec, boss, instance, note,
//     replacedGear, awardedAt, awardedBy }
//
// `rawId` + `source` is the dedup key (stable across re-imports of the same log).
//
// `itemName`/`itemIconUrl` are only what the export itself carries — RCLootcouncil
// gives a name but no icon, Gargul gives neither. enrichItemNames() fills in
// what's missing via a Wowhead lookup; call it once at import time, not on every
// read, since the same item ids repeat across a raid's loot.

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

// --- dispatch ------------------------------------------------------------------

/**
 * Parse a loot export. `tool` is "rclc" | "gargul". When omitted or "auto", the
 * format is sniffed (JSON → rclc, otherwise csv → gargul).
 */
function parseLoot(text, tool = "auto") {
    const t = String(tool || "auto").toLowerCase();
    if (t === "rclc") return parseRclc(text);
    if (t === "gargul") return parseGargul(text);
    // auto-detect
    const trimmed = String(text || "").trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) return parseRclc(text);
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

// --- name/icon enrichment ------------------------------------------------------

const wowhead = require("./wowhead");

/**
 * Fill in `itemName`/`itemIconUrl` for items an export didn't already carry
 * (Gargul: neither, RCLootcouncil: name but no icon). Looks up each distinct
 * item id at most once via Wowhead, then mutates every matching item in place.
 * Best-effort: a failed lookup just leaves that item showing "Item <id>" (still
 * clickable via itemLink). Call once at import time — the result is stored, so
 * later reads never repeat the network round trip.
 */
async function enrichItemNames(items) {
    const ids = [...new Set(
        (items || [])
            .filter((it) => it && it.itemId && (!it.itemName || !it.itemIconUrl))
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
    }
    return items;
}

module.exports = {
    parseLoot, parseRclc, parseGargul, detectImportDate, enrichItemNames,
    splitPlayer, characterKey, itemLink, LootParseError,
};
