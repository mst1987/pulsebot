// Who stood in which boss kill (#990), read from the report/fights payload the
// evaluation already loads — no extra Warcraft-Logs request.
//
// WCL v1 lists every friendly unit with the fights it took part in
// (`friendlies[].fights: [{ id }]`). Kept on the report as `kills`, so the
// attendance can later tell who was still there for the last bosses of the
// night without asking WCL again. Wipes and trash are left out on purpose: only
// a kill marks the raid as still going.

const { classOf } = require("./wclRoster");

/**
 * @param {object} fights  WCL v1 report/fights payload
 * @returns {Array<{ id: number, encounterId: number, boss: string, at: number, players: string[] }>}
 *   one entry per boss kill in log order; `at` is the absolute start time (ms)
 *   so kills from several logs of one evening can be put in order.
 */
function buildKillRoster(fights) {
    const list = (fights && Array.isArray(fights.fights)) ? fights.fights : [];
    const start = Number(fights && fights.start) || 0;
    const kills = list.filter((f) => f && f.kill && Number(f.boss) > 0);
    if (!kills.length) return [];

    // fight id -> names of the players (classed units only: no pets, no NPCs)
    const byFight = new Map(kills.map((f) => [f.id, new Set()]));
    for (const unit of (fights.friendlies || [])) {
        const name = String((unit && unit.name) || "").trim();
        if (!name || !classOf(unit)) continue;
        for (const f of (unit.fights || [])) {
            const set = byFight.get(f && f.id);
            if (set) set.add(name);
        }
    }

    return kills
        .map((f) => ({
            id: f.id,
            // Raw WCL encounter id, Anniversary offset included (docs/logcheck.md); kept for reference only -
            // the "left early" suggestion (#990) matches kills by boss name, never by this id.
            encounterId: Number(f.boss),
            boss: String(f.name || ""),
            at: start + (Number(f.start_time) || 0),
            players: [...byFight.get(f.id)].sort((a, b) => a.localeCompare(b)),
        }))
        .sort((a, b) => a.at - b.at);
}

module.exports = { buildKillRoster };
