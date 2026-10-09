// The "Komposition" tab of a roster (#657): the places per role against the
// slot targets, the classes in the roster and the buffs of the game version's
// rule set it covers. Computed on read, nothing stored.
//
// Counted are core and trial members ("im Roster"); bench is shown on its own
// against slots.bench, pause not at all. A member's class, spec and role come
// from their first character through memberSpec.js's chain (the orga's spec,
// the last signup in the roster's category, the logs, the raider profile, the
// class alone) - the same answer the members table and the overview cards get.
//
//   * classes: every member whose class is known, also without a spec;
//   * roles:   a member with a spec by its role; without a spec by the role
//              the newest log saw (dps then counts without melee/ranged);
//   * buffs:   providers by spec (`partyBuffs` / `raidBuffs` of the rule set,
//              `providers` as spec keys) - a member without spec brings none;
//   * unresolved: who counts without a spec or class, and why ("no_char" no
//              character, "no_class" class unknown, "no_spec" spec unknown).
const raiderProfileStore = require("../../stores/raiderProfileStore");
const { rulesFor } = require("../../config/gameVersions");
const { buildAttendanceContext } = require("../characters/rosterAttendance");
const { resolveMemberSpec, specContext } = require("./memberSpec");

const IN_ROSTER = ["core", "trial"];

/** fn(), or `fallback` when it throws. */
function attempt(fn, fallback) {
    try {
        return fn();
    } catch {
        return fallback;
    }
}

/** The first character of a member resolved through the chain: `{ className, spec, role, source }` or null without a class. */
function memberCharacter(userId, member, versionId, sctx = null) {
    const ctx = sctx || specContext({ versionId, categoryId: null, guildId: "" });
    const r = resolveMemberSpec(userId, member, ctx);
    if (!r.className) return null;
    return { className: r.className, spec: r.spec, role: r.specRole, source: r.source };
}

/** A name for a member nobody else names: the profile's, else the character's, else the id. */
function fallbackName(userId, member) {
    const profile = attempt(() => raiderProfileStore.getProfile(userId), null);
    const key = member.chars[0] || "";
    return (profile && profile.name) || (member.charNames && member.charNames[key]) || key || userId;
}

/**
 * The composition of one roster.
 * @param {object} roster
 * @param {{ ctx?: object }} [opts]  the attendance context of the roster's version (built when left out)
 * @returns {{ rosterId, versionId, slots, counts: { core, trial, bench, pause },
 *   roles: { role: "tank"|"healer"|"dps", target: number, actual: number }[],
 *   dps: { melee: number, ranged: number }, unknown: number,
 *   bench: { target: number, actual: number }, open: number,
 *   classes: { className, label, labelEn, color, icon, count }[],
 *   buffs: { key, label, labelEn, icon, scope, providers: string[], covered: boolean }[],
 *   buffsAvailable: boolean,
 *   members: { userId, className, spec, role, source }[],
 *   unresolved: { userId, displayName, character, className, reason }[],
 *   sources: { override, signup, logs, profile, class } }}
 */
function rosterComposition(roster, opts = {}) {
    const rules = rulesFor(roster.versionId);
    const ctx = opts.ctx || attempt(() => buildAttendanceContext(roster.guildId, { versionId: roster.versionId }), null);
    const sctx = specContext(roster, ctx);
    const counts = { core: 0, trial: 0, bench: 0, pause: 0 };
    const roleCount = { tank: 0, healer: 0, melee: 0, ranged: 0, dps: 0 };
    const classCount = new Map();
    const specsInRoster = new Map(); // spec key -> [userId]
    const sources = { override: 0, signup: 0, logs: 0, profile: 0, class: 0 };
    const members = [];
    const unresolved = [];
    let unknown = 0;
    for (const [userId, member] of Object.entries(roster.members)) {
        counts[member.status] += 1;
        if (!IN_ROSTER.includes(member.status)) continue;
        const r = resolveMemberSpec(userId, member, sctx);
        members.push({ userId, className: r.className, spec: r.spec, role: r.role, source: r.source });
        if (r.source) sources[r.source] += 1;
        if (r.reason) {
            unresolved.push({ userId, displayName: fallbackName(userId, member), character: (member.charNames && member.charNames[r.character]) || r.character, className: r.className, reason: r.reason });
        }
        if (r.className) classCount.set(r.className, (classCount.get(r.className) || 0) + 1);
        if (r.spec) specsInRoster.set(r.spec, [...(specsInRoster.get(r.spec) || []), userId]);
        if (r.specRole && roleCount[r.specRole] !== undefined) roleCount[r.specRole] += 1;
        else if (r.role && roleCount[r.role] !== undefined) roleCount[r.role] += 1;
        else unknown += 1;
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
            { role: "dps", target: Math.max(0, total - tank - healer), actual: roleCount.melee + roleCount.ranged + roleCount.dps },
        ],
        dps: { melee: roleCount.melee, ranged: roleCount.ranged },
        unknown,
        bench: { target: bench, actual: counts.bench },
        open: Math.max(0, total - inRoster),
        classes,
        buffs,
        buffsAvailable: !!rules,
        members,
        unresolved: unresolved.sort((a, b) => a.displayName.localeCompare(b.displayName)),
        sources,
    };
}

module.exports = { rosterComposition, memberCharacter, IN_ROSTER };
