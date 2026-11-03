// The Twitch check (docs/twitch.md): one central poll every 2 minutes asks Helix who of
// all servers' streamers is live (each login once, however many servers list it) and
// posts, updates or ends each server's message. Only the live bot polls by itself: a
// test instance must not ask or post in the background; "Jetzt prüfen" works everywhere.
//
// The rules that must hold, each with a test (test/services/twitch/twitchJob.test.js):
// - A failed, timed out or rate limited answer means "unknown", never "offline": nothing
//   counts, nothing ends. A 429 skips the next run as well.
// - The state is written right after every post, so a restart never pings a stream twice.
// - "Ended" takes 2 clean answers in a row without the stream, at least a minute apart.
// - A new stream id within 10 minutes of the end (or of the last sighting) is the same
//   session: the old message goes live again, without a ping, whatever the game filter says.
// - A message deleted in Discord stays deleted for this session: no repost, no second ping.
// - An error of one entry lands on that entry; the others go on. It stays after the stream,
//   until a post or an edit works, even for a stream that never got its message.
// - The "ended" edit gives up 24 hours after its first failed try: `end_gave_up` stays on
//   the entry until the next stream starts, which posts as usual.
const crypto = require("crypto");
const Twitch = require("../../classes/twitch");
const discord = require("../discord/discord");
const { serverLang } = require("../discord/botLanguage");
const { allTwitchStreamers, matchesGameFilter } = require("./twitchSettings");
const { liveCard, endedCard } = require("./twitchCard");
const {
    getTwitchState, setTwitchState, removeTwitchState, listTwitchStates,
} = require("../../stores/discord/twitchStateStore");
const { isLiveInstance } = require("../../config/runMode");
const logger = require("../../logger").child("twitchJob");

const POLL_MS = 2 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
/** Clean answers without the stream before it counts as ended. */
const OFFLINE_RUNS_TO_END = 2;
/** Two offline answers closer than this count once ("Jetzt prüfen" right after the job). */
const OFFLINE_MIN_GAP_MS = MINUTE_MS;
/** A new stream id this soon after the old one is a restart of the same session. */
const RESUME_WINDOW_MS = 10 * MINUTE_MS;
/** At most one edit per message in this time. */
const EDIT_MIN_GAP_MS = 5 * MINUTE_MS;
/** After a 429: longer than one poll, shorter than two, so exactly the next run is skipped. */
const RATE_LIMIT_PAUSE_MS = POLL_MS + 30 * 1000;
/** How long the "ended" edit is tried, from its first failure. */
const END_GIVE_UP_MS = 24 * 60 * MINUTE_MS;
const END_GAVE_UP = "end_gave_up";

let timer = null;
let running = null;
let pausedUntil = 0;
let client = null;
let clientKey = "";
let lastRun = { at: 0, error: "" };

function settingsStore() {
    return require("../../stores/settings/settingsStore");
}

/** The client of the configured app; kept while the credentials stay, so its token stays too. */
function clientFor(cfg) {
    const { clientId = "", clientSecret = "" } = (cfg && cfg.twitch) || {};
    if (!clientId || !clientSecret) return null;
    const key = `${clientId}\n${clientSecret}`;
    if (!client || clientKey !== key) {
        client = new Twitch({ clientId, clientSecret });
        clientKey = key;
    }
    return client;
}

/** Whether anything may be concluded about this server's messages (fallen-out guild = no). */
const reachable = (guildId) => discord.isOnline() && discord.isGuildAvailable(guildId);

/** What a card needs of a stream; survives in the state for the "ended" card. */
function displayOf(stream, login) {
    return {
        name: String(stream.user_name || login),
        title: String(stream.title || ""),
        game: String(stream.game_name || ""),
        viewers: Number(stream.viewer_count) || 0,
        thumbnail: String(stream.thumbnail_url || ""),
    };
}

/** What makes an edit worth it. The picture's time window is left out: alone it never justifies one. */
function hashOf(entry, display) {
    return crypto.createHash("sha1")
        .update(JSON.stringify([display.name, display.title, display.game, display.viewers, entry.text, entry.roleId]))
        .digest("hex");
}

/** A Discord or bot failure as the short code the page explains in words; "" = not the entry's fault. */
function errorCodeOf(e) {
    const code = e && e.code;
    if (code === "bot_offline") return "";
    if (code === "channel_not_found" || code === 10003) return "channel_gone";
    if (code === 50001 || code === 50013) return "no_permission";
    if (code === "wrong_guild") return "wrong_guild";
    return "post_failed";
}

const logFailure = (what, e) => logger.warn(`${what}: ${(e && e.code) || (e && e.status) || "error"}`);

const durationOf = (state, now) => {
    const started = Date.parse(state.startedAt);
    return Number.isNaN(started) ? 0 : Math.max(0, (state.lastSeenAt || now) - started);
};

/**
 * Turn the message into its "ended" card and note the outcome. A message or channel
 * that is gone needs no further try (a gone channel stays on the entry as its error);
 * anything else tries again next run (endPending), for 24 hours from the first failure.
 * Without a message nothing was tried, so an old error stays.
 */
async function finishMessage(cfg, guildId, login, state, now) {
    const patch = { endPending: false, endFailingSince: 0 };
    if (state.messageId && !state.messageGone) {
        const payload = endedCard({ lang: serverLang(cfg, guildId), login, display: state.display, durationMs: durationOf(state, now) });
        try {
            await discord.editPayload(state.channelId, state.messageId, payload);
            patch.lastEditAt = now;
            patch.error = "";
        } catch (e) {
            if (e && (e.code === 10008 || e.code === 10003)) {
                patch.messageId = "";
                patch.messageGone = true;
                patch.error = e.code === 10003 ? errorCodeOf(e) : "";
            } else {
                const since = state.endFailingSince || now;
                if (now - since >= END_GIVE_UP_MS) {
                    patch.error = END_GAVE_UP;
                } else {
                    patch.endPending = true;
                    patch.endFailingSince = since;
                    patch.error = errorCodeOf(e) || state.error;
                }
                logFailure(`ended card of ${login}`, e);
            }
        }
    }
    return setTwitchState(guildId, login, patch);
}

/** Post the announcement (with the one ping) unless the game filter says no; on record at once. */
async function announce(cfg, entry, stream, display, now) {
    const { guildId, login } = entry;
    // an old error stays until a post works; "gave up" belongs to the stream before this one
    const before = getTwitchState(guildId, login).error;
    const keptError = before === END_GAVE_UP ? "" : before;
    const base = {
        announced: false,
        messageGone: false,
        messageId: "",
        channelId: entry.channelId,
        streamId: String(stream.id),
        startedAt: String(stream.started_at || ""),
        lastSeenAt: now,
        endedAt: 0,
        endPending: false,
        endFailingSince: 0,
        offlineCount: 0,
        lastOfflineAt: 0,
        display,
    };
    if (!matchesGameFilter(entry.games, display.game)) {
        setTwitchState(guildId, login, { ...base, hash: "", error: keptError });
        return "filtered";
    }
    const payload = liveCard({ lang: serverLang(cfg, guildId), entry, display, now });
    try {
        const posted = await discord.postPayload(entry.channelId, payload, { guildId, pingRoleId: entry.roleId });
        setTwitchState(guildId, login, {
            ...base,
            announced: true,
            messageId: String(posted.messageId),
            channelId: String(posted.channelId || entry.channelId),
            lastEditAt: now,
            hash: hashOf(entry, display),
            error: "",
        });
        return "announced";
    } catch (e) {
        // not announced: the next run tries again, and only the post that works pings
        setTwitchState(guildId, login, { ...base, hash: "", error: errorCodeOf(e) || keptError });
        logFailure(`post of ${login}`, e);
        return "failed";
    }
}

/** Edit the message to the current live card and note the outcome; a deleted one is never posted again. */
async function refreshMessage(cfg, entry, state, display, now, extra = {}) {
    const { guildId, login } = entry;
    const payload = liveCard({ lang: serverLang(cfg, guildId), entry, display, now });
    try {
        await discord.editPayload(state.channelId, state.messageId, payload);
        setTwitchState(guildId, login, { ...extra, display, lastSeenAt: now, lastEditAt: now, hash: hashOf(entry, display), error: "" });
    } catch (e) {
        if (e && e.code === 10008) {
            setTwitchState(guildId, login, { ...extra, display, lastSeenAt: now, messageId: "", messageGone: true, error: "" });
        } else {
            setTwitchState(guildId, login, { ...extra, display, lastSeenAt: now, lastEditAt: now, error: errorCodeOf(e) || state.error });
            logFailure(`edit of ${login}`, e);
        }
    }
}

/** A stream is running for this entry. */
async function handleLive(cfg, entry, stream, now) {
    const { guildId, login } = entry;
    const state = getTwitchState(guildId, login);
    const display = displayOf(stream, login);
    const streamId = String(stream.id);
    const sameStream = state.streamId === streamId;

    if (sameStream && !state.announced) {
        // still waiting: the filter may pass now (the streamer changed the game), or the last post failed
        return announce(cfg, entry, stream, display, now);
    }
    const lastAlive = state.endedAt || state.lastSeenAt;
    const resuming = !sameStream && state.announced && now - lastAlive <= RESUME_WINDOW_MS;
    if (!sameStream && !resuming) {
        // a stream of its own: the old message (if it was never ended) ends first, then a new announcement
        if (state.announced && !state.endedAt) await finishMessage(cfg, guildId, login, state, now);
        return announce(cfg, entry, stream, display, now);
    }

    const alive = {
        streamId, endedAt: 0, endPending: false, endFailingSince: 0, offlineCount: 0, lastOfflineAt: 0,
    };
    if (state.messageGone || !state.messageId) {
        setTwitchState(guildId, login, { ...alive, display, lastSeenAt: now });
        return "gone";
    }
    if (state.endedAt || resuming) {
        await refreshMessage(cfg, entry, state, display, now, alive);
        return "resumed";
    }
    const due = now - state.lastEditAt >= EDIT_MIN_GAP_MS && hashOf(entry, display) !== state.hash;
    if (due) {
        await refreshMessage(cfg, entry, state, display, now, alive);
        return "updated";
    }
    setTwitchState(guildId, login, { ...alive, lastSeenAt: now, display: state.display || display });
    return "unchanged";
}

/** A clean answer says this entry's stream is not running. */
async function handleOffline(cfg, entry, now) {
    const { guildId, login } = entry;
    const state = getTwitchState(guildId, login);
    if (!state.streamId) return "offline";
    if (!state.announced) {
        // nothing out there to end: filtered out or never posted. Only an error is left to
        // show; the next stream finds no stream id and no announcement, so it posts (and pings) once.
        if (state.error) {
            setTwitchState(guildId, login, {
                streamId: "", startedAt: "", lastSeenAt: 0, offlineCount: 0, lastOfflineAt: 0, display: null,
            });
        } else {
            removeTwitchState(guildId, login);
        }
        return "offline";
    }
    if (state.endedAt) {
        if (state.endPending) await finishMessage(cfg, guildId, login, state, now);
        return "offline";
    }
    if (now - state.lastOfflineAt < OFFLINE_MIN_GAP_MS) return "waiting";
    const offlineCount = state.offlineCount + 1;
    if (offlineCount < OFFLINE_RUNS_TO_END) {
        setTwitchState(guildId, login, { offlineCount, lastOfflineAt: now });
        return "waiting";
    }
    const ended = setTwitchState(guildId, login, { offlineCount, lastOfflineAt: now, endedAt: now });
    await finishMessage(cfg, guildId, login, ended, now);
    return "ended";
}

/** State without an entry (it was removed, perhaps while live): end the message if that works, then forget it. */
async function clearOrphans(cfg, entries, guildId) {
    const listed = new Set(entries.map((e) => `${e.guildId}:${e.login}`));
    for (const { guildId: owner, login, state } of listTwitchStates()) {
        if (guildId && owner !== guildId) continue;
        if (listed.has(`${owner}:${login}`) || !reachable(owner)) continue;
        if (state.announced && !state.endedAt && !state.messageGone && state.messageId) {
            try {
                await discord.editPayload(state.channelId, state.messageId, endedCard({
                    lang: serverLang(cfg, owner), login, display: state.display, durationMs: durationOf(state, Date.now()),
                }));
            } catch (e) {
                logFailure(`ended card of removed ${login}`, e);
            }
        }
        removeTwitchState(owner, login);
    }
}

async function run({ guildId = "", now = Date.now() } = {}) {
    const cfg = settingsStore().getConfig();
    const twitch = clientFor(cfg);
    if (!twitch) return { skipped: "no_credentials" };
    if (!discord.isOnline()) return { skipped: "bot_offline" };
    if (now < pausedUntil) return { skipped: "rate_limited" };

    const all = allTwitchStreamers({ config: cfg });
    await clearOrphans(cfg, all, guildId);
    const entries = guildId ? all.filter((e) => e.guildId === guildId) : all;
    if (!entries.length) {
        lastRun = { at: now, error: "" };
        return { checked: 0, live: 0 };
    }

    let streams;
    try {
        streams = await twitch.getStreams([...new Set(entries.map((e) => e.login))]);
    } catch (e) {
        const limited = e && e.status === 429;
        if (limited) pausedUntil = now + RATE_LIMIT_PAUSE_MS;
        const error = limited ? "rate_limited" : "twitch_unavailable";
        lastRun = { at: now, error };
        logger.warn(`Twitch did not answer (${(e && (e.status || e.kind)) || "error"}): nothing changes this run`);
        return { skipped: error };
    }

    const byLogin = new Map(streams.map((s) => [String(s.user_login || "").toLowerCase(), s]));
    let live = 0;
    for (const entry of entries) {
        if (!reachable(entry.guildId)) continue;
        const stream = byLogin.get(entry.login);
        // Twitch's doc: `type` is "" on an error of that stream, which says nothing either way
        if (stream && stream.type !== "live") continue;
        try {
            if (stream) {
                live += 1;
                await handleLive(cfg, entry, stream, now);
            } else {
                await handleOffline(cfg, entry, now);
            }
        } catch (e) {
            logFailure(`entry ${entry.login} on ${entry.guildId}`, e);
            const error = errorCodeOf(e);
            if (error) setTwitchState(entry.guildId, entry.login, { error });
        }
    }
    lastRun = { at: now, error: "" };
    return { checked: entries.length, live };
}

/**
 * One check; `guildId` limits it to that server ("Jetzt prüfen"). A scheduled run joins
 * the one going; a server's own check waits for it, then runs for that server.
 */
function runTwitchCheck({ guildId = "", now } = {}) {
    if (running) return guildId ? running.then(() => runTwitchCheck({ guildId, now })) : running;
    running = run({ guildId, now: now === undefined ? Date.now() : now })
        .catch((e) => {
            logFailure("run", e);
            return { skipped: "failed" };
        })
        .finally(() => { running = null; });
    return running;
}

/**
 * What the page shows for one server's list: `state` "live" (announced and running),
 * "filtered" (running, no message yet: filter or a failed post), "offline".
 * `postedChannelId`: the channel of the running message when the entry now names another
 * one ("" otherwise): the message stays where it is, the next stream goes to the new channel.
 */
function twitchStatusOf(entries) {
    return (entries || []).map((entry) => {
        const s = getTwitchState(entry.guildId, entry.login);
        const running = !!s.streamId && !s.endedAt;
        const display = s.display || {};
        let state = "offline";
        if (running) state = s.announced ? "live" : "filtered";
        const moved = running && s.announced && !!s.messageId && s.channelId !== entry.channelId;
        return {
            login: entry.login,
            state,
            since: running ? s.startedAt : "",
            endedAt: s.endedAt || 0,
            title: running ? display.title || "" : "",
            game: running ? display.game || "" : "",
            viewers: running ? display.viewers || 0 : 0,
            messageGone: !!s.messageGone,
            postedChannelId: moved ? s.channelId : "",
            error: s.error || "",
        };
    });
}

/** The last run: when, and how Twitch answered ("" = fine). */
const lastTwitchRun = () => ({ ...lastRun });

function startTwitchJob({ intervalMs = POLL_MS, live = isLiveInstance() } = {}) {
    if (timer) return;
    if (!live) {
        logger.info("not the live bot: no automatic Twitch check (Jetzt prüfen still works)");
        return;
    }
    timer = setInterval(() => { runTwitchCheck(); }, intervalMs);
    if (timer.unref) timer.unref();
}

function stopTwitchJob() {
    if (timer) clearInterval(timer);
    timer = null;
}

function _resetForTests() {
    stopTwitchJob();
    running = null;
    pausedUntil = 0;
    client = null;
    clientKey = "";
    lastRun = { at: 0, error: "" };
}

module.exports = { runTwitchCheck, twitchStatusOf, lastTwitchRun, startTwitchJob, stopTwitchJob, _resetForTests };
