// Recruitment templates and the recruitment messages posted from them (#420):
// data/settings/recruitment.json ({ templates }) and recruitment-posts.json
// ({ posts }), one file each.
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");
const { newId } = require("../utils/ids");

const templatesStore = createJsonStore({ file: settingsPath("recruitment.json"), defaults: { templates: [] } });
const postsStore = createJsonStore({ file: settingsPath("recruitment-posts.json"), defaults: { posts: [] } });

/** All recruitment templates, newest-edited first. */
function listRecruitment() {
    const data = templatesStore.read();
    const templates = Array.isArray(data.templates) ? data.templates : [];
    return templates.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/** A single recruitment template by id, or null. */
function getRecruitment(id) {
    return listRecruitment().find((t) => t.id === id) || null;
}

/**
 * Create or update a recruitment template. If `data.id` matches an existing
 * template it is updated, otherwise a new one is created. Returns the saved template.
 */
function saveRecruitment(data) {
    const templates = listRecruitment();
    const clean = {
        name: String(data.name || "").trim(),
        content: String(data.content || ""),
        title: String(data.title || "").trim(),
        body: String(data.body || ""),
        buttonLabel: String(data.buttonLabel || "").trim(),
    };
    const existing = data.id && templates.find((t) => t.id === data.id);
    let saved;
    if (existing) {
        saved = Object.assign(existing, clean, { updatedAt: Date.now() });
    } else {
        saved = Object.assign({ id: newId(), createdAt: Date.now(), updatedAt: Date.now() }, clean);
        templates.push(saved);
    }
    templatesStore.write({ templates });
    return saved;
}

/** Delete a recruitment template by id. Returns true if one was removed. */
function deleteRecruitment(id) {
    const templates = listRecruitment();
    const next = templates.filter((t) => t.id !== id);
    if (next.length === templates.length) return false;
    templatesStore.write({ templates: next });
    return true;
}

// ---- posted recruitment messages (tracked so they can be edited later) ----

/** All tracked posted recruitment messages, newest first. */
function listRecruitmentPosts() {
    const data = postsStore.read();
    const posts = Array.isArray(data.posts) ? data.posts : [];
    return posts.slice().sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0));
}

function getRecruitmentPost(id) {
    return listRecruitmentPosts().find((p) => p.id === id) || null;
}

/**
 * Record or update a posted recruitment message. Deduplicates by
 * (channelId, messageId) so a re-scan doesn't create duplicates.
 * Returns the saved post.
 */
function saveRecruitmentPost(data) {
    const posts = listRecruitmentPosts();
    const match = posts.find((p) =>
        (data.id && p.id === data.id)
        || (p.channelId === data.channelId && p.messageId === data.messageId));
    const clean = {
        guildId: data.guildId || (match && match.guildId) || "",
        channelId: data.channelId || (match && match.channelId) || "",
        messageId: data.messageId || (match && match.messageId) || "",
        channelName: data.channelName || (match && match.channelName) || "",
        content: data.content || "",
        title: data.title || "",
        body: data.body || "",
        buttonLabel: data.buttonLabel || "",
        // A message the admin menu posted stays "web" when a later scan finds it
        // again — the scan only knows that it exists, not where it came from.
        source: (match && match.source === "web") ? "web" : (data.source || (match && match.source) || "web"),
        // Which template it was posted from — kept across edits and re-scans; a
        // message the scan found on its own has none.
        templateId: data.templateId || (match && match.templateId) || "",
    };
    let saved;
    if (match) {
        saved = Object.assign(match, clean, { updatedAt: Date.now() });
    } else {
        saved = Object.assign({ id: newId(), postedAt: Date.now(), updatedAt: Date.now() }, clean);
        posts.push(saved);
    }
    postsStore.write({ posts });
    return saved;
}

/** Remove a tracked post (does not touch the Discord message). Returns true if removed. */
function deleteRecruitmentPost(id) {
    const posts = listRecruitmentPosts();
    const next = posts.filter((p) => p.id !== id);
    if (next.length === posts.length) return false;
    postsStore.write({ posts: next });
    return true;
}
/** Tests: other files for the templates and the posts; null = the defaults again. */
function useFile(templatesFile, postsFile) {
    templatesStore.useFile(templatesFile);
    postsStore.useFile(postsFile);
}

module.exports = {
    listRecruitment, getRecruitment, saveRecruitment, deleteRecruitment,
    listRecruitmentPosts, getRecruitmentPost, saveRecruitmentPost, deleteRecruitmentPost,
    useFile,
};
