// Who may set a raid night's attendance by hand (#677, attendanceOverridesStore):
//
//   - a full admin,
//   - the orga with the area `raids` at write level (who also enters absences for raiders),
//   - a manager of the roster of the night's raid category and version - the
//     category orga (services/roster/categoryOrga.js, #724; #739: not of a closed
//     roster - it is read only).
//
// The views ask it to say `canEdit` (the client shows the edit menu only then);
// POST /api/attendance/override asks it before every write.
const { userCan } = require("../../config/permissions");
const { managesRoster } = require("../roster/categoryOrga");
const { rosterOfCategory } = require("../roster/categoryRoster");

/** Whether `user` may override attendance without looking at a roster (admin or raids write). */
function canEditAnyAttendance(user) {
    if (!user) return false;
    return user.isAdmin === true || userCan(user, "raids", "write");
}

/**
 * Whether `user` may override the attendance of a night of this raid category.
 * @param {object|null} user
 * @param {string} categoryId  the night's category ("" = none - then only admin / raids write)
 * @param {{ versionId?: string, memberRoleIds?: Function, cache?: object }} [opts]  `versionId`: the night's
 *   version (#739, none = the version the category plays now); the rest is passed on to
 *   categoryOrga.managesRoster (`cache`: the request's role cache, `memberRoleIds`: tests)
 * @returns {Promise<boolean>}
 */
async function canEditAttendance(user, categoryId, { versionId = "", ...opts } = {}) {
    if (canEditAnyAttendance(user)) return true;
    if (!user || !categoryId) return false;
    const roster = rosterOfCategory(String(categoryId), { versionId });
    if (!roster || roster.closedAt) return false;
    return managesRoster(user, roster, opts);
}

module.exports = { canEditAttendance, canEditAnyAttendance };
