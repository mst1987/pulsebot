const { ok, error } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { activeGuildFor } = require("../http/activeGuild");
const { mayUseServer, mayUseChannel, guildOfChannel, OTHER_SERVER } = require("../http/serverQuery");
const {
    listRecruitment, getRecruitment, saveRecruitment, deleteRecruitment,
    listRecruitmentPosts, getRecruitmentPost, saveRecruitmentPost, deleteRecruitmentPost,
    getConfig,
} = require("../../stores/settingsStore");
const discord = require("../../services/discord/discord");
const serverDefaults = require("../../services/discord/serverDefaults");
const { SPEC_CATALOG } = require("../../utils/recruitment/recruitmentSpecs");
const { annotateApplication } = require("../recruitment/recruitmentApplications");
const { VERSIONS } = require("../../config/gameVersions");
const { cleanInviteUrl } = require("../../utils/recruitment/inviteLink");
const { serverLang } = require("../../services/discord/botLanguage");
const { tr } = require("../../utils/i18n/botText");

/** At most `max` characters, counted in code points: an emoji is never cut in half. */
function cut(text, max) {
    return Array.from(text).slice(0, max).join("");
}
const { mainVersionFor, visibleRows, visibleVersions, resolveVersionQuery } = require("../../services/events/mainVersion");

/**
 * The servers a link button's invite can come from: the bot's servers the caller may act on, each with its channels
 * (`canInvite`: the bot may create an invite there) and the channel of a recruitment post already tracked there as the
 * suggestion.
 */
function inviteServersFor(user, req) {
    const posts = listRecruitmentPosts();
    return discord.listGuilds().filter((g) => mayUseServer(user, req, g.id)).map((g) => {
        const channels = discord.listInviteChannels(g.id);
        const ids = new Set(channels.map((c) => c.id));
        const known = posts.filter((p) => p.guildId === g.id).map((p) => p.parentChannelId || p.channelId).find((id) => ids.has(id));
        const suggestion = known || (channels.find((c) => c.canInvite) || {}).id || "";
        return { id: g.id, name: g.name, channels, suggestedChannelId: suggestion };
    });
}

/**
 * The button part of a post request: `{ buttonKind, linkUrl, buttonLabel }`, or `{ error }` for a link that is not a
 * Discord invite or channel link (checked here, never trusted from the client).
 */
function buttonOf(body, fallback = {}) {
    const kind = body.buttonKind === "link" || body.buttonKind === "apply" ? body.buttonKind : (fallback.buttonKind || "apply");
    const label = cut(String(body.buttonLabel !== undefined ? body.buttonLabel : (fallback.buttonLabel || "")).trim(), 80);
    if (kind === "apply") return { buttonKind: "apply", linkUrl: "", buttonLabel: label };
    const linkUrl = cleanInviteUrl(body.linkUrl !== undefined ? body.linkUrl : fallback.linkUrl);
    if (!linkUrl) return { error: "Nur Discord-Einladungen (discord.gg/…, discord.com/invite/…) oder Discord-Kanal-Links sind erlaubt." };
    return { buttonKind: "link", linkUrl, buttonLabel: label };
}

const FORUM_TITLE_MAX = 100;
const titleOf = (value) => cut(String(value || "").trim(), FORUM_TITLE_MAX);

/** The default label of a new link button: "Server beitreten" / "Join server" in the language of the server it goes on. */
const defaultLinkLabel = (guildId) => tr(serverLang(getConfig(), guildId), "Join server");

/**
 * GET /api/recruitment?view=posts|templates|applications&edit=<id>&editpost=<id>
 * Applications are only fetched (a Discord API call) when the applications tab
 * is actually open, mirroring the SSR page's loadRecruitmentOpts().
 */
const getRecruitmentData = withUser({}, async ({ user, req, res, url }) => {
    const guildId = activeGuildFor(req);
    const editId = (url.searchParams.get("edit") || "").trim();
    const editPostId = (url.searchParams.get("editpost") || "").trim();
    const view = url.searchParams.get("view") || "";
    // The application channel of the active server (#924): "" lists nothing.
    const applicationChannelId = serverDefaults.applicationChannelId(guildId);
    // One game version (#741): `?version=` narrows the three lists to it (nothing asked = every shown version);
    // an entry an editor is opened on stays, whatever its version.
    const asked = url.searchParams.get("version");
    const pageVersion = asked === null ? "" : resolveVersionQuery(asked, { config: getConfig() }).versionId;
    const ofPage = (rows, keepId = "") => (pageVersion && rows ? rows.filter((r) => (r.versionId || "tbc") === pageVersion || (keepId && r.id === keepId)) : rows);

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
        // Other versions hidden (#563): their templates, posts and applications stay out.
        templates: ofPage(visibleRows(listRecruitment(), (r) => r.versionId), editId),
        editing: editId ? getRecruitment(editId) : null,
        editingPost: editPostId ? getRecruitmentPost(editPostId) : null,
        posts: ofPage(visibleRows(guildId ? listRecruitmentPosts().filter((p) => p.guildId === guildId) : listRecruitmentPosts(), (p) => p.versionId), editPostId),
        channels: discord.listTextChannels(guildId),
        // Where a post may go: the text channels plus the forums (kind "forum": a post with a title).
        targets: discord.listRecruitmentTargets(guildId),
        // Servers the bot may make an invite on for a link button: only those the caller may act on (#925) -
        // for any other server (a partner guild's) the link is pasted by hand.
        inviteServers: inviteServersFor(user, req),
        // the label a new link button gets when none is typed: in the language of the active server (posts go there)
        defaultLinkLabel: defaultLinkLabel(guildId),
        emojis: discord.listEmojis(guildId),
        specCatalog: SPEC_CATALOG,
        applications: ofPage(visibleRows(applications, (a) => a.versionId || "tbc")),
        applicationsError,
        applicationChannelId,
        activeGuildId: guildId,
        // The version filter and the template's version switch (#553): every
        // template, post and application carries a versionId; the page filters.
        gameVersions: VERSIONS.filter((v) => visibleVersions().includes(v.id)).map((v) => ({ id: v.id, label: v.label, short: v.short })),
        mainVersion: mainVersionFor(),
    });
});

/** POST /api/recruitment — create/update a template. Body: { id?, name, content, buttonLabel, versionId? } (versionId: new = main version, #553). */
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
const postRecruitmentTemplate = withUser({ csrf: true, body: true }, async ({ user, req, body, res }) => {
    const template = getRecruitment(String(body.templateId || "").trim());
    const channelId = String(body.channelId || "").trim();
    if (!template || !channelId) return error(res, 400, "invalid", "Vorlage oder Channel fehlt.");
    // a channel of another server is out of reach (#925): only a full admin posts on every server
    if (!mayUseChannel(user, req, channelId)) return error(res, 403, "other_server", OTHER_SERVER);
    const button = buttonOf(body, template);
    if (button.error) return error(res, 400, "invalid_link", button.error);
    // a new link button without a typed label gets the default in the server's language; a typed one stays as it is
    if (button.buttonKind === "link" && !button.buttonLabel) button.buttonLabel = defaultLinkLabel(guildOfChannel(channelId) || activeGuildFor(req));
    const forumTitle = titleOf(body.forumTitle);
    const message = { ...template, ...button, forumTitle };
    try {
        const posted = await discord.postRecruitment(channelId, message);
        // a forum post is listed under its forum's name
        const client = discord.getClient();
        const channel = posted.parentChannelId
            ? (client ? await client.channels.fetch(posted.parentChannelId).catch(() => null) : null)
            : await discord.fetchTextChannel(channelId).catch(() => null);
        const saved = saveRecruitmentPost({
            guildId: posted.guildId,
            channelId: posted.channelId,
            messageId: posted.messageId,
            channelName: channel ? channel.name : "",
            content: template.content,
            title: template.title,
            body: template.body,
            buttonLabel: button.buttonLabel,
            source: "web",
            templateId: template.id,
            // the version the posted button names (#553)
            versionId: template.versionId,
            buttonKind: button.buttonKind,
            linkUrl: button.linkUrl,
            parentChannelId: posted.parentChannelId || "",
            forumTitle: posted.parentChannelId ? forumTitle : "",
        });
        ok(res, saved, 201);
    } catch (e) {
        if (e && e.code === "title_required") return error(res, 400, "title_required", e.message);
        error(res, 400, "post_failed", e.message || "Posten fehlgeschlagen.");
    }
});

/**
 * POST /api/recruitment/invite — a permanent invite for a link button. Body: { guildId, channelId, fresh? }.
 * Only on a server the caller may act on (#925: a full admin every server, everybody else the active one) and only into a
 * channel of that server; a partner guild's link is pasted by hand instead.
 */
const createRecruitmentInviteHandler = withUser({ csrf: true, body: true }, async ({ user, req, body, res }) => {
    const guildId = String(body.guildId || "").trim();
    const channelId = String(body.channelId || "").trim();
    if (!guildId || !channelId) return error(res, 400, "invalid", "Server oder Kanal fehlt.");
    if (!mayUseServer(user, req, guildId)) return error(res, 403, "other_server", OTHER_SERVER);
    if (guildOfChannel(channelId) !== guildId) return error(res, 400, "wrong_guild", "Der Kanal liegt nicht auf diesem Server.");
    try {
        // the bot's permanent invite there is reused; `fresh` ("Neu erzeugen") makes a new one
        const invite = await discord.createRecruitmentInvite(channelId, `Recruitment-Link (${user.username || user.id || "Web"})`,
            { fresh: body.fresh === true });
        ok(res, invite, 201);
    } catch (e) {
        if (e && e.code === "invite_permission") return error(res, 400, "invite_permission", e.message);
        error(res, 400, "invite_failed", e.message || "Einladung konnte nicht erstellt werden.");
    }
});

/**
 * A tracked post the caller may reach (#925: a full admin every server, everybody else
 * the active one), else null - a post of another server does not exist here.
 */
function ownPost(id, user, req) {
    const post = id ? getRecruitmentPost(id) : null;
    return post && mayUseServer(user, req, post.guildId) ? post : null;
}

/**
 * POST /api/recruitment/post-update — edit an already-posted message. Body: { id, content, buttonLabel, linkUrl?, forumTitle? }.
 * The kind of button stays (an apply post stays one); a link post may get a new link, a forum post a new title. A title
 * Discord refuses for now (2 renames per 10 minutes) does not fail the edit: the answer carries `notice:
 * "title_rate_limited"` (or "title_failed") and the stored title stays the old one.
 */
const updateRecruitmentPost = withUser({ csrf: true, body: true }, async ({ user, req, body, res }) => {
    const post = ownPost(String(body.id || "").trim(), user, req);
    if (!post) return error(res, 404, "not_found", "Nachricht nicht gefunden.");
    const button = buttonOf({ buttonLabel: body.buttonLabel || "", linkUrl: body.linkUrl }, post);
    if (button.error) return error(res, 400, "invalid_link", button.error);
    const forumTitle = post.parentChannelId ? (titleOf(body.forumTitle) || post.forumTitle || "") : "";
    // The button keeps the version of the post (#553) — an edit changes the text, not whose applications it collects.
    const template = { content: body.content || "", title: "", body: "", ...button, versionId: post.versionId, forumTitle };
    try {
        const edited = await discord.editRecruitment(post.channelId, post.messageId, template);
        // the text is saved even when Discord refused the new title for now: the post keeps its old title, `notice` says so
        const notice = (edited && edited.notice) || "";
        const saved = saveRecruitmentPost({ id: post.id, ...template, ...(notice ? { forumTitle: post.forumTitle || "" } : {}) });
        ok(res, { ...saved, notice });
    } catch (e) {
        if (e && e.code === "thread_locked") return error(res, 400, "thread_locked", e.message);
        error(res, 400, "update_failed", e.message || "Aktualisieren fehlgeschlagen.");
    }
});

/** POST /api/recruitment/post-delete — stop tracking a post (the Discord message stays). Body: { id }. */
const deleteRecruitmentPostHandler = withUser({ csrf: true, body: true }, async ({ user, req, body, res }) => {
    const id = String(body.id || "").trim();
    if (!ownPost(id, user, req) || !deleteRecruitmentPost(id)) return error(res, 404, "not_found", "Nachricht nicht gefunden.");
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
    { method: "POST", path: "/api/recruitment/invite", handler: createRecruitmentInviteHandler, area: "recruitment" },
    { method: "POST", path: "/api/recruitment/post-delete", handler: deleteRecruitmentPostHandler, area: "recruitment" },
    { method: "POST", path: "/api/recruitment/scan", handler: scanRecruitmentPosts, area: "recruitment" },
];

module.exports = {
    getRecruitmentData,
    saveRecruitmentTemplate,
    deleteRecruitmentTemplate,
    postRecruitmentTemplate,
    updateRecruitmentPost,
    createRecruitmentInviteHandler,
    deleteRecruitmentPostHandler,
    scanRecruitmentPosts,
    routes,
};
