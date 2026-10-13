// The Orga-Zentrale of a raid category (design "A · Liste je Raid", Okt 2026):
// one bot message per category, posted by the orga into a channel only the
// orga sees, listing the category's own raids of the next four weeks with
// where each one stands (services/events/orgaStatus.js) and the way into the
// web. services/events/orgaHubPanel.js builds it, the "Raid anlegen" button is
// commands/event/orgaHubButton.js, the hubs live in stores/orgaHubStore.js.
//
// Posting again — into the same or another channel — replaces the category's
// earlier hub. Each hub remembers a fingerprint of what it shows (`hash`); it
// is redrawn when that changes:
//   - the sweep (startOrgaHubs): a minute after the start, then every five
//     minutes — a raid that began falls out, a deploy changed the text;
//   - a nudge a few seconds after an own event or a signup changed
//     (eventStore.onEventsChanged, signupStore.onSignupsChanged): an event
//     created, moved or cancelled, a setup saved, approved or posted, a signup.
// A hub whose message is gone (deleted in Discord: linkWatch.js tells
// onHubMessageDeleted at once) is posted anew into its channel; one whose
// channel is gone is logged once and left.
//
// Only own EventHelper events: a store read, never a Raid-Helper request.
const crypto = require("crypto");
const store = require("../../stores/orgaHubStore");
const eventStore = require("../../stores/eventStore");
const signupStore = require("../../stores/signupStore");
const settingsStore = require("../../stores/settingsStore");
const discord = require("../discord/discord");
const { appEmojiMap } = require("../discord/appEmojis");
const { categoryNameFor } = require("../signups/availabilityPanel");
const { visibleRows, versionOfEvent } = require("./mainVersion");
const { orgaStatus, statusCounts } = require("./orgaStatus");
const { orgaHubPayload } = require("./orgaHubPanel");
const { publicBaseUrl } = require("../../utils/publicUrl");
const logger = require("../../logger");

const WEEKS = 4;
const FIRST_DELAY_MS = 60 * 1000;
const SWEEP_MS = 5 * 60 * 1000;
/** A burst of changes (a setup save writes the event several times) collapses into one redraw. */
const NUDGE_MS = 5 * 1000;

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/** An absolute link into the web menu, "" while no public address is set (Discord refuses a relative link). */
function webLink(path) {
    const base = publicBaseUrl();
    return base ? `${base}${path}` : "";
}

/**
 * The category's own raids of the next `weeks`, soonest first, with their
 * status: not begun yet, of a visible game version; cancelled ones stay until their date.
 */
function hubRaids(categoryId, { now = Date.now(), weeks = WEEKS, config } = {}) {
    const cat = str(categoryId);
    if (!cat) return [];
    const nowSec = Math.floor(now / 1000);
    const events = eventStore.listEvents("", { sinceSeconds: nowSec + 1, untilSeconds: nowSec + weeks * 7 * 86400 })
        .filter((e) => e && str(e.categoryId) === cat && Number(e.startTime) > nowSec);
    return visibleRows(events, (e) => versionOfEvent(e, { config }), config)
        .sort((a, b) => Number(a.startTime) - Number(b.startTime))
        .map((e) => {
            const st = orgaStatus(e, signupStore.listSignups(e.id), { now });
            const path = `/raids/detail?event=${encodeURIComponent(e.id)}${st.link && st.link.tab ? `&tab=${st.link.tab}` : ""}`;
            return {
                id: e.id,
                title: e.title,
                startTime: Number(e.startTime),
                channelId: e.channelId,
                status: st.status,
                label: st.label,
                detail: st.detail,
                linkLabel: st.link ? st.link.label : "",
                url: st.link ? webLink(path) : "",
            };
        });
}

/** The payload of a category's hub as it should look now. */
function currentPayload(categoryId, cfg, { now = Date.now() } = {}) {
    const raids = hubRaids(categoryId, { now, config: cfg });
    const active = raids.filter((r) => r.status !== "cancelled");
    return orgaHubPayload({
        categoryId: str(categoryId),
        categoryName: categoryNameFor(categoryId, { config: cfg }),
        raids,
        counts: statusCounts(raids.map((r) => r.status)),
        links: store.getLinks(categoryId),
        total: active.length,
        webUrl: webLink("/raids"),
        weeks: WEEKS,
        emojis: appEmojiMap(),
    });
}

/** The fingerprint of a payload: its components as Discord gets them. */
function payloadHash(payload) {
    return crypto.createHash("sha1").update(JSON.stringify(payload.components)).digest("hex").slice(0, 16);
}

/**
 * Post the hub of a category into a channel and drop its earlier one.
 * @returns {Promise<{ hub?: object, url?: string, error?: string }>}
 */
async function postHub({ categoryId, channelId, by = "", config, now = Date.now() } = {}) {
    const cat = str(categoryId);
    const channel = str(channelId);
    if (!cat) return { error: "Keine Kategorie gewählt." };
    if (!channel) return { error: "Kein Kanal gewählt." };
    const payload = currentPayload(cat, config || settingsStore.getConfig(), { now });
    let posted;
    try {
        posted = await discord.postPayload(channel, payload);
    } catch (e) {
        return { error: `Die Orga-Zentrale konnte nicht gepostet werden: ${(e && e.message) || e}` };
    }
    const earlier = store.getHub(cat);
    if (earlier && earlier.messageId !== posted.messageId) await discord.deleteMessage(earlier.channelId, earlier.messageId);
    const hub = store.setHub({ categoryId: cat, guildId: posted.guildId, channelId: posted.channelId, messageId: posted.messageId, postedBy: by, hash: payloadHash(payload) }, { now });
    return { hub, url: posted.url };
}

/** Take a category's hub down (the message too, best-effort). Returns the removed hub or null. */
async function removeHub(categoryId) {
    const hub = store.removeHub(categoryId);
    if (hub) await discord.deleteMessage(hub.channelId, hub.messageId);
    return hub;
}

/**
 * Replace a category's orga links and redraw its hub at once (the web's editor and
 * the Discord handlers, orgaHubLinks.js, both come through here).
 * @returns {Promise<{ links?: object[], error?: string }>}
 */
async function saveLinks(categoryId, list, { config } = {}) {
    const result = store.setLinks(categoryId, list);
    if (result.error) return result;
    await refreshHubs({ categoryId: str(categoryId), config });
    return result;
}

const isUnknownMessage = (e) => !!(e && (e.code === 10008 || /unknown message/i.test((e && e.message) || "")));

// Hubs whose redraw failed and were said so once — a channel that is gone
// would otherwise fill the log every five minutes.
const warned = new Set();

/**
 * Redraw the posted hubs whose content changed (`onlyStale`, the default) or
 * all of them; `categoryId` limits it to one. A hub whose message was deleted
 * is posted anew into its channel. Never throws.
 * @returns {Promise<{ edited: number, reposted: number, failed: number, unchanged: number }>}
 */
async function refreshHubs({ config, onlyStale = true, categoryId = "", now = Date.now() } = {}) {
    const cfg = config || settingsStore.getConfig();
    const out = { edited: 0, reposted: 0, failed: 0, unchanged: 0 };
    for (const hub of store.listHubs()) {
        if (categoryId && hub.categoryId !== str(categoryId)) continue;
        try {
            const payload = currentPayload(hub.categoryId, cfg, { now });
            const hash = payloadHash(payload);
            if (onlyStale && hub.hash === hash) {
                out.unchanged += 1;
                continue;
            }
            try {
                await discord.editPayload(hub.channelId, hub.messageId, payload);
                store.markHubDrawn(hub.categoryId, hash);
                out.edited += 1;
            } catch (e) {
                if (!isUnknownMessage(e)) throw e;
                // deleted in Discord: back into its channel, as a new message
                const posted = await discord.postPayload(hub.channelId, payload);
                store.setHub({ ...hub, guildId: posted.guildId, channelId: posted.channelId, messageId: posted.messageId, hash }, { now });
                out.reposted += 1;
            }
            warned.delete(hub.categoryId);
        } catch (e) {
            out.failed += 1;
            if (!warned.has(hub.categoryId)) logger.warn(`[orgaHub] ${hub.categoryId}: ${(e && e.message) || e}`);
            warned.add(hub.categoryId);
        }
    }
    return out;
}

// One redraw at a time: a nudge during a sweep waits for the next round instead of editing the same message twice.
let running = null;
let again = false;

function sweep() {
    if (running) {
        again = true;
        return running;
    }
    running = refreshHubs()
        .then((r) => {
            if (r.edited || r.reposted) logger.debug(`[orgaHub] ${r.edited} neu gezeichnet, ${r.reposted} neu gepostet, ${r.unchanged} aktuell`);
        })
        .catch((e) => logger.warn(`[orgaHub] refresh: ${(e && e.message) || e}`))
        .finally(() => {
            running = null;
            if (again) {
                again = false;
                scheduleRefresh();
            }
        });
    return running;
}

let nudgeTimer = null;

/** Redraw after a short pause; a burst of changes collapses into one run. Nothing while no hub is posted. */
function scheduleRefresh({ delayMs = NUDGE_MS } = {}) {
    if (!store.listHubs().length) return null;
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => {
        nudgeTimer = null;
        sweep();
    }, delayMs);
    if (nudgeTimer.unref) nudgeTimer.unref();
    return nudgeTimer;
}

/**
 * A hub's message was deleted in Discord (services/discord/linkWatch.js): its
 * fingerprint is forgotten, so the next redraw finds it stale, its edit hits
 * "Unknown Message" and it is posted anew. Returns whether it was a hub.
 */
function onHubMessageDeleted(messageId, { delayMs = NUDGE_MS } = {}) {
    const id = str(messageId);
    const hub = id ? store.listHubs().find((h) => h.messageId === id) : null;
    if (!hub) return false;
    store.markHubDrawn(hub.categoryId, "");
    scheduleRefresh({ delayMs });
    return true;
}

let stopFn = null;

/**
 * Keep the hubs current: the sweep `firstDelayMs` after the start (the bot is
 * logged in by then) and every `intervalMs`, plus a nudge on every change of
 * an own event or a signup. Idempotent; the timers never keep the process alive.
 */
function startOrgaHubs({ firstDelayMs = FIRST_DELAY_MS, intervalMs = SWEEP_MS, nudgeMs = NUDGE_MS } = {}) {
    if (stopFn) return stopFn;
    const nudge = () => scheduleRefresh({ delayMs: nudgeMs });
    const offEvents = eventStore.onEventsChanged(nudge);
    const offSignups = signupStore.onSignupsChanged(nudge);
    let interval = null;
    const first = setTimeout(() => {
        sweep();
        interval = setInterval(sweep, intervalMs);
        if (interval.unref) interval.unref();
    }, firstDelayMs);
    if (first.unref) first.unref();
    stopFn = () => {
        offEvents();
        offSignups();
        clearTimeout(first);
        if (interval) clearInterval(interval);
        clearTimeout(nudgeTimer);
        nudgeTimer = null;
        stopFn = null;
    };
    return stopFn;
}

/** Stop what startOrgaHubs() set up (idempotent). */
function stopOrgaHubs() {
    if (stopFn) stopFn();
}

module.exports = {
    hubRaids, currentPayload, payloadHash, postHub, removeHub, saveLinks, refreshHubs, scheduleRefresh, onHubMessageDeleted, startOrgaHubs, stopOrgaHubs, WEEKS,
};
