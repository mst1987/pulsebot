// What the Kaderplaner (docs/kaderplaner.md) reads from the rest of the bot:
// the game version's rule set (classes, specs, buffs), the human members of the
// server with their Discord roles, the raider profiles, the characters the logs
// link to an account, and the attendance — of the planner's version and of the
// server's main version (Forever has no raid nights yet; the TBC nights still
// say who shows up). Everything is derived on read; the planner's own data
// lives in kaderStore.js and is merged on top by kaderView.js.
//
// Privacy: a profile leaves this module as a whitelist of fields — characters,
// their specs and gear, the tank/heal switches, the main flag, the raid days and
// the name the profile was saved under. Never `avoid`/`avoidEnabled`, wishes,
// the note, preferred raids, calendar tokens or who else claims a character
// (test/web/kader/kaderSource.test.js scans the payload for them).
const { rulesFor } = require("../../config/gameVersions");
const { buildClasses } = require("../../config/gameVersions/classes");
const { mainVersionFor } = require("../../services/events/mainVersion");
const { buildAttendanceContext, attendanceForAccounts } = require("../../services/characters/rosterAttendance");
const discord = require("../../services/discord/discord");
const profiles = require("../../stores/raiderProfileStore");
const raiderCharacters = require("../../stores/raiderCharactersStore");
const { logIndex } = require("../characters/profileLogs");
const { serverDateTime } = require("../../utils/time");

// Forever is what the planner is built for (launch Nov 2026); an install
// without that rule set falls back to its main version.
const PREFERRED_VERSION = "forever";

// The party buffs a setup group is checked for ("kein Windzorn" on a group of
// melee). The others are shown when a group has them, never flagged as missing.
const KEY_PARTY_BUFFS = new Set(["windfury", "battleShout", "manaSpring"]);
// The raid buffs worth a line: one per providing class.
const BOARD_RAID_BUFFS = ["fortitude", "intellect", "motw", "kings", "might"];

/** The version the planner works in: forever, else the main version. */
function plannerVersion() {
    return rulesFor(PREFERRED_VERSION) ? PREFERRED_VERSION : mainVersionFor();
}

/** Classes and specs of a rule set, keys as the profiles store them ("Warrior", "Warrior-Protection"). */
function sourceClasses(rules) {
    return buildClasses(rules.classes).map((c) => {
        const specs = c.specs.map((s) => ({
            key: s.key,
            name: s.label,
            nameEn: s.labelEn,
            role: s.role,
            canTank: !!s.canTank,
            canHeal: !!s.canHeal,
            icon: s.icon || "",
        }));
        return {
            key: c.id,
            name: c.label,
            nameEn: c.labelEn,
            color: c.color,
            icon: c.icon || "",
            specs,
            canTank: specs.some((s) => s.canTank),
            canHeal: specs.some((s) => s.canHeal),
        };
    });
}

/** The raid and party buffs of a rule set, reduced to what the planner checks: who provides it, who wants it. */
function sourceBuffs(rules) {
    const raid = BOARD_RAID_BUFFS
        .map((key) => (rules.raidBuffs || []).find((b) => b.key === key))
        .filter(Boolean)
        .map((b) => ({ key: b.key, label: b.label, icon: b.icon || "", providers: [...b.providers] }));
    const party = (rules.partyBuffs || []).map((b) => ({
        key: b.key,
        label: b.label,
        icon: b.icon || "",
        providers: [...b.providers],
        beneficiaries: [...(b.beneficiaries || [])],
        important: KEY_PARTY_BUFFS.has(b.key),
    }));
    return { raid, party };
}

/** The name part of a character key ("forever~aldric sturmwind" -> "aldric sturmwind"): logs know no version. */
function logSpecsOf(character, index) {
    const entry = index.get(profiles.nameKey(character.key)) || index.get(profiles.nameKey(character.name));
    return entry && entry.specKey && entry.className === character.className ? [entry.specKey] : [];
}

/**
 * One profile, whitelisted: the characters of the version, and the main
 * character of another version as `other` (what the planner prefills when the
 * raider has no character of the version yet). Null for a profile without any.
 */
function sourceProfile(profile, versionId, index) {
    const all = profiles.charactersOfVersion(profile, "");
    if (!all.length) return null;
    const chars = profiles.charactersOfVersion(profile, versionId);
    // The stored main is one per account across all versions; inside this
    // version the first character stands in when the main plays another one.
    const mainKey = chars.length ? (chars.find((c) => c.main) || chars[0]).key : "";
    const others = all.filter((c) => !chars.includes(c));
    const otherMain = others.find((c) => c.main) || others[0] || null;
    return {
        userId: profile.userId,
        displayName: profile.name || "",
        characters: chars.map((c) => {
            const roles = profiles.characterRoles(profile, c);
            return {
                key: c.key,
                name: c.name,
                className: c.className,
                specs: (c.specs || []).map((s) => ({ spec: s.key, gear: s.gear })),
                main: c.key === mainKey,
                canTank: !!roles.canOfftank,
                canHeal: !!roles.canHeal,
                logSpecs: logSpecsOf(c, index),
            };
        }),
        availability: [...(profile.availability || [])],
        other: otherMain && otherMain.className
            ? { name: otherMain.name, className: otherMain.className, spec: ((otherMain.specs || [])[0] || {}).key || (logSpecsOf(otherMain, index)[0] || ""), versionId: profiles.characterVersion(otherMain.versionId) }
            : null,
    };
}

/**
 * The characters the bot links to an account without a profile: the manual
 * raider→character assignments per raid category, with class and spec from the
 * logs. `{ [userId]: { name, className, spec } }`, the first known one each.
 */
function sourceLogChars(index) {
    const out = {};
    for (const map of Object.values(raiderCharacters.listAllAssignments())) {
        for (const [userId, name] of Object.entries(map || {})) {
            if (!name || out[userId]) continue;
            const entry = index.get(profiles.characterKey(name));
            if (!entry || !entry.className) continue;
            out[userId] = { name: entry.character || String(name), className: entry.className, spec: entry.specKey || "" };
        }
    }
    return out;
}

/**
 * Attendance per Discord account over one version's raid nights, every raid
 * category of the guild summed up. Each category counts its last RAID_WINDOW
 * nights with evidence (rosterAttendance.js), so the list stays bounded.
 * `rate` is null while nothing is counted (Forever before its raids open).
 */
function sourceAttendance(guildId, versionId, accounts, nowSec) {
    if (!accounts.length) return [];
    const ctx = buildAttendanceContext(guildId, { versionId, now: nowSec });
    const byUser = new Map(accounts.map((a) => [a.userId, []]));
    for (const categoryId of ctx.raidsByCategory.keys()) {
        for (const [userId, result] of attendanceForAccounts(ctx, categoryId, accounts, { nights: true })) {
            byUser.get(userId).push(...(result.raids || []));
        }
    }
    return accounts.map(({ userId }) => {
        const nights = byUser.get(userId)
            .sort((a, b) => (b.startTime || 0) - (a.startTime || 0))
            .map((r) => {
                const dt = serverDateTime(r.startTime);
                return {
                    date: dt ? dt.toISODate() : "",
                    eventId: r.eventId,
                    title: r.title || "",
                    attended: !!r.attended,
                    reason: r.attended ? null : (r.reason || null),
                };
            });
        const attended = nights.filter((n) => n.attended).length;
        return {
            userId,
            attended,
            counted: nights.length,
            rate: nights.length ? Math.round((attended / nights.length) * 100) / 100 : null,
            nights,
        };
    });
}

/** The Discord roles of the server with how many of its members hold each; roles nobody holds are left out. */
function sourceRoles(guildId, members) {
    const counts = new Map();
    for (const m of members) for (const id of m.roleIds) counts.set(id, (counts.get(id) || 0) + 1);
    return discord.listRoles(guildId)
        .filter((r) => counts.has(r.id))
        .map((r) => ({ id: r.id, name: r.name, color: r.color || "", count: counts.get(r.id) }));
}

/**
 * Everything the planner reads from the bot, for one server and version.
 * @param {{ guildId: string, versionId?: string, now?: number }} opts  `now` in ms
 */
async function loadKaderSource({ guildId = "", versionId = plannerVersion(), now = Date.now() } = {}) {
    const rules = rulesFor(versionId);
    if (!rules) throw new Error(`unknown version ${versionId}`);
    const mainVersionId = mainVersionFor();
    const mainRules = rulesFor(mainVersionId);
    const warnings = [];

    let members = [];
    if (!guildId) {
        warnings.push("Kein Discord-Server aktiv - Mitgliederliste leer.");
    } else {
        const listed = await discord.listHumanMembers(guildId);
        if (listed.error) warnings.push(`Mitgliederliste nicht verfügbar (GuildMembers-Intent aktiv? Bot verbunden?): ${listed.error}`);
        members = listed.members.map((m) => ({ userId: m.id, displayName: m.displayName, avatarUrl: m.avatarUrl || null, roleIds: [...(m.roleIds || [])] }));
    }

    const index = logIndex();
    const listed = profiles.listProfiles()
        .map((p) => sourceProfile(p, versionId, index))
        .filter(Boolean)
        .sort((a, b) => a.userId.localeCompare(b.userId));
    const logChars = sourceLogChars(index);

    const nowSec = Math.floor(now / 1000);
    let attendance = [];
    let attendanceMain = [];
    try {
        attendance = sourceAttendance(guildId, versionId, listed
            .filter((p) => p.characters.length)
            .map((p) => ({ userId: p.userId, chars: p.characters.map((c) => ({ name: c.name, className: c.className, manual: true })) })), nowSec);
        if (mainVersionId !== versionId) {
            const accounts = new Map();
            for (const p of profiles.listProfiles()) {
                const chars = profiles.charactersOfVersion(p, mainVersionId).map((c) => ({ name: c.name, className: c.className, manual: true }));
                if (chars.length) accounts.set(p.userId, chars);
            }
            for (const [userId, c] of Object.entries(logChars)) {
                const list = accounts.get(userId) || [];
                if (!list.some((x) => x.name.toLowerCase() === c.name.toLowerCase())) list.push({ name: c.name, className: c.className, manual: true });
                accounts.set(userId, list);
            }
            attendanceMain = sourceAttendance(guildId, mainVersionId, [...accounts].map(([userId, chars]) => ({ userId, chars })), nowSec);
        }
    } catch (e) {
        warnings.push(`Anwesenheit nicht verfügbar: ${(e && e.message) || e}`);
    }

    return {
        guildId: guildId || "",
        versionId,
        mainVersion: { id: mainVersionId, label: mainRules ? mainRules.short || mainRules.label : mainVersionId },
        classes: sourceClasses(rules),
        buffs: sourceBuffs(rules),
        members,
        discordRoles: guildId ? sourceRoles(guildId, members) : [],
        profiles: listed,
        logChars,
        attendance,
        attendanceMain,
        warnings,
    };
}

/** The rule set's classes alone — enough for a change inside one Kader (no Discord, no profiles). */
function loadKaderRules(versionId = plannerVersion()) {
    const rules = rulesFor(versionId);
    if (!rules) throw new Error(`unknown version ${versionId}`);
    return { versionId, classes: sourceClasses(rules) };
}

module.exports = { loadKaderSource, loadKaderRules, plannerVersion, PREFERRED_VERSION };
