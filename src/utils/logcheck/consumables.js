const data = require("../../config/claData");

const FLASK = new Set(data.CONSUMABLES.flask);
const BATTLE = new Set(data.CONSUMABLES.battleElixir);
const GUARDIAN = new Set(data.CONSUMABLES.guardianElixir);
const FOOD = new Set(data.CONSUMABLES.food);

function overlapsAnyFight(bands, fights) {
    const covered = new Set();
    for (const f of fights) {
        for (const b of bands) {
            if (b.startTime <= f.end_time && b.endTime >= f.start_time) {
                covered.add(f.id);
                break;
            }
        }
    }
    return covered;
}

/**
 * Per-player consumable coverage across the raid's boss fights.
 * Coverage = (# boss fights the buff was active on) / (# boss fights) in percent.
 * A flask counts as covering both battle and guardian elixir slots.
 *
 * Makes one buffs API call per player (sourceid filter).
 *
 * @param {WarcraftLogs} wcl
 * @param {string} reportId
 * @param {object} fights   WCL fights response
 * @param {Array}  players  selected player entries (need .id, .name, .type)
 * @returns {Promise<Array<{name,type,flask,battle,guardian,food}>>}
 */
async function analyzeConsumables(wcl, reportId, fights, players) {
    const bossFights = (fights.fights || []).filter((f) => f.boss && f.boss > 0);
    const start = 0;
    const end = fights.end || 999999999999;

    const results = [];
    const icons = {};
    for (const p of players) {
        let buffs;
        try {
            buffs = await wcl.getBuffs(reportId, start, end, { sourceid: p.id });
        } catch {
            buffs = null;
        }
        const cov = { flask: new Set(), battle: new Set(), guardian: new Set(), food: new Set() };
        const present = new Set();
        for (const aura of (buffs && buffs.auras) || []) {
            if (!aura.bands) continue;
            // any tracked aura marks the fights the player actually participated in
            for (const id of overlapsAnyFight(aura.bands, bossFights)) present.add(id);
            const g = String(aura.guid);
            let target = null;
            if (FLASK.has(g)) target = "flask";
            else if (BATTLE.has(g)) target = "battle";
            else if (GUARDIAN.has(g)) target = "guardian";
            else if (FOOD.has(g)) target = "food";
            if (!target) continue;
            if (aura.abilityIcon && !icons[target]) icons[target] = aura.abilityIcon;
            for (const id of overlapsAnyFight(aura.bands, bossFights)) cov[target].add(id);
        }
        // a flask replaces both elixirs
        for (const id of cov.flask) { cov.battle.add(id); cov.guardian.add(id); }

        const denom = present.size || bossFights.length;
        const pct = (set) => (denom ? Math.round((set.size * 100) / denom) : 0);

        // weapon enhancement (oil/sharpening stone): main-hand has a temporary enchant
        const weapon = (p.gear || []).find((g) => g && Number(g.slot) === 15);
        const weaponOiled = !!(weapon && weapon.temporaryEnchant && String(weapon.temporaryEnchant) !== "0");

        results.push({
            name: p.name, type: p.type,
            flask: pct(cov.flask), battle: pct(cov.battle), guardian: pct(cov.guardian), food: pct(cov.food),
            weaponOiled,
        });
    }
    return { players: results, icons };
}

module.exports = { analyzeConsumables };
