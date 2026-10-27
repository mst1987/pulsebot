// Einstellungen → <Server> → Log-Auswertung → Warcraft-Logs-Gilde (#922): the
// "Jetzt abrufen" button. The list itself is saved with PATCH /api/settings
// (wclGuilds); this route only fetches one entry of the active server now,
// whatever its interval. Same right as the log channels: settings, write.
const { ok, error } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { activeGuildFor } = require("../http/activeGuild");
const { getConfig } = require("../../stores/settingsStore");
const { wclGuildsOf, entryKey } = require("../../services/logcheck/wclGuildSettings");
const wclGuildSync = require("../../services/logcheck/wclGuildSync");

/**
 * POST /api/settings/wcl-guilds/fetch — body: { key, serverSettingsGuildId }.
 * Only on the active server; a tab that loaded another one gets 409
 * `server_switched` (like the settings PATCH). A double click or the minute job
 * fetching the same entry joins that fetch instead of asking WCL twice.
 */
const postFetch = withUser({ csrf: true, body: true }, async ({ body, req, res }) => {
    const guildId = activeGuildFor(req);
    if (!guildId) return error(res, 400, "no_active_server", "Kein aktiver Server gewählt.");
    // like serverSettingsTarget: a body without the loaded server counts as switched
    if (String(body.serverSettingsGuildId || "") !== guildId) {
        return error(res, 409, "server_switched", "Der aktive Server wurde inzwischen gewechselt. Bitte die Seite neu laden.");
    }
    const key = typeof body.key === "string" ? body.key : "";
    const entry = wclGuildsOf(guildId, { config: getConfig() }).find((e) => entryKey(e) === key);
    if (!entry) return error(res, 404, "not_found", "Diese Gilde ist auf diesem Server nicht eingetragen (erst speichern).");
    const result = await wclGuildSync.fetchEntry(guildId, key);
    if (!result) return error(res, 404, "not_found", "Diese Gilde ist auf diesem Server nicht eingetragen (erst speichern).");
    ok(res, { key, result, wclGuilds: wclGuildsOf(guildId, { config: getConfig() }) });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "POST", path: "/api/settings/wcl-guilds/fetch", handler: postFetch, area: "settings" },
];

module.exports = { postFetch, routes };
