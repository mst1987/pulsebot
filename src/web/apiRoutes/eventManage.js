// JSON API of "Event verwalten" (#288) — the actions menu on the raid detail of
// an own event. Every path is area `raids` (apiAccess.js, level by method); the
// two reads additionally want write access, because they only exist to prepare
// an action (who would get a DM, what the channel would be renamed to).
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
const { ok } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { sendResult } = require("../http/apiResult");
const { q } = require("../http/apiParams");
const { activeGuildFor } = require("../http/activeGuild");
const manage = require("../eventManage");

/** A read that prepares an action: menu user with `raids` write. */
const reader = (fn) => withUser({ write: "raids" }, fn);
/** A write: menu user, CSRF, JSON body. */
const action = (fn) => withUser({ csrf: true, body: true }, fn);

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

const postSignups = action(async ({ user, body, req, res }) => {
    sendResult(res, await manage.setSignupsOpen({ guildId: activeGuildFor(req), eventId: body.event, open: body.open === true, user, byName: user.name }));
});

const getRaiderCandidates = reader(async ({ req, res, query }) => {
    sendResult(res, await manage.raiderCandidates({ guildId: activeGuildFor(req), eventId: q.str(query, "event") }));
});

const postRaider = action(async ({ user, body: b, req, res }) => {
    sendResult(res, await manage.addRaider({
        guildId: activeGuildFor(req), eventId: b.event, userId: b.userId, character: b.character, spec: b.spec,
        // further own characters, "kann auch mit" (#293)
        alternates: Array.isArray(b.alternates) ? b.alternates : undefined,
        status: b.status || "signed", comment: b.comment, user, byName: user.name,
    }));
});

const postRaiderRemove = action(async ({ user, body, req, res }) => {
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
];

module.exports = {
    getManage, getMovePreview, postMove, postSignups, getRaiderCandidates, postRaider, postRaiderRemove, postCancel, postReopen, postDelete,
    routes,
};
