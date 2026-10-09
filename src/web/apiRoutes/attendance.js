// Attendance set by hand (#677, docs/roster-profile.md "Anwesenheit"):
//
// POST /api/attendance/override  { eventId, userId, status | null, reason? }
//   status one of the attendance codes (present, bench, vacation, absence,
//   noSignup, noShow) sets the night of that Discord account by hand; null (or
//   "auto") removes the override - the automatic verdict counts again.
//   Answer: { eventId, userId, override: { status, reason, by, byName, at } | null }.
//
// Gate: the areas `roster` or `raids` at write level; then attendanceAccess:
// a full admin, `raids` write, or a manager of the roster of the event's raid
// category - else 403 "not_manager". Codes the client translates:
// bad_request, invalid_status, reason_too_long (400), not_found (404, unknown event).
const { ok, error: apiError } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const overridesStore = require("../../stores/attendanceOverridesStore");
const { getStoredEvent } = require("../../services/events/eventSources");
const { canEditAttendance } = require("../../services/characters/attendanceAccess");

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

const STATUS_OF_CODE = { not_found: 404, not_manager: 403 };
const refuse = (res, code) => apiError(res, STATUS_OF_CODE[code] || 400, code, `Anwesenheit: ${code}`);

/** The stored event of either source, or null (a lookup that throws counts as unknown). */
function eventOf(eventId) {
    try {
        return getStoredEvent(eventId);
    } catch {
        return null;
    }
}

const postOverride = withUser({ csrf: true, body: true }, async ({ user, body, res }) => {
    const eventId = str(body.eventId);
    const userId = str(body.userId);
    if (!eventId || !userId) return refuse(res, "bad_request");
    const auto = body.status === null || body.status === undefined || body.status === "" || body.status === "auto";
    if (!auto && !overridesStore.STATUSES.includes(body.status)) return refuse(res, "invalid_status");
    if (str(body.reason).length > overridesStore.REASON_MAX) return refuse(res, "reason_too_long");
    const event = eventOf(eventId);
    if (!event) return refuse(res, "not_found");
    if (!(await canEditAttendance(user, str(event.categoryId)))) return refuse(res, "not_manager");
    if (auto) {
        overridesStore.clearOverride(eventId, userId);
        return ok(res, { eventId, userId, override: null });
    }
    const saved = overridesStore.setOverride(eventId, userId, {
        status: body.status, reason: str(body.reason), by: str(user.id), byName: str(user.name || user.username),
    });
    if (saved.error) return refuse(res, saved.error);
    return ok(res, { eventId, userId, override: saved });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "POST", path: "/api/attendance/override", handler: postOverride, area: ["roster", "raids"] },
];

module.exports = { routes };
