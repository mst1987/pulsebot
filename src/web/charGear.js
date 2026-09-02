// The gear a character was last seen wearing, read out of the CLA evaluations
// that already exist (data/reports/*.json — see reportStore.js).
//
// Every stored report carries its whole roster with the armory that
// utils/logcheck/gearIssues.js built from the Warcraft-Logs casts table: item
// id, item level, gems and the permanent-enchant id per equip slot. That is
// exactly the shape a WoWSims loadout needs, so the loot council can compare
// and simulate gear without a single extra API call — and without asking anyone
// to maintain a gear list by hand.
//
// Its limits, which the callers have to respect:
//   - it is *last seen*, not *current*: someone who has not raided since the
//     newest reports simply has no entry (`null`), and one who raided last week
//     is judged on last week's gear. Every payload carries `seenAt`, so the page
//     can say how old the picture is.
//   - it is per character, keyed like lootStore/characterStore (lowercased, no
//     realm suffix), so "Devihra-Thunderstrike" and "devihra" are one raider.
//   - a report only knows what the log recorded: an unequipped slot is missing
//     rather than empty, and enchants/gems are ids, never names.

const { listReports, getReport } = require("./reportStore");
const { characterKey, splitPlayer } = require("../utils/lootImport");
const { SLOT_NAMES } = require("../utils/logcheck/gearIssues");

// How many of the newest evaluations are walked. Same bound and same reason as
// charGearIssues.js's MAX_REPORTS: far enough back to cover everyone who raided
// recently, without reading years of files on every page view.
const MAX_REPORTS = 40;

function charKey(character) {
    return characterKey(splitPlayer(character).character);
}

/**
 * One armory entry, trimmed to what the council needs. Slots are WCL's numbers
 * (see SLOT_NAMES); `gems` keeps the socket order, because a gem list is
 * positional in a WoWSims loadout.
 */
function trimItem(entry) {
    const slot = Number(entry.slot);
    const enchantId = Number((entry.enchant && entry.enchant.enchantId) || 0) || 0;
    return {
        slot,
        slotName: SLOT_NAMES[slot] || `Slot ${slot}`,
        itemId: Number(entry.itemId) || 0,
        itemName: String(entry.itemName || ""),
        icon: entry.icon || null,
        itemLevel: Number(entry.itemLevel) || 0,
        gems: (entry.gems || []).map((g) => Number(g.id) || 0),
        emptySockets: Number(entry.emptySockets) || 0,
        enchantId,
        enchantStatus: (entry.enchant && entry.enchant.status) || "na",
    };
}

/**
 * The newest gear snapshot per character across the recent reports.
 *
 * Walks the reports newest first and keeps the first hit per character, so a
 * raider who has not logged in weeks keeps their last known set rather than
 * dropping out — the entry says when it was seen, and the caller decides
 * whether that is still worth something.
 *
 * @returns {Map<string, {key, character, className, seenAt, reportId, reportTitle, items}>}
 */
function gearByCharacter() {
    const out = new Map();
    const reports = listReports().slice(0, MAX_REPORTS);
    for (const meta of reports) {
        const report = getReport(meta.id);
        if (!report || !Array.isArray(report.roster)) continue;
        for (const entry of report.roster) {
            const key = charKey(entry.name);
            if (!key || out.has(key)) continue;
            const items = (entry.armory || []).filter((it) => it && Number(it.itemId) > 0).map(trimItem);
            // A roster row without a single item is a player the log saw but
            // whose gear it could not read — keeping it would look like a raider
            // in no gear at all.
            if (!items.length) continue;
            out.set(key, {
                key,
                character: entry.name,
                className: entry.type || "",
                seenAt: Number(report.generatedAt) || 0,
                reportId: report.id || meta.id,
                reportTitle: report.title || "",
                items,
            });
        }
    }
    return out;
}

/** The gear snapshot for one character, or null when no report shows them. */
function gearFor(character) {
    return gearByCharacter().get(charKey(character)) || null;
}

/** The item a character has in one equip slot, or null. */
function itemInSlot(gear, slot) {
    if (!gear) return null;
    return gear.items.find((it) => it.slot === Number(slot)) || null;
}

module.exports = { gearByCharacter, gearFor, itemInSlot, charKey, MAX_REPORTS };
