// The "Besetzung" of a raid plan (docs/raidplan.md): which role slots a raid of a type
// has, before anything is placed on a map — Tank 1..n, Heiler 1..n, Melee 1..n,
// Ranged 1..n and the setup groups. Derived from the raid type (its instances and size)
// with the rules the events already use (gameVersions' compositionFor), pure.
//
//   { size, counts: { tank, healer, melee, ranged }, groups }
//
// The damage dealers that are left after tanks and healers are split evenly, the odd
// one going to melee (25 players: 3 tanks, 7 healers, 8 melee, 7 ranged).
const { instanceById, compositionFor } = require("../config/gameVersions");

const ROLES = ["tank", "healer", "melee", "ranged"];
const MAX_SIZE = 40;
const MAX_COUNT = 40;

const int = (v) => Math.floor(Number(v));

/** The size a raid of these instances defaults to: the biggest instance's own, else 25. */
function defaultSize(instanceIds) {
    const sizes = (Array.isArray(instanceIds) ? instanceIds : []).map((id) => (instanceById(id) || {}).defaultSize || 0);
    return Math.max(0, ...sizes) || 25;
}

/** A size within 1..40 (anything else = the default of the instances). */
function cleanSize(v, instanceIds) {
    const n = int(v);
    return n >= 1 && n <= MAX_SIZE ? n : defaultSize(instanceIds);
}

/** Tanks, healers, melee and ranged for a raid type; `size` 0 / missing = the instances' default. */
function defaultBesetzung(instanceIds, size) {
    const n = cleanSize(size, instanceIds);
    const biggest = (Array.isArray(instanceIds) ? instanceIds : []).map(instanceById).filter(Boolean)
        .sort((a, b) => (b.defaultSize || 0) - (a.defaultSize || 0))[0] || null;
    const comp = compositionFor(biggest, n);
    const tank = Math.min(comp.tanks, n);
    const healer = Math.min(comp.healers, n - tank);
    const dps = Math.max(0, n - tank - healer);
    const melee = Math.ceil(dps / 2);
    return { size: n, counts: { tank, healer, melee, ranged: dps - melee }, groups: Math.max(1, Math.ceil(n / 5)) };
}

/** A counts object with every role a whole number 0..40, or null when there is none to keep. */
function cleanCounts(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const out = {};
    for (const r of ROLES) {
        const n = int(raw[r]);
        out[r] = Number.isFinite(n) ? Math.max(0, Math.min(MAX_COUNT, n)) : 0;
    }
    return out;
}

/** The Besetzung a plan or template shows: its own counts when it has them, else the raid type's. */
function effectiveBesetzung(instanceIds, size, counts) {
    const base = defaultBesetzung(instanceIds, size);
    const own = cleanCounts(counts);
    return own ? { ...base, counts: own } : base;
}

module.exports = { ROLES, MAX_SIZE, MAX_COUNT, defaultSize, cleanSize, defaultBesetzung, cleanCounts, effectiveBesetzung };
