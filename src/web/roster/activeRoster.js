// The roster a request may touch: the one of that id on the server the admin is
// managing (activeGuildFor), like GET /api/rosters/roster reads it. A roster of
// another server answers as if it did not exist (404 "not_found"), so a write
// route never changes a roster the page could not have shown. An empty active
// server (the bot sees none) or a roster without server is not filtered - the
// same rule as rosterView.buildRosterDetail.
const rosterStore = require("../../stores/rosterStore");
const { activeGuildFor } = require("../http/activeGuild");

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/** Whether `roster` belongs to `guildId` (an empty side counts as a match). */
function inGuild(roster, guildId) {
    const gid = str(guildId);
    return !(gid && roster.guildId && roster.guildId !== gid);
}

/** The roster `id` when it exists and belongs to the request's active server, else null. */
function activeRoster(req, id) {
    const roster = rosterStore.getRoster(str(id));
    if (!roster) return null;
    return inGuild(roster, activeGuildFor(req)) ? roster : null;
}

module.exports = { activeRoster, inGuild };
