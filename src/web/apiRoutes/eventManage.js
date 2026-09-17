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
const { ok, error } = require("../apiResponse");
const { requireAdmin, requireCsrf } = require("../apiMiddleware");
const { readJsonBody } = require("../apiBody");
const { activeGuildFor } = require("../activeGuild");
const { userCan } = require("../../config/permissions");
const manage = require("../eventManage");

function send(res, result) {
    if (result.error) return error(res, result.error.status, result.error.code, result.error.message);
    return ok(res, result.body, result.status);
}

/** The caller of a read, or null (and a sent 403) without write access. */
function writer(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return null;
    if (!userCan(user, "raids", "write")) {
        error(res, 403, "forbidden", "Dafür brauchst du Schreibrechte für Raids.");
        return null;
    }
    return user;
}

/** Caller and body of a write, or null when the gate already answered. */
async function action(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return null;
    if (!requireCsrf(req, res)) return null;
    const body = await readJsonBody(req);
    return { user, body: body || {}, guildId: activeGuildFor(req) };
}

const q = (url, key) => String((url && url.searchParams && url.searchParams.get(key)) || "").trim();

async function getManage(req, res, url) {
    if (!writer(req, res)) return;
    send(res, await manage.manageInfo({ guildId: activeGuildFor(req), eventId: q(url, "event") }));
}

async function getMovePreview(req, res, url) {
    if (!writer(req, res)) return;
    const result = await manage.movePlan({ guildId: activeGuildFor(req), eventId: q(url, "event"), date: q(url, "date"), time: q(url, "time") });
    if (result.error) return send(res, result);
    ok(res, result.plan);
}

async function postMove(req, res) {
    const a = await action(req, res);
    if (!a) return;
    send(res, await manage.moveEvent({
        guildId: a.guildId, eventId: a.body.event, date: a.body.date, time: a.body.time,
        renameChannel: a.body.renameChannel !== false, notify: a.body.notify !== false, user: a.user, byName: a.user.name,
    }));
}

async function postSignups(req, res) {
    const a = await action(req, res);
    if (!a) return;
    send(res, await manage.setSignupsOpen({ guildId: a.guildId, eventId: a.body.event, open: a.body.open === true, user: a.user, byName: a.user.name }));
}

async function getRaiderCandidates(req, res, url) {
    if (!writer(req, res)) return;
    send(res, await manage.raiderCandidates({ guildId: activeGuildFor(req), eventId: q(url, "event") }));
}

async function postRaider(req, res) {
    const a = await action(req, res);
    if (!a) return;
    const b = a.body;
    send(res, await manage.addRaider({
        guildId: a.guildId, eventId: b.event, userId: b.userId, character: b.character, spec: b.spec,
        // further own characters, "kann auch mit" (#293)
        alternates: Array.isArray(b.alternates) ? b.alternates : undefined,
        status: b.status || "signed", comment: b.comment, user: a.user, byName: a.user.name,
    }));
}

async function postRaiderRemove(req, res) {
    const a = await action(req, res);
    if (!a) return;
    send(res, await manage.removeRaider({ guildId: a.guildId, eventId: a.body.event, userId: a.body.userId, user: a.user, byName: a.user.name }));
}

async function postCancel(req, res) {
    const a = await action(req, res);
    if (!a) return;
    send(res, await manage.cancelEvent({
        guildId: a.guildId, eventId: a.body.event, reason: a.body.reason,
        archiveChannel: a.body.archiveChannel === true, notify: a.body.notify !== false, user: a.user, byName: a.user.name,
    }));
}

async function postReopen(req, res) {
    const a = await action(req, res);
    if (!a) return;
    send(res, await manage.reopenEvent({ guildId: a.guildId, eventId: a.body.event, user: a.user, byName: a.user.name }));
}

async function postDelete(req, res) {
    const a = await action(req, res);
    if (!a) return;
    const b = a.body;
    send(res, await manage.deleteEvent({
        guildId: a.guildId, eventId: b.event,
        // both off unless asked for: mostly test or mistaken events are deleted
        archiveChannel: b.archiveChannel === true, notify: b.notify === true, confirmStarted: b.confirmStarted === true,
        user: a.user, byName: a.user.name,
    }));
}

module.exports = {
    getManage, getMovePreview, postMove, postSignups, getRaiderCandidates, postRaider, postRaiderRemove, postCancel, postReopen, postDelete,
};
