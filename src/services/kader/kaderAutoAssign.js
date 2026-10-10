// "Automatisch verteilen" of the Kaderplaner's setup view (docs/kaderplaner.md):
// a simple, deterministic heuristic that puts a roster into groups of five. Not
// an optimiser — it gives the raid lead a sensible start to drag around:
//   1. tanks one per group first, healers spread next,
//   2. classes that bring totems (shamans) spread over the groups,
//   3. melee prefer groups with a shaman or a warrior (Windzorn, Schlachtruf),
//      casters prefer groups with a healer or a shaman (Manaquelle),
//   4. inside a role the players with the best attendance are placed first.
// The classes that spread, give melee and give casters a bonus are read from the rule set's party buffs
// (supportOf, #751); without them the Classic/TBC answer below applies.
// Pure.

const GROUP_SIZE = 5;
// The class keys whose members should be spread over the groups (they bring totems).
const SPREAD_CLASSES = ["Shaman"];
const DEFAULT_SUPPORT = { spread: SPREAD_CLASSES, melee: ["Shaman", "Warrior"], caster: ["Shaman"] };

/**
 * Which classes the heuristic treats as group support, from the rule set's party buffs
 * (`source.buffs.party`: providers and beneficiaries by spec key, `slot`, `important`):
 *   spread  classes with a slotted buff other than a shout (totems: only one per element
 *           and group counts, so the shamans go to different groups),
 *   melee   classes providing an important buff that melee specs want (Windfury, Battle Shout),
 *   caster  classes providing an important buff that ranged specs want (Mana Spring).
 * @param {object[]} partyBuffs
 * @param {Map<string, { key: string, specs: object[] }>|Iterable} classes  ctx.classes (class key -> { specs })
 */
function supportOf(partyBuffs, classes) {
    if (!Array.isArray(partyBuffs) || !partyBuffs.length || !classes) return DEFAULT_SUPPORT;
    const specs = new Map();
    for (const c of classes.values ? classes.values() : classes) for (const s of c.specs) specs.set(s.key, { classKey: c.key, role: s.role });
    const out = { spread: new Set(), melee: new Set(), caster: new Set() };
    for (const b of partyBuffs) {
        const classesOf = new Set((b.providers || []).map((k) => (specs.get(k) || {}).classKey).filter(Boolean));
        if (b.slot && b.slot !== "shout") classesOf.forEach((c) => out.spread.add(c));
        if (!b.important) continue;
        const wants = new Set((b.beneficiaries || []).map((k) => (specs.get(k) || {}).role));
        if (wants.has("melee")) classesOf.forEach((c) => out.melee.add(c));
        if (wants.has("ranged")) classesOf.forEach((c) => out.caster.add(c));
    }
    return { spread: [...out.spread], melee: [...out.melee], caster: [...out.caster] };
}

function emptyGroup() {
    return { members: [], roles: { tank: 0, healer: 0, melee: 0, ranged: 0 }, classes: {}, supportsMelee: false, supportsCaster: false };
}

function addTo(group, p, support) {
    group.members.push(p.userId);
    group.roles[p.role] = (group.roles[p.role] || 0) + 1;
    group.classes[p.classKey] = (group.classes[p.classKey] || 0) + 1;
    if (support.melee.includes(p.classKey) || p.role === "tank") group.supportsMelee = true;
    if (support.caster.includes(p.classKey) || p.role === "healer") group.supportsCaster = true;
}

const byRate = (a, b) => (b.rate - a.rate) || a.userId.localeCompare(b.userId);

/**
 * @param {{userId:string, role:string, classKey:string, rate:number}[]} members
 * @param {number} groupCount
 * @param {{ spread: string[], melee: string[], caster: string[] }} [support]  supportOf() of the rule set
 * @returns {{groups:(string|null)[][], unassigned:string[]}}
 */
function autoAssign(members, groupCount, support = DEFAULT_SUPPORT) {
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
        else addTo(groups[best], p, support);
    };

    const sorted = [...members].sort(byRate);
    const ofRole = (role) => sorted.filter((p) => p.role === role);
    const isSupport = (p) => p.role === "tank" || p.role === "healer";
    const spread = sorted.filter((p) => support.spread.includes(p.classKey) && !isSupport(p));

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

module.exports = { autoAssign, supportOf, GROUP_SIZE, SPREAD_CLASSES };
