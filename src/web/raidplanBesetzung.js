// The "Besetzung" of a raid plan (docs/raidplan.md): which role slots a raid of a type
// has, before anything is placed on a map — Tank 1..n, Heiler 1..n, DPS 1..n and the setup
// groups. Derived from the raid type (its instances and size) with the rules the events already
// use (gameVersions' compositionFor), pure.
//
//   { size, counts: { tank, healer, dps, melee, ranged }, groups, split }
//
// What must be known is the size, the tanks and the healers; the DPS is what is left
// (size - tanks - healers) and is one number: the slots are "DPS 1..n", any damage dealer.
// Melee and ranged are OPTIONAL: only when somebody splits the DPS by hand do `melee` and
// `ranged` slots exist (their sum is at most the DPS, the rest stays "DPS n"). An older
// counts object without `dps` is read that way: its melee + ranged are the DPS, so every slot
// that existed still exists.
const { instanceById, compositionFor } = require("../config/gameVersions");

const ROLES = ["tank", "healer", "dps", "melee", "ranged"];
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

/** Tanks, healers and the DPS that is left for a raid type; `size` 0 / missing = the instances' default. Melee / ranged are not split. */
function defaultBesetzung(instanceIds, size) {
    const n = cleanSize(size, instanceIds);
    const biggest = (Array.isArray(instanceIds) ? instanceIds : []).map(instanceById).filter(Boolean)
        .sort((a, b) => (b.defaultSize || 0) - (a.defaultSize || 0))[0] || null;
    const comp = compositionFor(biggest, n);
    const tank = Math.min(comp.tanks, n);
    const healer = Math.min(comp.healers, n - tank);
    return { size: n, counts: { tank, healer, dps: Math.max(0, n - tank - healer), melee: 0, ranged: 0 }, groups: Math.max(1, Math.ceil(n / 5)), split: false };
}

/**
 * A counts object with every role a whole number 0..40, or null when there is none to keep. Without
 * `dps` the melee + ranged are the DPS (an older object); melee + ranged never exceed the DPS.
 */
function cleanCounts(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const num = (v) => { const n = int(v); return Number.isFinite(n) ? Math.max(0, Math.min(MAX_COUNT, n)) : 0; };
    const melee = num(raw.melee);
    const ranged = num(raw.ranged);
    const dps = raw.dps === undefined || raw.dps === null ? melee + ranged : num(raw.dps);
    return { tank: num(raw.tank), healer: num(raw.healer), dps: Math.max(dps, melee + ranged), melee, ranged };
}

/** How many slots of each kind the counts make: the DPS that is not split into melee / ranged is "DPS n". */
function slotCounts(counts) {
    return { tank: counts.tank, healer: counts.healer, dps: Math.max(0, counts.dps - counts.melee - counts.ranged), melee: counts.melee, ranged: counts.ranged };
}

/** The Besetzung a plan or template shows: its own counts when it has them, else the raid type's. */
function effectiveBesetzung(instanceIds, size, counts) {
    const base = defaultBesetzung(instanceIds, size);
    const own = cleanCounts(counts);
    return own ? { ...base, counts: own, split: own.melee > 0 || own.ranged > 0 } : base;
}

module.exports = { ROLES, MAX_SIZE, MAX_COUNT, defaultSize, cleanSize, defaultBesetzung, cleanCounts, slotCounts, effectiveBesetzung };
