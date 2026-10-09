// Creating a raid roster (#657, docs/roster-profile.md "Roster anlegen und
// einstellen"): the settings (rosterSettings.cleanSettings), then the first
// members from one source:
//
//   "role"   everyone holding one of roleIds right now -> core, the first
//            profile character of the roster's version. No role is given -
//            they hold it already.
//   "kader"  a Kader of the Kaderplaner (createRosterFromKader): state roster
//            -> core, bench -> bench, tentative -> trial; the character is the
//            planner's active one when the profile has it in the roster's
//            version (its key), else that name kept as typed; without one a
//            profile character of the decided class, else the profile's first.
//            Only { userId, state, decision, characterName } ever comes over
//            (services/kader/kaderRoster.js) - wishes, answers, notes, votes and
//            comments stay in the Kaderplaner.
//   "raids"  every account present at least once in the category's last
//            RAIDS_BACK counted raid nights (attendance context of the roster's
//            version): one of their profile characters in the night's log, or -
//            for a night without log - signed up (signed / late).
//   "none"   nobody.
//
// Members from "kader" and "raids" are being taken in, so they get the main
// role (and the trial role for trial) through rosterMembers.addMember; the
// role failures come back in `initial.roleFailures`. Note: rosterRoleSync's
// reconcile adds every holder of the roster's roles within ten minutes anyway
// (the decision of #659, "Rolle im Discord bekommen = im Roster").
//
// Creating is for full admins - the route checks that, not this module.
//
// Later (#658, the Kaderplaner's "Ins Roster übernehmen"): syncRosterFromKader
// takes the Kader's players of those three states who are no member yet into
// the roster LINKED to the Kader (`roster.kaderId`, 1:1 - a roster created from
// a Kader starts linked, any other roster can be linked later, e.g. a migrated
// one: linkRosterToKader), the same way; members already in it stay exactly as
// they are - status, characters, note. Who may do it (area `kader` write plus
// manager of that roster) is the route's business.
const rosterStore = require("../../stores/rosterStore");
const raiderProfileStore = require("../../stores/raiderProfileStore");
const discord = require("../discord/discord");
const { listKnownCategories } = require("../discord/categoryNames");
const { mainVersionFor, knownVersion } = require("../events/mainVersion");
const { buildAttendanceContext } = require("../characters/rosterAttendance");
const { nameKeyOf } = require("../../utils/loot/lootImport");
const { rosterPlayers, kaderSummaries } = require("../kader/kaderRoster");
const { cleanSettings } = require("./rosterSettings");
const { mirrorCategoryRoles } = require("./categoryRoles");
const rosterMembers = require("./rosterMembers");

const SOURCES = ["role", "kader", "raids", "none"];
const RAIDS_BACK = 4;
const STATUS_OF_KADER_STATE = { roster: "core", bench: "bench", tentative: "trial" };
const PRESENT = ["signed", "late"];
// The Kaderplaner plans for WoW Forever (web/kader/kaderSource.plannerVersion): a roster from a Kader
// without a category plays that version when the rule set exists (#658); a category's version wins.
const KADER_VERSION = "forever";

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const isMap = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** The name Discord (or the snapshot) knows for a category, "" for none. */
function categoryName(guildId, categoryId) {
    if (!categoryId) return "";
    const hit = listKnownCategories(guildId).find((c) => c.id === categoryId);
    return hit ? hit.name : "";
}

/** The Kader of a server for the create dialog (counts only, kaderRoster.kaderSummaries). */
function kaderChoices(guildId) {
    return kaderSummaries(guildId);
}

/**
 * The character a Kader player joins with, as rosterMembers takes it:
 * `[name or key]`, or undefined for "the profile's first".
 */
function kaderCharacter(player, versionId) {
    if (player.characterName) return [player.characterName];
    if (player.decision && player.decision.className) {
        const profile = raiderProfileStore.getProfile(player.userId);
        const hit = raiderProfileStore.charactersOfVersion(profile, versionId).find((c) => c.className === player.decision.className);
        if (hit) return [hit.key];
    }
    return undefined;
}

/** The accounts present in the category's last RAIDS_BACK counted nights (see the head comment). */
function presentInRaids(guildId, categoryId, versionId, { ctx } = {}) {
    const context = ctx || buildAttendanceContext(guildId, { versionId });
    const nights = ((context.allRaidsByCategory || context.raidsByCategory).get(categoryId) || []).slice(0, RAIDS_BACK);
    const owners = new Map();
    for (const profile of raiderProfileStore.listProfiles()) {
        for (const c of raiderProfileStore.charactersOfVersion(profile, versionId)) {
            const key = nameKeyOf(c.key);
            if (key && !owners.has(key)) owners.set(key, profile.userId);
        }
    }
    const present = new Set();
    for (const night of nights) {
        if (night.logs && night.logs.length) {
            for (const rep of night.logs) for (const key of rep.keys) if (owners.has(key)) present.add(owners.get(key));
            continue;
        }
        for (const s of night.signUps || []) {
            if (s && s.userId && PRESENT.includes(String(s.status || "signed"))) present.add(String(s.userId));
        }
    }
    return [...present].filter((id) => /^\d{5,25}$/.test(id));
}

/** Everyone holding one of the roster's roles: `{ userIds }` or `{ error }` ("offline", "members_unavailable"). */
async function roleHolders(roster) {
    if (!roster.guildId || !discord.isOnline() || !discord.getGuild(roster.guildId)) return { error: "offline" };
    const { members, error } = await discord.listMembersWithRoles(roster.guildId, roster.roleIds);
    if (error) return { error: "members_unavailable" };
    return { userIds: members.map((m) => String(m.id)) };
}

/** Take members in through rosterMembers (store, then roles); collects what failed. */
async function takeIn(roster, entries, actor, initial) {
    for (const { userId, patch } of entries) {
        const res = await rosterMembers.addMember(roster.id, userId, patch, { actor });
        if (!res.ok) {
            initial.skipped += 1;
            continue;
        }
        initial.added += 1;
        for (const r of (res.roles && res.roles.results) || []) {
            if (!r.ok) initial.roleFailures.push({ userId, roleId: r.roleId, code: r.code });
        }
    }
}

/** Store the role holders as core members without touching their roles. */
function addHolders(roster, userIds, actor, initial) {
    for (const userId of userIds) {
        if (rosterStore.getRoster(roster.id).members[userId]) continue;
        try {
            rosterStore.upsertMember(roster.id, userId, { status: "core", ...rosterMembers.defaultChars(roster, userId) }, { actor });
            initial.added += 1;
        } catch (e) {
            if (!(e && e.name === "RosterError")) throw e;
            initial.skipped += 1;
        }
    }
}

/** The input checked: `{ data, source, kader }` for rosterStore.createRoster, or `{ code }`. */
function prepare(input, { guildId, config, knownRoleIds }) {
    const raw = isMap(input) ? { ...input } : {};
    if (raw.versionId === "" || raw.versionId === null) delete raw.versionId;
    if (raw.name === undefined || raw.name === null) raw.name = "";
    const source = raw.source === undefined || raw.source === "" ? "none" : raw.source;
    if (!SOURCES.includes(source)) return { code: "invalid_source" };
    const clean = cleanSettings(raw, { knownRoleIds });
    if (clean.code) return clean;
    const fields = clean.fields;
    const categoryId = fields.categoryId || null;
    if (categoryId && rosterStore.rosterForCategory(categoryId)) return { code: "category_taken" };
    if (source === "role" && !(fields.roleIds || []).length) return { code: "no_role" };
    if (source === "raids" && !categoryId) return { code: "no_category" };
    let kader = null;
    if (source === "kader") {
        kader = rosterPlayers(guildId, str(raw.kaderId));
        if (!kader) return { code: "kader_not_found" };
    }
    const name = fields.name || categoryName(guildId, categoryId) || (kader ? kader.name : "");
    if (!name) return { code: "invalid_name" };
    const data = {
        ...fields,
        guildId,
        name: name.slice(0, rosterStore.LIMITS.name),
        categoryId,
        versionId: fields.versionId || (kader && !categoryId && knownVersion(KADER_VERSION)) || mainVersionFor({ categoryId: categoryId || "", config }),
        source: kader ? { kind: "kader", kaderId: kader.id } : { kind: "manual" },
    };
    return { data, source, kader };
}

/**
 * Create a roster and fill it from its source (head comment).
 * @param {object} input  name, categoryId, versionId, roleIds, trialRoleId, managers, slots,
 *   allowMultipleChars, signupOnly, source ("role" | "kader" | "raids" | "none"), kaderId
 * @param {{ guildId: string, actor?: string, config?: object, knownRoleIds?: Set<string>|null, ctx?: object }} opts
 * @returns {Promise<{ ok: true, roster: object, initial: { source, added, skipped, roleFailures, error } } | { ok: false, code: string }>}
 */
async function createRosterWithSource(input, { guildId = "", actor = "", config, knownRoleIds = null, ctx } = {}) {
    const prepared = prepare(input, { guildId: str(guildId), config, knownRoleIds });
    if (prepared.code) return { ok: false, code: prepared.code };
    let roster;
    try {
        roster = rosterStore.createRoster(prepared.data, { actor });
    } catch (e) {
        if (e && e.name === "RosterError") return { ok: false, code: e.code };
        throw e;
    }
    mirrorCategoryRoles(roster);
    const initial = { source: prepared.source, added: 0, skipped: 0, roleFailures: [], error: null };
    if (prepared.source === "role") {
        const holders = await roleHolders(roster);
        if (holders.error) initial.error = holders.error;
        else addHolders(roster, holders.userIds, actor, initial);
    } else if (prepared.source === "kader") {
        const entries = prepared.kader.players.map((p) => ({
            userId: p.userId,
            patch: { status: STATUS_OF_KADER_STATE[p.state], chars: kaderCharacter(p, roster.versionId) },
        }));
        await takeIn(roster, entries, actor, initial);
    } else if (prepared.source === "raids") {
        const userIds = presentInRaids(roster.guildId, roster.categoryId, roster.versionId, { ctx });
        await takeIn(roster, userIds.map((userId) => ({ userId, patch: { status: "core" } })), actor, initial);
    }
    return { ok: true, roster: rosterStore.getRoster(roster.id), initial };
}

/** The roster linked to a Kader (`roster.kaderId`) on that server, or null. */
function rosterOfKader(guildId, kaderId) {
    return rosterStore.rosterForKader(str(kaderId), str(guildId));
}

/** Whether the server's planner has this Kader (names only, through kaderRoster.js). */
function kaderExists(guildId, kaderId) {
    const id = str(kaderId);
    return !!id && kaderSummaries(str(guildId)).some((k) => k.id === id);
}

/**
 * The rosters of the server a Kader can be linked to, for the Kaderplaner's
 * "Mit bestehendem Roster verknüpfen": `[{ id, name, categoryId, members,
 * linkedKaderId, suggested }]` - `suggested` = its category is one the Kader
 * counts attendance in (`attendanceCategories`) and no other Kader holds it;
 * suggested first.
 */
function kaderLinkChoices(guildId, kaderId) {
    const id = str(kaderId);
    const kader = kaderSummaries(str(guildId)).find((k) => k.id === id);
    const cats = new Set((kader && kader.attendanceCategories) || []);
    return rosterStore.listRosters(str(guildId))
        .map((r) => ({
            id: r.id,
            name: r.name,
            categoryId: r.categoryId,
            members: Object.keys(r.members).length,
            linkedKaderId: r.kaderId && r.kaderId !== id ? r.kaderId : null,
            suggested: !!r.categoryId && cats.has(r.categoryId) && (!r.kaderId || r.kaderId === id),
        }))
        .sort((a, b) => Number(b.suggested) - Number(a.suggested) || a.name.localeCompare(b.name));
}

/**
 * Link a Kader to an existing roster of the server, or unlink it (`rosterId`
 * ""): the Kader's previous roster is unlinked first, then the new one takes
 * `kaderId` (a history line on both). Nothing of the Kader is copied.
 * @returns {{ ok: true, roster: object|null } | { ok: false, code: string }}
 *   codes: "kader_not_found", "not_found" (no such roster on that server), "kader_taken"
 */
function linkRosterToKader(kaderId, rosterId, { guildId = "", actor = "" } = {}) {
    const id = str(kaderId);
    if (!kaderExists(guildId, id)) return { ok: false, code: "kader_not_found" };
    const target = str(rosterId) ? rosterStore.getRoster(str(rosterId)) : null;
    if (str(rosterId) && (!target || (str(guildId) && target.guildId !== str(guildId)))) return { ok: false, code: "not_found" };
    if (target && target.kaderId && target.kaderId !== id) return { ok: false, code: "kader_taken" };
    const previous = rosterOfKader(guildId, id);
    try {
        if (previous && (!target || previous.id !== target.id)) rosterStore.updateRoster(previous.id, { kaderId: null }, { actor });
        if (target && target.kaderId !== id) rosterStore.updateRoster(target.id, { kaderId: id }, { actor });
    } catch (e) {
        if (e && e.name === "RosterError") return { ok: false, code: e.code };
        throw e;
    }
    return { ok: true, roster: target ? rosterStore.getRoster(target.id) : null };
}

/** The Kader's players a roster takes (kaderRoster.rosterPlayers) who are no member of `roster` yet. */
function pendingPlayers(roster, kader) {
    return kader.players.filter((p) => !roster.members[p.userId]);
}

/**
 * What the Kaderplaner's roster button needs for one Kader (counts only):
 * `{ roster: { id, name, members } | null, candidates, pending }` -
 * `candidates` = players in roster / bench / tentative, `pending` = those of
 * them not in the roster yet (all of them while there is no roster). Null for
 * an unknown Kader.
 */
function kaderRosterState(guildId, kaderId) {
    const kader = rosterPlayers(str(guildId), str(kaderId));
    if (!kader) return null;
    const roster = rosterOfKader(guildId, kader.id);
    return {
        roster: roster ? { id: roster.id, name: roster.name, members: Object.keys(roster.members).length } : null,
        candidates: kader.players.length,
        pending: roster ? pendingPlayers(roster, kader).length : kader.players.length,
    };
}

/**
 * "Ins Roster übernehmen" (#658): the Kader's players in roster / bench /
 * tentative who are not in the roster yet are taken in like createRosterFromKader
 * does it (status by state, the character, the main role through
 * rosterMembers.addMember); members already in the roster are left untouched.
 * @param {string} kaderId
 * @param {{ guildId?: string, actor?: string, rosterId?: string }} [opts]  `rosterId` defaults to the roster linked to the Kader
 * @returns {Promise<{ ok: true, roster: object, added: number, skipped: number, kept: number, roleFailures: object[] } | { ok: false, code: string }>}
 *   codes: "not_found" (no roster for that Kader), "not_from_kader" (the roster is not linked to it), "kader_not_found"
 */
async function syncRosterFromKader(kaderId, { guildId = "", actor = "", rosterId = "" } = {}) {
    const roster = rosterId ? rosterStore.getRoster(str(rosterId)) : rosterOfKader(guildId, kaderId);
    if (!roster) return { ok: false, code: "not_found" };
    if (roster.kaderId !== str(kaderId)) return { ok: false, code: "not_from_kader" };
    const kader = rosterPlayers(roster.guildId || str(guildId), str(kaderId));
    if (!kader) return { ok: false, code: "kader_not_found" };
    const pending = pendingPlayers(roster, kader);
    const result = { added: 0, skipped: 0, roleFailures: [] };
    const entries = pending.map((p) => ({
        userId: p.userId,
        patch: { status: STATUS_OF_KADER_STATE[p.state], chars: kaderCharacter(p, roster.versionId) },
    }));
    await takeIn(roster, entries, actor, result);
    return { ok: true, roster: rosterStore.getRoster(roster.id), ...result, kept: kader.players.length - pending.length };
}

/**
 * A roster from a Kader (#657; #658 puts a button for it into the Kaderplaner):
 * the same as createRosterWithSource with source "kader".
 * @param {string} kaderId
 * @param {object} [opts]  the settings fields of createRosterWithSource plus guildId, actor, config, knownRoleIds
 */
function createRosterFromKader(kaderId, opts = {}) {
    const { guildId, actor, config, knownRoleIds, ...fields } = isMap(opts) ? opts : {};
    return createRosterWithSource({ ...fields, source: "kader", kaderId }, { guildId, actor, config, knownRoleIds });
}

module.exports = {
    createRosterWithSource, createRosterFromKader, kaderChoices, presentInRaids, kaderCharacter, categoryName,
    rosterOfKader, kaderRosterState, syncRosterFromKader, kaderExists, kaderLinkChoices, linkRosterToKader,
    SOURCES, RAIDS_BACK, STATUS_OF_KADER_STATE,
};
