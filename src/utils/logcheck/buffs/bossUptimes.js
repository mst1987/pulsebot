// Per-boss debuff uptimes for key raid debuffs (one debuffs call per boss fight).
// Matched by ability name so it works across ranks/variants.
const METRICS = [
    { key: "faerie", label: "Faerie Fire", match: (n) => n.includes("Faerie Fire") },
    { key: "expose", label: "Expose Armor", match: (n) => n.includes("Expose Armor") },
    { key: "jWisdom", label: "Judgement of Wisdom", match: (n) => n.includes("Judgement of Wisdom") },
    { key: "jLight", label: "Judgement of Light", match: (n) => n.includes("Judgement of Light") },
];

/**
 * @returns {Promise<null | { metrics: [{key,label}], rows: [{boss, kill, ...uptimes}] }>}
 */
async function analyzeBossUptimes(wcl, reportId, fights) {
    const bossFights = (fights.fights || []).filter((f) => f.boss && f.boss > 0);
    if (bossFights.length === 0) return null;

    const rows = [];
    for (const f of bossFights) {
        const duration = f.end_time - f.start_time;
        if (duration <= 0) continue;
        let table;
        try {
            table = await wcl.getDebuffs(reportId, f.start_time, f.end_time, { hostility: 1 });
        } catch {
            continue;
        }
        const auras = (table && table.auras) || [];
        const row = { boss: f.name, kill: !!f.kill };
        for (const m of METRICS) {
            let uptime = 0;
            for (const a of auras) {
                if (a.name && m.match(a.name)) uptime += a.totalUptime || 0;
            }
            row[m.key] = Math.min(100, Math.round((uptime / duration) * 100));
        }
        rows.push(row);
    }
    if (rows.length === 0) return null;
    return { metrics: METRICS.map((m) => ({ key: m.key, label: m.label })), rows };
}

module.exports = { analyzeBossUptimes };
