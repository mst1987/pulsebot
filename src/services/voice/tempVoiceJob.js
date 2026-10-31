// The temporary voice channels per raid (docs/channels.md "Sprachkanal je Raid"): one
// job that opens, watches and closes them. Its state lives in tempVoiceStore, so a
// restart finds every channel again; the first run (a minute after the start, when
// the gateway is up) closes whatever the bot left open for a raid that is gone.
//
// Per raid, every minute and soon after an event changed:
//   - a planned channel opens `leadMinutes` before the start (tempVoicePlan.js);
//   - an open one closes once it was empty for EMPTY_CLOSE_MINUTES - never before
//     the raid's end - and at the latest `closeAfterMinutes` after the end: whoever
//     is still in it moves to the category's fixed channel when there is one, else
//     the channel goes with them in it (Discord drops them from the call);
//   - it closes at once when the raid is deleted, cancelled, merged into raid 1 or
//     no longer gets a temporary channel ("gone"), or someone deleted it ("missing").
// voiceStateUpdate keeps `emptySince` exact between the ticks (bot.js).
const eventStore = require("../../stores/events/eventStore");
const tempVoiceStore = require("../../stores/events/tempVoiceStore");
const { getConfig } = require("../../stores/settings/configStore");
const { groupEvents } = require("../events/raidGroup");
const { MAX_DURATION } = require("../../utils/time");
const { LEAD_MAX, CLOSE_AFTER_MAX, categoryTempVoiceFor } = require("../../stores/settings/tempVoiceSettings");
const { planFor, settingsFor } = require("./tempVoicePlan");
const voice = require("./tempVoiceDiscord");
const discord = require("../discord/discord");
const logger = require("../../logger");

const TICK_MS = 60 * 1000;
const FIRST_DELAY_MS = 60 * 1000;
const NUDGE_DELAY_MS = 5 * 1000;
// A failed create is tried again after this long, not every minute.
const RETRY_SECONDS = 10 * 60;
// Closed entries are kept this long (the setup editor shows "geschlossen"), then pruned.
const KEEP_CLOSED_SECONDS = 7 * 24 * 3600;

const nowSeconds = () => Math.floor(Date.now() / 1000);
const isOpen = (entry) => !!(entry && entry.channelId && !entry.closedAt);
const errorText = (e) => String((e && e.message) || e || "Unbekannter Fehler").slice(0, 300);

/** Every raid of the group the event belongs to, the primary first. */
function groupOf(event) {
    try {
        return groupEvents(event);
    } catch {
        return [event];
    }
}

/** The plan of one raid as the job needs it (the leader's name read from Discord). */
function planOf(event, group, config) {
    return planFor(event, { group, config, leaderName: (id) => voice.memberName(event.guildId, id) });
}

/**
 * The raids the job looks at now: every own event whose channel could be due or
 * still open (start within the longest lead before / longest raid + close after),
 * and every event with an open entry.
 */
function candidates(now) {
    const since = now - (MAX_DURATION + CLOSE_AFTER_MAX) * 60;
    const until = now + LEAD_MAX * 60;
    const out = new Map();
    for (const e of eventStore.listEvents("", { siblings: true, sinceSeconds: since, untilSeconds: until })) out.set(e.id, e);
    for (const entry of tempVoiceStore.listEntries()) {
        if (isOpen(entry) && !out.has(entry.eventId)) out.set(entry.eventId, eventStore.getEvent(entry.eventId));
    }
    return out;
}

const lastFailure = new Map();

async function open(event, plan, now, { manual = false } = {}) {
    try {
        const created = await voice.createVoice(plan.guildId, plan);
        lastFailure.delete(event.id);
        tempVoiceStore.updateEntry(event.id, {
            guildId: plan.guildId, channelId: created.id, name: created.name, createdAt: now, emptySince: now,
            closedAt: 0, closeReason: "", manual, error: "",
        });
        logger.info(`[tempVoice] ${created.name} angelegt (${event.id})`);
        return { ok: true, channelId: created.id };
    } catch (e) {
        lastFailure.set(event.id, now);
        tempVoiceStore.updateEntry(event.id, { guildId: plan.guildId, error: errorText(e) });
        logger.warn(`[tempVoice] Anlegen für ${event.id} fehlgeschlagen:`, errorText(e));
        return { ok: false, error: errorText(e) };
    }
}

async function close(eventId, entry, reason, now, { moveTo = "" } = {}) {
    try {
        const result = await voice.closeVoice(entry.guildId, entry.channelId, { moveTo });
        tempVoiceStore.updateEntry(eventId, { closedAt: now, closeReason: reason, emptySince: 0, error: "" });
        logger.info(`[tempVoice] ${entry.name || entry.channelId} geschlossen (${reason}${result.moved ? `, ${result.moved} verschoben` : ""})`);
        return { ok: true, moved: result.moved };
    } catch (e) {
        tempVoiceStore.updateEntry(eventId, { error: errorText(e) });
        logger.warn(`[tempVoice] Schließen von ${entry.channelId} fehlgeschlagen:`, errorText(e));
        return { ok: false, error: errorText(e) };
    }
}

/** One raid's step: open when due, track emptiness, close when it is time. */
async function stepRaid(eventId, event, config, now, out) {
    const entry = tempVoiceStore.getEntry(eventId);
    const plan = event ? planOf(event, groupOf(event), config) : null;
    if (isOpen(entry)) {
        if (!plan) {
            out.closed.push(eventId);
            return close(eventId, entry, "gone", now);
        }
        const count = voice.memberCount(entry.guildId, entry.channelId);
        if (count === null) {
            // The channel is not in the cache: gone in Discord, or the bot is not connected yet.
            if (!discord.isOnline() || !discord.getGuild(entry.guildId)) return null;
            tempVoiceStore.updateEntry(eventId, { closedAt: now, closeReason: "missing", emptySince: 0 });
            out.closed.push(eventId);
            return null;
        }
        const emptySince = count > 0 ? 0 : entry.emptySince || now;
        if (emptySince !== entry.emptySince) tempVoiceStore.updateEntry(eventId, { emptySince });
        if (now >= plan.limitAt) {
            out.closed.push(eventId);
            return close(eventId, entry, "limit", now, { moveTo: plan.fixedChannelId });
        }
        if (now >= plan.endAt && emptySince && now - emptySince >= plan.emptyMinutes * 60) {
            out.closed.push(eventId);
            return close(eventId, entry, "empty", now);
        }
        if (plan.name !== entry.name) {
            const renamed = await voice.renameVoice(entry.guildId, entry.channelId, plan.name).catch((e) => logger.warn("[tempVoice] Umbenennen:", errorText(e)));
            if (renamed) tempVoiceStore.updateEntry(eventId, { name: renamed });
        }
        if (plan.onlyAssigned) await voice.syncMembers(entry.guildId, entry.channelId, plan.members).catch((e) => logger.warn("[tempVoice] Zugang:", errorText(e)));
        return null;
    }
    if (!plan || (entry && entry.closedAt)) return null;
    if (now < plan.openAt || now >= plan.limitAt) return null;
    if (now - (lastFailure.get(eventId) || 0) < RETRY_SECONDS) return null;
    if (!discord.getGuild(plan.guildId)) return null;
    out.opened.push(eventId);
    return open(event, plan, now);
}

let running = false;

/** One sweep over every raid; `{ opened, closed, pruned }` (ids). Never two at once. */
async function runTempVoice({ now = nowSeconds() } = {}) {
    const out = { opened: [], closed: [], pruned: 0 };
    if (running) return out;
    running = true;
    try {
        const config = getConfig() || {};
        for (const [eventId, event] of candidates(now)) {
            try {
                await stepRaid(eventId, event, config, now, out);
            } catch (e) {
                logger.warn(`[tempVoice] ${eventId}:`, errorText(e));
            }
        }
        out.pruned = tempVoiceStore.prune(now - KEEP_CLOSED_SECONDS);
    } finally {
        running = false;
    }
    return out;
}

/** voiceStateUpdate: keep `emptySince` of the bot's own channels exact between the ticks. */
function onVoiceStateUpdate(oldState, newState, { now = nowSeconds() } = {}) {
    const touched = new Set([oldState && oldState.channelId, newState && newState.channelId].filter(Boolean).map(String));
    if (!touched.size) return;
    for (const entry of tempVoiceStore.listEntries()) {
        if (!isOpen(entry) || !touched.has(entry.channelId)) continue;
        const count = voice.memberCount(entry.guildId, entry.channelId);
        if (count === null) continue;
        const emptySince = count > 0 ? 0 : entry.emptySince || now;
        if (emptySince !== entry.emptySince) tempVoiceStore.updateEntry(entry.eventId, { emptySince });
    }
}

/** The event and its plan for the manual actions; `{ event, plan }` or `{ error }`. */
function manualTarget(eventId) {
    const event = eventStore.getEvent(eventId);
    if (!event) return { error: "Event nicht gefunden.", status: 404 };
    const plan = planOf(event, groupOf(event), getConfig() || {});
    return { event, plan };
}

/** "Jetzt anlegen": open the raid's channel now, before its time; reopens a closed one. */
async function openNow(eventId, { now = nowSeconds() } = {}) {
    const { event, plan, error, status } = manualTarget(eventId);
    if (error) return { error, status };
    if (!plan) return { error: "Für diesen Raid ist kein temporärer Sprachkanal vorgesehen.", status: 409 };
    if (now >= plan.limitAt) return { error: "Der Raid ist vorbei.", status: 409 };
    if (isOpen(tempVoiceStore.getEntry(event.id))) return { error: "Der Kanal ist schon offen.", status: 409 };
    const result = await open(event, plan, now, { manual: true });
    return result.ok ? { ok: true } : { error: result.error, status: 502 };
}

/** "Schließen": close the raid's channel now; people in it move to the fixed channel when there is one. */
async function closeNow(eventId, { now = nowSeconds() } = {}) {
    const event = eventStore.getEvent(eventId);
    const entry = tempVoiceStore.getEntry(eventId);
    if (!isOpen(entry)) return { error: "Kein offener Kanal.", status: 409 };
    const fixed = event ? categoryTempVoiceFor(getConfig() || {}, (groupOf(event)[0] || event).categoryId).voiceChannelId : "";
    const result = await close(eventId, entry, "manual", now, { moveTo: fixed });
    return result.ok ? { ok: true } : { error: result.error, status: 502 };
}

/**
 * The voice channel of every raid of an event's group, for the setup editor:
 * `[{ eventId, index, kind, state, name, channelId, url, members, openAt, parentName, error, missingRights }]`
 *   kind  "none" | "fixed" (the category's channel) | "temp"
 *   state "fixed" | "planned" | "open" | "closed" | "failed"
 */
function voiceStatus(event, { now = nowSeconds(), config = getConfig() || {} } = {}) {
    if (!event) return [];
    const group = groupOf(event);
    const settings = settingsFor(group[0] || event, config);
    return group.map((raid, i) => {
        const plan = planOf(raid, group, config);
        const base = { eventId: raid.id, index: i + 1, total: group.length, mode: settings.mode };
        if (!plan) {
            const fixed = settings.mode === "existing" ? settings.voiceChannelId : "";
            if (!fixed) return { ...base, kind: "none", state: "none" };
            return {
                ...base, kind: "fixed", state: "fixed", channelId: fixed, name: voice.channelName(raid.guildId, fixed),
                url: voice.channelUrl(raid.guildId, fixed), members: voice.memberCount(raid.guildId, fixed),
            };
        }
        const entry = tempVoiceStore.getEntry(raid.id) || {};
        const missing = voice.missingRights(raid.guildId, plan);
        const out = {
            ...base, kind: "temp", name: entry.channelId && !entry.closedAt ? entry.name || plan.name : plan.name,
            channelId: "", url: "", members: null, openAt: plan.openAt, endAt: plan.endAt, limitAt: plan.limitAt,
            parentName: plan.parentId ? voice.channelName(raid.guildId, plan.parentId) : "",
            error: entry.error || "", missingRights: missing || [], closeReason: entry.closeReason || "",
        };
        if (isOpen(entry)) {
            return { ...out, state: "open", channelId: entry.channelId, url: voice.channelUrl(raid.guildId, entry.channelId), members: voice.memberCount(raid.guildId, entry.channelId) };
        }
        if (entry.closedAt) return { ...out, state: "closed", closedAt: entry.closedAt };
        return { ...out, state: entry.error ? "failed" : now >= plan.limitAt ? "closed" : "planned" };
    });
}

/** Whether an event's raids have a temporary channel at all (the setup editor hides the row otherwise). */
function hasVoice(event, opts) {
    return voiceStatus(event, opts).some((r) => r.kind !== "none");
}

let timer = null;
let firstTimer = null;
let nudgeTimer = null;
let offEvents = null;

function nudge() {
    if (nudgeTimer) return;
    nudgeTimer = setTimeout(() => {
        nudgeTimer = null;
        runTempVoice().catch((e) => logger.warn("[tempVoice]", errorText(e)));
    }, NUDGE_DELAY_MS);
    if (nudgeTimer.unref) nudgeTimer.unref();
}

/** Start the sweep (idempotent, unref'd): the first run a minute after the start, then every minute and after event changes. */
function startTempVoice({ intervalMs = TICK_MS, firstDelayMs = FIRST_DELAY_MS } = {}) {
    if (timer) return timer;
    const run = () => runTempVoice().catch((e) => logger.warn("[tempVoice]", errorText(e)));
    firstTimer = setTimeout(run, firstDelayMs);
    if (firstTimer.unref) firstTimer.unref();
    timer = setInterval(run, intervalMs);
    if (timer.unref) timer.unref();
    offEvents = eventStore.onEventsChanged(nudge);
    return timer;
}

/** Stop the sweep and its listener (idempotent). */
function stopTempVoice() {
    if (timer) clearInterval(timer);
    if (firstTimer) clearTimeout(firstTimer);
    if (nudgeTimer) clearTimeout(nudgeTimer);
    if (offEvents) offEvents();
    timer = null;
    firstTimer = null;
    nudgeTimer = null;
    offEvents = null;
}

/** Test-only. */
function _resetForTests() {
    stopTempVoice();
    running = false;
    lastFailure.clear();
}

module.exports = {
    runTempVoice, onVoiceStateUpdate, openNow, closeNow, voiceStatus, hasVoice, startTempVoice, stopTempVoice, _resetForTests,
};
