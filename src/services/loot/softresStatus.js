// The softres card in the raid channel (Oct 2026): the softres.it list posted as
// ONE raid card with the softres icon, the instances, the start, "SR per player"
// and how many of the raid have entered their soft reserves ("Signed up 14 / 25"),
// a link button and "Who is missing?" (softresMissingBot.js).
//
//   * readStatus(eventId)          - one GET of the softres.it raid page
//                                    (utils/loot/softres.fetchRaid) matched
//                                    against who is expected in the raid
//   * postSoftresCard(...)         - the web's "Softres posten" (raidDetail.js):
//                                    read fresh, post or edit the card
//   * refreshSoftresCard(eventId)  - edit the posted card, only when the count or
//                                    the missing names changed
//   * startSoftresStatus()         - the one job (web/http/jobs.js): every 10
//                                    minutes the cards of raids starting in the
//                                    next 7 days or at most 2 h ago, one by one
//
// Who is expected: the slots of the approved setup (own events), else every
// active signup (no sign-off, bench or absence) — own and Raid-Helper events alike.
// Raid-Helper data comes from the stored snapshots only (eventSources.getStoredEvent,
// raidhelperEventsStore), never from Raid-Helper itself (1000 requests a day).
//
// A reserve counts for a raider by the Discord id softres.it carries (a reserve
// made with a Discord login), else by the character name — case and accents do
// not matter — against every character of the raider in the event's version.
// Hidden reserves without the admin token, or any failure, leave the count out:
// the card is still posted, just without "Signed up" and "Who is missing?".
const { ButtonBuilder, ButtonStyle } = require("discord.js");
const softres = require("../../utils/loot/softres");
const { getEventSoftres, listEventSoftres, markEventSoftresPosted, setEventSoftresStatus } = require("../../stores/eventSoftresStore");
const eventStore = require("../../stores/eventStore");
const { readSnapshot } = require("../../stores/raidhelperEventsStore");
const { getProfile, charactersOfVersion } = require("../../stores/raiderProfileStore");
const { getStoredEvent } = require("../events/eventSources");
const { versionOfEvent } = require("../versions/mainVersion");
const { approvedSetupOf } = require("../setup/setupCore");
const { embedColor } = require("../events/embedLook");
const { signupStatus } = require("../../utils/attendance");
const discord = require("../discord/discord");
const { eventLang } = require("../discord/botLanguage");
const { tr } = require("../../utils/i18n/botText");
const logger = require("../../logger").child("softresStatus");

const SOFTRES_ICON = "https://softres.it/apple-touch-icon.png";
const SOFTRES_MISSING_PREFIX = "softres-missing";
const SOFTRES_PING_PREFIX = "softres-ping";
/** Signups that do not come to the raid. */
const INACTIVE = new Set(["absence", "bench"]);

const INTERVAL_MS = 10 * 60 * 1000;
const FIRST_DELAY_MS = 2 * 60 * 1000;
const AHEAD_S = 7 * 24 * 60 * 60;
const BEHIND_S = 2 * 60 * 60;

/** A character name for matching: lower case, no accents, no realm suffix. */
function nameKey(name) {
    return softres.normalizeTitle(String(name || "").trim().split("-")[0]).replace(/\s+/g, "");
}

/**
 * The event of an id: its stored shape (own events and the Raid-Helper snapshot),
 * else the synced Raid-Helper list; `raw` is the own event itself (its setup).
 */
function resolveEvent(eventId) {
    const id = String(eventId || "").trim();
    if (!id) return { event: null, raw: null };
    const raw = eventStore.isOwnEventId(id) ? eventStore.getEvent(id) : null;
    let event = getStoredEvent(id);
    if (!event) {
        const synced = (readSnapshot().events || []).find((e) => String(e.id) === id);
        event = synced ? { source: "raidhelper", ...synced } : null;
    }
    return { event, raw };
}

function charNames(entry) {
    const names = [entry && entry.character, entry && entry.name];
    for (const c of (entry && Array.isArray(entry.characters)) ? entry.characters : []) {
        names.push(typeof c === "string" ? c : c && (c.character || c.name));
    }
    return names.map((n) => String(n || "").trim()).filter(Boolean);
}

/**
 * Who is expected to enter soft reserves: `[{ userId, names, label }]`, one per
 * raider — names are every character a reserve may carry (slot/signup, the
 * signup's other characters, the profile's characters of the event's version).
 */
function expectedRaiders(event, raw) {
    const approved = approvedSetupOf(raw);
    const entries = approved
        ? approved.groups.flatMap((g) => g.slots || [])
        : ((event && event.signUps) || []).filter((s) => !INACTIVE.has(signupStatus(s)));
    const versionId = event ? versionOfEvent(event) : "";
    const byUser = new Map();
    for (const e of entries) {
        const userId = String((e && e.userId) || "").trim();
        if (!userId) continue;
        const known = byUser.get(userId) || { userId, names: [], label: "" };
        const own = charNames(e);
        if (!known.label && own[0]) known.label = own[0];
        known.names.push(...own);
        byUser.set(userId, known);
    }
    for (const r of byUser.values()) {
        r.names.push(...charactersOfVersion(getProfile(r.userId), versionId).map((c) => c.name));
        r.names = [...new Set(r.names.filter(Boolean))];
        if (!r.label) r.label = r.names[0] || "";
    }
    return [...byUser.values()];
}

/**
 * Which expected raiders have a reserve. A reserve counts once, in three passes:
 * Discord id AND character name, then the name alone, then the Discord id alone —
 * so one account entering for a friend too (two reserves with its id) does not
 * take the friend's reserve. `{ filled, missing }` of the expected.
 */
function matchReserves(expected = [], reserves = []) {
    const open = reserves.slice();
    const take = (pred) => {
        const i = open.findIndex(pred);
        if (i < 0) return false;
        open.splice(i, 1);
        return true;
    };
    const byId = (r) => (res) => Boolean(res.discordId) && res.discordId === r.userId;
    const byName = (r) => {
        const keys = new Set(r.names.map(nameKey).filter(Boolean));
        return (res) => keys.has(nameKey(res.name));
    };
    const passes = [
        (r) => { const id = byId(r); const name = byName(r); return (res) => id(res) && name(res); },
        byName,
        byId,
    ];
    let rest = expected.slice();
    const filled = [];
    for (const pass of passes) {
        const next = [];
        for (const r of rest) (take(pass(r)) ? filled : next).push(r);
        rest = next;
    }
    // Both lists in the order of `expected`, whichever pass found them.
    const done = new Set(filled);
    return { filled: expected.filter((r) => done.has(r)), missing: rest };
}

/** The missing raiders as a stable key — the job edits the card only when it changes. */
const missingKeyOf = (missing) => missing.map((m) => m.userId).sort().join("|");

/** One softres.it read serves every click within this window (25 clicks ≠ 25 requests). */
const FETCH_CACHE_MS = 60 * 1000;
// raidId → { at, promise } of the last read; a failed read is dropped at once.
const fetchCache = new Map();

function clearFetchCache() {
    fetchCache.clear();
}

/** softres.fetchRaid, shared for FETCH_CACHE_MS per raid — also by clicks arriving while it runs. */
function fetchRaidCached(raidId, token, now = Date.now()) {
    const key = `${raidId}|${token ? "t" : ""}`;
    const hit = fetchCache.get(key);
    if (hit && now - hit.at < FETCH_CACHE_MS) return hit.promise;
    const promise = softres.fetchRaid(raidId, token);
    fetchCache.set(key, { at: now, promise });
    promise.catch(() => { if (fetchCache.get(key) && fetchCache.get(key).promise === promise) fetchCache.delete(key); });
    for (const [k, v] of fetchCache) if (now - v.at >= FETCH_CACHE_MS) fetchCache.delete(k);
    return promise;
}

/**
 * Read softres.it once and count. `{ ok: false, reason }` when there is nothing to
 * count (no list, hidden reserves without the token, softres.it down, nobody
 * expected); else `{ ok, filled, expected, missing: [{ userId, label }], reserveLimit,
 * instances, missingKey, checkedAt }`. Never throws.
 */
async function readStatus(eventId, { event, raw, sr } = {}) {
    const record = sr || getEventSoftres(eventId);
    const checkedAt = Math.floor(Date.now() / 1000);
    if (!record || !record.raidId) return { ok: false, reason: "no_softres", checkedAt };
    let raid;
    try {
        raid = await fetchRaidCached(record.raidId, record.token);
    } catch (e) {
        logger.warn(`softres ${record.raidId} for ${eventId}: ${e.message}`);
        return { ok: false, reason: "fetch_failed", checkedAt };
    }
    const base = { reserveLimit: raid.reserveLimit, instances: raid.instances, checkedAt };
    if (raid.hideReserves && !raid.isManager) return { ...base, ok: false, reason: "hidden" };
    const resolved = event ? { event, raw: raw !== undefined ? raw : resolveEvent(eventId).raw } : resolveEvent(eventId);
    const expected = expectedRaiders(resolved.event, resolved.raw);
    if (!expected.length) return { ...base, ok: false, reason: "nobody_expected" };
    const { filled, missing } = matchReserves(expected, raid.reserves);
    return {
        ...base,
        ok: true,
        filled: filled.length,
        expected: expected.length,
        missing: missing.map((m) => ({ userId: m.userId, label: m.label })),
        missingKey: missingKeyOf(missing),
    };
}

/** The instance names of the list ("Karazhan · Gruul's Lair"), the stored ones when softres.it gave none. */
function instancesLine(sr, status) {
    const codes = (status && status.instances && status.instances.length) ? status.instances : ((sr && sr.instances) || []);
    return codes.map((c) => softres.nameOf(c) || c).filter(Boolean).join(" · ");
}

/** The options of discord.postLink/editLink for the softres card, in the event's language. */
function softresCardOpts(event, sr, status, { message = "", lang } = {}) {
    const l = lang || eventLang(event);
    const start = Number(event && event.startTime) || 0;
    const amount = Number((status && status.reserveLimit) || (sr && sr.amount) || 0);
    const ok = Boolean(status && status.ok);
    const facts = [];
    if (start) facts.push([tr(l, "Start"), `<t:${start}:d> <t:${start}:t> · <t:${start}:R>`]);
    if (amount) facts.push([tr(l, "SR per player"), String(amount)]);
    if (ok) facts.push([tr(l, "Entered"), `${status.filled} / ${status.expected}`]);
    let color;
    try { color = embedColor(event); } catch { color = undefined; }
    const checkedAt = Number(status && status.checkedAt) || 0;
    return {
        url: sr.url,
        kicker: String((event && event.title) || "").trim(),
        title: "Softres",
        thumbnail: SOFTRES_ICON,
        lines: [instancesLine(sr, status)],
        message,
        facts,
        color,
        label: tr(l, "Open Softres"),
        buttons: ok && event && event.id
            ? [new ButtonBuilder().setCustomId(`${SOFTRES_MISSING_PREFIX}:${event.id}`).setLabel(tr(l, "Who is missing?")).setStyle(ButtonStyle.Secondary)]
            : [],
        note: checkedAt ? tr(l, "Last changed {time}", { time: `<t:${checkedAt}:R>` }) : "",
    };
}

function rememberStatus(eventId, status) {
    setEventSoftresStatus(eventId, {
        ok: status.ok, filled: status.filled, expected: status.expected, missingKey: status.missingKey, checkedAt: status.checkedAt,
    });
}

/**
 * Post (or edit in place) the softres card of an event — the web's "Softres
 * posten". Reads softres.it fresh first. `event` is the route's own lookup (its
 * channel is trusted), `message` the orga's text. Returns `{ posted, edited, status }`;
 * throws when Discord refuses.
 */
async function postSoftresCard({ eventId, event, message = "" }) {
    const sr = getEventSoftres(eventId);
    if (!sr || !sr.url) throw new Error("Für dieses Event gibt es noch keine Softres-Liste.");
    const ev = { ...event, id: (event && event.id) || eventId };
    const status = await readStatus(eventId, { event: { ...(resolveEvent(eventId).event || {}), ...ev }, sr });
    // softres.it unreachable: post with the last known count (and its button) instead
    // of taking them away — like refreshSoftresCard; the stored count stays as it is.
    const unreachable = status.reason === "fetch_failed";
    const shown = unreachable && sr.status && sr.status.ok ? { ...sr.status } : status;
    const opts = softresCardOpts(ev, sr, shown, { message });
    const alreadyPosted = Boolean(sr.postedChannelId && sr.postedMessageId);
    let posted;
    if (alreadyPosted) {
        try {
            posted = await discord.editLink(sr.postedChannelId, sr.postedMessageId, opts);
        } catch {
            posted = await discord.postLink(ev.channelId, opts);
        }
    } else {
        posted = await discord.postLink(ev.channelId, opts);
    }
    markEventSoftresPosted(eventId, { channelId: posted.channelId, messageId: posted.messageId, message });
    if (!unreachable) rememberStatus(eventId, status);
    return { posted, edited: alreadyPosted, status };
}

/** Whether the card shows something else now than the last stored count. */
function changed(before, status) {
    if (!before) return true;
    if (Boolean(before.ok) !== Boolean(status.ok)) return true;
    if (!status.ok) return false;
    return before.filled !== status.filled || before.expected !== status.expected || before.missingKey !== status.missingKey;
}

/**
 * Edit the posted card of an event when its count or missing names changed.
 * `status` — an already read one (the "Who is missing?" click). Returns the
 * status, or null when the event has no posted card. Never throws.
 */
async function refreshSoftresCard(eventId, { status } = {}) {
    const sr = getEventSoftres(eventId);
    if (!sr || !sr.url || !sr.postedChannelId || !sr.postedMessageId) return null;
    const { event, raw } = resolveEvent(eventId);
    if (!event) return null;
    const ev = { ...event, id: eventId };
    const now = status || await readStatus(eventId, { event: ev, raw, sr });
    // softres.it unreachable: the card keeps its last count rather than losing it.
    if (now.reason === "fetch_failed") return now;
    if (!changed(sr.status, now)) return now;
    try {
        await discord.editLink(sr.postedChannelId, sr.postedMessageId, softresCardOpts(ev, sr, now, { message: sr.postedMessage || "" }));
        rememberStatus(eventId, now);
    } catch (e) {
        logger.warn(`softres card of ${eventId} not edited: ${e.message}`);
    }
    return now;
}

/** The posted cards of raids starting in the next 7 days or at most 2 h ago. */
function cardsInWindow(nowS = Math.floor(Date.now() / 1000)) {
    return listEventSoftres().filter((sr) => {
        if (!sr.url || !sr.postedChannelId || !sr.postedMessageId) return false;
        const { event } = resolveEvent(sr.eventId);
        const start = Number(event && event.startTime) || 0;
        return start && start >= nowS - BEHIND_S && start <= nowS + AHEAD_S;
    });
}

/** One pass of the job: the cards one after the other (1 vCPU, softres.it is not hammered). */
async function sweep() {
    let edited = 0;
    for (const sr of cardsInWindow()) {
        const before = sr.status;
        const now = await refreshSoftresCard(sr.eventId);
        if (now && now.reason !== "fetch_failed" && changed(before, now)) edited += 1;
    }
    return edited;
}

let timers = { first: null, interval: null };

function startSoftresStatus({ intervalMs = INTERVAL_MS, firstDelayMs = FIRST_DELAY_MS } = {}) {
    if (timers.interval) return timers.interval;
    const run = () => sweep().catch((e) => logger.warn("sweep failed: " + e.message));
    timers.first = setTimeout(run, firstDelayMs);
    timers.interval = setInterval(run, intervalMs);
    for (const t of [timers.first, timers.interval]) if (t.unref) t.unref();
    return timers.interval;
}

function stopSoftresStatus() {
    clearTimeout(timers.first);
    clearInterval(timers.interval);
    timers = { first: null, interval: null };
}

module.exports = {
    SOFTRES_ICON, SOFTRES_MISSING_PREFIX, SOFTRES_PING_PREFIX,
    nameKey, resolveEvent, expectedRaiders, matchReserves, readStatus, softresCardOpts,
    postSoftresCard, refreshSoftresCard, cardsInWindow, sweep, startSoftresStatus, stopSoftresStatus,
    clearFetchCache, FETCH_CACHE_MS,
};
