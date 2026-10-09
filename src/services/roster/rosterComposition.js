// The "Komposition" tab of a roster (#657): the places per role against the
// slot targets, the classes in the roster and the buffs of the game version's
// rule set it covers. Computed on read, nothing stored.
//
// Counted are core and trial members ("im Roster"); bench is shown on its own
// against slots.bench, pause not at all. A member's class, spec and role come
// from their first character as the profile knows it in the roster's version
// (the first spec of that character is its main one); a character typed by
// hand or missing in the profile has no class, so the member counts as
// `unknown`.
//
// Buffs: the party and raid buffs of the rule set (config/gameVersions,
// `partyBuffs` / `raidBuffs` with their `providers` as spec keys). A member
// provides a buff when the main spec of their first character is a provider.
const raiderProfileStore = require("../../stores/raiderProfileStore");
const { rulesFor, roleOfSpec } = require("../../config/gameVersions");

const IN_ROSTER = ["core", "trial"];

/** The first character of a member as the profile knows it: `{ className, spec, role }` or null. */
function memberCharacter(userId, member, versionId) {
    const key = member.chars[0];
    if (!key) return null;
    const own = raiderProfileStore.findCharacter(raiderProfileStore.getProfile(userId), key, versionId);
    if (!own) return null;
    const spec = own.specs[0] ? own.specs[0].key : "";
    return { className: own.className, spec, role: spec ? roleOfSpec(spec, versionId) : "" };
}

/**
 * The composition of one roster.
 * @returns {{ rosterId, versionId, slots, counts: { core, trial, bench, pause },
 *   roles: { role: "tank"|"healer"|"dps", target: number, actual: number }[],
 *   dps: { melee: number, ranged: number }, unknown: number,
 *   bench: { target: number, actual: number }, open: number,
 *   classes: { className, label, labelEn, color, icon, count }[],
 *   buffs: { key, label, labelEn, icon, scope, providers: string[], covered: boolean }[],
 *   buffsAvailable: boolean }}
 */
function rosterComposition(roster) {
    const rules = rulesFor(roster.versionId);
    const counts = { core: 0, trial: 0, bench: 0, pause: 0 };
    const roleCount = { tank: 0, healer: 0, melee: 0, ranged: 0 };
    const classCount = new Map();
    const specsInRoster = new Map(); // spec key -> [userId]
    let unknown = 0;
    for (const [userId, member] of Object.entries(roster.members)) {
        counts[member.status] += 1;
        if (!IN_ROSTER.includes(member.status)) continue;
        const char = memberCharacter(userId, member, roster.versionId);
        if (!char) {
            unknown += 1;
            continue;
        }
        classCount.set(char.className, (classCount.get(char.className) || 0) + 1);
        if (char.role && roleCount[char.role] !== undefined) roleCount[char.role] += 1;
        else unknown += 1;
        if (char.spec) specsInRoster.set(char.spec, [...(specsInRoster.get(char.spec) || []), userId]);
    }
    const inRoster = counts.core + counts.trial;
    const { total, tank, healer, bench } = roster.slots;
    const classMeta = new Map(((rules && rules.classes) || []).map((c) => [c.id, c]));
    const classes = [...classCount.entries()]
        .map(([className, count]) => {
            const meta = classMeta.get(className) || {};
            return { className, label: meta.label || className, labelEn: meta.labelEn || className, color: meta.color || "", icon: meta.icon || "", count };
        })
        .sort((a, b) => b.count - a.count || a.className.localeCompare(b.className));
    const buffs = rules
        ? [...rules.raidBuffs, ...rules.partyBuffs].map((b) => {
            const providers = [...new Set(b.providers.flatMap((spec) => specsInRoster.get(spec) || []))];
            return { key: b.key, label: b.label, labelEn: b.labelEn, icon: b.icon, scope: b.scope, providers, covered: providers.length > 0 };
        })
        : [];
    return {
        rosterId: roster.id,
        versionId: roster.versionId,
        slots: { ...roster.slots },
        counts,
        roles: [
            { role: "tank", target: tank, actual: roleCount.tank },
            { role: "healer", target: healer, actual: roleCount.healer },
            { role: "dps", target: Math.max(0, total - tank - healer), actual: roleCount.melee + roleCount.ranged },
        ],
        dps: { melee: roleCount.melee, ranged: roleCount.ranged },
        unknown,
        bench: { target: bench, actual: counts.bench },
        open: Math.max(0, total - inRoster),
        classes,
        buffs,
        buffsAvailable: !!rules,
    };
}

module.exports = { rosterComposition, memberCharacter, IN_ROSTER };
