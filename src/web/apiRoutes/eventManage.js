// JSON API of "Event verwalten" (#288) — the actions menu on the raid detail of
// an own event. Every path is area `raids` (apiAccess.js, level by method) and
// only for the orga; the reads additionally want write access, because they only
// exist to prepare an action (who would get a DM, what the channel would be renamed to).
//
//   GET  /api/raids/manage?event=                      state, recipients, archive, log
//   GET  /api/raids/manage/move?event=&date=&time=     preview of a move (nothing changes)
//   POST /api/raids/manage/move                        { event, date, time, renameChannel, notify }
//   POST /api/raids/manage/signups                     { event, open }
//   GET  /api/raids/manage/raider?event=               who can be signed up, with characters
//   POST /api/raids/manage/raider                      { event, userId, character, spec, status, comment }
//   POST /api/raids/manage/raider/remove               { event, userId }
//   POST /api/raids/manage/cancel                      { event, reason, archiveChannel, notify }
//   POST /api/raids/manage/reopen                      { event }
//   POST /api/raids/manage/delete                      { event, archiveChannel, notify, confirmStarted }
//   POST /api/raids/manage/recreate-channel            { event } — the event's channel was deleted (#537)
const { ok } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { sendResult } = require("../http/apiResult");
const { q } = require("../http/apiParams");
const { activeGuildFor } = require("../http/activeGuild");
const manage = require("../../services/events/eventManage");

// "Event verwalten" is the orga's (permissions.userIsOrga): a raider role that holds `raids`
// write is still no orga, so every path here wants the orga as well as its right.
// The signups of a raid (#727, epic #723) are also the orga of its category's: closing/opening the
// signup, signing a raider up or off (and the candidates of that dialog) are `orgaScoped` - a manager
// of the current roster of the raid's category, for that raid only (docs/permissions.md
// "Kategorie-Orga"). Moving, cancelling, reopening, deleting and the channel stay the global orga's (#728).

const BY_EVENT = (body) => body.event;
const BY_QUERY = (body, query) => query.get("event");

/** A read that prepares an action: the orga with `raids` write. */
const reader = (fn) => withUser({ orga: true, write: "raids" }, fn);
/** A write: the orga, CSRF, JSON body (the area gate asks for `raids` write). */
const action = (fn) => withUser({ orga: true, csrf: true, body: true, archived: BY_EVENT }, fn);
/** reader for the orga of the raid's category as well (#727). */
const scopedReader = (fn) => withUser({ orgaScoped: BY_QUERY, write: "raids" }, fn);
/** action for the orga of the raid's category as well (#727). */
const scopedAction = (fn) => withUser({ orgaScoped: BY_EVENT, write: "raids", csrf: true, body: true, archived: BY_EVENT }, fn);

const getManage = reader(async ({ req, res, query }) => {
    sendResult(res, await manage.manageInfo({ guildId: activeGuildFor(req), eventId: q.str(query, "event") }));
});

const getMovePreview = reader(async ({ req, res, query }) => {
    const result = await manage.movePlan({ guildId: activeGuildFor(req), eventId: q.str(query, "event"), date: q.str(query, "date"), time: q.str(query, "time") });
    if (result.error) return sendResult(res, result);
    ok(res, result.plan);
});

const postMove = action(async ({ user, body, req, res }) => {
    sendResult(res, await manage.moveEvent({
        guildId: activeGuildFor(req), eventId: body.event, date: body.date, time: body.time,
        renameChannel: body.renameChannel !== false, notify: body.notify !== false, user, byName: user.name,
    }));
});

const postSignups = scopedAction(async ({ user, body, req, res }) => {
    sendResult(res, await manage.setSignupsOpen({ guildId: activeGuildFor(req), eventId: body.event, open: body.open === true, user, byName: user.name }));
});

const getRaiderCandidates = scopedReader(async ({ req, res, query }) => {
    sendResult(res, await manage.raiderCandidates({ guildId: activeGuildFor(req), eventId: q.str(query, "event") }));
});

const postRaider = scopedAction(async ({ user, body: b, req, res }) => {
    sendResult(res, await manage.addRaider({
        guildId: activeGuildFor(req), eventId: b.event, userId: b.userId, character: b.character, spec: b.spec,
        // further own characters, "kann auch mit" (#293)
        alternates: Array.isArray(b.alternates) ? b.alternates : undefined,
        status: b.status || "signed", comment: b.comment, user, byName: user.name,
    }));
});

const postRaiderRemove = scopedAction(async ({ user, body, req, res }) => {
    sendResult(res, await manage.removeRaider({ guildId: activeGuildFor(req), eventId: body.event, userId: body.userId, user, byName: user.name }));
});

const postCancel = action(async ({ user, body, req, res }) => {
    sendResult(res, await manage.cancelEvent({
        guildId: activeGuildFor(req), eventId: body.event, reason: body.reason,
        archiveChannel: body.archiveChannel === true, notify: body.notify !== false, user, byName: user.name,
    }));
});

const postReopen = action(async ({ user, body, req, res }) => {
    sendResult(res, await manage.reopenEvent({ guildId: activeGuildFor(req), eventId: body.event, user, byName: user.name }));
});

const postDelete = action(async ({ user, body: b, req, res }) => {
    sendResult(res, await manage.deleteEvent({
        guildId: activeGuildFor(req), eventId: b.event,
        // both off unless asked for: mostly test or mistaken events are deleted
        archiveChannel: b.archiveChannel === true, notify: b.notify === true, confirmStarted: b.confirmStarted === true,
        user, byName: user.name,
    }));
});

/** "Kanal neu anlegen" (#537, dashboard task "Kanal von <Event> fehlt"). */
const postRecreateChannel = action(async ({ user, body, req, res }) => {
    sendResult(res, await manage.recreateChannel({ guildId: activeGuildFor(req), eventId: body.event, user, byName: user.name }));
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/raids/manage", handler: getManage, area: "raids" },
    { method: "GET", path: "/api/raids/manage/move", handler: getMovePreview, area: "raids" },
    { method: "POST", path: "/api/raids/manage/move", handler: postMove, area: "raids" },
    { method: "POST", path: "/api/raids/manage/signups", handler: postSignups, area: "raids" },
    { method: "GET", path: "/api/raids/manage/raider", handler: getRaiderCandidates, area: "raids" },
    { method: "POST", path: "/api/raids/manage/raider", handler: postRaider, area: "raids" },
    { method: "POST", path: "/api/raids/manage/raider/remove", handler: postRaiderRemove, area: "raids" },
    { method: "POST", path: "/api/raids/manage/cancel", handler: postCancel, area: "raids" },
    { method: "POST", path: "/api/raids/manage/reopen", handler: postReopen, area: "raids" },
    { method: "POST", path: "/api/raids/manage/delete", handler: postDelete, area: "raids" },
    { method: "POST", path: "/api/raids/manage/recreate-channel", handler: postRecreateChannel, area: "raids" },
];

module.exports = {
    getManage, getMovePreview, postMove, postSignups, getRaiderCandidates, postRaider, postRaiderRemove, postCancel, postReopen, postDelete, postRecreateChannel,
    routes,
};
