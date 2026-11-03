// The posted roster picture keeps itself current ("Roster als Bild", docs/roster-profile.md):
// every minute each remembered picture (rosterStore's imagePost) is compared with what the
// roster shows now, and on a change the same message is edited - nobody is pinged, nothing is
// posted anew. The PNG is drawn only on a change; without a remembered picture a run does nothing
// (the server has one core). The member list is read with `background`: the job does not keep
// a full fetch going itself. Under web/ because the picture is built from the roster page's view.
//
// Deleted in Discord, a picture stays gone: services/discord/linkWatch.js forgets it at once,
// and 10008 / 10003 here catch what happened while the bot was away. Any other refusal (the bot
// lost its rights, Discord hiccups) keeps the picture and tries again next run, warned once.
const rosterStore = require("../../stores/roster/rosterStore");
const { getConfig } = require("../../stores/settings/settingsStore");
const discord = require("../../services/discord/discord");
const { rosterImageModel, pictureHash, drawPicture, pictureLine } = require("./rosterImageView");
const logger = require("../../logger").child("rosterImageLive");

const FIRST_DELAY_MS = 60 * 1000;
const SWEEP_MS = 60 * 1000;

const UNKNOWN_MESSAGE = 10008;
const UNKNOWN_CHANNEL = 10003;

let running = false;
let stopFn = null;
// messages whose failure is already in the log: one line per message, not one a minute
const warned = new Set();

/** Discord says the message or its channel is gone for good (never a matter of rights). */
function isGone(err) {
    const code = err && err.code;
    return code === UNKNOWN_MESSAGE || code === UNKNOWN_CHANNEL || code === "channel_not_found";
}

function warnOnce(messageId, line) {
    if (warned.has(messageId)) return;
    warned.add(messageId);
    logger.warn(line);
}

/**
 * Whether the server's member list can be read now. Without it the roster view falls back to
 * profile names and user ids (rosterView.loadDiscord), and a short outage would overwrite the
 * picture with ids. Read with `background`, so a run triggers a fetch only when the list is
 * older than discord.js' MEMBERS_STALE_MAX_MS or missing; the view below then finds it cached.
 */
async function membersReadable(guildId) {
    try {
        const listed = await discord.listHumanMembers(guildId, { background: true });
        return !!listed && !listed.error;
    } catch {
        return false;
    }
}

/** One roster's picture. Returns what happened: "held", "same", "edited", "gone" or "failed". */
async function refreshPost(roster, { config, now }) {
    const post = roster.imagePost;
    const line = `Roster picture ${roster.id} (message ${post.messageId})`;
    try {
        if (!(await membersReadable(post.guildId))) return "held";
        const built = await rosterImageModel({ guildId: post.guildId, id: roster.id, config, now, background: true });
        if (!built) return "held";
        const hash = pictureHash(built.model, { reserve: post.reserve, chars: post.chars, lang: built.lang });
        if (hash === post.hash) return "same";
        const { png } = drawPicture(built, { showReserve: post.reserve, showMoreChars: post.chars });
        await discord.editPayload(post.channelId, post.messageId, {
            content: pictureLine(built.lang, built.roster.name, now),
            files: [{ attachment: png, name: "roster.png" }],
            attachments: [],
        });
        rosterStore.markImagePostDrawn(roster.id, post.messageId, hash);
        warned.delete(post.messageId);
        return "edited";
    } catch (err) {
        if (isGone(err)) {
            // by message, not by roster: a post made meanwhile stays
            rosterStore.forgetImagePostByMessage(post.messageId);
            warned.delete(post.messageId);
            logger.info(`${line} is gone in Discord, forgotten`);
            return "gone";
        }
        warnOnce(post.messageId, `${line} could not be updated: ${err && err.message}`);
        return "failed";
    }
}

/**
 * One run over every remembered picture, one after another. Never throws; a run that finds the
 * last one still at work does nothing. A closed roster keeps its last picture, and goes on when
 * it is opened again.
 * @returns {Promise<{ posts: number, edited: number, gone: number, failed: number, skipped?: string }>}
 */
async function refreshRosterImages({ now = Date.now() } = {}) {
    const result = { posts: 0, edited: 0, gone: 0, failed: 0 };
    if (running) return { ...result, skipped: "running" };
    running = true;
    try {
        if (!discord.isOnline()) return { ...result, skipped: "offline" };
        const posts = rosterStore.listRosters().filter((r) => r.imagePost && !rosterStore.isClosed(r));
        if (!posts.length) return result;
        const config = getConfig();
        for (const roster of posts) {
            result.posts += 1;
            const outcome = await refreshPost(roster, { config, now });
            if (outcome in result) result[outcome] += 1;
        }
        return result;
    } catch (err) {
        logger.warn(`Roster picture run: ${err && err.message}`);
        return result;
    } finally {
        running = false;
    }
}

/** The first run after a minute, then one a minute; a second call returns the running job's stop. */
function startRosterImageLive({ firstDelayMs = FIRST_DELAY_MS, intervalMs = SWEEP_MS } = {}) {
    if (stopFn) return stopFn;
    let interval = null;
    const first = setTimeout(() => {
        refreshRosterImages();
        interval = setInterval(refreshRosterImages, intervalMs);
        if (interval.unref) interval.unref();
    }, firstDelayMs);
    if (first.unref) first.unref();
    stopFn = () => {
        clearTimeout(first);
        if (interval) clearInterval(interval);
        stopFn = null;
    };
    return stopFn;
}

function stopRosterImageLive() {
    if (stopFn) stopFn();
}

module.exports = { refreshRosterImages, startRosterImageLive, stopRosterImageLive };
