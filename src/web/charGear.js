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
const { gearProfile, fitsRole } = require("./gearProfile");

const ICON_BASE = "https://wow.zamimg.com/images/wow/icons/large";

// The order a character sheet shows the slots in — head down the left side,
// then the right, then the weapons. Same list as gearIssues.js's ARMORY_SLOTS;
// kept here too because this module hands out gear for display, and "in the
// order the game shows it" is part of that.
const DISPLAY_ORDER = [0, 1, 2, 14, 4, 8, 9, 5, 6, 7, 10, 11, 12, 13, 15, 16, 17];

/**
 * WCL ships a bare asset name ("inv_helmet_21.jpg"), the CDN wants it
 * lowercased without the extension. Same mapping as charGearIssues.js and
 * render.js — three copies exist because each formats a different payload, and
 * none of them is worth a module of its own.
 */
function itemIconUrl(icon) {
    if (!icon) return "";
    return `${ICON_BASE}/${String(icon).replace(/\.(jpg|jpeg|png|gif)$/i, "").toLowerCase()}.jpg`;
}

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
        iconUrl: itemIconUrl(entry.icon),
        quality: typeof entry.quality === "number" ? entry.quality : null,
        itemLevel: Number(entry.itemLevel) || 0,
        gems: (entry.gems || []).map((g) => Number(g.id) || 0),
        emptySockets: Number(entry.emptySockets) || 0,
        enchantId,
        enchantStatus: (entry.enchant && entry.enchant.status) || "na",
    };
}

/**
 * The newest *usable* gear snapshot per character across the recent reports.
 *
 * Walks the reports newest first and keeps the first hit per character, so a
 * raider who has not logged in weeks keeps their last known set rather than
 * dropping out — the entry says when it was seen, and the caller decides
 * whether that is still worth something.
 *
 * ⚠️ "Usable" is what `roleFor` is for. Shamans, druids and priests routinely
 * heal a night, and their newest log then shows a healing set. Judging a DPS
 * caster by it ruins three things at once: the simulated DPS (healing gear does
 * not do damage), the upgrade comparison (the drop "replaces" a healing piece it
 * has nothing to do with) and the BiS count. With `roleFor` the walk keeps going
 * to the newest raid where they actually played that role, and the snapshot
 * records how many newer raids were passed over (`skippedReports`) so the page
 * can say the gear is older than the last raid, and why.
 *
 * @param {object} [opts]
 * @param {(key: string) => string} [opts.roleFor] the role a character is judged
 *        as ("caster" | "healer"), by character key. Omit to take any set.
 * @returns {Map<string, {key, character, className, seenAt, reportId, reportTitle,
 *          items, profile, skippedReports, roleMismatch}>}
 */
function gearByCharacter({ roleFor } = {}) {
    const out = new Map();
    // Sets rejected for the wrong role, kept as a fallback: a raider who has
    // *only* ever been logged healing must still get gear, or the page would
    // show "kein Gear" for somebody it plainly knows something about.
    const rejected = new Map();
    const reports = listReports().slice(0, MAX_REPORTS);
    for (const meta of reports) {
        const report = getReport(meta.id);
        if (!report || !Array.isArray(report.roster)) continue;
        for (const entry of report.roster) {
            const key = charKey(entry.name);
            if (!key || out.has(key)) continue;
            // Kept in character-sheet order rather than the order the report
            // happened to list them: this is what the page draws as a row of
            // icons, and "head, neck, shoulders, …" is the order a raider reads
            // their own gear in.
            const items = (entry.armory || [])
                .filter((it) => it && Number(it.itemId) > 0)
                .map(trimItem)
                .sort((a, b) => DISPLAY_ORDER.indexOf(a.slot) - DISPLAY_ORDER.indexOf(b.slot));
            // A roster row without a single item is a player the log saw but
            // whose gear it could not read — keeping it would look like a raider
            // in no gear at all.
            if (!items.length) continue;

            const snapshot = {
                key,
                character: entry.name,
                className: entry.type || "",
                seenAt: Number(report.generatedAt) || 0,
                reportId: report.id || meta.id,
                reportTitle: report.title || "",
                items,
                profile: gearProfile({ items }),
                skippedReports: 0,
                roleMismatch: false,
            };

            const wanted = roleFor ? roleFor(key) : "";
            if (wanted && !fitsRole(snapshot.profile, wanted)) {
                // Wrong role for this raider — remember the newest such set as a
                // fallback, count it, and keep looking for one that fits.
                if (!rejected.has(key)) rejected.set(key, snapshot);
                rejected.get(key).skippedReports += 1;
                continue;
            }
            snapshot.skippedReports = rejected.has(key) ? rejected.get(key).skippedReports : 0;
            out.set(key, snapshot);
        }
    }
    // Nothing fitting anywhere: fall back to the newest set, marked, so the page
    // can say "das ist Heilgear" instead of showing nothing at all.
    for (const [key, snapshot] of rejected) {
        if (!out.has(key)) out.set(key, { ...snapshot, roleMismatch: true, skippedReports: 0 });
    }
    return out;
}

/** The gear snapshot for one character, or null when no report shows them. */
function gearFor(character, opts) {
    return gearByCharacter(opts).get(charKey(character)) || null;
}

/** The item a character has in one equip slot, or null. */
function itemInSlot(gear, slot) {
    if (!gear) return null;
    return gear.items.find((it) => it.slot === Number(slot)) || null;
}

module.exports = { gearByCharacter, gearFor, itemInSlot, charKey, itemIconUrl, DISPLAY_ORDER, MAX_REPORTS };
