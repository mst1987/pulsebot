// "Darf sich anmelden" — the one rule that says whether a member may take a new
// signup in a raid category. Two readers share it, so "listed" and "may sign
// up" never drift apart again:
//
//   * checkRaiderRole (signupService.js), the gate on every save — web, bot
//     buttons, talk overview, several raids, the absence panel;
//   * the lists of raids for a raider — "Für dich" on the dashboard and the
//     "Anmeldungen" page (signupView.memberEventRows): a raider sees the raids
//     they may sign up for, plus the ones they are already signed up for.
//
// The rule, per category and the raid's game version (`versionId`, #739):
//   "roster"  the category's roster takes signups only from its members
//             ("Anmeldung nur für das Roster", #658, `roster.signupOnly`):
//             status core, trial or bench may, paused and outsiders may not
//             (`roster_only`). No Discord role is read.
//   "roles"   the category has raider roles (categoryRoles.expectedRoleIds —
//             the roster's roleIds, else config.categoryRoles): only holders of
//             one may (`raider_role`). Roles that cannot be read (`roleIds` not
//             an array) give `allowed: null` — unknown; the caller decides:
//             the save lets it through, a list leaves the raid out and says so.
//   "open"    neither: everyone may — a PuG category (`openToAll`).
//
// What this rule does not know: the orga's exemption (`byOrga`) and an
// existing own signup — both are the caller's (checkRaiderRole, the lists).
//
// `rosterByRoles` (only "Ansicht als Rolle"): a role has no roster membership,
// so a member holding one of the roster's roles (roleIds, trialRoleId) counts
// as a member — the roster sync hands its members exactly those roles.
const { expectedRoleIds } = require("../roster/categoryRoles");
const { rosterOfCategory } = require("../roster/categoryRoster");

// Who may sign up where the roster says "Anmeldung nur für das Roster" (#658): pause is out.
const ROSTER_SIGNUP_STATUSES = ["core", "trial", "bench"];

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/**
 * Which rule a category follows for a raid of `versionId`: `{ rule, roster, roleIds }`.
 * @param {string} categoryId
 * @param {{ config?: object, versionId?: string }} [opts]
 * @returns {{ rule: "open"|"roles"|"roster", roster: object|null, roleIds: string[] }}
 */
function accessRule(categoryId, { config, versionId = "" } = {}) {
    const roster = rosterOfCategory(categoryId, { versionId, config });
    if (roster && roster.signupOnly) return { rule: "roster", roster, roleIds: [] };
    const roleIds = expectedRoleIds(categoryId, config, { versionId });
    return roleIds.length ? { rule: "roles", roster: null, roleIds } : { rule: "open", roster: null, roleIds: [] };
}

/**
 * "Anmeldung nur für das Roster" (#658, `roster.signupOnly`): null when the
 * category's roster does not ask for it (or there is no roster) - then the
 * raider-role rule applies -, else whether the user is a member with status
 * core, trial or bench (a paused member is not). The roster is the one of the
 * raid's version (`versionId`, #739; none = the version the category plays now).
 * @returns {boolean|null}
 */
function rosterOnlyAccess(categoryId, userId, { versionId = "", config } = {}) {
    const roster = rosterOfCategory(categoryId, { versionId, config });
    if (!roster || !roster.signupOnly) return null;
    const member = roster.members[str(userId)];
    return !!member && ROSTER_SIGNUP_STATUSES.includes(member.status);
}

/** Whether a roster's roles are among the member's (only "Ansicht als Rolle", see the head). */
function holdsRosterRole(roster, roleIds) {
    if (!Array.isArray(roleIds)) return null;
    const own = new Set(roleIds.map(String));
    return [...(roster.roleIds || []), roster.trialRoleId].filter(Boolean).map(String).some((r) => own.has(r));
}

/**
 * Whether a member may take a new signup in a category (see the head).
 * `allowed`: true / false / null (roles not readable); `code` names the
 * refusal ("" when allowed or unknown).
 * @param {string} categoryId
 * @param {{ userId?: string, roleIds?: string[]|null, config?: object, versionId?: string, rosterByRoles?: boolean }} [opts]
 * @returns {{ rule: "open"|"roles"|"roster", allowed: boolean|null, code: ""|"raider_role"|"roster_only" }}
 */
function signupAccess(categoryId, { userId = "", roleIds = null, config, versionId = "", rosterByRoles = false } = {}) {
    const { rule, roster, roleIds: needed } = accessRule(categoryId, { config, versionId });
    if (rule === "open") return { rule, allowed: true, code: "" };
    if (rule === "roster") {
        const member = roster.members[str(userId)];
        const allowed = rosterByRoles
            ? holdsRosterRole(roster, roleIds)
            : !!member && ROSTER_SIGNUP_STATUSES.includes(member.status);
        if (allowed === null) return { rule, allowed: null, code: "" };
        return { rule, allowed, code: allowed ? "" : "roster_only" };
    }
    if (!Array.isArray(roleIds)) return { rule, allowed: null, code: "" };
    const own = new Set(roleIds.map(String));
    const allowed = needed.some((r) => own.has(r));
    return { rule, allowed, code: allowed ? "" : "raider_role" };
}

/** Whether a category is one of the event categories (`config.categoryIds`; none set = every category is). */
function inEventCategories(categoryId, config) {
    const cats = Array.isArray(config && config.categoryIds) ? config.categoryIds.map(String) : [];
    return !cats.length || cats.includes(str(categoryId));
}

/**
 * "Darf sich anmelden" for a list of raids: an event category and the rule
 * above says yes. Unknown roles are a no here — a list never shows a raid it
 * cannot vouch for (the caller says the roles could not be read).
 * @param {string} categoryId
 * @param {{ userId?: string, roleIds?: string[]|null, config?: object, versionId?: string, rosterByRoles?: boolean }} [opts]
 * @returns {boolean}
 */
function canSignUp(categoryId, opts = {}) {
    return inEventCategories(categoryId, opts.config) && signupAccess(categoryId, opts).allowed === true;
}

/** A category open to everyone (no raider role, no roster-only signup): a PuG raid, the "PuG" badge. */
function openToAll(categoryId, { config, versionId = "" } = {}) {
    return accessRule(categoryId, { config, versionId }).rule === "open";
}

module.exports = { accessRule, signupAccess, rosterOnlyAccess, canSignUp, openToAll, inEventCategories, ROSTER_SIGNUP_STATUSES };
