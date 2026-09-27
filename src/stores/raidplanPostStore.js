const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");

// Where the raid plan's read link ("Einteilungen", /p/<token>) was posted into
// an event's channel (POST /api/raids/post-raidplan, #502). Keyed by event id,
// so posting again edits that same message instead of writing a second one —
// the same idea as the raidsheet's `posted*` fields in eventSheetStore.js, but
// kept apart: a plan post must not make a raid look like it had a sheet.
const store = createJsonStore({ file: settingsPath("raidplan-posts.json"), defaults: { posts: [] } });

const str = (v) => String(v || "").trim();

function readPosts() {
    const data = store.read();
    return Array.isArray(data.posts) ? data.posts : [];
}

/** The post record of one event id — `{ eventId, channelId, messageId, message, postedAt, postedBy }` — or null. */
function getRaidplanPost(eventId) {
    const id = str(eventId);
    if (!id) return null;
    return readPosts().find((p) => p && p.eventId === id) || null;
}

/**
 * Record that the link was posted (or the message edited). Called after
 * `discord.postLink`/`editLink`; returns the saved record, null for a blank id.
 */
function markRaidplanPosted(eventId, { channelId, messageId, message, userId, now = Date.now() } = {}) {
    const id = str(eventId);
    if (!id) return null;
    const posts = readPosts().filter((p) => p && p.eventId !== id);
    const saved = {
        eventId: id,
        channelId: str(channelId),
        messageId: str(messageId),
        message: str(message),
        postedAt: Number(now) || Date.now(),
        postedBy: str(userId),
    };
    posts.push(saved);
    store.write({ posts });
    return saved;
}

/** Forget an event's post (the event is gone). Returns true when one was removed. */
function deleteRaidplanPost(eventId) {
    const id = str(eventId);
    const posts = readPosts();
    const rest = posts.filter((p) => !(p && p.eventId === id));
    if (rest.length === posts.length) return false;
    store.write({ posts: rest });
    return true;
}

module.exports = { getRaidplanPost, markRaidplanPosted, deleteRaidplanPost, useFile: store.useFile };
