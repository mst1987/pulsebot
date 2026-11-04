// Which server a per-server library route means: the raid plan library (#945, docs/raidplan.md "Bibliothek je
// Server") and the raid templates (#1076). A read names the server (`?guildId=`, else the active one), a write the
// server the tab loaded (`libraryGuildId`, the GET's `guildId`): the active server is per session, not per tab, so a
// tab of server A whose session switched to B would otherwise write into B (409 `server_switched`, as settings.js
// does). Only a full admin reaches another server than the active one; for everybody else another server is unknown
// (404).
const { error } = require("./apiResponse");
const { activeGuildFor } = require("./activeGuild");
const { getConfig } = require("../../stores/settings/configStore");
const { resolveServer } = require("../../services/discord/roles/guildRoles");
const { firstServerId } = require("../../services/discord/servers/serverOf");

/** Whether `guildId` is a server of the list (the home guild without one). */
function knownServer(guildId) {
    const id = String(guildId || "").trim();
    return !!id && resolveServer({ guildId: id }) === id;
}

/** The library server a read means, or null after the error was sent. */
function libraryReadServer(res, user, req, wanted) {
    const asked = String(wanted || "").trim();
    const active = String(activeGuildFor(req) || "");
    if (asked) {
        if (user.isAdmin ? knownServer(asked) : asked === active) return asked;
        error(res, 404, "not_found", "Server nicht gefunden.");
        return null;
    }
    // a full admin without an active server reads the main server's library (the first of the list)
    const server = active || (user.isAdmin ? String(firstServerId(getConfig()) || "") : "");
    if (server) return server;
    error(res, 400, "no_active_server", "Kein aktiver Discord-Server.");
    return null;
}

/** The library server a write goes to - the tab's (`libraryGuildId`) - or null after the error was sent. */
function libraryWriteServer(res, user, req, tab) {
    const loaded = String(tab || "").trim();
    const active = String(activeGuildFor(req) || "");
    // a full admin writes to the server the tab loaded, whichever is active now
    if (user.isAdmin && loaded) {
        if (knownServer(loaded)) return loaded;
        error(res, 404, "not_found", "Server nicht gefunden.");
        return null;
    }
    if (loaded !== active || !loaded) {
        if (!active && !loaded) error(res, 400, "no_active_server", "Kein aktiver Discord-Server.");
        else error(res, 409, "server_switched", "Der Discord-Server wurde gewechselt – bitte die Seite neu laden.");
        return null;
    }
    return active;
}

module.exports = { knownServer, libraryReadServer, libraryWriteServer };
