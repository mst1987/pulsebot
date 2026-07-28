// RPB: what the raid actually used — class cooldowns, trinkets/racials,
// consumables, engineering gadgets, absorbs and interrupts.
//
// All of these are counted off the per-player cast table that the activity
// analyzer already fetches, so this module takes the tables as input instead of
// hitting the API again. Only interrupts need their own (single, raid-wide) call.
//
// Ported from RPB.js (~L2648-3400).
const rpbData = require("../../../config/rpbData");
const { EXCLUDE_KALECGOS, bossFights } = require("./common");

/**
 * Count uses of each tracked entry, split into trash and boss usage.
 *
 * @param {Array<object>} allEntries    casts over the whole report
 * @param {Array<object>} trashEntries  casts restricted to trash (encounter=0)
 * @param {Array<object>} tracked       an rpbData section
 * @returns {Array<{label,name,trash,bosses,total,spellId?,icon?,cooldown?,possibleUses?}>}
 */
function countUsage(allEntries, trashEntries, tracked) {
    const total = new Map();
    for (const e of allEntries || []) {
        if (e && e.guid !== undefined && e.guid !== null) total.set(String(e.guid), e);
    }
    const trash = new Map();
    for (const e of trashEntries || []) {
        if (e && e.guid !== undefined && e.guid !== null) trash.set(String(e.guid), e);
    }

    const rows = [];
    for (const entry of tracked) {
        let all = 0;
        let onTrash = 0;
        let hit = null;
        for (const id of entry.ids) {
            const t = total.get(String(id));
            if (t) {
                all += t.total || 0;
                // remember the most-used rank: its icon + id represent the row in the UI
                if (!hit || (t.total || 0) > (hit.total || 0)) hit = t;
            }
            const tr = trash.get(String(id));
            if (tr) onTrash += tr.total || 0;
        }
        if (all === 0) continue;
        const row = {
            label: entry.label,
            name: entry.name,
            trash: onTrash,
            bosses: Math.max(0, all - onTrash),
            total: all,
        };
        if (hit) {
            if (Number(hit.guid)) row.spellId = Number(hit.guid);
            if (hit.abilityIcon) row.icon = hit.abilityIcon;
        }
        if (entry.cooldown) row.cooldown = entry.cooldown;
        rows.push(row);
    }
    return rows;
}

/**
 * Class cooldowns per player, including how many uses would have been possible
 * given the fight time and the cooldown length.
 */
function classCooldownsFor(playerClass, allEntries, trashEntries, bossSeconds) {
    const tracked = rpbData.CLASS_COOLDOWNS[playerClass] || [];
    const rows = countUsage(allEntries, trashEntries, tracked);
    for (const row of rows) {
        if (row.cooldown && bossSeconds > 0) {
            row.possibleUses = Math.floor(bossSeconds / row.cooldown);
        }
    }
    return rows;
}

/**
 * Flatten the interrupts table into the list of interrupted spells.
 *
 * The v1 interrupts endpoint nests one level deeper than the other tables:
 *   { entries: [ { entries: [ { name, guid, details: [ {name: player, ...} ] } ] } ] }
 * so the outer wrapper has to be unwrapped before the spells are reachable.
 */
function interruptedSpellsOf(table) {
    const outer = (table && table.entries) || [];
    const spells = [];
    for (const group of outer) {
        // tolerate both the nested shape and a flat one
        if (group && Array.isArray(group.entries)) spells.push(...group.entries);
        else if (group && group.name) spells.push(group);
    }
    return spells;
}

/**
 * Interrupts across the raid: how many spells each player interrupted, and which.
 *
 * The API reports this the other way round (per interrupted spell, with the
 * interrupting players nested underneath), so it is re-keyed by player here.
 *
 * @returns {Promise<null | { heading, players: Array<{name,type,count,spells}> }>}
 */
async function analyzeInterrupts(wcl, reportId, fights) {
    const end = fights.end || 999999999999;
    let table = null;
    try {
        table = await wcl.getInterrupts(reportId, 0, end, { filter: EXCLUDE_KALECGOS });
    } catch {
        return null;
    }

    const byPlayer = new Map();
    for (const spell of interruptedSpellsOf(table)) {
        const spellName = spell.name || `Spell ${spell.guid}`;
        for (const detail of spell.details || []) {
            if (!detail || !detail.name) continue;
            const rec = byPlayer.get(detail.name)
                || { name: detail.name, type: detail.type, count: 0, spells: new Map(), kicks: new Map() };
            const n = detail.total || 1;
            rec.count += n;
            const prev = rec.spells.get(spellName)
                || { name: spellName, count: 0, spellId: Number(spell.guid) || null, icon: spell.abilityIcon || "" };
            prev.count += n;
            rec.spells.set(spellName, prev);
            // the abilities the player interrupted *with* (Counterspell, Kick, ...)
            for (const ab of detail.abilities || []) {
                if (!ab || !ab.name) continue;
                rec.kicks.set(ab.name, (rec.kicks.get(ab.name) || 0) + (ab.total || 0));
            }
            byPlayer.set(detail.name, rec);
        }
    }

    const players = [...byPlayer.values()]
        .filter((p) => p.count > 0)
        .map((p) => ({
            name: p.name,
            type: p.type,
            count: p.count,
            spells: [...p.spells.values()].sort((a, b) => b.count - a.count),
            kicks: [...p.kicks.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([name, count]) => ({ name, count })),
        }));

    if (players.length === 0) return null;
    players.sort((a, b) => b.count - a.count);
    return { heading: rpbData.HEADINGS.interrupts, players };
}

/**
 * Everything countable off one player's cast table.
 *
 * @param {{name,type}} player
 * @param {Array<object>} allEntries
 * @param {Array<object>} trashEntries
 * @param {number} bossSeconds
 */
function usageForPlayer(player, allEntries, trashEntries, bossSeconds) {
    return {
        name: player.name,
        type: player.type,
        classCooldowns: classCooldownsFor(player.type, allEntries, trashEntries, bossSeconds),
        trinketsAndRacials: countUsage(allEntries, trashEntries, rpbData.TRINKETS_AND_RACIALS),
        consumables: countUsage(allEntries, trashEntries, rpbData.OTHER_CASTS),
        engineering: countUsage(allEntries, trashEntries, rpbData.ENGINEERING),
        absorbs: countUsage(allEntries, trashEntries, rpbData.ABSORBS),
    };
}

/** Total boss combat time in seconds (used for the "possible uses" of a cooldown). */
function bossSecondsOf(fights) {
    return Math.round(
        bossFights(fights).reduce((s, f) => s + Math.max(0, f.end_time - f.start_time), 0) / 1000,
    );
}

module.exports = {
    countUsage,
    classCooldownsFor,
    analyzeInterrupts,
    interruptedSpellsOf,
    usageForPlayer,
    bossSecondsOf,
};
