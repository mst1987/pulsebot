// Roster and Discord role are one thing, both ways (#656, docs/roster-profile.md
// "Roster und Discord-Rollen").
//
// Tool -> Discord (applyMemberAdded / applyStatusChange / applyMemberRemoved,
// called by rosterMembers.js after the store write):
//   - taken into the roster       -> the main role (roleIds[0]); status trial also trialRoleId
//   - status to trial / away from -> trialRoleId given / taken
//   - removed from the roster     -> every role of the roster taken (roleIds + trialRoleId)
//   Each change writes a history line (role-given / role-taken, or
//   role-give-failed / role-take-failed with the reason code). Never throws.
//
// Discord -> Tool (onGuildMemberUpdate / onGuildMemberAdd, and reconcile()):
//   - gets any role of roster.roleIds -> member, status "core", the first
//     character of the roster's version from the raider profile, history "via Discord"
//   - loses all of them               -> no longer a member (history line stays)
//
// No loop: the tool always writes the store first and the role second. The
// gateway event of its own role write then finds the member already in (give)
// or already out (take) and does nothing. Status changes touch trialRoleId,
// which is not in roleIds, so they never reach the Discord side at all.
//
// The reconcile (at start and every 10 minutes, startRosterRoleSync) catches
// what the events missed. It is careful on purpose:
//   - a failed or empty member fetch changes nothing;
//   - it adds every holder of a roster role who is not a member, except one the
//     tool removed and could not take the role from (latest history line of
//     that user "role-take-failed") - that one waits in the Abgleich list;
//   - it removes only a member it SAW holding a role on its previous run who
//     holds none now. Members who never held the role (the start-up migration
//     made members from character assignments) stay and show up in the
//     Abgleich list "im Roster ohne Rolle". The first run after a start
//     therefore only adds; a changed roleIds list skips removals for one run;
//   - a role that no longer exists on the server is ignored, and a run that
//     would remove more than half of a roster's members (at least 5) removes
//     none of them and logs it instead;
//   - the member list is cached for a minute, so what the tool itself just
//     wrote (memberRoles.recentWrite) wins over the cached roles.
// Pause members are members like any other: they keep their role.
const rosterStore = require("../../stores/rosterStore");
const raiderProfileStore = require("../../stores/raiderProfileStore");
const memberRoles = require("../discord/memberRoles");
const discord = require("../discord/discord");
const logger = require("../../logger").child("rosterRoles");

const MASS_REMOVAL_SHARE = 0.5;
const MASS_REMOVAL_MIN = 5;

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/** The stored roster for an id or a roster object (fresh from the store when it still exists). */
function resolveRoster(rosterOrId) {
    if (rosterOrId && typeof rosterOrId === "object") return rosterStore.getRoster(rosterOrId.id) || rosterOrId;
    return rosterStore.getRoster(rosterOrId);
}

const roleLabel = (result) => (result.roleName ? `@${result.roleName}` : result.roleId);

/** The history line of one role write: success, failure, or none for "nothing to do". */
function logRoleResult(roster, userId, give, result, actor) {
    let what = "";
    let detail = roleLabel(result);
    if (result.changed) what = give ? "role-given" : "role-taken";
    else if (!result.ok && !(give === false && result.code === "not_member")) {
        what = give ? "role-give-failed" : "role-take-failed";
        detail = `${detail}: ${result.code}`;
    }
    if (what) rosterStore.appendHistory(roster.id, { by: actor, userId, what, detail });
}

/**
 * Give or take one role of a roster and write the history line. Never throws.
 * @returns {Promise<{ roleId, roleName, give, ok, code, changed }>}
 */
async function applyRoleChange(roster, userId, roleId, give, { actor = "" } = {}) {
    let result;
    try {
        result = give
            ? await memberRoles.giveRole(roster.guildId, userId, roleId)
            : await memberRoles.takeRole(roster.guildId, userId, roleId);
        logRoleResult(roster, userId, give, result, actor);
    } catch (e) {
        result = { ok: false, code: "failed", changed: false, roleId, roleName: "", error: e && e.message };
    }
    return { roleId: str(roleId), roleName: result.roleName || "", give, ok: !!result.ok, code: result.code, changed: !!result.changed };
}

/** Run a plan of role writes for one member: `{ ok, skipped?, results }`. Never throws. */
async function applyPlan(rosterOrId, userId, planOf, { actor = "" } = {}) {
    try {
        const roster = resolveRoster(rosterOrId);
        if (!roster) return { ok: false, skipped: "no_roster", results: [] };
        if (!roster.guildId) return { ok: true, skipped: "no_guild", results: [] };
        const plan = planOf(roster);
        if (!plan.length) return { ok: true, skipped: "no_roles", results: [] };
        const results = [];
        for (const step of plan) results.push(await applyRoleChange(roster, userId, step.roleId, step.give, { actor }));
        return { ok: results.every((r) => r.ok), results };
    } catch (e) {
        logger.warn("role plan failed:", e && e.message);
        return { ok: false, skipped: "error", results: [] };
    }
}

/** Taken into the roster: the main role, and trialRoleId for status trial. */
function applyMemberAdded(rosterOrId, userId, opts = {}) {
    return applyPlan(rosterOrId, userId, (roster) => {
        const plan = [];
        if (roster.roleIds[0]) plan.push({ roleId: roster.roleIds[0], give: true });
        const member = roster.members[str(userId)];
        if (member && member.status === "trial" && roster.trialRoleId) plan.push({ roleId: roster.trialRoleId, give: true });
        return plan;
    }, opts);
}

/** Status changed: to trial gives trialRoleId, away from trial takes it; everything else touches no role. */
function applyStatusChange(rosterOrId, userId, from, to, opts = {}) {
    return applyPlan(rosterOrId, userId, (roster) => {
        if (!roster.trialRoleId || from === to) return [];
        if (to === "trial") return [{ roleId: roster.trialRoleId, give: true }];
        if (from === "trial") return [{ roleId: roster.trialRoleId, give: false }];
        return [];
    }, opts);
}

/** Removed from the roster: every role of it goes (roleIds and trialRoleId). */
function applyMemberRemoved(rosterOrId, userId, opts = {}) {
    return applyPlan(rosterOrId, userId, (roster) => {
        const ids = [...new Set([...roster.roleIds, roster.trialRoleId].filter(Boolean))];
        return ids.map((roleId) => ({ roleId, give: false }));
    }, opts);
}

// ── Discord -> Tool ─────────────────────────────────────────────────────────

/** A member's role ids as a set; null when they cannot be known (a partial member). */
function memberRoleSet(member) {
    if (!member || member.partial || !member.roles || !member.roles.cache || typeof member.roles.cache.keys !== "function") return null;
    return new Set([...member.roles.cache.keys()].map(String));
}

/**
 * Whether the tool removed this user and could not take the role: the user's
 * latest history line before any re-add or removal is "role-take-failed".
 * Such a holder is not added back automatically - a person decides.
 */
function takeFailedPending(roster, userId) {
    const uid = str(userId);
    for (let i = roster.history.length - 1; i >= 0; i -= 1) {
        const line = roster.history[i];
        if (line.userId !== uid) continue;
        if (line.what === "role-take-failed") return true;
        if (line.what === "member-added" || line.what === "member-removed") return false;
    }
    return false;
}

/** Add a role holder as member "via Discord": core, the first character of the roster's version. */
function addFromDiscord(roster, userId) {
    const profile = raiderProfileStore.getProfile(userId);
    const first = raiderProfileStore.firstCharacter(profile, roster.versionId);
    const patch = { status: "core" };
    if (first && first.key) {
        patch.chars = [first.key];
        patch.charNames = { [first.key]: first.name };
    }
    try {
        return !!rosterStore.upsertMember(roster.id, userId, patch, { actor: "", via: "discord" });
    } catch (e) {
        logger.warn(`could not add ${userId} to roster ${roster.id}:`, e && (e.code || e.message));
        return false;
    }
}

function removeFromDiscord(roster, userId) {
    return rosterStore.removeMember(roster.id, userId, { actor: "", via: "discord" });
}

/** The rosters of a server that name at least one role. */
function rostersWithRoles(guildId) {
    const gid = str(guildId);
    return gid ? rosterStore.listRosters(gid).filter((r) => r.roleIds.length) : [];
}

// rosterId -> { sig, holders: Set<userId> } as the last reconcile saw them
const snapshots = new Map();

/**
 * guildMemberUpdate: a member whose roles changed. Adds them to every roster
 * one of whose roles they just gained, removes them from every roster whose
 * last role they just lost. With the old roles unknown (partial member) a
 * holder is added (unless pending, see takeFailedPending) but nobody removed.
 * @returns {{ rosterId, userId, action: "added"|"removed" }[]}  never throws
 */
function onGuildMemberUpdate(oldMember, newMember) {
    const changes = [];
    try {
        if (!newMember || !newMember.guild || (newMember.user && newMember.user.bot)) return changes;
        const rosters = rostersWithRoles(newMember.guild.id);
        if (!rosters.length) return changes;
        const uid = str(newMember.id);
        const after = memberRoleSet(newMember);
        if (!uid || !after) return changes;
        const before = memberRoleSet(oldMember);
        for (const roster of rosters) {
            const has = roster.roleIds.some((r) => after.has(r));
            const had = before ? roster.roleIds.some((r) => before.has(r)) : null;
            const gained = before ? roster.roleIds.some((r) => after.has(r) && !before.has(r)) : null;
            const isMember = !!roster.members[uid];
            if (has && !isMember && (gained === true || (gained === null && !takeFailedPending(roster, uid)))) {
                if (addFromDiscord(roster, uid)) changes.push({ rosterId: roster.id, userId: uid, action: "added" });
            } else if (!has && isMember && had === true) {
                if (removeFromDiscord(roster, uid)) changes.push({ rosterId: roster.id, userId: uid, action: "removed" });
            }
            const snap = snapshots.get(roster.id);
            if (snap && snap.sig === roster.roleIds.join(",")) {
                if (has) snap.holders.add(uid);
                else snap.holders.delete(uid);
            }
        }
        for (const c of changes) logger.info(`${c.userId} ${c.action} (roster ${c.rosterId}, via Discord)`);
    } catch (e) {
        logger.warn("guildMemberUpdate failed:", e && e.message);
    }
    return changes;
}

/** guildMemberAdd: a new member arrives with no roles before - every roster role they bring counts as gained. */
function onGuildMemberAdd(member) {
    return onGuildMemberUpdate({ roles: { cache: new Map() } }, member);
}

const running = new Set();
const lastRuns = new Map();

/**
 * One roster against the member list: `roleExists(roleId)`, `holds(member, roleId)`
 * as the reconcile defines them; counts into `out`.
 */
function reconcileRoster(rosterId, humans, { roleExists, holds }, out) {
    const roster = rosterStore.getRoster(rosterId);
    if (!roster || !roster.roleIds.length) return;
    const roleIds = roster.roleIds.filter(roleExists);
    if (!roleIds.length) return; // every role of it deleted on the server: leave the roster alone
    const sig = roster.roleIds.join(",");
    const holders = new Set(humans.filter((m) => roleIds.some((r) => holds(m, r))).map((m) => String(m.id)));
    for (const uid of holders) {
        if (roster.members[uid] || takeFailedPending(roster, uid)) continue;
        if (addFromDiscord(roster, uid)) out.added += 1;
    }
    const prev = snapshots.get(roster.id);
    if (prev && prev.sig === sig) {
        const lost = Object.keys(roster.members).filter((uid) => prev.holders.has(uid) && !holders.has(uid));
        const memberCount = Object.keys(roster.members).length;
        if (lost.length >= MASS_REMOVAL_MIN && lost.length > memberCount * MASS_REMOVAL_SHARE) {
            out.held.push({ rosterId: roster.id, count: lost.length });
            logger.warn(`roster ${roster.id}: ${lost.length} members lost their role at once - not removed, see the Abgleich list`);
        } else {
            for (const uid of lost) if (removeFromDiscord(roster, uid)) out.removed += 1;
        }
    }
    snapshots.set(roster.id, { sig, holders });
}

/**
 * Compare every roster of a server with the holders of its roles and add or
 * remove members (rules in the head comment). Idempotent; never throws.
 * @returns {Promise<{ guildId, at, added, removed, held, skipped?, error? }>}
 */
async function reconcile(guildId, { now = Date.now() } = {}) {
    const gid = str(guildId);
    const out = { guildId: gid, at: now, added: 0, removed: 0, held: [], skipped: "", error: null };
    const finish = () => {
        lastRuns.set(gid, out);
        return out;
    };
    if (!gid || running.has(gid)) return { ...out, skipped: gid ? "running" : "no_guild" };
    const rosters = rostersWithRoles(gid);
    if (!rosters.length) return { ...out, skipped: "no_rosters" };
    const guild = discord.isOnline() ? discord.getGuild(gid) : null;
    if (!guild) { out.skipped = "offline"; return finish(); }
    running.add(gid);
    try {
        let list;
        try {
            // a fresh list: the reconcile adds and removes members from it
            list = await discord.fetchGuildMembersCached(gid, guild, { fresh: true });
        } catch (e) {
            out.error = (e && e.message) || "members_unavailable";
            return finish();
        }
        if (!Array.isArray(list) || !list.length) { out.skipped = "no_members"; return finish(); }
        const humans = list.filter((m) => m && m.id && !(m.user && m.user.bot) && m.roles && m.roles.cache);
        const roleExists = (roleId) => !guild.roles || !guild.roles.cache || guild.roles.cache.has(roleId);
        const holds = (m, roleId) => {
            const recent = memberRoles.recentWrite(gid, m.id, roleId, now);
            return recent !== undefined ? recent : m.roles.cache.has(roleId);
        };
        for (const listed of rosters) reconcileRoster(listed.id, humans, { roleExists, holds }, out);
        if (out.added || out.removed) logger.info(`reconcile ${gid}: ${out.added} added, ${out.removed} removed`);
    } catch (e) {
        out.error = (e && e.message) || String(e);
    } finally {
        running.delete(gid);
    }
    return finish();
}

/** Every server that has a roster with roles, reconciled one after the other. */
async function reconcileAll(opts = {}) {
    const guilds = [...new Set(rosterStore.listRosters("").filter((r) => r.guildId && r.roleIds.length).map((r) => r.guildId))];
    const results = [];
    for (const gid of guilds) results.push(await reconcile(gid, opts));
    return results;
}

/** The last reconcile of a server, or null. */
function lastReconcile(guildId) {
    return lastRuns.get(str(guildId)) || null;
}

let timer = null;
let firstTimer = null;

/** Start the periodic reconcile (idempotent, unref'd): first a minute after start, then every 10 minutes. */
function startRosterRoleSync({ intervalMs = 10 * 60 * 1000, firstRunMs = 60 * 1000 } = {}) {
    if (timer) return timer;
    const run = () => reconcileAll().catch((e) => logger.error("reconcile:", e && e.message));
    // Like roleSync: at boot the gateway is not ready, every server would read as offline.
    firstTimer = setTimeout(run, firstRunMs);
    if (firstTimer.unref) firstTimer.unref();
    timer = setInterval(run, intervalMs);
    if (timer.unref) timer.unref();
    return timer;
}

/** Stop the periodic reconcile (idempotent). */
function stopRosterRoleSync() {
    if (timer) clearInterval(timer);
    if (firstTimer) clearTimeout(firstTimer);
    timer = null;
    firstTimer = null;
}

/** Test-only: forget timers, snapshots and runs. */
function _resetForTests() {
    stopRosterRoleSync();
    snapshots.clear();
    running.clear();
    lastRuns.clear();
}

module.exports = {
    applyMemberAdded, applyStatusChange, applyMemberRemoved, applyRoleChange,
    onGuildMemberUpdate, onGuildMemberAdd, reconcile, reconcileAll, lastReconcile,
    takeFailedPending, memberRoleSet,
    startRosterRoleSync, stopRosterRoleSync, _resetForTests,
    MASS_REMOVAL_SHARE, MASS_REMOVAL_MIN,
};
