// JSON API layer for the React admin client (src/web-client/), built up alongside
// the existing SSR routes in server.js — see CLAUDE.md / the migration plan for
// context. Mounted under /api/* by server.js's handle(). Route handlers live in
// apiRoutes/, grouped by domain the same way renderAdmin.js/server.js are.
const { error } = require("./apiResponse");
const { getSession } = require("./apiRoutes/session");
const { getDashboard } = require("./apiRoutes/dashboard");
const { getChannels, createChannel, duplicateChannel } = require("./apiRoutes/channels");
const {
    getSettings, updateSettings, saveRaidsheetHandler, deleteRaidsheetHandler,
} = require("./apiRoutes/settings");

/** Dispatches an /api/* request. Returns true if handled, false to fall through. */
async function handle(pathname, req, res) {
    if (pathname === "/api/session" && req.method === "GET") {
        getSession(req, res);
        return true;
    }
    if (pathname === "/api/dashboard" && req.method === "GET") {
        await getDashboard(req, res);
        return true;
    }
    if (pathname === "/api/channels" && req.method === "GET") {
        getChannels(req, res);
        return true;
    }
    if (pathname === "/api/channels" && req.method === "POST") {
        await createChannel(req, res);
        return true;
    }
    if (pathname === "/api/channels/duplicate" && req.method === "POST") {
        await duplicateChannel(req, res);
        return true;
    }
    if (pathname === "/api/settings" && req.method === "GET") {
        getSettings(req, res);
        return true;
    }
    if (pathname === "/api/settings" && req.method === "PATCH") {
        await updateSettings(req, res);
        return true;
    }
    if (pathname === "/api/settings/raidsheets" && req.method === "POST") {
        await saveRaidsheetHandler(req, res);
        return true;
    }
    if (pathname === "/api/settings/raidsheets/delete" && req.method === "POST") {
        await deleteRaidsheetHandler(req, res);
        return true;
    }
    error(res, 404, "not_found", "Unbekannter API-Endpunkt.");
    return true;
}

module.exports = { handle };
