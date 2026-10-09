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
const rosterStore = require("../../stores/rosterStore");
const raiderProfileStore = require("../../stores/raiderProfileStore");
const discord = require("../discord/discord");
const { listKnownCategories } = require("../discord/categoryNames");
const { mainVersionFor } = require("../events/mainVersion");
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
        versionId: fields.versionId || mainVersionFor({ categoryId: categoryId || "", config }),
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
    SOURCES, RAIDS_BACK, STATUS_OF_KADER_STATE,
};
