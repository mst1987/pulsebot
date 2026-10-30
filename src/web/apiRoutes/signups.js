// "Anmeldungen" (#256): the member's upcoming raids and their own signup.
//
// GET /api/signups              area signup — upcoming events the caller may sign up for (or did), own status, profile;
//                               `?scope=all`: every raid, only for the orga (userIsOrga)
// PUT /api/signups              area signup — the caller's own signup; body { eventId, characters[] | character+spec | newCharacter{name,spec}, status, canAlso, comment }
// POST /api/signups/bulk        area signup — the caller for several raids at once (#293); body { eventIds[], characters[], status }
//
// The PUT works on `user.id` from the session and nothing else: a `userId` in
// the body is ignored, so nobody changes someone else's signup through it. The
// rules themselves are signupService.js', shared with the Discord signup (#258).
// Only here (#907): a PuG raid takes members of its server (`memberOnly`,
// pugMembership.js) - a refusal carries the server's `inviteUrl` -, and a
// raider without a character of the raid's version names a new one.
const { ok, error: apiError, sendJson } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { activeGuildFor } = require("../http/activeGuild");
const { loadEventGroups } = require("../../services/events/raidEventGroups");
const { getConfig } = require("../../stores/settingsStore");
const profiles = require("../../stores/raiderProfileStore");
const { getEvent, isOwnEventId } = require("../../stores/eventStore");
const { listSignups } = require("../../stores/signupStore");
const { submitSignup, submitSignups, httpStatusFor, roleCounts } = require("../../services/signups/signupService");
const { memberEventList, profileForSignup, signupSummary } = require("../signups/signupView");
const { markMembersOnly } = require("../../services/signups/pugMembership");
const { viewerRoles } = require("../signups/viewerRoles");
const { noteMode, isNoteStatus, MIN_NOTE } = require("../../services/signups/signupNotes");
const { userIsOrga } = require("../../config/permissions");
const { isGlobalRaidOrga, canOrgaRaid } = require("../events/raidOrgaAccess");
const { VERSIONS, rulesFor } = require("../../config/gameVersions");
const { mainVersionFor, classesOfVersion, resolveVersionQuery, versionOfEvent } = require("../../services/events/mainVersion");

/**
 * A version's classes for the picker, each with its specs (#907: the dialog's
 * class -> spec -> name for a raider without a character of the raid's version).
 */
function classesWithSpecs(versionId, config) {
    const specs = new Map(rulesFor(versionId).classes.map((c) => [c.id, c.specs]));
    return classesOfVersion(versionId, { config }).map((c) => ({
        ...c,
        specs: (specs.get(c.id) || []).map((sp) => ({ key: sp.key, label: sp.label, icon: sp.icon, role: sp.role })),
    }));
}

/** The refusal of a PuG raid to a non-member carries the invite link (#907). */
function signupError(res, result) {
    const status = httpStatusFor(result.code);
    if (result.inviteUrl === undefined) return apiError(res, status, result.code, result.error);
    return sendJson(res, status, { error: { code: result.code, message: result.error, inviteUrl: result.inviteUrl } });
}

/**
 * GET /api/signups[?version=<id>][&event=<id>] — the caller's upcoming raids of
 * one game version (#741: the menu's content switch, else the main version),
 * their status in each, and their characters. With `event` also that raid's
 * version (`eventVersion`, "" when the caller has no such raid).
 *
 * Which raids: the ones the caller may sign up for plus the ones they signed
 * up for (signupView.memberEventList) - for everybody, the orga too. The orga
 * (userIsOrga - an area right makes nobody orga, raider roles read the raids
 * as well) may ask for every raid with `scope=all` ("Alle Kategorien");
 * `canShowAll` tells the page to offer the switch. `rolesUnknown`: the
 * caller's Discord roles could not be read, raids with a raider role may be
 * missing.
 */
const getSignups = withUser({}, async ({ user, req, res, url }) => {
    const guildId = activeGuildFor(req);
    const { groups, error: err } = await loadEventGroups(guildId);
    const canShowAll = userIsOrga(user);
    const all = canShowAll && url && url.searchParams.get("scope") === "all";
    const roles = await viewerRoles(guildId, user);
    const profile = profiles.getProfile(user.id);
    const config = getConfig();
    // One version at a time (#741); with other versions hidden (#563) always the main one.
    const { versionId } = resolveVersionQuery(url && url.searchParams.get("version"), { config });
    const { rows, rolesUnknown } = memberEventList(groups, {
        userId: user.id, guildId, config, roleIds: roles.roleIds, viewAs: roles.viewAs, all,
        // byOrga only clears the "roster only" / "raider role missing" marks, which only "Alle
        // Kategorien" (the global orga's) can show - a category orga's rows are the raids they may
        // sign up for anyway, so no roster is asked here (#727: the save decides per raid)
        byOrga: isGlobalRaidOrga(user), profile,
    });
    // A link to one raid (`?event=`, the Discord post's button) names its version,
    // so the page can switch to it when the menu shows another one.
    const linkedId = String((url && url.searchParams.get("event")) || "").trim();
    const linked = linkedId ? rows.find((e) => e.id === linkedId) : null;
    // #907: open PuG raids of a server the caller is not on carry `membersOnly` + `inviteUrl` (the
    // dialog shows the hint instead of the form); the save checks again (memberOnly below)
    const events = await markMembersOnly(rows.filter((e) => versionOfEvent(e, { config }) === versionId), user.id, {
        config, isOrga: (event) => canOrgaRaid(user, event, req),
    });
    ok(res, {
        events,
        version: versionId,
        scope: all ? "all" : "mine",
        canShowAll,
        rolesUnknown: rolesUnknown && roles.unknown,
        eventVersion: linked ? versionOfEvent(linked, { config }) : "",
        // only the characters of the page's version (#741), like its raids
        profile: profileForSignup(profile, { versionId }),
        // Class colour and icon for the character picker (#541): per version,
        // the dialog takes the list of the event's version; `classes` is the
        // main version's, for a row without one (Raid-Helper).
        classes: classesOfVersion(mainVersionFor({ config }), { config }),
        classesByVersion: Object.fromEntries(VERSIONS.map((v) => [v.id, classesWithSpecs(v.id, config)])),
        // The names of the versions (#543): "Lege einen Forever-Charakter an" when the
        // profile has none of the event's version (the rows carry their versionId).
        versions: VERSIONS.map((v) => ({ id: v.id, label: v.label, short: v.short || v.label })),
        error: err,
    });
});

/** PUT /api/signups — create, change or withdraw (status "absence") the caller's own signup. */
const putSignup = withUser({ csrf: true, body: true, archived: (body) => body.eventId }, async ({ user, body, req, res }) => {
    const eventId = String(body.eventId || "").trim();
    if (!eventId) return apiError(res, 400, "bad_request", "Kein Event angegeben.");
    // The orga of this raid (#727: the global orga with `raids` write, or a manager of the current
    // roster of its category - raidOrgaAccess.js, the rule of the `orgaScoped` gate): the deadline,
    // a closed signup and the required message do not bind them.
    const event = isOwnEventId(eventId) ? getEvent(eventId) : null;
    const byOrga = event ? await canOrgaRaid(user, event, req) : false;
    // A category that requires a message with "Vielleicht" / "Absagen" requires
    // it here too — the dialog says so, this holds a bare request to the rule.
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
        // no character of the raid's version yet (#907): { name, spec } goes into the profile first
        newCharacter: body.newCharacter && typeof body.newCharacter === "object"
            ? { name: String(body.newCharacter.name || ""), spec: String(body.newCharacter.spec || "") }
            : undefined,
    }, { byOrga, actorId: user.id, memberOnly: true, accountName: String(user.name || "") });
    if (result.error) return signupError(res, result);
    ok(res, {
        signup: signupSummary(result.signup),
        counts: roleCounts(result.event, listSignups(result.event.id)),
        // The raid was full: the "Dabei" became the waiting list, or the signup
        // closed behind this one (#306). The dialog says so under its confirmation.
        waitlisted: !!result.waitlisted,
        locked: !!result.locked,
        notice: result.notice || "",
    });
});

/** At most this many raids per bulk request — more than a member has upcoming. */
const MAX_BULK = 50;

/**
 * POST /api/signups/bulk — the caller for several own raids with one choice of
 * characters and status (#293). Each raid runs the full rules; the answer has
 * one result per raid (saved, or refused with the reason, and the characters
 * skipped there) plus the fresh counts of the saved ones.
 */
const postSignupsBulk = withUser({ csrf: true, body: true, archived: (body) => (Array.isArray(body.eventIds) ? body.eventIds : []) }, async ({ user, body, req, res }) => {
    const eventIds = [...new Set((Array.isArray(body.eventIds) ? body.eventIds : []).map((id) => String(id || "").trim()).filter(Boolean))];
    if (!eventIds.length) return apiError(res, 400, "bad_request", "Keine Raids gewählt.");
    if (eventIds.length > MAX_BULK) return apiError(res, 400, "bad_request", `Höchstens ${MAX_BULK} Raids auf einmal.`);
    const characters = Array.isArray(body.characters) ? body.characters : [];
    const status = String(body.status || "signed");
    const results = await submitSignups(user.id, eventIds.map((eventId) => ({ eventId, characters, status })), {
        // per raid (#727): the orga of one raid's category is exempt there, not in the others
        byOrga: (event) => canOrgaRaid(user, event, req),
        actorId: user.id,
        memberOnly: true,
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
                inviteUrl: r.inviteUrl || "",
                skipped: r.skipped || [],
                waitlisted: !!r.waitlisted,
                notice: r.notice || "",
                signup: r.ok ? signupSummary(r.signup) : null,
                counts: event ? roleCounts(event, listSignups(event.id)) : null,
            };
        }),
    });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/signups", handler: getSignups, area: "signup" },
    { method: "PUT", path: "/api/signups", handler: putSignup, area: "signup" },
    { method: "POST", path: "/api/signups/bulk", handler: postSignupsBulk, area: "signup" },
];

module.exports = { getSignups, putSignup, postSignupsBulk, routes };
