// JSON API layer for the React admin client (src/web-client/), the sole admin
// UI (see CLAUDE.md's "Web Admin" section). Mounted under /api/* by server.js's
// handle(). Route handlers live in apiRoutes/, grouped by domain.
const { error } = require("./apiResponse");
const auth = require("./auth");
const { checkAccess } = require("./apiAccess");
const { getSession, postActiveGuild } = require("./apiRoutes/session");
const { getDashboard } = require("./apiRoutes/dashboard");
const { getChannels, createChannel, duplicateChannel } = require("./apiRoutes/channels");
const {
    getSettings, updateSettings, getItemSearch: getSettingsItemSearch,
    saveRaidsheetHandler, deleteRaidsheetHandler,
} = require("./apiRoutes/settings");
const { getRaiderCharacters, saveRaiderCharacters } = require("./apiRoutes/raiderCharacters");
const { getRoster } = require("./apiRoutes/roster");
const { getRaids, getRaidCreateContext, createRaid } = require("./apiRoutes/raids");
const {
    getRaidDetail, postNotify, postPingMissing, postFill, postPostSheet, postPostSoftres,
    getItemSearch, postSoftresCreate, postSoftresLink,
} = require("./apiRoutes/raidDetail");
const {
    getNotifyTemplates, saveNotifyTemplate, deleteNotifyTemplate,
} = require("./apiRoutes/notifyTemplates");
const {
    getRaidTemplates, createRaidTemplate, deleteRaidTemplateHandler, importRaidTemplates,
} = require("./apiRoutes/raidTemplates");
const {
    getRecruitmentData, saveRecruitmentTemplate, deleteRecruitmentTemplate, postRecruitmentTemplate,
    updateRecruitmentPost, deleteRecruitmentPostHandler, scanRecruitmentPosts,
} = require("./apiRoutes/recruitment");
const {
    getHistoryData, getLootStats, deleteHistoryLog, importLoot, setLootCategory, clearHistoryEvent, getHistoryEvent,
    resolveCharacters, getHistoryChar,
} = require("./apiRoutes/history");
const {
    getClaData, createReport, reportStatus, evalLog, evalStatus, resetEval, scanLogs, deleteLogHandler,
    linkLog, linkLogUrl, unlinkLog, autoMatchLogs,
    deleteReportHandler, unlinkReport,
} = require("./apiRoutes/cla");

/**
 * Dispatches an /api/* request, turning any escaping exception into a JSON error.
 *
 * Without this the failure bubbles up to server.js's catch-all, which answers
 * with the plain-text body "error" — the client then chokes on `res.json()` with
 * a bare "Unexpected token" and the real cause stays invisible. The long-running
 * routes (CLA/RPB evaluation) are the likeliest source of such errors, so they
 * are exactly the ones that need a readable message.
 *
 * Every request first passes the area gate (apiAccess.js), so a handler never
 * has to know which permission its endpoint needs.
 */
async function handle(pathname, req, res, url) {
    try {
        const denied = checkAccess(pathname, req.method, auth.getUser(req));
        if (denied) {
            error(res, denied.status, denied.code, denied.message);
            return true;
        }
        return await route(pathname, req, res, url);
    } catch (e) {
        console.error(`API ${req.method} ${pathname} failed:`, (e && e.stack) || e);
        if (!res.headersSent) {
            error(res, 500, "internal_error", (e && e.message) || "Unerwarteter Serverfehler.");
        }
        return true;
    }
}

/** The route table itself. `url` is only needed by routes that read query params. */
async function route(pathname, req, res, url) {
    if (pathname === "/api/session" && req.method === "GET") {
        getSession(req, res);
        return true;
    }
    if (pathname === "/api/session/guild" && req.method === "POST") {
        await postActiveGuild(req, res);
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
    if (pathname === "/api/settings/item-search" && req.method === "GET") {
        await getSettingsItemSearch(req, res, url);
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
    if (pathname === "/api/raider-characters" && req.method === "GET") {
        await getRaiderCharacters(req, res, url);
        return true;
    }
    if (pathname === "/api/raider-characters" && req.method === "POST") {
        await saveRaiderCharacters(req, res);
        return true;
    }
    if (pathname === "/api/roster" && req.method === "GET") {
        await getRoster(req, res);
        return true;
    }
    if (pathname === "/api/raids" && req.method === "GET") {
        await getRaids(req, res);
        return true;
    }
    if (pathname === "/api/raids/new" && req.method === "GET") {
        await getRaidCreateContext(req, res);
        return true;
    }
    if (pathname === "/api/raids" && req.method === "POST") {
        await createRaid(req, res);
        return true;
    }
    if (pathname === "/api/raids/detail" && req.method === "GET") {
        await getRaidDetail(req, res, url);
        return true;
    }
    if (pathname === "/api/raids/notify" && req.method === "POST") {
        await postNotify(req, res);
        return true;
    }
    if (pathname === "/api/raids/ping-missing" && req.method === "POST") {
        await postPingMissing(req, res);
        return true;
    }
    if (pathname === "/api/raids/fill" && req.method === "POST") {
        await postFill(req, res);
        return true;
    }
    if (pathname === "/api/raids/post-sheet" && req.method === "POST") {
        await postPostSheet(req, res);
        return true;
    }
    if (pathname === "/api/raids/post-softres" && req.method === "POST") {
        await postPostSoftres(req, res);
        return true;
    }
    if (pathname === "/api/raids/softres/item-search" && req.method === "GET") {
        await getItemSearch(req, res, url);
        return true;
    }
    if (pathname === "/api/raids/softres" && req.method === "POST") {
        await postSoftresCreate(req, res);
        return true;
    }
    if (pathname === "/api/raids/softres/link" && req.method === "POST") {
        await postSoftresLink(req, res);
        return true;
    }
    if (pathname === "/api/notify-templates" && req.method === "GET") {
        getNotifyTemplates(req, res);
        return true;
    }
    if (pathname === "/api/notify-templates" && req.method === "POST") {
        await saveNotifyTemplate(req, res);
        return true;
    }
    if (pathname === "/api/notify-templates/delete" && req.method === "POST") {
        await deleteNotifyTemplate(req, res);
        return true;
    }
    if (pathname === "/api/raid-templates" && req.method === "GET") {
        getRaidTemplates(req, res);
        return true;
    }
    if (pathname === "/api/raid-templates" && req.method === "POST") {
        await createRaidTemplate(req, res);
        return true;
    }
    if (pathname === "/api/raid-templates/delete" && req.method === "POST") {
        await deleteRaidTemplateHandler(req, res);
        return true;
    }
    if (pathname === "/api/raid-templates/import" && req.method === "POST") {
        await importRaidTemplates(req, res);
        return true;
    }
    if (pathname === "/api/recruitment" && req.method === "GET") {
        await getRecruitmentData(req, res, url);
        return true;
    }
    if (pathname === "/api/recruitment" && req.method === "POST") {
        await saveRecruitmentTemplate(req, res);
        return true;
    }
    if (pathname === "/api/recruitment/delete" && req.method === "POST") {
        await deleteRecruitmentTemplate(req, res);
        return true;
    }
    if (pathname === "/api/recruitment/post" && req.method === "POST") {
        await postRecruitmentTemplate(req, res);
        return true;
    }
    if (pathname === "/api/recruitment/post-update" && req.method === "POST") {
        await updateRecruitmentPost(req, res);
        return true;
    }
    if (pathname === "/api/recruitment/post-delete" && req.method === "POST") {
        await deleteRecruitmentPostHandler(req, res);
        return true;
    }
    if (pathname === "/api/recruitment/scan" && req.method === "POST") {
        await scanRecruitmentPosts(req, res);
        return true;
    }
    if (pathname === "/api/history" && req.method === "GET") {
        await getHistoryData(req, res);
        return true;
    }
    if (pathname === "/api/history/loot-stats" && req.method === "GET") {
        await getLootStats(req, res);
        return true;
    }
    if (pathname === "/api/history/log-delete" && req.method === "POST") {
        await deleteHistoryLog(req, res);
        return true;
    }
    if (pathname === "/api/history/import" && req.method === "POST") {
        await importLoot(req, res);
        return true;
    }
    if (pathname === "/api/history/loot-category" && req.method === "POST") {
        await setLootCategory(req, res);
        return true;
    }
    if (pathname === "/api/history/clear" && req.method === "POST") {
        await clearHistoryEvent(req, res);
        return true;
    }
    if (pathname === "/api/history/event" && req.method === "GET") {
        getHistoryEvent(req, res, url);
        return true;
    }
    if (pathname === "/api/history/characters-resolve" && req.method === "POST") {
        await resolveCharacters(req, res);
        return true;
    }
    if (pathname === "/api/history/char" && req.method === "GET") {
        await getHistoryChar(req, res, url);
        return true;
    }
    if (pathname === "/api/cla" && req.method === "GET") {
        await getClaData(req, res, url);
        return true;
    }
    if (pathname === "/api/cla" && req.method === "POST") {
        await createReport(req, res);
        return true;
    }
    if (pathname === "/api/cla/report-status" && req.method === "GET") {
        reportStatus(req, res, url);
        return true;
    }
    if (pathname === "/api/cla/report-delete" && req.method === "POST") {
        await deleteReportHandler(req, res);
        return true;
    }
    if (pathname === "/api/cla/report-unlink" && req.method === "POST") {
        await unlinkReport(req, res);
        return true;
    }
    if (pathname === "/api/cla/eval" && req.method === "POST") {
        await evalLog(req, res);
        return true;
    }
    if (pathname === "/api/cla/eval-status" && req.method === "GET") {
        evalStatus(req, res, url);
        return true;
    }
    if (pathname === "/api/cla/eval-reset" && req.method === "POST") {
        await resetEval(req, res);
        return true;
    }
    if (pathname === "/api/cla/scan" && req.method === "POST") {
        await scanLogs(req, res);
        return true;
    }
    if (pathname === "/api/cla/log-delete" && req.method === "POST") {
        await deleteLogHandler(req, res);
        return true;
    }
    if (pathname === "/api/cla/log-link" && req.method === "POST") {
        await linkLog(req, res);
        return true;
    }
    if (pathname === "/api/cla/log-link-url" && req.method === "POST") {
        await linkLogUrl(req, res);
        return true;
    }
    if (pathname === "/api/cla/log-unlink" && req.method === "POST") {
        await unlinkLog(req, res);
        return true;
    }
    if (pathname === "/api/cla/log-automatch" && req.method === "POST") {
        await autoMatchLogs(req, res);
        return true;
    }
    error(res, 404, "not_found", "Unbekannter API-Endpunkt.");
    return true;
}

module.exports = { handle };
