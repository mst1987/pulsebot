// "Anmeldungen" (#256): the member's upcoming raids and their own signup.
//
// GET /api/signups              area signup — upcoming events the caller may see, own status, profile
// PUT /api/signups              area signup — the caller's own signup; body { eventId, character, spec, status, canAlso, comment }
// GET /api/signups/event?id=    area raids  — every signup of one own event, for the orga
//
// The PUT works on `user.id` from the session and nothing else: a `userId` in
// the body is ignored, so nobody changes someone else's signup through it. The
// rules themselves are signupService.js', shared with the Discord signup (#258).
const { ok, error: apiError } = require("../apiResponse");
const { requireAdmin, requireCsrf } = require("../apiMiddleware");
const { readJsonBody } = require("../apiBody");
const { activeGuildFor } = require("../activeGuild");
const { loadEventGroups } = require("../raidEventGroups");
const { getConfig } = require("../settingsStore");
const discord = require("../discord");
const profiles = require("../raiderProfileStore");
const { getEvent, isOwnEventId } = require("../eventStore");
const { listSignups } = require("../signupStore");
const { submitSignup, httpStatusFor, roleCounts } = require("../signupService");
const { memberEventRows, profileForSignup, signupSummary, eventSignupList } = require("../signupView");
const { userCanAny } = require("../../config/permissions");
const { rulesFor, DEFAULT_VERSION } = require("../../config/gameVersions");

/** GET /api/signups — the caller's upcoming raids, their status in each, and their characters. */
async function getSignups(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const guildId = activeGuildFor(req);
    const { groups, error: err } = await loadEventGroups(guildId);
    const orga = userCanAny(user, ["raids"], "read");
    const roleIds = orga ? null : await discord.memberRoleIds(guildId, user.id);
    const profile = profiles.getProfile(user.id);
    ok(res, {
        events: memberEventRows(groups, { userId: user.id, guildId, config: getConfig(), roleIds, orga, profile }),
        profile: profileForSignup(profile),
        // Class colour and icon for the character picker.
        classes: rulesFor(DEFAULT_VERSION).classes.map((c) => ({ id: c.id, label: c.label, color: c.color, icon: c.icon })),
        error: err,
    });
}

/** PUT /api/signups — create, change or withdraw (status "absence") the caller's own signup. */
async function putSignup(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const eventId = String(body.eventId || "").trim();
    if (!eventId) return apiError(res, 400, "bad_request", "Kein Event angegeben.");
    const result = submitSignup(eventId, user.id, {
        character: body.character,
        spec: body.spec,
        status: body.status,
        canAlso: body.canAlso,
        comment: body.comment,
    }, {
        // Whoever may change raids is the orga: the deadline does not bind them.
        byOrga: userCanAny(user, ["raids"], "write"),
    });
    if (result.error) return apiError(res, httpStatusFor(result.code), result.code, result.error);
    ok(res, {
        signup: signupSummary(result.signup),
        counts: roleCounts(result.event, listSignups(result.event.id)),
    });
}

/** GET /api/signups/event?id= — all signups of an own event with names, "kann auch" and comment. */
async function getEventSignups(req, res, url) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const id = String(url.searchParams.get("id") || "").trim();
    if (!isOwnEventId(id)) return apiError(res, 409, "raidhelper", "Die Anmeldungen dieses Events liegen bei Raid-Helper.");
    const event = getEvent(id);
    if (!event) return apiError(res, 404, "not_found", "Event nicht gefunden.");
    const signups = listSignups(id);
    const names = await discord.resolveUserNames(event.guildId, signups.map((s) => s.userId));
    ok(res, { eventId: id, counts: roleCounts(event, signups), signups: eventSignupList(signups, names) });
}

module.exports = { getSignups, putSignup, getEventSignups };
