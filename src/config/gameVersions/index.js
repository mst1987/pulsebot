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
// The main version of an install whose settings name none (#541). Which version
// the guild plays is a setting — services/events/mainVersion.js' mainVersionFor()
// reads it; this constant is only its last fallback and the default parameter
// of the pure lookups below (every caller hands them a version).
const DEFAULT_VERSION = "tbc";
// The version of a record stored before it carried one: everything from then
// was TBC, whatever the main version is today — so a stored record never
// changes its version when the setting is switched.
const LEGACY_VERSION = "tbc";
const BY_ID = new Map(VERSIONS.map((v) => [v.id, v]));

const INSTANCE_BY_ID = new Map();
for (const v of VERSIONS) {
    for (const i of v.instances) INSTANCE_BY_ID.set(i.id, { ...i, versionId: v.id });
}

/**
 * Whether the version has a Google raid sheet layout (#751): the sheet fill
 * (utils/setup/fillSetup.js) writes TBC's template - other versions have none.
 */
function hasSheetLayout(versionId) {
    const rules = rulesFor(versionId);
    return Boolean(rules && rules.sheetLayout);
}

/** The rule set of a version, or null for an unknown id. */
function rulesFor(versionId) {
    return BY_ID.get(String(versionId || "")) || null;
}

/**
 * The main professions a character of the version can enter in "Mein Profil"
 * (Berufe, at most two): the rule set's `professions` - `[{ id, label,
 * labelEn, icon }]` - and the highest skill, `professionSkillMax` (null = the
 * profile keeps no skill). No rule set carries a list yet (the data is not
 * confirmed, docs/roster-profile.md "Berufe"): an empty list hides the part.
 * @returns {{ professions: { id: string, label: string, labelEn: string, icon: string }[], skillMax: number|null }}
 */
function professionsOf(versionId) {
    const rules = rulesFor(versionId);
    const list = rules && Array.isArray(rules.professions) ? rules.professions : [];
    const max = rules && Number.isInteger(rules.professionSkillMax) && rules.professionSkillMax > 0 ? rules.professionSkillMax : null;
    return {
        professions: list.map((p) => ({ id: String(p.id), label: p.label || String(p.id), labelEn: p.labelEn || p.label || String(p.id), icon: p.icon || "" })),
        skillMax: max,
    };
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
 * A suggested number of tanks and healers for a raid size, for an instance
 * without its own suggestion. 10 → 2/3, 20 → 2/5, 25 → 3/6, 40 → 4/10; other
 * sizes on the same curve, never more than the raid holds. A version may list
 * its own `composition` per size, which wins for those sizes.
 * @returns {{ tanks: number, healers: number }}
 */
function defaultComposition(size, versionId = DEFAULT_VERSION) {
    const n = Math.max(0, Math.floor(Number(size) || 0));
    // A version with its own curve (Forever, #751) answers for the sizes it lists.
    const own = (rulesFor(versionId) || {}).composition;
    if (own && own[n]) return { tanks: own[n].tanks, healers: own[n].healers };
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
// in tbcContent.js (loot table, instance patterns); config/raidContent.js asks
// the right one for a version. Both lookups take an optional `versionId`: with
// one they search only that version's instances (Forever's "Hyjal Summit" is
// not TBC's), without one every non-TBC version in release order.
const BOSS_INSTANCE = new Map(); // versionId -> Map(normalized boss -> instance id)
for (const v of VERSIONS) {
    const byBoss = new Map();
    BOSS_INSTANCE.set(v.id, byBoss);
    if (v.id === "tbc") continue;
    for (const i of v.instances) {
        for (const name of [...(i.bosses || []), ...(i.finalBossNames || []), ...(i.bossHints || [])]) {
            const key = normalizeBoss(name);
            if (key && !byBoss.has(key)) byBoss.set(key, i.id);
        }
    }
}

function searchedVersions(versionId) {
    if (versionId) {
        const v = rulesFor(versionId);
        return v && v.id !== "tbc" ? [v] : [];
    }
    return VERSIONS.filter((v) => v.id !== "tbc");
}

/** The non-TBC instance an encounter name belongs to (within `versionId` when given), or "". */
function instanceForBoss(name, versionId = "") {
    const key = normalizeBoss(name);
    for (const v of searchedVersions(versionId)) {
        const hit = BOSS_INSTANCE.get(v.id).get(key);
        if (hit) return hit;
    }
    return "";
}

/** The non-TBC instance a zone name ("Molten Core") names (within `versionId` when given), or "". */
function instanceForZone(text, versionId = "") {
    const s = String(text || "").toLowerCase();
    if (!s) return "";
    for (const v of searchedVersions(versionId)) {
        const hit = v.instances.find((i) => (i.zoneNames || []).some((z) => s.includes(z)));
        if (hit) return hit.id;
    }
    return "";
}

/** The boss icon of an instance of any version (rule set, `icon`), or "". */
function iconOf(id) {
    const inst = instanceById(id);
    return (inst && inst.icon) || "";
}

/** Every version in the shape GET /api/game-versions serves. */
function publicVersions() {
    return VERSIONS.map((v) => ({
        id: v.id,
        label: v.label,
        short: v.short,
        icon: v.icon || "",
        roles: ROLES.map((id) => ({ id, label: ROLE_LABELS[id] })),
        classes: v.classes,
        instances: v.instances.map((i) => ({
            id: i.id,
            name: i.name,
            short: i.short,
            sizes: i.sizes,
            defaultSize: i.defaultSize,
            icon: i.icon,
            // The colour the bot's event message falls back to (#307); the
            // client draws it in the "Aussehen" preview, so it never guesses one.
            color: i.color || "",
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
    VERSIONS, DEFAULT_VERSION, LEGACY_VERSION, ROLES,
    rulesFor, professionsOf, hasSheetLayout, instance, instanceById, spec, roleOfSpec,
    defaultComposition, compositionFor, finalBossesOf, bossesOf,
    instanceForBoss, instanceForZone, iconOf, publicVersions,
};
