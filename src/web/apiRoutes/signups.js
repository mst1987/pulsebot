// "Anmeldungen" (#256): the member's upcoming raids and their own signup.
//
// GET /api/signups              area signup — upcoming events the caller may see, own status, profile
// PUT /api/signups              area signup — the caller's own signup; body { eventId, characters[] | character+spec, status, canAlso, comment }
// POST /api/signups/bulk        area signup — the caller for several raids at once (#293); body { eventIds[], characters[], status }
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
const { submitSignup, submitSignups, httpStatusFor, roleCounts } = require("../signupService");
const { memberEventRows, profileForSignup, signupSummary, eventSignupList } = require("../signupView");
const { noteMode, isNoteStatus, MIN_NOTE } = require("../signupNotes");
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
    // Whoever may change raids is the orga: the deadline does not bind them.
    const byOrga = userCanAny(user, ["raids"], "write");
    // A category that requires a message with "Vielleicht" / "Absagen" requires
    // it here too — the dialog says so, this holds a bare request to the rule.
    const event = isOwnEventId(eventId) ? getEvent(eventId) : null;
    if (event && !byOrga && isNoteStatus(body.status) && noteMode(event.categoryId) === "required"
        && String(body.comment || "").trim().length < MIN_NOTE) {
        return apiError(res, 400, "note_required", "Bitte hinterlasse eine kurze Nachricht an die Raidleitung.");
    }
    const result = await submitSignup(eventId, user.id, {
        // Several own characters in priority order (#293); a single one still works.
        characters: Array.isArray(body.characters) ? body.characters : undefined,
        character: body.character,
        spec: body.spec,
        status: body.status,
        canAlso: body.canAlso,
        comment: body.comment,
    }, { byOrga });
    if (result.error) return apiError(res, httpStatusFor(result.code), result.code, result.error);
    ok(res, {
        signup: signupSummary(result.signup),
        counts: roleCounts(result.event, listSignups(result.event.id)),
        // The raid was full: the "Dabei" became the waiting list, or the signup
        // closed behind this one (#306). The dialog says so under its confirmation.
        waitlisted: !!result.waitlisted,
        locked: !!result.locked,
        notice: result.notice || "",
    });
}

/** At most this many raids per bulk request — more than a member has upcoming. */
const MAX_BULK = 50;

/**
 * POST /api/signups/bulk — the caller for several own raids with one choice of
 * characters and status (#293). Each raid runs the full rules; the answer has
 * one result per raid (saved, or refused with the reason, and the characters
 * skipped there) plus the fresh counts of the saved ones.
 */
async function postSignupsBulk(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const eventIds = [...new Set((Array.isArray(body.eventIds) ? body.eventIds : []).map((id) => String(id || "").trim()).filter(Boolean))];
    if (!eventIds.length) return apiError(res, 400, "bad_request", "Keine Raids gewählt.");
    if (eventIds.length > MAX_BULK) return apiError(res, 400, "bad_request", `Höchstens ${MAX_BULK} Raids auf einmal.`);
    const characters = Array.isArray(body.characters) ? body.characters : [];
    const status = String(body.status || "signed");
    const results = await submitSignups(user.id, eventIds.map((eventId) => ({ eventId, characters, status })), {
        byOrga: userCanAny(user, ["raids"], "write"),
    });
    ok(res, {
        results: results.map((r) => {
            const event = r.ok ? getEvent(r.eventId) : null;
            return {
                eventId: r.eventId,
                title: r.title,
                ok: r.ok,
                error: r.error || "",
                code: r.code || "",
                skipped: r.skipped || [],
                waitlisted: !!r.waitlisted,
                notice: r.notice || "",
                signup: r.ok ? signupSummary(r.signup) : null,
                counts: event ? roleCounts(event, listSignups(event.id)) : null,
            };
        }),
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

module.exports = { getSignups, putSignup, postSignupsBulk, getEventSignups };
