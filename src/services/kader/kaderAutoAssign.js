// "Automatisch verteilen" of the Kaderplaner's setup view (docs/kaderplaner.md):
// a simple, deterministic heuristic that puts a roster into groups of five. Not
// an optimiser — it gives the raid lead a sensible start to drag around:
//   1. tanks one per group first, healers spread next,
//   2. classes that bring totems (shamans) spread over the groups,
//   3. melee prefer groups with a shaman or a warrior (Windzorn, Schlachtruf),
//      casters prefer groups with a healer or a shaman (Manaquelle),
//   4. inside a role the players with the best attendance are placed first.
// Pure.

const GROUP_SIZE = 5;
// The class keys whose members should be spread over the groups (they bring totems).
const SPREAD_CLASSES = ["Shaman"];

function emptyGroup() {
    return { members: [], roles: { tank: 0, healer: 0, melee: 0, ranged: 0 }, classes: {}, supportsMelee: false, supportsCaster: false };
}

function addTo(group, p) {
    group.members.push(p.userId);
    group.roles[p.role] = (group.roles[p.role] || 0) + 1;
    group.classes[p.classKey] = (group.classes[p.classKey] || 0) + 1;
    if (p.classKey === "Shaman" || p.classKey === "Warrior" || p.role === "tank") group.supportsMelee = true;
    if (p.classKey === "Shaman" || p.role === "healer") group.supportsCaster = true;
}

const byRate = (a, b) => (b.rate - a.rate) || a.userId.localeCompare(b.userId);

/**
 * @param {{userId:string, role:string, classKey:string, rate:number}[]} members
 * @param {number} groupCount
 * @returns {{groups:(string|null)[][], unassigned:string[]}}
 */
function autoAssign(members, groupCount) {
    const groups = Array.from({ length: groupCount }, emptyGroup);
    const free = (g) => GROUP_SIZE - g.members.length;
    const unassigned = [];

    // Picks the open group with the best score; the lowest index wins a tie.
    const place = (p, score) => {
        let best = -1;
        let bestScore = -Infinity;
        groups.forEach((g, i) => {
            if (free(g) <= 0) return;
            const s = score(g);
            if (s > bestScore) {
                best = i;
                bestScore = s;
            }
        });
        if (best < 0) unassigned.push(p.userId);
        else addTo(groups[best], p);
    };

    const sorted = [...members].sort(byRate);
    const ofRole = (role) => sorted.filter((p) => p.role === role);
    const isSupport = (p) => p.role === "tank" || p.role === "healer";
    const spread = sorted.filter((p) => SPREAD_CLASSES.includes(p.classKey) && !isSupport(p));

    for (const p of ofRole("tank")) place(p, (g) => free(g) * 2 - g.roles.tank * 10);
    for (const p of ofRole("healer")) place(p, (g) => free(g) * 2 - g.roles.healer * 10 - (g.classes[p.classKey] || 0) * 3);
    for (const p of spread) place(p, (g) => free(g) - (g.classes[p.classKey] || 0) * 10);

    const rest = sorted.filter((p) => !spread.includes(p) && !isSupport(p));
    for (const p of rest) {
        place(p, (g) => {
            let s = free(g);
            if (p.role === "melee" && g.supportsMelee) s += 3;
            if (p.role === "ranged" && g.supportsCaster) s += 3;
            s -= (g.classes[p.classKey] || 0) * 2;
            return s;
        });
    }

    return {
        groups: groups.map((g) => Array.from({ length: GROUP_SIZE }, (_, i) => g.members[i] || null)),
        unassigned,
    };
}

module.exports = { autoAssign, GROUP_SIZE, SPREAD_CLASSES };
