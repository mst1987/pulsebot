const data = require("../../config/claData");
const { selectPlayers } = require("./common");

// WCL/WoW equip slot index -> human name
const SLOT_NAMES = {
    0: "Kopf", 1: "Hals", 2: "Schultern", 4: "Brust", 5: "Gürtel", 6: "Beine",
    7: "Füße", 8: "Armschienen", 9: "Hände", 10: "Ring 1", 11: "Ring 2",
    12: "Schmuck 1", 13: "Schmuck 2", 14: "Umhang", 15: "Waffe", 16: "Nebenhand", 17: "Wand/Idol/Relikt",
};
// display order for the per-raider armory page
const ARMORY_SLOTS = [0, 1, 2, 14, 4, 8, 9, 5, 6, 7, 10, 11, 12, 13, 15, 16, 17];
// slots that should always be filled (matches CLA: 0-17 except 3 [shirt] and 16 [off-hand])
const REQUIRED_SLOTS = [0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17];

const ENCHANTABLE = new Set(data.ENCHANTABLE_SLOTS);
const ITEMS_NO_ENCHANT = new Set(data.ITEMS_WITHOUT_ENCHANT);
const EXCLUDED_GEAR = new Set(data.EXCLUDED_GEAR.map((g) => g.id));
const META = new Set(data.META_GEM_IDS);
const YELLOW = new Set(data.YELLOW_GEM_IDS);
const RED = new Set(data.RED_GEM_IDS);
const BLUE = new Set(data.BLUE_GEM_IDS);
const UNCUT = new Set(data.UNCUT_GEM_IDS);
const ACC_UNCOMMON = new Set(data.ACCEPTABLE_UNCOMMON_GEM_IDS);
const ACC_RARE = new Set(data.ACCEPTABLE_RARE_GEM_IDS);

function isEnchantBad(enchantId, slot) {
    const id = String(enchantId);
    return data.ENCHANT_BLACKLIST.some(
        (b) => b.id === id && (b.slot === null || b.slot === String(slot))
    );
}
function getBadEnchantName(enchantId, slot) {
    const id = String(enchantId);
    const b = data.ENCHANT_BLACKLIST.find(
        (e) => e.id === id && (e.slot === null || e.slot === String(slot))
    );
    return b ? b.name : "";
}

// Meta gem activation rules (ported from GearIssues.js). Returns true if the
// meta gem's socket bonus requirements are met by the player's other gems.
function metaGemActive(metaId, red, yellow, blue) {
    const m = Number(metaId);
    if (m === 25896 && blue > 2) return true;
    if (m === 25897 && red > blue) return true;
    if ((m === 32409 || m === 25899 || m === 25901 || m === 25890 || m === 32410) && red > 1 && blue > 1 && yellow > 1) return true;
    if (m === 25898 && blue > 4) return true;
    if ((m === 25893 || m === 32640) && blue > yellow) return true;
    if (m === 34220 && blue > 1) return true;
    if (m === 25895 && red > yellow) return true;
    if ((m === 25894 || m === 28556 || m === 28557) && red > 0 && yellow > 1) return true;
    if (m === 32641 && yellow > 2) return true;
    if (m === 35503 && red > 2) return true;
    if (m === 35501 && blue > 1 && yellow > 0) return true;
    return false;
}

/**
 * Analyze one player's gear (from a WCL casts/summary table entry).
 * Returns an array of issue strings like "Spellstrike Hood [no enchant]".
 *
 * @param {object} player  entry with { name, type, total, gear: [...] }
 * @param {object} opts    { gemsToConsider = 3, onlyGems = false }
 */
function analyzePlayerGear(player, opts = {}) {
    const gemsToConsider = typeof opts.gemsToConsider === "number" ? opts.gemsToConsider : data.GEM_QUALITY.rare;
    const onlyGems = !!opts.onlyGems;
    const issues = [];
    const seen = new Set();
    // issue: { kind, itemId, itemName, icon, slot, label, severity }
    const add = (key, issue) => { if (!seen.has(key)) { seen.add(key); issues.push(issue); } };
    const gear = player.gear || [];

    // --- meta gem: count colors across all gems, then check activation ---
    if (gemsToConsider > 0) {
        let metaId = 0, metaItem = null, red = 0, yellow = 0, blue = 0;
        for (const item of gear) {
            if (!item || !item.gems) continue;
            for (const gem of item.gems) {
                if (gem.itemLevel === undefined || gem.itemLevel === null) continue;
                const gid = String(gem.id);
                // independent checks: a dual-color (e.g. purple) gem counts for both colors
                if (META.has(gid)) { metaId = gem.id; metaItem = item; }
                if (YELLOW.has(gid)) yellow++;
                if (RED.has(gid)) red++;
                if (BLUE.has(gid)) blue++;
            }
        }
        if (metaId > 0 && metaItem && !metaGemActive(metaId, red, yellow, blue)) {
            add("meta", {
                kind: "metaInactive", itemId: String(metaItem.id), itemName: metaItem.name,
                icon: metaItem.icon || null, slot: Number(metaItem.slot), label: "Meta-Gem inaktiv", severity: "medium",
            });
        }
    }

    // --- empty / missing item slots ---
    if (!onlyGems) {
        for (const slot of REQUIRED_SLOTS) {
            const item = gear.find((g) => g && Number(g.slot) === slot);
            if (!item || item.id === undefined || item.id === null || String(item.id) === "0" || String(item.id).length === 0) {
                add(`noitem-${slot}`, {
                    kind: "noItem", itemId: null, itemName: SLOT_NAMES[slot],
                    icon: null, slot, label: "kein Item", severity: "high",
                });
            }
        }
    }

    // --- per-item enchant / socket / gem-quality checks ---
    for (const item of gear) {
        if (!item || item.id === undefined || item.id === null) continue;
        const id = String(item.id);
        if (id === "0" || id.length === 0) continue;
        if (ITEMS_NO_ENCHANT.has(id) || EXCLUDED_GEAR.has(id)) continue;
        const slot = Number(item.slot);
        const base = { itemId: id, itemName: item.name, icon: item.icon || null, slot };

        // enchant check
        if (!onlyGems && ENCHANTABLE.has(slot)) {
            const isShieldMisc = slot === 16 && item.icon && item.icon.indexOf("_misc_") > -1;
            if (!isShieldMisc) {
                const pe = item.permanentEnchant;
                if (pe === undefined || pe === null || String(pe).length < 1) {
                    add(`ench-${id}`, { ...base, kind: "noEnchant", label: "keine Verzauberung", severity: "high" });
                } else if (isEnchantBad(pe, slot)) {
                    const peStr = String(pe);
                    const exceptionSpellPen = peStr === "2938" && player.type === "Priest";
                    const exceptionWeapon = peStr === "2669" && (player.type === "Paladin" || player.type === "Shaman");
                    if (!exceptionSpellPen && !exceptionWeapon) {
                        add(`ench-${id}`, { ...base, kind: "badEnchant", label: getBadEnchantName(pe, slot), severity: "medium" });
                    }
                }
            }
        }

        // empty socket check
        if (data.SOCKETS[id] !== undefined) {
            const sockets = data.SOCKETS[id];
            const gemCount = item.gems ? item.gems.length : 0;
            if (gemsToConsider > 0 && gemCount < sockets) {
                for (let m = sockets - gemCount; m > 0; m--) {
                    issues.push({ ...base, kind: "emptySocket", label: "leerer Sockel", severity: "medium" });
                }
            }
        }

        // uncut (raw) gems — flagged independently of quality
        if (item.gems) {
            for (const gem of item.gems) {
                if (UNCUT.has(String(gem.id))) {
                    add(`uncut-${id}`, { ...base, kind: "uncutGem", label: "ungeschliffener Edelstein", severity: "medium" });
                    break;
                }
            }
        }

        // gem quality check (one flag per item, matches CLA)
        if (item.gems) {
            let flagged = seen.has(`gem-${id}`);
            for (const gem of item.gems) {
                if (flagged || gem.itemLevel === undefined || gem.itemLevel === null) continue;
                const gid = String(gem.id);
                if (gemsToConsider > 1 && gem.itemLevel < 60) {
                    add(`gem-${id}`, { ...base, kind: "badGem", label: "gewöhnlicher Edelstein", severity: "medium" }); flagged = true;
                } else if (gemsToConsider > 2 && gem.itemLevel === 60 && !ACC_UNCOMMON.has(gid)) {
                    add(`gem-${id}`, { ...base, kind: "badGem", label: "grüner Edelstein", severity: "medium" }); flagged = true;
                } else if (gemsToConsider > 3 && gem.itemLevel < 100 && !ACC_RARE.has(gid)) {
                    add(`gem-${id}`, { ...base, kind: "badGem", label: "blauer Edelstein", severity: "medium" }); flagged = true;
                }
            }
        }
    }

    return issues;
}

/** Format a structured issue object as a plain string (for Discord). */
function formatIssue(issue) {
    return `${issue.itemName} [${issue.label}]`;
}

function isGemBad(gem, gemsToConsider) {
    if (gem === undefined || gem === null) return false;
    if (UNCUT.has(String(gem.id))) return true;
    if (gem.itemLevel === undefined || gem.itemLevel === null) return false;
    const gid = String(gem.id);
    if (gemsToConsider > 1 && gem.itemLevel < 60) return true;
    if (gemsToConsider > 2 && gem.itemLevel === 60 && !ACC_UNCOMMON.has(gid)) return true;
    if (gemsToConsider > 3 && gem.itemLevel < 100 && !ACC_RARE.has(gid)) return true;
    return false;
}

/**
 * Build an armory-style equipped-item list for one player (for the detail page).
 * Each item carries enchant status, gems and empty-socket count.
 */
function buildArmory(player, opts = {}) {
    const gemsToConsider = typeof opts.gemsToConsider === "number" ? opts.gemsToConsider : data.GEM_QUALITY.rare;
    const out = [];
    for (const slot of ARMORY_SLOTS) {
        const item = (player.gear || []).find((g) => g && Number(g.slot) === slot);
        if (!item || item.id === undefined || item.id === null) continue;
        const id = String(item.id);
        if (id === "0") continue;

        const pe = item.permanentEnchant;
        const enchId = pe === undefined || pe === null ? null : String(pe);
        // NOTE: WCL's permanentEnchantName is retail-scaled and wrong for TBC, so we do
        // NOT display it. The correct enchant is shown via the Wowhead tooltip (ench id).
        let enchant = { status: "na", enchantId: enchId, reason: "" };
        const enchantable = ENCHANTABLE.has(slot)
            && !(slot === 16 && item.icon && item.icon.indexOf("_misc_") > -1)
            && !ITEMS_NO_ENCHANT.has(id) && !EXCLUDED_GEAR.has(id);
        if (enchantable) {
            if (enchId === null || enchId.length < 1) enchant = { status: "missing", enchantId: null, reason: "" };
            else if (isEnchantBad(pe, slot)) enchant = { status: "bad", enchantId: enchId, reason: getBadEnchantName(pe, slot) || "" };
            else enchant = { status: "ok", enchantId: enchId, reason: "" };
        }

        const gems = (item.gems || []).map((g) => ({ id: String(g.id), itemLevel: g.itemLevel, icon: g.icon || null, bad: isGemBad(g, gemsToConsider) }));
        const sockets = data.SOCKETS[id];
        const emptySockets = sockets !== undefined ? Math.max(0, sockets - gems.length) : 0;

        out.push({
            slot, slotName: SLOT_NAMES[slot] || `Slot ${slot}`,
            itemId: id, itemName: item.name, icon: item.icon || null, quality: item.quality,
            itemLevel: item.itemLevel || 0, gems, emptySockets, enchant,
        });
    }
    return out;
}

/**
 * Build a per-player gear-issue report from a WCL "casts" table (whole-raid).
 * @param {object} table  WCL report/tables/casts response (has .entries)
 * @param {object} opts   { gemsToConsider, onlyGems, listPlayersWithNoIssues }
 * @returns {Array<{name, type, issues: string[]}>}
 */
function buildGearIssues(table, opts = {}) {
    const players = selectPlayers(table);

    const results = [];
    for (const p of players) {
        const issues = analyzePlayerGear(p, opts);
        if (issues.length > 0 || opts.listPlayersWithNoIssues) {
            results.push({ name: p.name, type: p.type, issues });
        }
    }
    return results;
}

module.exports = { analyzePlayerGear, buildGearIssues, buildArmory, formatIssue, isEnchantBad, getBadEnchantName, metaGemActive, SLOT_NAMES };
