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
//   the entry until the next stream starts, which posts as usual. That holds for old
//   messages too: one whose edit still fails when a new stream starts moves to `pendingEnds`.
// - A post that went out counts, even when writing its state fails: the process remembers
//   it and does not ping that stream again, and the next run writes it.
// - An entry removed while live leaves a tombstone with the stream id until Twitch says that
//   stream is over. Put back in the same stream it pings nothing: the old message goes live again.
// - Running without entries says nothing about Twitch: only a run over all servers notes it,
//   so "Jetzt prüfen" on an empty server does not wipe the error another server caused.
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
/** The credentials Twitch refused in the last run; apart from `lastRun`, which goes into the view. */
let rejectedKey = "";
/** Posts that went out but whose state could not be written: "<guild>:<login>" -> { guildId, login, patch }. */
const unwrittenPosts = new Map();

function settingsStore() {
    return require("../../stores/settings/settingsStore");
}

/** Identifies one set of credentials in memory ("" = incomplete); never leaves this module. */
function credentialsKeyOf(cfg) {
    const { clientId = "", clientSecret = "" } = (cfg && cfg.twitch) || {};
    return clientId && clientSecret ? `${clientId}\n${clientSecret}` : "";
}

/** The client of the configured app; kept while the credentials stay, so its token stays too. */
function clientFor(cfg) {
    const key = credentialsKeyOf(cfg);
    if (!key) return null;
    if (!client || clientKey !== key) {
        const { clientId, clientSecret } = cfg.twitch;
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

/** Discord says the message or its channel no longer exists: no further try can work. */
const isGone = (e) => !!e && (e.code === 10008 || e.code === 10003 || e.code === "channel_not_found");

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
    // "gave up" is about an older message that stays on "live": this edit does not cure it
    const keptGaveUp = state.error === END_GAVE_UP ? END_GAVE_UP : "";
    if (state.messageId && !state.messageGone) {
        const payload = endedCard({ lang: serverLang(cfg, guildId), login, display: state.display, durationMs: durationOf(state, now) });
        try {
            await discord.editPayload(state.channelId, state.messageId, payload);
            patch.lastEditAt = now;
            patch.error = keptGaveUp;
        } catch (e) {
            if (isGone(e)) {
                patch.messageId = "";
                patch.messageGone = true;
                patch.error = e.code === 10008 ? keptGaveUp : errorCodeOf(e);
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

/** An old message whose "ended" edit still fails, as `pendingEnds` keeps it. */
const pendingOf = (state, now) => ({
    messageId: state.messageId,
    channelId: state.channelId,
    display: state.display,
    startedAt: state.startedAt,
    lastSeenAt: state.lastSeenAt,
    endFailingSince: state.endFailingSince || now,
});

/**
 * A new stream takes over the record, so its old message gets one more try at its "ended"
 * card; if that fails, it moves to `pendingEnds` and the new stream posts all the same.
 */
async function closeOldMessage(cfg, guildId, login, state, now) {
    const tried = !state.endedAt || state.endPending ? await finishMessage(cfg, guildId, login, state, now) : state;
    if (!tried.endPending || !tried.messageId) return;
    setTwitchState(guildId, login, {
        pendingEnds: [...tried.pendingEnds, pendingOf(tried, now)],
        endPending: false,
        endFailingSince: 0,
        messageId: "",
    });
}

/** Try the "ended" edit of the old messages once more; gone or 24 hours old drops them. */
async function retryPendingEnds(cfg, guildId, login, state, now) {
    const open = [];
    let gaveUp = false;
    let cured = false;
    for (const end of state.pendingEnds) {
        try {
            await discord.editPayload(end.channelId, end.messageId, endedCard({
                lang: serverLang(cfg, guildId), login, display: end.display, durationMs: durationOf(end, now),
            }));
            cured = true;
        } catch (e) {
            if (isGone(e)) continue;
            logFailure(`old ended card of ${login}`, e);
            if (now - end.endFailingSince >= END_GIVE_UP_MS) gaveUp = true;
            else open.push(end);
        }
    }
    if (open.length === state.pendingEnds.length) return;
    const patch = { pendingEnds: open };
    if (gaveUp) patch.error = END_GAVE_UP;
    // with no stream running, the only thing that error can still be about is the edit that just worked
    else if (cured && !open.length && !state.streamId && state.error !== END_GAVE_UP) patch.error = "";
    const next = setTwitchState(guildId, login, patch);
    if (!open.length && !next.streamId && !next.error) removeTwitchState(guildId, login);
}

/** Post the announcement (with the one ping) unless the game filter says no; on record at once. */
async function announce(cfg, entry, stream, display, now) {
    const { guildId, login } = entry;
    const before = getTwitchState(guildId, login);
    // "gave up" belongs to the streams before this one: the same stream keeps it, a new one drops it
    const cleanError = before.streamId === String(stream.id) && before.error === END_GAVE_UP ? END_GAVE_UP : "";
    // any other old error stays until a post works
    const keptError = before.error === END_GAVE_UP ? cleanError : before.error;
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
        removedAt: 0,
        offlineCount: 0,
        lastOfflineAt: 0,
        display,
    };
    if (!matchesGameFilter(entry.games, display.game)) {
        setTwitchState(guildId, login, { ...base, hash: "", error: keptError });
        return "filtered";
    }
    const payload = liveCard({ lang: serverLang(cfg, guildId), entry, display, now });
    let posted;
    try {
        posted = await discord.postPayload(entry.channelId, payload, { guildId, pingRoleId: entry.roleId });
    } catch (e) {
        // not announced: the next run tries again, and only the post that works pings
        setTwitchState(guildId, login, { ...base, hash: "", error: errorCodeOf(e) || keptError });
        logFailure(`post of ${login}`, e);
        return "failed";
    }
    const patch = {
        ...base,
        announced: true,
        messageId: String(posted.messageId),
        channelId: String(posted.channelId || entry.channelId),
        lastEditAt: now,
        hash: hashOf(entry, display),
        error: cleanError,
    };
    try {
        setTwitchState(guildId, login, patch);
    } catch (e) {
        // the ping is out: this process must not send it again, whatever the file says
        unwrittenPosts.set(`${guildId}:${login}`, { guildId, login, patch });
        logger.error(`post of ${login} on ${guildId} went out, but its state was not written (${(e && e.code) || "error"}): remembered until the next run`);
    }
    return "announced";
}

/** Write what a failed write left behind; what fails again stays remembered. */
function flushUnwrittenPosts() {
    for (const [key, { guildId, login, patch }] of unwrittenPosts) {
        try {
            setTwitchState(guildId, login, patch);
            unwrittenPosts.delete(key);
        } catch (e) {
            logger.error(`state of ${login} on ${guildId} still not written (${(e && e.code) || "error"})`);
        }
    }
}

/**
 * Edit the message to the current live card and note the outcome; a deleted one is never posted again.
 * `resumed`: the message still says "ended" although the stream runs, so a failed edit waits for no gap.
 */
async function refreshMessage(cfg, entry, state, display, now, extra = {}, { resumed = false } = {}) {
    const { guildId, login } = entry;
    const payload = liveCard({ lang: serverLang(cfg, guildId), entry, display, now });
    try {
        await discord.editPayload(state.channelId, state.messageId, payload);
        // a running follow-up stream keeps "gave up"; a message back from its end has just been cured
        const error = state.error === END_GAVE_UP && !state.endedAt ? END_GAVE_UP : "";
        setTwitchState(guildId, login, { ...extra, display, lastSeenAt: now, lastEditAt: now, hash: hashOf(entry, display), error });
    } catch (e) {
        if (isGone(e)) {
            const error = e.code === 10008 ? "" : errorCodeOf(e);
            setTwitchState(guildId, login, { ...extra, display, lastSeenAt: now, messageId: "", messageGone: true, error });
        } else {
            // no hash: the message still shows the old card, so the next due edit tries again.
            // A posted message always has a lastEditAt, so 0 marks a resume still open: due at every run.
            const lastEditAt = resumed || !state.lastEditAt ? 0 : now;
            setTwitchState(guildId, login, { ...extra, display, lastSeenAt: now, lastEditAt, hash: "", error: errorCodeOf(e) || state.error });
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

    const unwritten = unwrittenPosts.get(`${guildId}:${login}`);
    if (unwritten && unwritten.patch.streamId === streamId) return "announced";

    if (sameStream && !state.announced) {
        // still waiting: the filter may pass now (the streamer changed the game), or the last post failed
        return announce(cfg, entry, stream, display, now);
    }
    const lastAlive = state.endedAt || state.lastSeenAt;
    // a tombstone only keeps its own stream: another id is a new stream, even within the window
    const resuming = !sameStream && state.announced && !state.removedAt && now - lastAlive <= RESUME_WINDOW_MS;
    if (!sameStream && !resuming) {
        // a stream of its own: the old message ends first (or waits in pendingEnds), then a new announcement
        if (state.announced) await closeOldMessage(cfg, guildId, login, state, now);
        return announce(cfg, entry, stream, display, now);
    }

    const alive = {
        streamId, endedAt: 0, endPending: false, endFailingSince: 0, removedAt: 0, offlineCount: 0, lastOfflineAt: 0,
    };
    if (state.messageGone || !state.messageId) {
        setTwitchState(guildId, login, { ...alive, display, lastSeenAt: now });
        return "gone";
    }
    if (state.endedAt || resuming) {
        await refreshMessage(cfg, entry, state, display, now, alive, { resumed: true });
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
    let state = getTwitchState(guildId, login);
    if (!state.streamId) return "offline";
    if (state.removedAt) state = setTwitchState(guildId, login, { removedAt: 0 }); // the entry is back
    if (!state.announced) {
        // nothing out there to end: filtered out or never posted. Only an error or an old message is
        // left; the next stream finds no stream id and no announcement, so it posts (and pings) once.
        if (state.error || state.pendingEnds.length) {
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
    // endPending before the edit: a restart in between leaves the retry open, finishMessage clears it
    const ended = setTwitchState(guildId, login, { offlineCount, lastOfflineAt: now, endedAt: now, endPending: true });
    await finishMessage(cfg, guildId, login, ended, now);
    return "ended";
}

/** Forget a record without an entry, but not the old messages whose "ended" edit still fails. */
function buryRecord(guildId, login, state, now) {
    const open = [...state.pendingEnds];
    if (state.endPending && state.messageId) open.push(pendingOf(state, now));
    removeTwitchState(guildId, login);
    if (open.length) setTwitchState(guildId, login, { pendingEnds: open });
}

/**
 * A record without an entry. A stream still running leaves a tombstone: its message gets the
 * "ended" card (retried like any other for 24 hours), the stream id stays until the stream is over.
 */
async function handleRemoved(cfg, guildId, login, state, now) {
    if (!state.announced || !state.streamId) {
        if (!state.pendingEnds.length) {
            removeTwitchState(guildId, login);
        } else if (state.streamId || state.error) {
            setTwitchState(guildId, login, {
                streamId: "", startedAt: "", lastSeenAt: 0, offlineCount: 0, lastOfflineAt: 0, display: null, error: "",
            });
        }
        return;
    }
    if (state.endedAt && !state.removedAt) {
        buryRecord(guildId, login, state, now);
        return;
    }
    if (!state.removedAt) {
        const marked = setTwitchState(guildId, login, { removedAt: now, endedAt: now, endPending: true });
        await finishMessage(cfg, guildId, login, marked, now);
        return;
    }
    if (state.endPending) await finishMessage(cfg, guildId, login, state, now);
}

/** A clean answer about a tombstone's login: the same rules as for an entry say when its stream is over. */
function settleTombstone(guildId, login, state, stream, now) {
    if (stream && stream.type !== "live") return;
    if (stream && String(stream.id) === state.streamId) {
        if (state.offlineCount || state.lastOfflineAt) setTwitchState(guildId, login, { offlineCount: 0, lastOfflineAt: 0 });
        return;
    }
    if (stream) {
        buryRecord(guildId, login, state, now);
        return;
    }
    if (now - state.lastOfflineAt < OFFLINE_MIN_GAP_MS) return;
    const offlineCount = state.offlineCount + 1;
    if (offlineCount >= OFFLINE_RUNS_TO_END) buryRecord(guildId, login, state, now);
    else setTwitchState(guildId, login, { offlineCount, lastOfflineAt: now });
}

/** The code a failed question to Twitch leaves in the run's result and in `lastRun`. */
function askErrorOf(e) {
    if (e && e.status === 429) return "rate_limited";
    if (e && e.authFailed) return "bad_credentials";
    return "twitch_unavailable";
}

async function run({ guildId = "", now = Date.now() } = {}) {
    const cfg = settingsStore().getConfig();
    const twitch = clientFor(cfg);
    if (!twitch) return { skipped: "no_credentials" };
    if (!discord.isOnline()) return { skipped: "bot_offline" };
    if (now < pausedUntil) return { skipped: "rate_limited" };

    const all = allTwitchStreamers({ config: cfg });
    const listed = new Set(all.map((e) => `${e.guildId}:${e.login}`));
    const recordsInScope = () => listTwitchStates()
        .filter((r) => (!guildId || r.guildId === guildId) && reachable(r.guildId));

    flushUnwrittenPosts();
    for (const r of recordsInScope()) {
        if (r.state.pendingEnds.length) await retryPendingEnds(cfg, r.guildId, r.login, r.state, now);
    }
    for (const r of recordsInScope()) {
        if (!listed.has(`${r.guildId}:${r.login}`)) await handleRemoved(cfg, r.guildId, r.login, r.state, now);
    }
    const entries = guildId ? all.filter((e) => e.guildId === guildId) : all;
    const tombstones = recordsInScope()
        .filter((r) => !listed.has(`${r.guildId}:${r.login}`) && r.state.removedAt && r.state.streamId);
    if (!entries.length && !tombstones.length) {
        // nothing was asked: a server's own check must not wipe the error of a run that did ask
        if (!guildId) lastRun = { at: now, error: "" };
        return { checked: 0, live: 0 };
    }

    let streams;
    try {
        streams = await twitch.getStreams([...new Set([
            ...entries.map((e) => e.login),
            ...tombstones.map((r) => r.login.toLowerCase()),
        ])]);
    } catch (e) {
        const error = askErrorOf(e);
        if (error === "rate_limited") pausedUntil = now + RATE_LIMIT_PAUSE_MS;
        lastRun = { at: now, error };
        rejectedKey = error === "bad_credentials" ? clientKey : "";
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
    for (const r of tombstones) {
        settleTombstone(r.guildId, r.login, r.state, byLogin.get(r.login.toLowerCase()), now);
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

/**
 * Whether the last run was refused the credentials `cfg` holds now: new ones lift it at once.
 * Memory only, so unknown (false) after a restart until the next check.
 */
function twitchCredentialsRejected(cfg) {
    const key = credentialsKeyOf(cfg);
    return !!key && lastRun.error === "bad_credentials" && rejectedKey === key;
}

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
    rejectedKey = "";
    unwrittenPosts.clear();
}

module.exports = { runTwitchCheck, twitchStatusOf, lastTwitchRun, twitchCredentialsRejected, startTwitchJob, stopTwitchJob, _resetForTests };
