// RPB: avoidable damage taken, deaths, reflected damage and friendly fire.
//
// Ported from the RPB Apps Script. The raid-wide "top avoidable abilities" list is
// built once from a by-ability damage-taken table; each player then contributes
// their share from a per-player table.
const rpbData = require("../../../config/rpbData");
const { EXCLUDE_KALECGOS, trashFights } = require("./common");

// The RPB shows the 15 highest-damage tracked abilities.
const MAX_ABILITIES = 15;

/** WCL "options" bitmasks the RPB uses for its damage-taken queries. */
const OPTIONS_BY_ABILITY = 4098;
const OPTIONS_PER_PLAYER = 4134;

/**
 * Ability ids that are self-inflicted but should not count as reflected damage
 * (environmental effects, fall damage, boss mechanics that mirror damage).
 * Taken verbatim from the RPB's damage-reflected filter.
 */
const REFLECT_EXCLUDED_IDS = [
    "348191", "16666", "11684", "11683", "1949", "26557", "28622", "290025", "27869",
    "13241", "20476", "32221", "32220", "30486", "351761", "37852", "27213", "38281",
    "29766", "348703", "41352", "40871", "45348", "45034", "45642",
];

/** Build the "target.name=source.name AND ability.id != ..." filter for reflects. */
function reflectFilter() {
    const excludes = REFLECT_EXCLUDED_IDS.map((id) => `ability.id!='${id}'`).join(" AND ");
    return `target.name=source.name AND ${excludes} AND ${EXCLUDE_KALECGOS}`;
}

/**
 * Pick the tracked abilities that actually appear in this report, ordered by the
 * total damage they dealt to the raid.
 *
 * @param {object} byAbility  report/tables/damage-taken?by=ability response
 * @returns {Array<{name,label,ids,total,sources}>}
 */
function topAvoidableAbilities(byAbility) {
    const entries = (byAbility && byAbility.entries) || [];
    const byGuid = new Map();
    for (const e of entries) {
        if (e && e.guid !== undefined && e.guid !== null) byGuid.set(String(e.guid), e);
    }

    const found = [];
    for (const tracked of rpbData.DAMAGE_TAKEN) {
        let total = 0;
        const sources = new Set();
        let icon = "";
        let spellId = null;
        for (const id of tracked.ids) {
            const hit = byGuid.get(String(id));
            if (!hit) continue;
            total += hit.total || 0;
            // the hardest-hitting id represents the ability in the UI
            if (!icon && hit.abilityIcon) { icon = hit.abilityIcon; spellId = Number(hit.guid) || null; }
            for (const src of hit.sources || []) {
                if (!src || !src.name) continue;
                // the sheet strips "[...]" markers and the UNUSED suffix from npc names
                const clean = src.name.replace(/\[|\]/g, "").replace("UNUSED", "").trim();
                if (clean) sources.add(clean);
            }
        }
        if (total > 0) {
            found.push({
                name: tracked.name,
                label: tracked.label,
                ids: tracked.ids,
                total,
                sources: [...sources],
                icon,
                spellId,
            });
        }
    }
    found.sort((a, b) => b.total - a.total);
    return found.slice(0, MAX_ABILITIES);
}

/**
 * Full avoidable-damage / deaths / self-inflicted analysis.
 *
 * @param {WarcraftLogs} wcl
 * @param {string} reportId
 * @param {object} fights   WCL fights response
 * @param {Array<{id:number,name:string,type:string}>} players
 * @returns {Promise<null | object>}
 */
async function analyzeDamage(wcl, reportId, fights, players) {
    if (!players || players.length === 0) return null;
    const end = fights.end || 999999999999;

    const byAbility = await wcl.getDamageTaken(reportId, 0, end, {
        by: "ability",
        options: OPTIONS_BY_ABILITY,
        filter: EXCLUDE_KALECGOS,
    });
    const abilities = topAvoidableAbilities(byAbility);

    // raid-wide extra tables (one call each)
    const [reflected, hostile, deathsAll, deathsTrash] = await Promise.all([
        wcl.getDamageTaken(reportId, 0, end, { filter: reflectFilter() }).catch(() => null),
        wcl.getDamageDone(reportId, 0, end, { targetclass: "player", by: "source", filter: EXCLUDE_KALECGOS }).catch(() => null),
        wcl.getDeaths(reportId, 0, end, { filter: EXCLUDE_KALECGOS }).catch(() => null),
        trashFights(fights).length
            ? wcl.getDeaths(reportId, 0, end, { encounter: 0, filter: EXCLUDE_KALECGOS }).catch(() => null)
            : Promise.resolve(null),
    ]);

    const reflectByName = totalsByName(reflected);
    const hostileByName = totalsByName(hostile);
    const deathsByName = countDeaths(deathsAll);
    const deathsTrashByName = countDeaths(deathsTrash);

    // per-player avoidable damage: one damage-taken table per player
    const rows = [];
    for (const p of players) {
        let table = null;
        try {
            table = await wcl.getDamageTaken(reportId, 0, end, {
                sourceid: p.id,
                options: OPTIONS_PER_PLAYER,
                filter: EXCLUDE_KALECGOS,
            });
        } catch {
            // a single player failing must not sink the section
        }
        const entries = (table && table.entries) || [];
        const byGuid = new Map();
        for (const e of entries) {
            if (e && e.guid !== undefined && e.guid !== null) byGuid.set(String(e.guid), e);
        }

        const perAbility = {};
        let avoidableTotal = 0;
        abilities.forEach((ab, i) => {
            let total = 0;
            for (const id of ab.ids) {
                const hit = byGuid.get(String(id));
                if (hit) total += hit.total || 0;
            }
            perAbility[i] = total;
            avoidableTotal += total;
        });

        rows.push({
            name: p.name,
            type: p.type,
            perAbility,
            avoidableTotal,
            reflected: reflectByName[p.name] || 0,
            hostile: hostileByName[p.name] || 0,
            deaths: deathsByName[p.name] || 0,
            deathsTrash: deathsTrashByName[p.name] || 0,
        });
    }

    rows.sort((a, b) => b.avoidableTotal - a.avoidableTotal);
    return {
        heading: rpbData.HEADINGS.damageTaken,
        abilities: abilities.map((a) => ({
            label: a.label, name: a.name, sources: a.sources, total: a.total, icon: a.icon, spellId: a.spellId,
        })),
        players: rows,
    };
}

/** Sum `total` per entry name from a WCL table keyed by source/target name. */
function totalsByName(table) {
    const out = {};
    for (const e of (table && table.entries) || []) {
        if (!e || !e.name) continue;
        out[e.name] = (out[e.name] || 0) + (e.total || 0);
    }
    return out;
}

/** Count death entries per player name. */
function countDeaths(table) {
    const out = {};
    for (const e of (table && table.entries) || []) {
        if (!e || !e.name) continue;
        out[e.name] = (out[e.name] || 0) + 1;
    }
    return out;
}

module.exports = {
    analyzeDamage,
    topAvoidableAbilities,
    reflectFilter,
    REFLECT_EXCLUDED_IDS,
    MAX_ABILITIES,
};
