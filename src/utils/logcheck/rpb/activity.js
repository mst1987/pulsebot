// RPB: how much of the raid each player actually spent doing something.
//
// The RPB does not read an "activity" number off the API — it reconstructs it:
// every tracked cast is multiplied by its base cast time, haste effects are
// subtracted (they make casts cheaper without making the player more active) and
// the gear's spell haste divides the result. That total is then set against the
// combat time of the raid.
//
// Ported from RPB.js (~L2400-2645). The sheet's own instructions note this is
// inaccurate for melee, since auto-attacks are not tracked at all.
const rpbData = require("../../../config/rpbData");
const { hasteDivisor, totalFightTime } = require("./common");

/**
 * Sum casts and cast time for one config section against a player's cast table.
 *
 * @param {Array<object>} entries   playerData.entries from report/tables/casts
 * @param {Array<object>} tracked   rpbData section (SINGLE_TARGET_CASTS[class] etc.)
 * @returns {{ totalTime:number, rows:Array }}
 */
function sumCastSection(entries, tracked) {
    const byGuid = new Map();
    for (const e of entries || []) {
        if (e && e.guid !== undefined && e.guid !== null) byGuid.set(String(e.guid), e);
    }

    let totalTime = 0;
    const rows = [];
    for (const spell of tracked) {
        let amount = 0;
        let lowerRankUsed = 0;
        let uptime = 0;
        for (const id of spell.ids) {
            const hit = byGuid.get(String(id));
            if (!hit) continue;
            amount += hit.total || 0;
            uptime += hit.uptime || 0;
            if ((spell.lowerRankIds || []).includes(String(id))) lowerRankUsed += hit.total || 0;
        }
        if (amount === 0 && uptime === 0) continue;

        const row = { label: spell.label, name: spell.name, amount };
        // "mostly lower rank used" — the sheet flags this in bold red
        if (amount > 0 && Math.round((lowerRankUsed * 100) / amount) > 50) row.mostlyLowerRank = true;
        if (spell.isUptime && amount > 0) row.uptimePercent = Math.round(uptime / amount);
        rows.push(row);

        if (spell.castTime) totalTime += amount * spell.castTime;
    }
    return { totalTime, rows };
}

/**
 * Seconds of cast time to subtract because the player was hasted, derived from
 * how often each haste effect was used.
 */
function hasteSecondsFromBuffs(castEntries, buffAuras) {
    const castByGuid = new Map();
    for (const e of castEntries || []) {
        if (e && e.guid !== undefined && e.guid !== null) castByGuid.set(String(e.guid), e);
    }
    const buffByGuid = new Map();
    for (const a of buffAuras || []) {
        if (a && a.guid !== undefined && a.guid !== null) buffByGuid.set(String(a.guid), a);
    }

    let seconds = 0;
    const used = {};
    for (const buff of rpbData.HASTE_BUFFS) {
        let uses = 0;
        for (const id of buff.ids) {
            const cast = castByGuid.get(String(id));
            if (cast && cast.total > 0) uses += cast.total;
            const aura = buffByGuid.get(String(id));
            if (aura) uses += aura.totalUses || (aura.bands || []).length || 0;
        }
        if (uses > 0) {
            used[buff.key] = uses;
            seconds += uses * buff.seconds;
        }
    }
    return { seconds, used };
}

/**
 * Per-player activity breakdown.
 *
 * Takes the already-fetched cast/buff tables so the report does not pull the same
 * table twice (the usage analyzer needs the very same casts).
 *
 * @param {object} fights
 * @param {Array<{id,name,type}>} players
 * @param {object} tables  name -> { casts, buffs } (WCL table responses)
 * @param {object} gearSpellHaste  name -> haste rating (from collectFromSummaries)
 * @returns {null | object}
 */
function analyzeActivity(fights, players, tables = {}, gearSpellHaste = {}) {
    if (!players || players.length === 0) return null;
    const raidSeconds = Math.max(1, Math.round(totalFightTime(fights) / 1000));

    const rows = [];
    for (const p of players) {
        const stTracked = rpbData.SINGLE_TARGET_CASTS[p.type] || [];
        const aoeTracked = rpbData.AOE_CASTS[p.type] || [];
        if (stTracked.length === 0 && aoeTracked.length === 0) continue;

        const tbl = tables[p.name] || {};
        const casts = tbl.casts;
        const buffs = tbl.buffs;
        if (!casts) continue;

        const entries = (casts && casts.entries) || [];
        const st = sumCastSection(entries, stTracked);
        const aoe = sumCastSection(entries, aoeTracked);
        const haste = hasteSecondsFromBuffs(entries, (buffs && buffs.auras) || []);

        const gearHaste = gearSpellHaste[p.name] || 0;
        const divisor = hasteDivisor(gearHaste);
        const combined = st.totalTime + aoe.totalTime;

        // The haste seconds are split between ST and AoE by their share of cast time.
        const stShare = combined > 0 ? st.totalTime / combined : 0;
        const aoeShare = combined > 0 ? aoe.totalTime / combined : 0;

        const totalActive = Math.round((combined - haste.seconds) / divisor);
        const stActive = Math.round(st.totalTime / divisor) - Math.round(haste.seconds * stShare);
        const aoeActive = Math.round(aoe.totalTime / divisor) - Math.round(haste.seconds * aoeShare);

        rows.push({
            name: p.name,
            type: p.type,
            gearSpellHaste: gearHaste,
            hasteSecondsSubtracted: Math.round(haste.seconds),
            hasteBuffsUsed: haste.used,
            secondsActive: Math.max(0, totalActive),
            secondsActiveST: Math.max(0, stActive),
            secondsActiveAoe: Math.max(0, aoeActive),
            relativeST: Math.max(0, Math.round((stActive / raidSeconds) * 100)),
            relativeAoe: Math.max(0, Math.round((aoeActive / raidSeconds) * 100)),
            relativeTotal: Math.max(0, Math.round((totalActive / raidSeconds) * 100)),
            singleTargetCasts: st.rows,
            aoeCasts: aoe.rows,
        });
    }

    if (rows.length === 0) return null;
    rows.sort((a, b) => b.relativeTotal - a.relativeTotal);
    return {
        raidSeconds,
        headings: {
            singleTargetCasts: rpbData.HEADINGS.singleTargetCasts,
            aoeCasts: rpbData.HEADINGS.aoeCasts,
        },
        players: rows,
    };
}

module.exports = { analyzeActivity, sumCastSection, hasteSecondsFromBuffs };
