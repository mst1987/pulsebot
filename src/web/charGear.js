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
//   - it is what they wore *that night*, which is not always what they wear
//     generally: a boss-specific piece (see config/situationalItems.js) is
//     substituted from an older raid rather than compared against.

const { listReports, getReport } = require("./reportStore");
const { characterKey, splitPlayer } = require("../utils/lootImport");
const { SLOT_NAMES } = require("../utils/logcheck/gearIssues");
const { gearProfile, fitsRole } = require("./gearProfile");
const { situationalItem } = require("../config/situationalItems");
const { armoryItemInSlot } = require("./armoryGear");

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
    const situational = situationalItem(entry.itemId);
    return {
        slot,
        // Set when this piece only pays off against certain bosses, so nothing
        // downstream compares against it without saying so. Filled in by
        // fillSituational() when an older raid shows what they wear otherwise.
        situational: situational ? { note: situational.note } : null,
        replacedSituational: null,
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
 * One roster row's armory, trimmed and in character-sheet order rather than the
 * order the report happened to list it: this is what the page draws as a row of
 * icons, and "head, neck, shoulders, …" is the order a raider reads their own
 * gear in.
 */
function armoryItems(entry, character = "") {
    const items = (entry.armory || [])
        .filter((it) => it && Number(it.itemId) > 0)
        .map((it) => ({ ...trimItem(it), alternate: it.alternate || null }))
        .sort((a, b) => DISPLAY_ORDER.indexOf(a.slot) - DISPLAY_ORDER.indexOf(b.slot));
    return replaceSituational(items, character || entry.name || "");
}

/**
 * Get a boss-specific piece out of the set, using the best source that answers.
 *
 * In order:
 *   1. the armory — what is on the character *now*, which is the only source
 *      that knows what they wear when nobody is logging,
 *   2. the same raid night, one boss over, where the evaluation recorded it
 *      (utils/logcheck/gearVariants.js).
 *
 * An older evaluation is tried after this, back in gearByCharacter, because
 * that one needs the whole walk. And if none of the three answers, the piece is
 * dropped rather than shown — see dropSituational().
 */
function replaceSituational(items, character) {
    if (!items.some((it) => it.situational)) return items;
    const equipped = new Set(items.map((it) => it.itemId));
    return items.map((it) => {
        if (!it.situational) return it;
        const source = armoryItemInSlot(character, it.slot)
            ? { row: armoryItemInSlot(character, it.slot), from: "armory" }
            : (it.alternate ? { row: it.alternate, from: "sameRaid" } : null);
        if (!source) return it;
        const alt = trimItem(source.row);
        // Same guard as everywhere else: never put on a piece the raider is
        // already wearing in another slot.
        if (!alt.itemId || alt.situational || equipped.has(alt.itemId)) return it;
        equipped.delete(it.itemId);
        equipped.add(alt.itemId);
        if (source.from === "armory") {
            return {
                ...alt,
                alternate: null,
                replacedSituational: {
                    itemId: it.itemId,
                    itemName: it.itemName,
                    iconUrl: it.iconUrl,
                    note: (it.situational || {}).note || "",
                    seenAt: 0,
                    reportTitle: "",
                    fight: "",
                    sameRaid: false,
                    // The strongest answer there is: not what they wore, what
                    // they wear.
                    armory: true,
                },
            };
        }
        return {
            ...alt,
            alternate: null,
            replacedSituational: {
                itemId: it.itemId,
                itemName: it.itemName,
                iconUrl: it.iconUrl,
                note: (it.situational || {}).note || "",
                seenAt: 0,
                reportTitle: "",
                // The one case where the substitute is not older than the rest
                // of the set: it is from the same raid, one boss away.
                fight: String(it.alternate.fight || ""),
                sameRaid: true,
                armory: false,
            },
        };
    });
}

/**
 * Take every boss-specific piece nothing could answer out of the set.
 *
 * The last word, and the simplest one. Such a piece is worth exactly nothing in
 * every comparison this app makes — WoWSims sims it as an empty slot, the stat
 * weights score it at zero — so leaving it in the set only ever misleads the
 * reader: the council sees a trinket where, for the boss they are planning for,
 * there is none. An empty slot with the reason on it is the truth.
 *
 * What was taken out stays on the snapshot (`dropped`) so the page can say
 * which slot is empty and why, instead of silently showing a hole.
 */
function dropSituational(snapshot) {
    const dropped = snapshot.items.filter((it) => it.situational);
    if (!dropped.length) return snapshot;
    snapshot.items = snapshot.items.filter((it) => !it.situational);
    snapshot.dropped = dropped.map((it) => ({
        slot: it.slot,
        slotName: it.slotName,
        itemId: it.itemId,
        itemName: it.itemName,
        iconUrl: it.iconUrl,
        note: (it.situational || {}).note || "",
    }));
    return snapshot;
}

/**
 * Fill the slots of a raider's set that are held by a boss-specific piece with
 * what they wear there the rest of the time.
 *
 * Somebody who put Mark of the Champion on for Illidan has, as far as every
 * comparison is concerned, an empty trinket slot — WoWSims values it at exactly
 * zero (see config/situationalItems.js). Left standing, that raider is credited
 * the *full* value of any trinket that drops while everyone in proper gear only
 * gets the difference, which turns a deliberate boss swap into a claim.
 *
 * The substitute has to earn its place: it comes from a set that fits the
 * raider's role, sits in the same slot, is not itself situational, and — the
 * one that bit — is not already on the raider somewhere else. A trinket they
 * still wear in the other slot would otherwise be duplicated into both, which
 * is not gear anybody can equip and quietly doubles that item's stats in every
 * comparison built on the set. It is recorded on the item
 * (`replacedSituational`) rather than swapped in quietly — showing gear a
 * raider was not wearing without saying so would be its own kind of wrong.
 *
 * @param {object} snapshot the accepted set, modified in place
 * @param {Map<number, object>} want slots still open, emptied as they are filled
 * @param {object} entry the older report's roster row for this raider
 * @param {object} report the older report
 * @param {string} wanted the role the raider is judged as, "" for any
 */
function fillSituational(snapshot, want, entry, report, wanted) {
    const items = armoryItems(entry);
    if (!items.length) return;
    if (wanted && !fitsRole(gearProfile({ items }), wanted)) return;
    // Everything the raider is already wearing, kept in step with the swaps
    // below so two open slots cannot be handed the same piece either.
    const equipped = new Set(snapshot.items.map((it) => it.itemId));
    for (const [slot, worn] of [...want]) {
        const older = items.find((it) => it.slot === slot);
        if (!older || older.itemId === worn.itemId || older.situational) continue;
        // The trinket they still wear in the other slot is not a substitute for
        // this one — it is the same item, and nobody can equip it twice.
        if (equipped.has(older.itemId)) continue;
        const idx = snapshot.items.findIndex((it) => it.slot === slot);
        if (idx < 0) continue;
        equipped.delete(worn.itemId);
        equipped.add(older.itemId);
        snapshot.items[idx] = {
            ...older,
            replacedSituational: {
                itemId: worn.itemId,
                itemName: worn.itemName,
                iconUrl: worn.iconUrl,
                note: (worn.situational || {}).note || "",
                // Where the substitute comes from — it is older than the rest of
                // the set, and the page says so.
                seenAt: Number(report.generatedAt) || 0,
                reportTitle: report.title || "",
                fight: "",
                sameRaid: false,
            },
        };
        want.delete(slot);
    }
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
    // Slots of an accepted set that are held by a boss-specific piece, waiting
    // to be filled from an older raid (see fillSituational).
    const pending = new Map();
    const reports = listReports().slice(0, MAX_REPORTS);
    for (const meta of reports) {
        const report = getReport(meta.id);
        if (!report || !Array.isArray(report.roster)) continue;
        for (const entry of report.roster) {
            const key = charKey(entry.name);
            if (!key) continue;
            if (out.has(key)) {
                // This raider's set is settled — the only reason to look at an
                // older raid of theirs is a slot still held by a situational
                // piece.
                const want = pending.get(key);
                if (want && want.size) fillSituational(out.get(key), want, entry, report, roleFor ? roleFor(key) : "");
                continue;
            }
            const items = armoryItems(entry);
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
                // Boss-specific pieces nothing could answer, taken out of the
                // set at the end of the walk (dropSituational).
                dropped: [],
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
            const situational = snapshot.items.filter((it) => it.situational);
            if (situational.length) pending.set(key, new Map(situational.map((it) => [it.slot, it])));
        }
    }
    // Nothing fitting anywhere: fall back to the newest set, marked, so the page
    // can say "das ist Heilgear" instead of showing nothing at all.
    for (const [key, snapshot] of rejected) {
        if (!out.has(key)) out.set(key, { ...snapshot, roleMismatch: true, skippedReports: 0 });
    }
    // Last: whatever no source could answer leaves the set. A piece worth zero
    // in every comparison must not sit in a raider's gear pretending otherwise.
    for (const snapshot of out.values()) dropSituational(snapshot);
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
