const data = require("../../config/claData");
const { selectPlayers } = require("./common");

// Shadow resistance granted by enchants / gems (TBC data, config/logcheckTables.js)
const { SR_ENCHANT, SR_GEM } = require("../../config/logcheckTables");

/**
 * Shadow resistance from gear (base + enchant + gem) for the Mother Shahraz fight.
 * Buff-based SR (priest shadow protection etc.) is not included.
 *
 * @param {object} table  WCL casts table (entries carry per-player gear)
 * @param {object} fights WCL fights response
 * @param {object} [rules] the report's rule set (which classes are raiders); TBC without one
 * @returns {null | { boss, note, players: [{name,type,sr,items}] }}
 */
function analyzeShadowResi(table, fights, rules) {
    // Mother Shahraz's boss guid ends with "607" (same marker CLA uses)
    const mother = ((fights && fights.fights) || []).find(
        (f) => f.boss && String(f.boss).endsWith("607")
    );
    if (!mother) return null;

    const players = selectPlayers(table, rules).map((p) => {
        let sr = 0;
        const items = [];
        for (const item of p.gear || []) {
            if (!item || item.id === undefined || item.id === null) continue;
            const id = String(item.id);
            if (id === "0" || Number(item.slot) === 3 || Number(item.slot) === 18) continue;
            const baseSr = data.SHADOW_RESISTANCE[id] || 0;
            const encSr = SR_ENCHANT[String(item.permanentEnchant)] || 0;
            let gemSr = 0;
            for (const g of item.gems || []) gemSr += SR_GEM[String(g.id)] || 0;
            const total = baseSr + encSr + gemSr;
            if (total > 0) {
                sr += total;
                items.push({ itemId: id, itemName: item.name, icon: item.icon || null, sr: total });
            }
        }
        return { name: p.name, type: p.type, sr, items };
    });

    players.sort((a, b) => a.sr - b.sr); // lowest (most at risk) first
    return {
        boss: mother.name,
        note: "Nur Gear-SR (Verzauberungen + Edelsteine + Items) — Buffs nicht eingerechnet.",
        players,
    };
}

module.exports = { analyzeShadowResi, SR_ENCHANT, SR_GEM };
