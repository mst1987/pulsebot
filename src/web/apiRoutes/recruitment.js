const { ok, error } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { activeGuildFor } = require("../http/activeGuild");
const {
    listRecruitment, getRecruitment, saveRecruitment, deleteRecruitment,
    listRecruitmentPosts, getRecruitmentPost, saveRecruitmentPost, deleteRecruitmentPost,
    getConfig,
} = require("../../stores/settingsStore");
const discord = require("../discord");
const { SPEC_CATALOG } = require("../../utils/recruitment/recruitmentSpecs");
const { annotateApplication } = require("../recruitmentApplications");

/**
 * GET /api/recruitment?view=posts|templates|applications&edit=<id>&editpost=<id>
 * Applications are only fetched (a Discord API call) when the applications tab
 * is actually open, mirroring the SSR page's loadRecruitmentOpts().
 */
const getRecruitmentData = withUser({}, async ({ req, res, url }) => {
    const guildId = activeGuildFor(req);
    const editId = (url.searchParams.get("edit") || "").trim();
    const editPostId = (url.searchParams.get("editpost") || "").trim();
    const view = url.searchParams.get("view") || "";
    const { applicationChannelId } = getConfig();

    let applications = null;
    let applicationsError = null;
    if (view === "applications" && !editId && !editPostId) {
        const result = await discord.listApplications(applicationChannelId);
        applications = (result.applications || []).map((a) => annotateApplication(a));
        applicationsError = result.error;
    }
    const guild = guildId ? discord.listGuilds().find((g) => g.id === guildId) : null;

    ok(res, {
        view,
        guildName: guild ? guild.name : "",
        templates: listRecruitment(),
        editing: editId ? getRecruitment(editId) : null,
        editingPost: editPostId ? getRecruitmentPost(editPostId) : null,
        posts: guildId ? listRecruitmentPosts().filter((p) => p.guildId === guildId) : listRecruitmentPosts(),
        channels: discord.listTextChannels(guildId),
        emojis: discord.listEmojis(guildId),
        specCatalog: SPEC_CATALOG,
        applications,
        applicationsError,
        applicationChannelId,
        activeGuildId: guildId,
    });
});

/** POST /api/recruitment — create/update a template. Body: { id?, name, content, buttonLabel }. */
const saveRecruitmentTemplate = withUser({ csrf: true, body: true }, async ({ body, res }) => {
    ok(res, saveRecruitment(body), 201);
});

/** POST /api/recruitment/delete — body: { id }. */
const deleteRecruitmentTemplate = withUser({ csrf: true, body: true }, async ({ body, res }) => {
    const id = String(body.id || "").trim();
    if (!id || !deleteRecruitment(id)) return error(res, 404, "not_found", "Vorlage nicht gefunden.");
    ok(res, { id });
});

/** POST /api/recruitment/post — post a template into a channel and track the message. Body: { templateId, channelId }. */
const postRecruitmentTemplate = withUser({ csrf: true, body: true }, async ({ body, res }) => {
    const template = getRecruitment(String(body.templateId || "").trim());
    const channelId = String(body.channelId || "").trim();
    if (!template || !channelId) return error(res, 400, "invalid", "Vorlage oder Channel fehlt.");
    try {
        const posted = await discord.postRecruitment(channelId, template);
        const channel = await discord.fetchTextChannel(channelId).catch(() => null);
        const saved = saveRecruitmentPost({
            guildId: posted.guildId,
            channelId: posted.channelId,
            messageId: posted.messageId,
            channelName: channel ? channel.name : "",
            content: template.content,
            title: template.title,
            body: template.body,
            buttonLabel: template.buttonLabel,
            source: "web",
            templateId: template.id,
        });
        ok(res, saved, 201);
    } catch (e) {
        error(res, 400, "post_failed", e.message || "Posten fehlgeschlagen.");
    }
});

/** POST /api/recruitment/post-update — edit an already-posted message. Body: { id, content, buttonLabel }. */
const updateRecruitmentPost = withUser({ csrf: true, body: true }, async ({ body, res }) => {
    const post = getRecruitmentPost(String(body.id || "").trim());
    if (!post) return error(res, 404, "not_found", "Nachricht nicht gefunden.");
    const template = { content: body.content || "", title: "", body: "", buttonLabel: body.buttonLabel || "" };
    try {
        await discord.editRecruitment(post.channelId, post.messageId, template);
        const saved = saveRecruitmentPost({ id: post.id, ...template });
        ok(res, saved);
    } catch (e) {
        error(res, 400, "update_failed", e.message || "Aktualisieren fehlgeschlagen.");
    }
});

/** POST /api/recruitment/post-delete — stop tracking a post (the Discord message stays). Body: { id }. */
const deleteRecruitmentPostHandler = withUser({ csrf: true, body: true }, async ({ body, res }) => {
    const id = String(body.id || "").trim();
    if (!id || !deleteRecruitmentPost(id)) return error(res, 404, "not_found", "Nachricht nicht gefunden.");
    ok(res, { id });
});

/** POST /api/recruitment/scan — scan the active guild's channels for bot recruitment messages. */
const scanRecruitmentPosts = withUser({ csrf: true }, async ({ req, res }) => {
    const guildId = activeGuildFor(req);
    if (!guildId) return error(res, 400, "no_guild", "Kein Server gewählt.");
    try {
        const found = await discord.scanRecruitment(guildId);
        for (const f of found) saveRecruitmentPost({ ...f, source: "scan" });
        ok(res, { count: found.length });
    } catch (e) {
        error(res, 400, "scan_failed", e.message || "Scan fehlgeschlagen.");
    }
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/recruitment", handler: getRecruitmentData, area: "recruitment" },
    { method: "POST", path: "/api/recruitment", handler: saveRecruitmentTemplate, area: "recruitment" },
    { method: "POST", path: "/api/recruitment/delete", handler: deleteRecruitmentTemplate, area: "recruitment" },
    { method: "POST", path: "/api/recruitment/post", handler: postRecruitmentTemplate, area: "recruitment" },
    { method: "POST", path: "/api/recruitment/post-update", handler: updateRecruitmentPost, area: "recruitment" },
    { method: "POST", path: "/api/recruitment/post-delete", handler: deleteRecruitmentPostHandler, area: "recruitment" },
    { method: "POST", path: "/api/recruitment/scan", handler: scanRecruitmentPosts, area: "recruitment" },
];

module.exports = {
    getRecruitmentData,
    saveRecruitmentTemplate,
    deleteRecruitmentTemplate,
    postRecruitmentTemplate,
    updateRecruitmentPost,
    deleteRecruitmentPostHandler,
    scanRecruitmentPosts,
    routes,
};
