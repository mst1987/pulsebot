// What the roster pages read (#654, docs/roster-profile.md "Roster-Seiten"):
// the overview's cards (GET /api/rosters) and one roster with its members
// (GET /api/rosters/roster?id=). The writes are web/apiRoutes/rosterMembers.js,
// rosterRoles.js and rosterAdmin.js (#655-#657); for a caller who may manage the
// roster the detail adds what the editing needs: each member's note and further
// profile characters of the version (`otherChars`), and the roster's `settings`.
//
// The data is rosterStore.js (#653); everything else is looked up on read and
// best-effort:
//   * Discord: the cached member list (names, avatars, who holds which role) and
//     the role list. Without the bot both are empty - names fall back to the
//     raider profile, "has the role" becomes null (unknown) instead of false.
//   * characters: a member's roster characters (profile keys) resolved through
//     the raider profile of the roster's game version (spec, class, colour,
//     icon), else the character cache the loot and logs fill, else the name.
//   * class, spec and role of the FIRST character: services/roster/memberSpec.js
//     (the orga's spec, the last signup in the category, the logs, the profile,
//     the class alone) - the same answer the Komposition tab counts with. Each
//     row carries it as `resolved` (with where it came from); a manager also
//     gets `specChoices`, the specs of the character's class for the drawer.
//   * attendance per PERSON (rosterAttendance.attendanceForAccounts): a night
//     counts when any character of the account stands in its log; the window is
//     the category's own (Einstellungen > Kategorien, categoryAttendance), the
//     nights only those of the roster's game version.
//
// Places: core and trial members take a place ("n von m Plaetzen", the role
// figures); bench and pause are counted per status only. The attendance average
// is taken over everybody but the paused members.
const rosterStore = require("../../stores/rosterStore");
const profiles = require("../../stores/raiderProfileStore");
const characterStore = require("../../stores/characterStore");
const discord = require("../../services/discord/discord");
const { listKnownCategories } = require("../../services/discord/categoryNames");
const { listStoredEvents } = require("../../services/events/eventSources");
const { rulesFor } = require("../../config/gameVersions");
const { CLASSES } = require("../../config/gameVersions/classes");
const { mainVersionFor } = require("../../services/events/mainVersion");
const { categoryAttendanceFor } = require("../../stores/configSchema");
const { buildAttendanceContext, attendanceForAccounts, categoryInfo, categoryNights, roleFromSpec } = require("../../services/characters/rosterAttendance");
const { canEditAnyAttendance } = require("../../services/characters/attendanceAccess");
const { CLASS_COLORS, classSpecIconUrl } = require("../../utils/setup/setupView");
const { characterKeyOf, nameKeyOf } = require("../../utils/loot/lootImport");
const { canManageRosterLive } = require("../../services/roster/rosterAccess");
const { trialEnding } = require("../../services/roster/rosterTrials");
const { resolveMemberSpec, specContext, specChoices } = require("../../services/roster/memberSpec");
const { kaderChoices } = require("../../services/roster/rosterCreate");
const { rosterLootSystem } = require("../../services/loot/lootSystem");

const STATUSES = rosterStore.STATUSES;
/** Statuses that take a place in the roster. */
const PLACE_STATUSES = new Set(["core", "trial"]);
const DEFAULT_ICON = "achievement_guildperk_everybodysfriend";

/** fn(), or `fallback` when it throws: every lookup here is best-effort. */
function attempt(fn, fallback) {
    try {
        return fn();
    } catch {
        return fallback;
    }
}

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/** "tank" | "healer" | "dps" from a rule set's spec role ("melee"/"ranged" are damage). */
function roleOfSpecRole(role) {
    if (role === "tank" || role === "healer") return role;
    return role ? "dps" : "";
}

function classColor(className) {
    const cls = CLASSES.find((c) => c.id === className);
    return (cls && cls.color) || CLASS_COLORS[className] || "";
}

/** "forever~aldric sturmwind" -> "Aldric Sturmwind": the last resort for a key nobody names. */
function nameFromKey(key) {
    return nameKeyOf(key).split(" ").filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** A game version's short label ("TBC", "Forever"). */
function versionLabel(versionId) {
    const rules = rulesFor(versionId);
    return rules ? rules.short || rules.label || versionId : versionId;
}

/**
 * The server's members and roles, best-effort. `members` is null when the list
 * is not available (bot offline, intent missing) - then nobody's roles are known.
 */
async function loadDiscord(guildId) {
    let members = null;
    let roles = new Map();
    if (!guildId) return { members, roles };
    try {
        const listed = await discord.listHumanMembers(guildId);
        if (listed && !listed.error) members = new Map((listed.members || []).map((m) => [String(m.id), m]));
    } catch {
        members = null;
    }
    try {
        roles = new Map((discord.listRoles(guildId) || []).map((r) => [String(r.id), r]));
    } catch {
        roles = new Map();
    }
    return { members, roles };
}

/** A role as the page shows it; a role Discord does not list (any more) keeps its id. */
function roleView(roles, roleId) {
    if (!roleId) return null;
    const r = roles.get(String(roleId));
    return { id: String(roleId), name: (r && r.name) || "", color: (r && r.color) || "" };
}

/**
 * One roster character with what the page shows: name, class, spec, colour,
 * icon and role. The profile of the roster's version first, then the
 * character cache (loot/logs), then the name the roster stored.
 */
function characterView(key, member, profile, versionId, ctx) {
    const pc = profile ? (profiles.findCharacter(profile, key, versionId) || profiles.findCharacter(profile, key)) : null;
    const cached = attempt(() => characterStore.getCharacter(nameKeyOf(key)), null);
    const name = str(member.charNames && member.charNames[key]) || (pc && pc.name) || (cached && cached.character) || nameFromKey(key);
    const className = (pc && pc.className) || (cached && cached.className) || "";
    const specKey = pc && pc.specs && pc.specs[0] ? pc.specs[0].key : "";
    const info = specKey ? profiles.specInfo(specKey) : null;
    const cachedSpec = !info && cached ? str(cached.spec) : "";
    const logRole = (ctx && ctx.roleByKey[characterKeyOf(name)]) || "";
    const role = logRole || (info ? roleOfSpecRole(info.role) : roleFromSpec(className, cachedSpec));
    return {
        key,
        name,
        className,
        classColor: classColor(className),
        spec: info ? info.key : cachedSpec,
        specId: info ? info.id : cachedSpec,
        specLabel: info ? info.label : cachedSpec,
        specIcon: info ? info.icon || "" : "",
        iconUrl: !info && className ? classSpecIconUrl(className, cachedSpec) : "",
        role,
    };
}

/** A spec key as the page shows it: `{ spec, specLabel, specIcon }` ("" each for none). */
function specLook(specKey) {
    const info = specKey ? profiles.specInfo(specKey) : null;
    return info ? { spec: info.key, specLabel: info.label, specIcon: info.icon || "" } : { spec: "", specLabel: "", specIcon: "" };
}

/** The first character with the chain's class, spec and role (memberSpec.js), so table and Komposition agree. */
function withResolvedSpec(char, resolved) {
    const className = char.className || resolved.className;
    const out = { ...char, className, classColor: char.classColor || classColor(className), role: resolved.role };
    if (!resolved.spec) return out;
    const info = profiles.specInfo(resolved.spec);
    return { ...out, spec: info.key, specId: info.id, specLabel: info.label, specIcon: info.icon || "", iconUrl: "" };
}

/** What a row says about the chain: the result, where it came from, the orga's choice and what the chain finds without it. */
function resolvedView(resolved) {
    return {
        className: resolved.className,
        ...specLook(resolved.spec),
        role: resolved.role,
        source: resolved.source,
        reason: resolved.reason,
        override: resolved.override,
        auto: { className: resolved.auto.className, ...specLook(resolved.auto.spec), source: resolved.auto.source },
    };
}

/** The profile characters of the version the member does not play in this roster yet, as character views. */
function otherCharacters(member, profile, versionId, ctx) {
    if (!profile) return [];
    return profiles.charactersOfVersion(profile, versionId)
        .filter((c) => !member.chars.includes(c.key))
        .map((c) => characterView(c.key, { charNames: {} }, profile, versionId, ctx));
}

/** The characters attendance is counted with: the roster's, then every profile character of the version. */
function attendanceChars(chars, profile, versionId) {
    const out = chars.map((c) => ({ name: c.name, className: c.className, manual: true }));
    for (const c of profile ? profiles.charactersOfVersion(profile, versionId) : []) {
        if (!out.some((o) => o.name.toLowerCase() === String(c.name).toLowerCase())) out.push({ name: c.name, className: c.className, manual: true });
    }
    return out;
}

/**
 * Attendance of the shape the roster's AttendanceBar reads, from attendanceForAccounts with `nights`:
 * `present` = the nights that count (status present or bench, #677), `missed` the others (a neutral "tentative" too) - each with
 * its status code, detail and the orga's override when there is one.
 */
function attendanceView(result) {
    if (!result) return null;
    return {
        attended: result.attended,
        total: result.total,
        pct: result.pct,
        link: result.link,
        // every night not attended - a "maybe" the setup left out (status tentative) rides along so the grid shows it;
        // the quota above already leaves it out
        missed: result.raids ? result.raids.filter((r) => !r.attended).map(({ attended: _a, ...night }) => night) : result.missed,
        present: (result.raids || []).filter((r) => r.attended).map(({ attended: _a, reason: _r, ...night }) => night),
    };
}

/** One attendance context per game version, built on first use. */
function contextCache(guildId) {
    const cache = new Map();
    return (versionId) => {
        if (!cache.has(versionId)) {
            let ctx;
            try {
                ctx = buildAttendanceContext(guildId, { versionId });
            } catch {
                ctx = { raidsByCategory: new Map(), allRaidsByCategory: new Map(), roleByKey: {} };
            }
            cache.set(versionId, ctx);
        }
        return cache.get(versionId);
    };
}

/**
 * Every member of a roster as a row: identity, status, characters, role,
 * whether the Discord role is there and the attendance per person.
 */
function memberRows(roster, { ctx, discordData, config, manage = false }) {
    const { members: discordMembers } = discordData;
    const roleIds = roster.roleIds || [];
    const rosterRoleIds = [...roleIds, roster.trialRoleId].filter(Boolean);
    const sctx = attempt(() => specContext(roster, ctx), { versionId: roster.versionId, signups: new Map(), charMap: {}, roleByKey: {} });
    const rows = Object.entries(roster.members).map(([userId, member]) => {
        const profile = profiles.getProfile(userId);
        const dm = discordMembers ? discordMembers.get(userId) : null;
        const chars = member.chars.map((key) => characterView(key, member, profile, roster.versionId, ctx));
        const resolved = resolveMemberSpec(userId, member, sctx);
        if (chars[0]) chars[0] = withResolvedSpec(chars[0], resolved);
        let hasRole = null;
        if (discordMembers && roleIds.length) hasRole = !!dm && (dm.roleIds || []).some((id) => roleIds.includes(String(id)));
        const held = dm ? (dm.roleIds || []).map(String) : [];
        const extra = manage ? {
            note: member.note || "",
            otherChars: otherCharacters(member, profile, roster.versionId, ctx),
            specChoices: specChoices(resolved.auto.className || resolved.className, roster.versionId),
        } : {};
        return {
            userId,
            displayName: str(dm && dm.displayName) || str(profile && profile.name) || (chars[0] && chars[0].name) || userId,
            avatarUrl: (dm && dm.avatarUrl) || "",
            onServer: discordMembers ? !!dm : null,
            status: member.status,
            since: member.since || "",
            trialUntil: member.trialUntil || null,
            chars,
            role: resolved.role,
            resolved: resolvedView(resolved),
            hasRole,
            // the roster's roles this person holds (main, others, trial); null when the member list is unavailable
            heldRoles: discordMembers ? rosterRoleIds.filter((id) => held.includes(id)) : null,
            attendance: null,
            ...extra,
            _attendanceChars: attendanceChars(chars, profile, roster.versionId),
        };
    });
    if (roster.categoryId) {
        const window = categoryAttendanceFor(config, roster.categoryId).window;
        const accounts = rows.map((r) => ({ userId: r.userId, chars: r._attendanceChars }));
        const results = attempt(() => attendanceForAccounts(ctx, roster.categoryId, accounts, { nights: true, window }), new Map());
        for (const r of rows) r.attendance = attendanceView(results.get(r.userId));
    }
    for (const r of rows) delete r._attendanceChars;
    return rows.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** The figures a card and the roster's head share. */
function rosterFigures(rows) {
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    const roleCounts = { tank: 0, healer: 0, dps: 0, unknown: 0 };
    let withoutChar = 0;
    let withoutRole = 0;
    let roleKnown = false;
    const pcts = [];
    for (const r of rows) {
        counts[r.status] = (counts[r.status] || 0) + 1;
        if (PLACE_STATUSES.has(r.status)) {
            if (r.role === "tank" || r.role === "healer" || r.role === "dps") roleCounts[r.role] += 1;
            else roleCounts.unknown += 1;
        }
        if (!r.chars.length) withoutChar += 1;
        if (r.hasRole !== null) roleKnown = true;
        if (r.hasRole === false) withoutRole += 1;
        if (r.status !== "pause" && r.attendance && r.attendance.pct !== null) pcts.push(r.attendance.pct);
    }
    return {
        counts,
        members: rows.length,
        places: counts.core + counts.trial,
        roleCounts,
        attendance: pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null,
        attendanceCounted: pcts.length,
        todo: { withoutRole: roleKnown ? withoutRole : null, withoutChar, trial: counts.trial },
    };
}

/** The name of every known category of the server, and the names its stored events carry as fallback. */
function categoryNames(guildId) {
    const names = new Map();
    try {
        for (const c of listKnownCategories(guildId)) if (c.name) names.set(c.id, c.name);
    } catch {
        // names stay ids
    }
    return names;
}

function eventCategoryName(guildId, categoryId) {
    try {
        const ev = listStoredEvents(guildId).find((e) => e && String(e.categoryId) === categoryId && str(e.categoryName));
        return ev ? str(ev.categoryName) : "";
    } catch {
        return "";
    }
}

/** The head of a roster: what the card and the roster page show above the members. */
function rosterHead(roster, { ctx, names, discordData, figures, guildId }) {
    const info = roster.categoryId ? categoryInfo(ctx, roster.categoryId) : { raids: 0, contents: [], icon: "" };
    return {
        id: roster.id,
        name: roster.name,
        categoryId: roster.categoryId,
        categoryName: roster.categoryId ? names.get(roster.categoryId) || eventCategoryName(guildId, roster.categoryId) || "" : "",
        versionId: roster.versionId,
        versionLabel: versionLabel(roster.versionId),
        contents: info.contents,
        raids: info.raids,
        icon: info.icon || DEFAULT_ICON,
        mainRole: roleView(discordData.roles, roster.roleIds[0]),
        trialRole: roleView(discordData.roles, roster.trialRoleId),
        discordRoles: roster.roleIds.map((id) => roleView(discordData.roles, id)),
        slots: { ...roster.slots },
        allowMultipleChars: roster.allowMultipleChars,
        source: roster.source.kind,
        kaderId: roster.kaderId || null,
        ...figures,
    };
}

/**
 * What the settings dialog starts from (managers and admins only): the stored
 * fields a head does not carry, the manager accounts with their names.
 */
function rosterSettingsView(roster, discordData, config = {}) {
    const nameOf = (userId) => {
        const dm = discordData.members ? discordData.members.get(userId) : null;
        const p = profiles.getProfile(userId);
        return str(dm && dm.displayName) || str(p && p.name) || userId;
    };
    return {
        categoryId: roster.categoryId,
        versionId: roster.versionId,
        roleIds: [...roster.roleIds],
        trialRoleId: roster.trialRoleId,
        managers: {
            roleIds: [...roster.managers.roleIds],
            userIds: [...roster.managers.userIds],
            users: roster.managers.userIds.map((userId) => ({ userId, displayName: nameOf(userId) })),
        },
        signupOnly: roster.signupOnly,
        allowMultipleChars: roster.allowMultipleChars,
        slots: { ...roster.slots },
        kaderId: roster.kaderId || null,
        // #676: what the roster runs on (with a category: the category's system) and its council profile ("" = default)
        lootSystem: rosterLootSystem(config, roster).system,
        lootSystemSource: rosterLootSystem(config, roster).source,
        lootProfileId: roster.lootProfileId || "",
    };
}

/** The linked Kader's id and name (names only, rosterCreate.kaderChoices); a link to a Kader that is gone keeps its id with name "". */
function linkedKader(roster) {
    if (!roster.kaderId) return null;
    const hit = attempt(() => kaderChoices(roster.guildId), []).find((k) => k.id === roster.kaderId);
    return { id: roster.kaderId, name: hit ? hit.name : "" };
}

/**
 * GET /api/rosters: one card per roster of the server, the raid categories
 * without a roster, and whether the caller may create one (full admins).
 * @param {{ guildId: string, user: object, config: object }} opts
 */
async function buildRosterOverview({ guildId = "", user = null, config = {} } = {}) {
    const discordData = await loadDiscord(guildId);
    const names = categoryNames(guildId);
    const ctxFor = contextCache(guildId);
    const list = rosterStore.listRosters(guildId);
    const rosters = list.map((roster) => {
        const ctx = ctxFor(roster.versionId);
        const rows = memberRows(roster, { ctx, discordData, config });
        const head = rosterHead(roster, { ctx, names, discordData, figures: rosterFigures(rows), guildId });
        // trials ending within a week or overdue (#658): the managers' hint
        const nameOf = new Map(rows.map((r) => [r.userId, r.displayName]));
        return { ...head, trialEnding: trialEnding(roster, { nameOf: (id) => nameOf.get(id) || id }) };
    });
    const taken = new Set(list.map((r) => r.categoryId).filter(Boolean));
    const categoriesWithoutRoster = (Array.isArray(config.categoryIds) ? config.categoryIds : [])
        .map(str)
        .filter((id, i, all) => id && all.indexOf(id) === i && !taken.has(id))
        // a category another server knows stays on that server's page
        .filter((id) => !names.size || names.has(id))
        .map((id) => {
            const versionId = mainVersionFor({ categoryId: id, config });
            return { id, name: names.get(id) || eventCategoryName(guildId, id) || id, versionId, versionLabel: versionLabel(versionId) };
        });
    return { rosters, categoriesWithoutRoster, canCreate: !!(user && user.isAdmin === true) };
}

/**
 * GET /api/rosters/roster?id=: one roster with its members, or null when it
 * does not exist or belongs to another server.
 * @param {{ guildId: string, id: string, user: object, config: object }} opts
 */
async function buildRosterDetail({ guildId = "", id = "", user = null, config = {} } = {}) {
    const roster = rosterStore.getRoster(id);
    if (!roster || (guildId && roster.guildId && roster.guildId !== guildId)) return null;
    const discordData = await loadDiscord(roster.guildId || guildId);
    const ctx = contextCache(roster.guildId || guildId)(roster.versionId);
    const canManage = await canManageRosterLive(user, roster).catch(() => false);
    const members = memberRows(roster, { ctx, discordData, config, manage: canManage });
    const head = rosterHead(roster, {
        ctx, names: categoryNames(roster.guildId || guildId), discordData, figures: rosterFigures(members), guildId: roster.guildId || guildId,
    });
    const window = roster.categoryId ? categoryAttendanceFor(config, roster.categoryId).window : null;
    return {
        roster: { ...head, kader: linkedKader(roster) },
        members,
        window,
        // the attendance grid's columns (#677): the counted nights of the category, newest first
        nights: roster.categoryId ? attempt(() => categoryNights(ctx, roster.categoryId, { window }), []) : [],
        // set a night by hand: the roster's managers, admins and `raids` write (attendanceAccess.js)
        canEditAttendance: !!roster.categoryId && (canManage || canEditAnyAttendance(user)),
        membersKnown: !!discordData.members,
        canManage,
        isAdmin: !!(user && user.isAdmin === true),
        settings: canManage ? rosterSettingsView(roster, discordData, config) : null,
    };
}

module.exports = { buildRosterOverview, buildRosterDetail, rosterFigures, characterView, PLACE_STATUSES };
