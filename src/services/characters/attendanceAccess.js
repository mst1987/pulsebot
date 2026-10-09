// Who may set a raid night's attendance by hand (#677, attendanceOverridesStore):
//
//   - a full admin,
//   - the orga with the area `raids` at write level (who also enters absences for raiders),
//   - a manager of the roster of the night's raid category (rosterAccess.canManageRosterLive).
//
// The views ask it to say `canEdit` (the client shows the edit menu only then);
// POST /api/attendance/override asks it before every write.
const rosterStore = require("../../stores/rosterStore");
const { userCan } = require("../../config/permissions");
const { canManageRosterLive } = require("../roster/rosterAccess");

/** Whether `user` may override attendance without looking at a roster (admin or raids write). */
function canEditAnyAttendance(user) {
    if (!user) return false;
    return user.isAdmin === true || userCan(user, "raids", "write");
}

/**
 * Whether `user` may override the attendance of a night of this raid category.
 * @param {object|null} user
 * @param {string} categoryId  the night's category ("" = none - then only admin / raids write)
 * @param {{ memberRoleIds?: Function }} [opts]  passed on to canManageRosterLive (tests)
 * @returns {Promise<boolean>}
 */
async function canEditAttendance(user, categoryId, opts = {}) {
    if (canEditAnyAttendance(user)) return true;
    if (!user || !categoryId) return false;
    const roster = rosterStore.rosterForCategory(String(categoryId));
    if (!roster) return false;
    return canManageRosterLive(user, roster, opts).catch(() => false);
}

module.exports = { canEditAttendance, canEditAnyAttendance };
