const { ok, error } = require("../apiResponse");
const { requireAdmin, requireCsrf } = require("../apiMiddleware");
const { readJsonBody } = require("../apiBody");
const { activeGuildFor } = require("../activeGuild");
const {
    listRecruitment, getRecruitment, saveRecruitment, deleteRecruitment,
    listRecruitmentPosts, getRecruitmentPost, saveRecruitmentPost, deleteRecruitmentPost,
    getConfig,
} = require("../settingsStore");
const discord = require("../discord");
const { SPEC_CATALOG } = require("../../utils/recruitmentSpecs");

/**
 * GET /api/recruitment?view=posts|templates|applications&edit=<id>&editpost=<id>
 * Applications are only fetched (a Discord API call) when the applications tab
 * is actually open, mirroring the SSR page's loadRecruitmentOpts().
 */
async function getRecruitmentData(req, res, url) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const guildId = activeGuildFor(req);
    const editId = (url.searchParams.get("edit") || "").trim();
    const editPostId = (url.searchParams.get("editpost") || "").trim();
    const view = url.searchParams.get("view") || "";
    const { applicationChannelId } = getConfig();

    let applications = null;
    let applicationsError = null;
    if (view === "applications" && !editId && !editPostId) {
        const result = await discord.listApplications(applicationChannelId);
        applications = result.applications;
        applicationsError = result.error;
    }

    ok(res, {
        view,
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
}

/** POST /api/recruitment — create/update a template. Body: { id?, name, content, buttonLabel }. */
async function saveRecruitmentTemplate(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    ok(res, saveRecruitment(body), 201);
}

/** POST /api/recruitment/delete — body: { id }. */
async function deleteRecruitmentTemplate(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const id = String(body.id || "").trim();
    if (!id || !deleteRecruitment(id)) return error(res, 404, "not_found", "Vorlage nicht gefunden.");
    ok(res, { id });
}

/** POST /api/recruitment/post — post a template into a channel and track the message. Body: { templateId, channelId }. */
async function postRecruitmentTemplate(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const template = getRecruitment(String(body.templateId || "").trim());
    const channelId = String(body.channelId || "").trim();
    if (!template || !channelId) return error(res, 400, "invalid", "Vorlage oder Channel fehlt.");
    try {
        const posted = await discord.postRecruitment(channelId, template);
        const channel = discord.getClient() ? await discord.getClient().channels.fetch(channelId) : null;
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
        });
        ok(res, saved, 201);
    } catch (e) {
        error(res, 400, "post_failed", e.message || "Posten fehlgeschlagen.");
    }
}

/** POST /api/recruitment/post-update — edit an already-posted message. Body: { id, content, buttonLabel }. */
async function updateRecruitmentPost(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
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
}

/** POST /api/recruitment/post-delete — stop tracking a post (the Discord message stays). Body: { id }. */
async function deleteRecruitmentPostHandler(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const id = String(body.id || "").trim();
    if (!id || !deleteRecruitmentPost(id)) return error(res, 404, "not_found", "Nachricht nicht gefunden.");
    ok(res, { id });
}

/** POST /api/recruitment/scan — scan the active guild's channels for bot recruitment messages. */
async function scanRecruitmentPosts(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const guildId = activeGuildFor(req);
    if (!guildId) return error(res, 400, "no_guild", "Kein Server gewählt.");
    try {
        const found = await discord.scanRecruitment(guildId);
        for (const f of found) saveRecruitmentPost({ ...f, source: "scan" });
        ok(res, { count: found.length });
    } catch (e) {
        error(res, 400, "scan_failed", e.message || "Scan fehlgeschlagen.");
    }
}

module.exports = {
    getRecruitmentData,
    saveRecruitmentTemplate,
    deleteRecruitmentTemplate,
    postRecruitmentTemplate,
    updateRecruitmentPost,
    deleteRecruitmentPostHandler,
    scanRecruitmentPosts,
};
