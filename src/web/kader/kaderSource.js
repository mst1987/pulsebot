// What the Kaderplaner (docs/kaderplaner.md) reads from the rest of the bot:
// the game version's rule set (classes, specs, buffs), the human members of the
// server with their Discord roles, the raider profiles, the characters the logs
// link to an account, the server's raid categories and the attendance of every
// account in each of them — a Kader picks the categories that count, so a PUG
// category nobody of the Kader joins no longer pulls everybody down. Everything
// is derived on read; the planner's own data lives in kaderStore.js and is
// merged on top by kaderView.js.
//
// Privacy: a profile leaves this module as a whitelist of fields — characters,
// their specs and gear, the tank/heal switches, the main flag, the raid days and
// the name the profile was saved under; `allCharacters` lists them across all game versions (same fields). Never `avoid`/`avoidEnabled`, wishes,
// the note, preferred raids, calendar tokens or who else claims a character
// (test/web/kader/kaderSource.test.js scans the payload for them).
const { rulesFor } = require("../../config/gameVersions");
const { buildClasses } = require("../../config/gameVersions/classes");
const { mainVersionFor, isVersionVisible } = require("../../services/events/mainVersion");
const { listStoredEvents } = require("../../services/events/eventSources");
const { isCategoryActive } = require("../../services/events/categoryLifecycle");
const { buildAttendanceContext, attendanceForAccounts } = require("../../services/characters/rosterAttendance");
const discord = require("../../services/discord/discord");
const { listKnownCategories } = require("../../services/discord/categoryNames");
const { getConfig } = require("../../stores/configStore");
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
        .map((b) => ({ key: b.key, label: b.label, labelEn: b.labelEn || b.label, icon: b.icon || "", providers: [...b.providers] }));
    const party = (rules.partyBuffs || []).map((b) => ({
        key: b.key,
        label: b.label,
        labelEn: b.labelEn || b.label,
        icon: b.icon || "",
        providers: [...b.providers],
        beneficiaries: [...(b.beneficiaries || [])],
        slot: b.slot || "",
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
 * One profile, whitelisted: the characters of the version, and the raider's
 * first character of another version as `other` (what the planner prefills
 * when the raider has no character of the version yet). Null for a profile
 * without any. There is no main — `main` here only marks the raider's first
 * character of the version in their own order, the one the planner starts on.
 */
function sourceProfile(profile, versionId, index) {
    const all = profiles.charactersOfVersion(profile, "");
    if (!all.length) return null;
    const chars = profiles.charactersOfVersion(profile, versionId);
    const mainKey = chars.length ? chars[0].key : "";
    const others = all.filter((c) => !chars.includes(c));
    const otherMain = others[0] || null;
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
        // every character of the account, any game version: what the account dialog offers to assign
        allCharacters: all.map((c) => {
            const roles = profiles.characterRoles(profile, c);
            return {
                key: c.key,
                name: c.name,
                className: c.className,
                versionId: profiles.characterVersion(c.versionId),
                specs: (c.specs || []).map((s) => ({ spec: s.key, gear: s.gear })),
                canTank: !!roles.canOfftank,
                canHeal: !!roles.canHeal,
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
 * The raid categories of the server a Kader can count attendance in: every
 * Discord category the admin marked for events (config.categoryIds) and every
 * category a raid of this server ran in, with the name Discord gives it (or the
 * one remembered, categoryNames.js), the game version it plays and whether that
 * version is hidden (#563). An id no name is known for is left out. In
 * Discord's order. Only active categories (#744): a deactivated or closed one
 * is history, not something to plan for. Only categories of a shown version,
 * unless `includeHidden` (the Kaderplaner's attendance pick: a hidden version's
 * nights are still a reliability signal, the page marks them "archiviert");
 * with `versionId` only those that play it.
 * @param {string} guildId
 * @param {{ versionId?: string, includeHidden?: boolean }} [opts]
 * @returns {{ id: string, name: string, versionId: string, versionLabel: string, hidden: boolean }[]}
 */
function listRaidCategories(guildId, { versionId: only = "", includeHidden = false } = {}) {
    const config = getConfig();
    const ids = new Set((config.categoryIds || []).map((id) => String(id).trim()).filter(Boolean));
    for (const ev of listStoredEvents(guildId)) if (ev && ev.categoryId) ids.add(String(ev.categoryId));
    return listKnownCategories(guildId)
        .filter((c) => ids.has(c.id) && c.name && isCategoryActive(c.id, config))
        .map((c) => {
            const versionId = mainVersionFor({ categoryId: c.id, config });
            const rules = rulesFor(versionId);
            return { id: c.id, name: c.name, versionId, versionLabel: rules ? rules.short || rules.label : versionId, hidden: !isVersionVisible(versionId, config) };
        })
        .filter((c) => (!only || c.versionId === only) && (includeHidden || !c.hidden));
}

/**
 * The categories in the order the attendance pick shows them: grouped by game
 * version - the Kader's own version first, then the other shown versions, then
 * the hidden ones, each in the order its first category comes - and in
 * Discord's order inside a version.
 * @template {{ versionId: string, hidden: boolean }} T
 * @param {T[]} categories
 * @param {string} ownVersion
 * @returns {T[]}
 */
function groupByVersion(categories, ownVersion) {
    const order = [];
    for (const c of categories) if (!order.includes(c.versionId)) order.push(c.versionId);
    const rank = (v) => {
        if (v === ownVersion) return 0;
        return categories.some((c) => c.versionId === v && c.hidden) ? 2 : 1;
    };
    const versions = order.map((v, i) => ({ v, i })).sort((a, b) => rank(a.v) - rank(b.v) || a.i - b.i).map((x) => x.v);
    return versions.flatMap((v) => categories.filter((c) => c.versionId === v));
}

/**
 * Whom attendance is counted for: every account with a character the bot
 * knows — the profile's characters of every version (a TBC night is matched
 * against the TBC character) and the characters the orga assigned per raid
 * category (with class and name as the logs spell them).
 */
function attendanceAccounts(index) {
    const byUser = new Map();
    const add = (userId, name, className) => {
        const clean = String(name || "").trim();
        if (!userId || !clean) return;
        const list = byUser.get(userId) || [];
        if (!list.some((c) => c.name.toLowerCase() === clean.toLowerCase())) list.push({ name: clean, className: className || "", manual: true });
        byUser.set(userId, list);
    };
    for (const p of profiles.listProfiles()) for (const c of profiles.charactersOfVersion(p, "")) add(p.userId, c.name, c.className);
    for (const map of Object.values(raiderCharacters.listAllAssignments())) {
        for (const [userId, name] of Object.entries(map || {})) {
            const entry = name ? index.get(profiles.characterKey(name)) : null;
            add(userId, (entry && entry.character) || name, entry && entry.className);
        }
    }
    return [...byUser].map(([userId, chars]) => ({ userId, chars }));
}

/** One counted night as the page shows it. */
function nightOf(r) {
    const dt = serverDateTime(r.startTime);
    return {
        date: dt ? dt.toISODate() : "",
        eventId: r.eventId,
        title: r.title || "",
        attended: !!r.attended,
        // the attendance code (#677: present, bench, vacation, absence, noSignup, noShow) - the page words it
        status: r.status || (r.attended ? "present" : "noShow"),
        reason: r.attended ? null : (r.reason || null),
        ...(r.override ? { override: r.override } : {}),
    };
}

/**
 * Attendance per Discord account in each raid category: the category's last
 * RAID_WINDOW nights with evidence (rosterAttendance.js) of the game version
 * the category plays (#740), counted with that version's context - a TBC
 * category counts its TBC nights against the TBC characters, also for a
 * Forever Kader (the one deliberate reading across versions,
 * docs/game-versions.md). A category whose version has no context here is
 * skipped. An account carries only the categories that counted a night for
 * it; one without any is left out (the page shows "—").
 * @param {Map<string, object>} contexts  versionId -> buildAttendanceContext()
 * @returns {{ userId: string, byCategory: Object<string, { attended: number, counted: number, versionId: string, nights: object[] }> }[]}
 */
function sourceAttendance(contexts, categories, accounts) {
    const byUser = new Map(accounts.map((a) => [a.userId, {}]));
    for (const { id, versionId } of categories) {
        const ctx = contexts.get(versionId);
        if (!ctx || !(ctx.raidsByCategory.get(id) || []).length) continue;
        for (const [userId, result] of attendanceForAccounts(ctx, id, accounts, { nights: true })) {
            if (!result.total || !byUser.has(userId)) continue;
            byUser.get(userId)[id] = { attended: result.attended, counted: result.total, versionId, nights: (result.raids || []).map(nightOf) };
        }
    }
    return [...byUser]
        .filter(([, byCategory]) => Object.keys(byCategory).length)
        .map(([userId, byCategory]) => ({ userId, byCategory }));
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
 * The attendance contexts the planner needs: one for its own version (the
 * nights of its categories in the pick) and one for every other version a
 * picked category plays - never one for a version nobody picked.
 * @returns {Map<string, object>} versionId -> buildAttendanceContext()
 */
function attendanceContexts(guildId, categories, { versionId, picked, now }) {
    const versions = new Set([versionId]);
    for (const c of categories) if (picked.has(c.id)) versions.add(c.versionId);
    return new Map([...versions].map((v) => [v, buildAttendanceContext(guildId, { now: Math.floor(now / 1000), versionId: v })]));
}

/**
 * Everything the planner reads from the bot, for one server and version.
 * The raid categories are those of every version (`hidden` marks one of a
 * hidden version), the Kader's own first; `nights` is null for a category
 * whose version no Kader picked yet (`attendanceCategoryIds`: the picks of
 * the Kader of this version) - its attendance is counted once it is picked.
 * @param {{ guildId: string, versionId?: string, now?: number, attendanceCategoryIds?: string[] }} opts  `now` in ms
 */
async function loadKaderSource({ guildId = "", versionId = plannerVersion(), now = Date.now(), attendanceCategoryIds = [] } = {}) {
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

    let raidCategories = [];
    let attendance = [];
    try {
        const categories = groupByVersion(listRaidCategories(guildId, { includeHidden: true }), versionId);
        const contexts = attendanceContexts(guildId, categories, { versionId, picked: new Set(attendanceCategoryIds.map(String)), now });
        raidCategories = categories.map((c) => {
            const ctx = contexts.get(c.versionId);
            return { ...c, nights: ctx ? (ctx.raidsByCategory.get(c.id) || []).length : null };
        });
        attendance = sourceAttendance(contexts, categories, attendanceAccounts(index));
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
        raidCategories,
        attendance,
        warnings,
    };
}

/** The rule set's classes alone — enough for a change inside one Kader (no Discord, no profiles). */
function loadKaderRules(versionId = plannerVersion()) {
    const rules = rulesFor(versionId);
    if (!rules) throw new Error(`unknown version ${versionId}`);
    return { versionId, classes: sourceClasses(rules) };
}

module.exports = { loadKaderSource, loadKaderRules, listRaidCategories, groupByVersion, plannerVersion, PREFERRED_VERSION };
