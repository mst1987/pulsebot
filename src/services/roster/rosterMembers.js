// Member changes of a roster made in the tool (#656, for the routes of #655):
// the store write and the Discord roles together, always in that order -
// store first, role second - so the gateway event of the role write finds
// nothing left to do (rosterRoleSync.js, "No loop").
//
// Every function answers `{ ok, code?, member?, roles }` and never throws:
// `code` is a machine code the web translates (DE/EN) - "not_found",
// "bad_request", "invalid_status", "already_member", "not_member",
// "member_limit"; `roles` is rosterRoleSync's answer ({ ok, skipped?, results })
// so the page can say which role could not be given and why.
const rosterStore = require("../../stores/rosterStore");
const rosterRoleSync = require("./rosterRoleSync");

const NO_ROLES = Object.freeze({ ok: true, skipped: "unchanged", results: [] });
const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const validUserId = (v) => /^\d{5,25}$/.test(str(v));

/** The roster and the user id, or the refusal. */
function target(rosterId, userId) {
    const roster = rosterStore.getRoster(rosterId);
    if (!roster) return { refusal: { ok: false, code: "not_found", roles: NO_ROLES } };
    if (!validUserId(userId)) return { refusal: { ok: false, code: "bad_request", roles: NO_ROLES } };
    return { roster, uid: str(userId) };
}

/** A store write that may throw a RosterError, as `{ value }` or `{ refusal }`. */
function storeWrite(fn) {
    try {
        return { value: fn() };
    } catch (e) {
        if (e && e.name === "RosterError") return { refusal: { ok: false, code: e.code, roles: NO_ROLES } };
        throw e;
    }
}

/**
 * Take a user into a roster (`patch` as rosterStore.upsertMember: status,
 * chars, charNames, note, trialUntil), then give the roster's roles.
 */
async function addMember(rosterId, userId, patch = {}, { actor = "" } = {}) {
    const { roster, uid, refusal } = target(rosterId, userId);
    if (refusal) return refusal;
    if (roster.members[uid]) return { ok: false, code: "already_member", roles: NO_ROLES };
    if (patch && patch.status !== undefined && !rosterStore.STATUSES.includes(patch.status)) {
        return { ok: false, code: "invalid_status", roles: NO_ROLES };
    }
    const written = storeWrite(() => rosterStore.upsertMember(roster.id, uid, patch, { actor }));
    if (written.refusal) return written.refusal;
    const roles = await rosterRoleSync.applyMemberAdded(roster.id, uid, { actor });
    return { ok: true, member: written.value, roles };
}

/** Take a user out of a roster, then take every role of the roster from them. */
async function removeMember(rosterId, userId, { actor = "" } = {}) {
    const { roster, uid, refusal } = target(rosterId, userId);
    if (refusal) return refusal;
    if (!roster.members[uid]) return { ok: false, code: "not_member", roles: NO_ROLES };
    rosterStore.removeMember(roster.id, uid, { actor });
    const roles = await rosterRoleSync.applyMemberRemoved(roster.id, uid, { actor });
    return { ok: true, roles };
}

/** Change a member's status, then move trialRoleId when trial is involved. */
async function setStatus(rosterId, userId, status, { actor = "" } = {}) {
    const { roster, uid, refusal } = target(rosterId, userId);
    if (refusal) return refusal;
    const current = roster.members[uid];
    if (!current) return { ok: false, code: "not_member", roles: NO_ROLES };
    if (!rosterStore.STATUSES.includes(status)) return { ok: false, code: "invalid_status", roles: NO_ROLES };
    if (current.status === status) return { ok: true, member: current, roles: NO_ROLES };
    const member = rosterStore.upsertMember(roster.id, uid, { status }, { actor });
    const roles = await rosterRoleSync.applyStatusChange(roster.id, uid, current.status, status, { actor });
    return { ok: true, member, roles };
}

module.exports = { addMember, removeMember, setStatus };
