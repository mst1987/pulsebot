// JSON API of a raid's voice channel in the setup editor (docs/channels.md "Sprachkanal je
// Raid"): the state of every raid of the event's group, and the two manual
// actions of the "Kanal" menu. The channels themselves are the job's
// (services/voice/tempVoiceJob.js); this file only reads its state and asks it to act.
const { ok, error } = require("../../http/apiResponse");
const { withUser } = require("../../http/apiHandler");
const { q } = require("../../http/apiParams");
const { activeGuildFor } = require("../../http/activeGuild");
const { getEvent } = require("../../../stores/events/eventStore");
const discord = require("../../../services/discord/discord");
const tempVoiceJob = require("../../../services/voice/tempVoiceJob");

// The orga of the raid (global with `raids` write, or a manager of its category, #723); an archived
// raid (a hidden game version) is read only.
const BY_EVENT = (body) => body.event;
const ORGA = { orgaScoped: BY_EVENT, write: "raids", csrf: true, body: true, archived: BY_EVENT };

/** The event when it lies on the active server; a raid of another server is "not found", never shown. */
function eventOnServer(req, eventId) {
    const event = eventId ? getEvent(eventId) : null;
    return event && String(event.guildId) === String(activeGuildFor(req)) ? event : null;
}

/**
 * GET /api/raids/voice?event=<id> - the voice channel of every raid of the event's group:
 * `{ botOnline, raids: [{ eventId, index, total, kind, state, name, url, members, openAt, … }] }`
 * (tempVoiceJob.voiceStatus). Raids without a channel answer `kind: "none"`.
 */
const getVoice = withUser({ orgaScoped: (body, query) => query.get("event") }, async ({ req, res, url }) => {
    const event = eventOnServer(req, (url.searchParams.get("event") || "").trim());
    if (!event) return error(res, 404, "not_found", "Event nicht gefunden.");
    ok(res, { botOnline: !!discord.getGuild(event.guildId), raids: tempVoiceJob.voiceStatus(event) });
});

/** The shared body of "Jetzt anlegen" / "Schließen": the raid of the body's `event`, then the job's action. */
function action(run) {
    return withUser(ORGA, async ({ body, req, res }) => {
        const event = eventOnServer(req, q.str(body, "event"));
        if (!event) return error(res, 404, "not_found", "Event nicht gefunden.");
        const result = await run(event.id);
        if (!result.ok) return error(res, result.status || 400, result.status === 502 ? "discord" : "conflict", result.error);
        ok(res, { raids: tempVoiceJob.voiceStatus(event) });
    });
}

/** POST /api/raids/voice/open - "Jetzt anlegen": the raid's temporary channel now. Body `{ event }`. */
const postVoiceOpen = action((eventId) => tempVoiceJob.openNow(eventId));

/** POST /api/raids/voice/close - "Schließen": the raid's temporary channel now; people in it move to the fixed one. */
const postVoiceClose = action((eventId) => tempVoiceJob.closeNow(eventId));

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/raids/voice", handler: getVoice, area: "raids" },
    { method: "POST", path: "/api/raids/voice/open", handler: postVoiceOpen, area: "raids" },
    { method: "POST", path: "/api/raids/voice/close", handler: postVoiceClose, area: "raids" },
];

module.exports = { getVoice, postVoiceOpen, postVoiceClose, routes };
