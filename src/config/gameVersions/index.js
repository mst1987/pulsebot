// Rule sets per game version: classes and specs with their roles, the
// instances with size, bosses, final boss and suggested tanks/healers, and the
// party/raid buffs. Pure data and pure functions — the signup (#256), raid
// templates (#266), event creation (#261) and the setup suggestion (#262) all
// read from here. There are no custom raids: the rule set is the only source
// of instances.
//
// Instance ids are unique across every version, so `instanceById()` needs no
// version and a stored id stays unambiguous.

const { normalizeBoss } = require("../tbcContent");
const { ROLES, ROLE_LABELS } = require("./classes");
const tbc = require("./tbc");
const classic = require("./classic");
const forever = require("./forever");

const VERSIONS = [tbc, classic, forever];
const DEFAULT_VERSION = "tbc";
const BY_ID = new Map(VERSIONS.map((v) => [v.id, v]));

const INSTANCE_BY_ID = new Map();
for (const v of VERSIONS) {
    for (const i of v.instances) INSTANCE_BY_ID.set(i.id, { ...i, versionId: v.id });
}

/** The rule set of a version, or null for an unknown id. */
function rulesFor(versionId) {
    return BY_ID.get(String(versionId || "")) || null;
}

/** One instance of a version, or null (also when the id belongs to another version). */
function instance(versionId, id) {
    const rules = rulesFor(versionId);
    return (rules && rules.instances.find((i) => i.id === String(id || ""))) || null;
}

/** An instance by id in whichever version has it, with its `versionId`; null when none does. */
function instanceById(id) {
    return INSTANCE_BY_ID.get(String(id || "")) || null;
}

/** A spec of a version by its key ("Druid-Guardian"), or null. */
function spec(specKey, versionId = DEFAULT_VERSION) {
    const rules = rulesFor(versionId);
    if (!rules) return null;
    for (const c of rules.classes) {
        const hit = c.specs.find((s) => s.key === specKey);
        if (hit) return hit;
    }
    return null;
}

/** tank / healer / melee / ranged for a spec key, or "" when the version has no such spec. */
function roleOfSpec(specKey, versionId = DEFAULT_VERSION) {
    const s = spec(specKey, versionId);
    return s ? s.role : "";
}

/**
 * The buffs a spec brings and the ones it benefits from.
 * @returns {{ provides: object[], receives: object[] }} party and raid buffs together
 */
function buffsOf(specKey, versionId = DEFAULT_VERSION) {
    const rules = rulesFor(versionId);
    if (!rules) return { provides: [], receives: [] };
    const all = [...rules.partyBuffs, ...rules.raidBuffs];
    return {
        provides: all.filter((b) => b.providers.includes(specKey)),
        receives: all.filter((b) => b.beneficiaries.includes(specKey)),
    };
}

/**
 * A suggested number of tanks and healers for a raid size, for an instance
 * without its own suggestion. 10 → 2/3, 20 → 2/5, 25 → 3/6, 40 → 4/10; other
 * sizes on the same curve, never more than the raid holds. The version is
 * accepted for when a version needs its own curve; today they share one.
 * @returns {{ tanks: number, healers: number }}
 */
// eslint-disable-next-line no-unused-vars
function defaultComposition(size, versionId = DEFAULT_VERSION) {
    const n = Math.max(0, Math.floor(Number(size) || 0));
    if (n <= 1) return { tanks: n, healers: 0 };
    if (n <= 5) return { tanks: 1, healers: 1 };
    const tanks = n <= 20 ? 2 : (n <= 25 ? 3 : 4);
    const healers = Math.min(Math.round(n / 4), n - tanks);
    return { tanks, healers };
}

/**
 * The suggestion for an instance at a size: its own when it has one for that
 * size, otherwise defaultComposition().
 * @returns {{ tanks: number, healers: number, source: "instance" | "default" }}
 */
function compositionFor(inst, size) {
    const n = Number(size) || (inst && inst.defaultSize) || 0;
    const own = inst && inst.composition && inst.composition[n];
    if (own) return { tanks: own.tanks, healers: own.healers, source: "instance" };
    return { ...defaultComposition(n, inst && inst.versionId), source: "default" };
}

/** The accepted final-boss names of any instance, [] when it has none (never blocks). */
function finalBossesOf(id) {
    const inst = instanceById(id);
    return (inst && inst.finalBossNames) || [];
}

/** The boss list of any instance, [] when unknown. */
function bossesOf(id) {
    const inst = instanceById(id);
    return (inst && inst.bosses) || [];
}

// Boss and zone lookups for the non-TBC versions. TBC has its own, richer ones
// in tbcContent.js (loot table, instance patterns); callers ask that first.
const BOSS_INSTANCE = new Map();
for (const v of VERSIONS) {
    if (v.id === "tbc") continue;
    for (const i of v.instances) {
        for (const name of [...(i.bosses || []), ...(i.finalBossNames || [])]) {
            const key = normalizeBoss(name);
            if (key && !BOSS_INSTANCE.has(key)) BOSS_INSTANCE.set(key, i.id);
        }
    }
}

/** The non-TBC instance an encounter name belongs to, or "". */
function instanceForBoss(name) {
    return BOSS_INSTANCE.get(normalizeBoss(name)) || "";
}

/** The non-TBC instance a zone name ("Molten Core") names, or "". */
function instanceForZone(text) {
    const s = String(text || "").toLowerCase();
    if (!s) return "";
    for (const v of VERSIONS) {
        if (v.id === "tbc") continue;
        const hit = v.instances.find((i) => (i.zoneNames || []).some((z) => s.includes(z)));
        if (hit) return hit.id;
    }
    return "";
}

/** Every version in the shape GET /api/game-versions serves. */
function publicVersions() {
    return VERSIONS.map((v) => ({
        id: v.id,
        label: v.label,
        short: v.short,
        roles: ROLES.map((id) => ({ id, label: ROLE_LABELS[id] })),
        classes: v.classes,
        instances: v.instances.map((i) => ({
            id: i.id,
            name: i.name,
            short: i.short,
            sizes: i.sizes,
            defaultSize: i.defaultSize,
            icon: i.icon,
            bosses: i.bosses,
            finalBoss: i.finalBoss,
            status: i.status,
            suggested: Object.fromEntries(i.sizes.map((size) => [size, compositionFor({ ...i, versionId: v.id }, size)])),
        })),
        partyBuffs: v.partyBuffs,
        raidBuffs: v.raidBuffs,
    }));
}

module.exports = {
    VERSIONS, DEFAULT_VERSION, ROLES,
    rulesFor, instance, instanceById, spec, roleOfSpec, buffsOf,
    defaultComposition, compositionFor, finalBossesOf, bossesOf,
    instanceForBoss, instanceForZone, publicVersions,
};
