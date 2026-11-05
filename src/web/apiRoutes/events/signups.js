// "Anmeldungen" (#256): the member's upcoming raids and their own signup.
//
// GET /api/signups              area signup — upcoming events the caller may sign up for (or did), own status, profile;
//                               `?scope=all`: every raid, only for the orga (userIsOrga)
// PUT /api/signups              area signup — the caller's own signup; body { eventId, characters[] | character+spec | newCharacter{name,spec}, status, canAlso, comment }
// POST /api/signups/bulk        area signup — the caller for several raids at once (#293); body { eventIds[], characters[], status }
// GET /api/signups/raid?event=  session + the raid server's rights (#1074) — that one raid and the caller's own signup
// PUT /api/signups/raid         session + the raid server's rights (#1074) — the caller's own signup for it; body as PUT /api/signups
//
// The PUT works on `user.id` from the session and nothing else: a `userId` in
// the body is ignored, so nobody changes someone else's signup through it. The
// rules themselves are signupService.js', shared with the Discord signup (#258).
// Only here (#907): a PuG raid takes members of its server (`memberOnly`,
// pugMembership.js) - a refusal carries the server's `inviteUrl` -, and a
// raider without a character of the raid's version names a new one.
//
// The two /raid routes are the one exception to "a page needs its active server" (#1074): links
// into `/signups?event=` come from Discord messages and /e/<id>, whoever follows them. They are
// bound to the one raid, ask the rights on the raid's own server and show it only to whom it is
// visible (`raidVisibility`, docs/signups.md). They open no server: no switch, no list, no channel.
const { ok, error: apiError, sendJson } = require("../../http/apiResponse");
const { withUser } = require("../../http/apiHandler");
const { activeGuildFor } = require("../../http/activeGuild");
const auth = require("../../http/auth");
const { mayEnterGuild } = require("../../http/guildChoice");
const { requireCsrf } = require("../../http/apiMiddleware");
const { readJsonBody } = require("../../http/apiBody");
const { archivedRefusal } = require("../../../services/events/eventArchive");
const { loadEventGroups } = require("../../../services/events/raidEventGroups");
const { getConfig } = require("../../../stores/settings/settingsStore");
const profiles = require("../../../stores/roster/raiderProfileStore");
const { getEvent, isOwnEventId } = require("../../../stores/events/eventStore");
const { getSignup, listSignups } = require("../../../stores/events/signupStore");
const { NAME_FETCH_MS } = require("../../../services/discord/discord");
const { accessRule, canSignUp } = require("../../../services/signups/signupAccess");
const { submitSignup, submitSignups, httpStatusFor, roleCounts } = require("../../../services/signups/signupService");
const { memberEventList, profileForSignup, signupSummary } = require("../../signups/signupView");
const { markMembersOnly, serverOf } = require("../../../services/signups/pugMembership");
const { signupEventIdOf } = require("../../../utils/raidGroup");
const { viewerRoles } = require("../../signups/viewerRoles");
const { noteMode, isNoteStatus, MIN_NOTE } = require("../../../services/signups/signupNotes");
const { userIsOrga, userCan } = require("../../../config/permissions");
const { isGlobalRaidOrga, canOrgaRaid } = require("../../events/raidOrgaAccess");
const { VERSIONS, rulesFor } = require("../../../config/gameVersions");
const { mainVersionFor, classesOfVersion, resolveVersionQuery, versionOfEvent } = require("../../../services/versions/mainVersion");

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

/** What the dialog's character picker needs, independent of any server. */
function pickerData(config) {
    return {
        // Class colour and icon for the character picker (#541): per version,
        // the dialog takes the list of the event's version; `classes` is the
        // main version's, for a row without one (Raid-Helper).
        classes: classesOfVersion(mainVersionFor({ config }), { config }),
        classesByVersion: Object.fromEntries(VERSIONS.map((v) => [v.id, classesWithSpecs(v.id, config)])),
        // The names of the versions (#543): "Lege einen Forever-Charakter an" when the
        // profile has none of the event's version (the rows carry their versionId).
        versions: VERSIONS.map((v) => ({ id: v.id, label: v.label, short: v.short || v.label, lastName: !!(v.characterNames && v.characterNames.lastName) })),
    };
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
        ...pickerData(config),
        error: err,
    });
});

/**
 * Saves the session user's own signup for `eventId` (`event`: its stored record, null for
 * none) with the rights in `user` and answers the request: PUT /api/signups and its raid-bound
 * twin differ only in which server's rights those are.
 */
async function saveOwnSignup({ user, body, eventId, event, req, res }) {
    // The orga of this raid (#727: the global orga with `raids` write, or a manager of the current
    // roster of its category - raidOrgaAccess.js, the rule of the `orgaScoped` gate): the deadline,
    // a closed signup and the required message do not bind them.
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
}

/** PUT /api/signups — create, change or withdraw (status "absence") the caller's own signup. */
const putSignup = withUser({ csrf: true, body: true, archived: (body) => body.eventId }, async ({ user, body, req, res }) => {
    const eventId = String(body.eventId || "").trim();
    if (!eventId) return apiError(res, 400, "bad_request", "Kein Event angegeben.");
    const event = isOwnEventId(eventId) ? getEvent(eventId) : null;
    return saveOwnSignup({ user, body, eventId, event, req, res });
});

/**
 * The raid a signup link names and the caller's rights on its server, or null. A further raid
 * of a raid group stands for the first one, where its signup is (#811); only own events have a
 * signup here.
 */
function linkedRaid(req, rawId, level) {
    const id = String(rawId || "").trim();
    const named = id && isOwnEventId(id) ? getEvent(id) : null;
    if (!named) return null;
    const eventId = signupEventIdOf(named);
    const event = eventId === named.id ? named : getEvent(eventId);
    if (!event) return null;
    const guildId = serverOf(event, getConfig());
    const view = auth.userForGuild(req, guildId);
    return view && userCan(view, "signup", level) ? { eventId, event, guildId, view } : null;
}

/**
 * The one refusal of a signup link: an unknown raid, a raid whose server gives the caller no
 * access and a raid hidden from them by role or roster read the same. So the answer says nothing
 * about the caller's access; that a raid exists is public through /e/<id> anyway. A raid that is
 * visible keeps its own answers (`closed`, `deadline` and so on).
 */
function raidUnavailable(res) {
    return apiError(res, 403, "raid_unavailable", "Dieser Raid ist für dich nicht verfügbar. Der Link kann veraltet sein, oder sein Server lässt deine Anmeldung nicht zu.");
}

/**
 * Whether the raid of a signup link shows to the caller, the one rule of GET and PUT: their own
 * signup, the orga of the raid's server, or a category of that server's raids they may sign up
 * for. Roles that cannot be read count as not held, within a time limit, because this route also
 * serves people who are no members. That is stricter than checkRaiderRole on the ordinary route,
 * which lets them through and so is only safe for callers known to belong to the server.
 * @returns {Promise<{ visible: boolean, roleIds: string[]|null, rolesUnknown: boolean }>}
 */
async function raidVisibility({ event, eventId, guildId, view }, config) {
    const versionId = versionOfEvent(event, { config });
    const { rule } = accessRule(event.categoryId, { config, versionId });
    const roles = rule === "roles"
        ? await viewerRoles(guildId, { id: view.id }, { waitMs: NAME_FETCH_MS })
        : { roleIds: null, unknown: false };
    const visible = !!getSignup(eventId, view.id)
        || userIsOrga(view)
        || canSignUp(event.categoryId, { userId: view.id, roleIds: roles.roleIds, config, versionId });
    return { visible, roleIds: roles.roleIds, rolesUnknown: roles.unknown };
}

/**
 * The answer for a raid that does not show. Whoever may enter its server learns that their roles
 * could not be read, since "not available" would be untrue for them and tells them nothing new;
 * everybody else gets the one refusal.
 */
function raidHidden(req, res, { guildId }, { rolesUnknown }) {
    if (rolesUnknown && mayEnterGuild(auth.guildViewerOf(req), guildId)) {
        return apiError(res, 503, "raid_roles_unknown", "Deine Discord-Rollen konnten gerade nicht gelesen werden. Versuch es gleich noch einmal.");
    }
    return raidUnavailable(res);
}

/** The session's account, or a 401 and null. */
function loggedIn(req, res) {
    const user = auth.getRealUser(req);
    if (!user) apiError(res, 401, "unauthorized", "Nicht angemeldet.");
    return user;
}

/**
 * GET /api/signups/raid?event=<id> — what the dialog needs for the one raid of a signup link
 * (#1074), by the rules of the raid's server and whatever server is active. Same row as
 * GET /api/signups without the link into Discord and without the other raiders' names.
 */
async function getSignupRaid(req, res, url) {
    const session = loggedIn(req, res);
    if (!session) return undefined;
    const raid = linkedRaid(req, url && url.searchParams.get("event"), "read");
    if (!raid) return raidUnavailable(res);
    const { eventId, guildId, view } = raid;
    const config = getConfig();
    const seen = await raidVisibility(raid, config);
    if (!seen.visible) return raidHidden(req, res, raid, seen);
    // the list of the raid's server does not show a raid of a hidden version either
    const archived = archivedRefusal(eventId);
    if (archived) return apiError(res, archived.status, archived.code, archived.message);
    const { groups } = await loadEventGroups(guildId);
    // only this raid goes into the list, so no other can come out of it
    const own = (groups || []).map((g) => ({ ...g, events: (g.events || []).filter((e) => e.id === eventId) }));
    const profile = profiles.getProfile(view.id);
    const { rows } = memberEventList(own, {
        userId: view.id, guildId, config, roleIds: seen.roleIds, profile,
        // what "Alle Kategorien" is to the orga on that server's own page
        all: userIsOrga(view),
        byOrga: isGlobalRaidOrga(view),
    });
    if (!rows.length) return raidUnavailable(res);
    const [row] = await markMembersOnly(rows, view.id, {
        config, isOrga: (event) => canOrgaRaid(view, event, req),
    });
    const versionId = versionOfEvent(row, { config });
    return ok(res, {
        events: [{ ...row, discordUrl: "", categoryId: "", wishPartners: [] }],
        version: versionId,
        scope: "mine",
        canShowAll: false,
        rolesUnknown: false,
        eventVersion: "",
        profile: profileForSignup(profile, { versionId }),
        ...pickerData(config),
        error: "",
    });
}

/** PUT /api/signups/raid — the caller's own signup for the one raid of a signup link (#1074). */
async function putSignupRaid(req, res) {
    const session = loggedIn(req, res);
    if (!session || !requireCsrf(req, res)) return undefined;
    const body = (await readJsonBody(req)) || {};
    const raid = linkedRaid(req, body.eventId, "write");
    if (!raid) return raidUnavailable(res);
    const seen = await raidVisibility(raid, getConfig());
    if (!seen.visible) return raidHidden(req, res, raid, seen);
    const { eventId, event, view } = raid;
    const archived = archivedRefusal(eventId);
    if (archived) return apiError(res, archived.status, archived.code, archived.message);
    return saveOwnSignup({ user: view, body, eventId, event, req, res });
}

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
    // no gate of an area: the active server says nothing here, the handlers check the raid's own
    { method: "GET", path: "/api/signups/raid", handler: getSignupRaid, auth: "none" },
    { method: "PUT", path: "/api/signups/raid", handler: putSignupRaid, auth: "none" },
];

module.exports = { getSignups, putSignup, postSignupsBulk, getSignupRaid, putSignupRaid, routes };
