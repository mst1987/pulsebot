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
const { getRaids, getRaidCreateContext, createRaid } = require("./apiRoutes/raids");
const {
    getRaidTemplates, createRaidTemplate, deleteRaidTemplateHandler, importRaidTemplates,
} = require("./apiRoutes/raidTemplates");
const {
    getRecruitmentData, saveRecruitmentTemplate, deleteRecruitmentTemplate, postRecruitmentTemplate,
    updateRecruitmentPost, deleteRecruitmentPostHandler, scanRecruitmentPosts,
} = require("./apiRoutes/recruitment");

/** Dispatches an /api/* request. `url` is only needed by routes that read query params. */
async function handle(pathname, req, res, url) {
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
    error(res, 404, "not_found", "Unbekannter API-Endpunkt.");
    return true;
}

module.exports = { handle };
