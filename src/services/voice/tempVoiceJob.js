// The temporary voice channels per raid (docs/channels.md "Sprachkanal je Raid"): one
// job that opens, watches and closes them. Its state lives in tempVoiceStore, so a
// restart finds every channel again; the first run (a minute after the start, when
// the gateway is up) closes whatever the bot left open for a raid that is gone.
//
// Per raid, every minute and soon after an event changed:
//   - a planned channel opens `leadMinutes` before the start (tempVoicePlan.js); the
//     entry is marked "creating" before the create, so a crash in between finds the
//     channel again (same name and Discord category) instead of creating a second;
//   - an open one closes once it was empty for EMPTY_CLOSE_MINUTES - never before
//     the raid's end - and at the latest `closeAfterMinutes` after the end: whoever
//     is still in it moves to the category's fixed channel when there is one, else
//     the channel goes with them in it (Discord drops them from the call);
//   - it closes at once and its entry goes when the raid is deleted, cancelled or
//     merged into raid 1 ("gone"), and when the raid moved later while the channel is
//     empty; someone deleting it in Discord (proven by Discord's "Unknown Channel")
//     closes the entry ("missing");
//   - the category no longer giving the raid a temporary channel (mode switched) lets
//     an open one run to its end with the times it was opened with.
// Only a close for "limit", "empty", "manual" or "missing" keeps the job from opening
// the raid's channel again; "Jetzt anlegen" may reopen any before the latest close.
// voiceStateUpdate keeps `emptySince` exact between the ticks (bot.js).
const eventStore = require("../../stores/events/eventStore");
const tempVoiceStore = require("../../stores/events/tempVoiceStore");
const { getConfig } = require("../../stores/settings/configStore");
const { groupEvents } = require("../events/raidGroup");
const { MAX_DURATION } = require("../../utils/time");
const { LEAD_MAX, CLOSE_AFTER_MAX, EMPTY_CLOSE_MINUTES, categoryTempVoiceFor } = require("../../stores/settings/tempVoiceSettings");
const { planFor, settingsFor } = require("./tempVoicePlan");
const voice = require("./tempVoiceDiscord");
const discord = require("../discord/discord");
const { eventLang } = require("../discord/botLanguage");
const logger = require("../../logger");

const TICK_MS = 60 * 1000;
const FIRST_DELAY_MS = 60 * 1000;
const NUDGE_DELAY_MS = 5 * 1000;
// A failed create is tried again after this long, not every minute.
const RETRY_SECONDS = 10 * 60;
// Discord allows 2 renames of a channel per 10 minutes: at most one per this long.
const RENAME_SECONDS = 5 * 60;
// Closed entries are kept this long (the setup editor shows "geschlossen"), then pruned.
const KEEP_CLOSED_SECONDS = 7 * 24 * 3600;
// The closes after which the job does not open the raid's channel again by itself.
const BLOCKING = new Set(["limit", "empty", "manual", "missing"]);

const nowSeconds = () => Math.floor(Date.now() / 1000);
const isOpen = (entry) => !!(entry && entry.channelId && !entry.closedAt);
const isCreating = (entry) => !!(entry && entry.creatingAt && !isOpen(entry));
const errorText = (e) => String((e && e.message) || e || "Unbekannter Fehler").slice(0, 300);
const alive = (event) => !!event && event.status !== "cancelled";

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
    return planFor(event, { group, config, lang: eventLang(event, config), leaderName: (id) => voice.memberName(event.guildId, id) });
}

/**
 * The raids the job looks at now: every own event whose channel could be due or
 * still open (start within the longest lead before / longest raid + close after),
 * and every event with an open or half-created entry.
 */
function candidates(now) {
    const since = now - (MAX_DURATION + CLOSE_AFTER_MAX) * 60;
    const until = now + LEAD_MAX * 60;
    const out = new Map();
    for (const e of eventStore.listEvents("", { siblings: true, sinceSeconds: since, untilSeconds: until })) out.set(e.id, e);
    for (const entry of tempVoiceStore.listEntries()) {
        if ((isOpen(entry) || isCreating(entry)) && !out.has(entry.eventId)) out.set(entry.eventId, eventStore.getEvent(entry.eventId));
    }
    return out;
}

const lastFailure = new Map();
// eventId -> the running open(): a second caller (the job, "Jetzt anlegen") waits for it instead of creating twice.
const opening = new Map();

async function create(event, plan, now, manual) {
    const before = tempVoiceStore.getEntry(event.id) || {};
    // Noted before the create: a crash before the id is saved finds the channel again (adoptCreated).
    tempVoiceStore.updateEntry(event.id, {
        guildId: plan.guildId, creatingAt: now, name: plan.name, parentId: plan.parentId, endAt: plan.endAt,
        limitAt: plan.limitAt, fixedChannelId: plan.fixedChannelId, onlyAssigned: plan.onlyAssigned, error: "",
    });
    try {
        const created = await voice.createVoice(plan.guildId, plan);
        lastFailure.delete(event.id);
        tempVoiceStore.updateEntry(event.id, {
            channelId: created.id, name: created.name, createdAt: now, emptySince: now, closedAt: 0, closeReason: "",
            manual, error: "", creatingAt: 0, granted: created.granted || [], renameAt: 0,
        });
        logger.info(`[tempVoice] ${created.name} angelegt (${event.id})`);
        return { ok: true, channelId: created.id };
    } catch (e) {
        lastFailure.set(event.id, now);
        const error = discord.isRateLimitError(e) ? "Discord-Ratelimit beim Anlegen, nächster Versuch in 10 Minuten." : errorText(e);
        tempVoiceStore.updateEntry(event.id, { creatingAt: 0, error, name: before.name || plan.name });
        logger.warn(`[tempVoice] Anlegen für ${event.id} fehlgeschlagen:`, errorText(e));
        return { ok: false, error };
    }
}

/** Open the raid's channel; a call while one is running for the raid gets the running one's result. */
function open(event, plan, now, { manual = false } = {}) {
    if (opening.has(event.id)) return opening.get(event.id);
    const running = create(event, plan, now, manual).finally(() => opening.delete(event.id));
    opening.set(event.id, running);
    return running;
}

async function close(eventId, entry, reason, now, { moveTo = "", remove = false } = {}) {
    try {
        const result = await voice.closeVoice(entry.guildId, entry.channelId, { moveTo });
        if (remove) tempVoiceStore.removeEntry(eventId);
        else tempVoiceStore.updateEntry(eventId, { closedAt: now, closeReason: reason, emptySince: 0, error: "" });
        logger.info(`[tempVoice] ${entry.name || entry.channelId} geschlossen (${reason}${result.moved ? `, ${result.moved} verschoben` : ""})`);
        return { ok: true, moved: result.moved };
    } catch (e) {
        tempVoiceStore.updateEntry(eventId, { error: errorText(e) });
        logger.warn(`[tempVoice] Schließen von ${entry.channelId} fehlgeschlagen:`, errorText(e));
        return { ok: false, error: errorText(e) };
    }
}

/**
 * An entry marked "creating" without a running create: the bot stopped between the
 * create and saving its id. A voice channel of that name in that Discord category,
 * created since, is taken over; none - the mark goes and the raid may open again.
 * Returns the entry as it is now; null while the server is not available.
 */
function adoptCreated(eventId, entry, plan, now) {
    if (!discord.isGuildAvailable(entry.guildId)) return null;
    const found = voice.findCreatedVoice(entry.guildId, { name: entry.name, parentId: entry.parentId, since: entry.creatingAt });
    if (!found) return tempVoiceStore.updateEntry(eventId, { creatingAt: 0 });
    logger.info(`[tempVoice] ${found.name} nach Neustart wiedergefunden (${eventId})`);
    return tempVoiceStore.updateEntry(eventId, {
        channelId: found.id, name: found.name, createdAt: entry.creatingAt, emptySince: now, closedAt: 0, closeReason: "",
        error: "", creatingAt: 0, renameAt: 0, granted: entry.onlyAssigned && plan ? plan.members : [],
    });
}

/**
 * What an open channel follows: the raid's plan, else (the category no longer gives the
 * raid a temporary channel) the times it was opened with, so it runs to its end.
 */
function followedPlan(plan, entry) {
    if (plan) return plan;
    if (!entry.limitAt) return null;
    return { guildId: entry.guildId, endAt: entry.endAt, limitAt: entry.limitAt, emptyMinutes: EMPTY_CLOSE_MINUTES, fixedChannelId: entry.fixedChannelId, kept: true };
}

/** Keep name and access of an open channel in line with its plan; every Discord call on its own. */
async function keepInLine(eventId, entry, plan, now) {
    const timesChanged = plan.endAt !== entry.endAt || plan.limitAt !== entry.limitAt || plan.fixedChannelId !== entry.fixedChannelId || plan.parentId !== entry.parentId;
    if (timesChanged) tempVoiceStore.updateEntry(eventId, { endAt: plan.endAt, limitAt: plan.limitAt, fixedChannelId: plan.fixedChannelId, parentId: plan.parentId });
    if (plan.name !== entry.name && now - (entry.renameAt || 0) >= RENAME_SECONDS) {
        tempVoiceStore.updateEntry(eventId, { renameAt: now });
        try {
            const renamed = await voice.renameVoice(entry.guildId, entry.channelId, plan.name);
            if (renamed) tempVoiceStore.updateEntry(eventId, { name: renamed });
        } catch (e) {
            if (discord.isRateLimitError(e)) logger.info(`[tempVoice] Umbenennen von ${entry.channelId} wartet auf das Discord-Ratelimit.`);
            else logger.warn("[tempVoice] Umbenennen:", errorText(e));
        }
    }
    try {
        if (plan.onlyAssigned !== !!entry.onlyAssigned) {
            const done = await voice.setAccess(entry.guildId, entry.channelId, { onlyAssigned: plan.onlyAssigned, members: plan.members });
            if (done) tempVoiceStore.updateEntry(eventId, { onlyAssigned: plan.onlyAssigned, granted: done.granted });
        } else if (plan.onlyAssigned) {
            const done = await voice.syncMembers(entry.guildId, entry.channelId, plan.members, entry.granted || []);
            if (done && done.changed) tempVoiceStore.updateEntry(eventId, { granted: done.granted });
        }
    } catch (e) {
        logger.warn("[tempVoice] Zugang:", errorText(e));
    }
}

/** An open channel's step: track emptiness, close when it is time, keep name and access in line. */
async function stepOpen(eventId, event, entry, plan, now, out) {
    const follow = alive(event) ? followedPlan(plan, entry) : null;
    if (!follow) {
        out.closed.push(eventId);
        return close(eventId, entry, "gone", now, { remove: true });
    }
    const count = voice.memberCount(entry.guildId, entry.channelId);
    if (count === null) {
        // Not in the cache: deleted in Discord - or the bot is not connected yet, or the cache is behind.
        if (!discord.isOnline() || !discord.isGuildAvailable(entry.guildId)) return null;
        if (!(await voice.channelGone(entry.guildId, entry.channelId))) return null;
        tempVoiceStore.updateEntry(eventId, { closedAt: now, closeReason: "missing", emptySince: 0 });
        out.closed.push(eventId);
        return null;
    }
    const emptySince = count > 0 ? 0 : entry.emptySince || now;
    if (emptySince !== entry.emptySince) tempVoiceStore.updateEntry(eventId, { emptySince });
    if (now >= follow.limitAt) {
        out.closed.push(eventId);
        return close(eventId, entry, "limit", now, { moveTo: follow.fixedChannelId });
    }
    if (now >= follow.endAt && emptySince && now - emptySince >= follow.emptyMinutes * 60) {
        out.closed.push(eventId);
        return close(eventId, entry, "empty", now);
    }
    if (follow.kept) return null;
    if (count === 0 && !entry.manual && now < plan.openAt) {
        // The raid moved later: the empty channel goes and opens again on the new time.
        out.closed.push(eventId);
        return close(eventId, entry, "moved", now, { remove: true });
    }
    return keepInLine(eventId, entry, plan, now);
}

/** One raid's step: open when due, track emptiness, close when it is time. */
async function stepRaid(eventId, event, config, now, out) {
    if (opening.has(eventId)) return null;
    let entry = tempVoiceStore.getEntry(eventId);
    const plan = alive(event) ? planOf(event, groupOf(event), config) : null;
    if (isCreating(entry)) {
        entry = adoptCreated(eventId, entry, plan, now);
        if (!entry) return null;
    }
    if (isOpen(entry)) return stepOpen(eventId, event, entry, plan, now, out);
    if (!plan || (entry && entry.closedAt && BLOCKING.has(entry.closeReason))) return null;
    if (now < plan.openAt || now >= plan.limitAt) return null;
    if (now - (lastFailure.get(eventId) || 0) < RETRY_SECONDS) return null;
    if (!discord.isGuildAvailable(plan.guildId)) return null;
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

/** "Jetzt anlegen": open the raid's channel now, before its time; reopens a closed one until the latest close. */
async function openNow(eventId, { now = nowSeconds() } = {}) {
    const { event, plan, error, status } = manualTarget(eventId);
    if (error) return { error, status };
    if (!plan) return { error: "Für diesen Raid ist kein temporärer Sprachkanal vorgesehen.", status: 409 };
    if (now >= plan.limitAt) return { error: "Der Raid ist vorbei.", status: 409 };
    if (!opening.has(event.id) && isOpen(tempVoiceStore.getEntry(event.id))) return { error: "Der Kanal ist schon offen.", status: 409 };
    const result = await open(event, plan, now, { manual: true });
    return result.ok ? { ok: true } : { error: result.error, status: 502 };
}

/** "Schließen": close the raid's channel now; people in it move to the fixed channel when there is one. */
async function closeNow(eventId, { now = nowSeconds() } = {}) {
    const event = eventStore.getEvent(eventId);
    const entry = tempVoiceStore.getEntry(eventId);
    if (!isOpen(entry)) return { error: "Kein offener Kanal.", status: 409 };
    const fixed = event ? categoryTempVoiceFor(getConfig() || {}, (groupOf(event)[0] || event).categoryId).voiceChannelId : "";
    const result = await close(eventId, entry, "manual", now, { moveTo: fixed || entry.fixedChannelId });
    return result.ok ? { ok: true } : { error: result.error, status: 502 };
}

/** An open channel whose raid no longer plans one (the category's mode changed): it runs to its end. */
function keptStatus(base, raid, entry) {
    return {
        ...base, kind: "temp", state: "open", name: entry.name, channelId: entry.channelId,
        url: voice.channelUrl(raid.guildId, entry.channelId), members: voice.memberCount(raid.guildId, entry.channelId),
        openAt: entry.createdAt, endAt: entry.endAt, limitAt: entry.limitAt, parentName: entry.parentId ? voice.channelName(raid.guildId, entry.parentId) : "",
        error: entry.error || "", missingRights: [], closeReason: "", canOpen: false,
    };
}

/**
 * The voice channel of every raid of an event's group, for the setup editor:
 * `[{ eventId, index, kind, state, name, channelId, url, members, openAt, parentName, error, missingRights, canOpen }]`
 *   kind  "none" | "fixed" (the category's channel) | "temp"
 *   state "fixed" | "planned" | "creating" | "open" | "closed" | "failed"
 *   canOpen  whether "Jetzt anlegen" is offered (not open, before the latest close)
 */
function voiceStatus(event, { now = nowSeconds(), config = getConfig() || {} } = {}) {
    if (!event) return [];
    const group = groupOf(event);
    const settings = settingsFor(group[0] || event, config);
    return group.map((raid, i) => {
        const plan = planOf(raid, group, config);
        const entry = tempVoiceStore.getEntry(raid.id) || {};
        const base = { eventId: raid.id, index: i + 1, total: group.length, mode: settings.mode };
        if (!plan) {
            if (isOpen(entry)) return keptStatus(base, raid, entry);
            const fixed = settings.mode === "existing" ? settings.voiceChannelId : "";
            if (!fixed) return { ...base, kind: "none", state: "none" };
            return {
                ...base, kind: "fixed", state: "fixed", channelId: fixed, name: voice.channelName(raid.guildId, fixed),
                url: voice.channelUrl(raid.guildId, fixed), members: voice.memberCount(raid.guildId, fixed),
            };
        }
        const missing = voice.missingRightKeys(raid.guildId, plan);
        const creating = opening.has(raid.id) || isCreating(entry);
        const out = {
            ...base, kind: "temp", name: isOpen(entry) ? entry.name || plan.name : plan.name,
            channelId: "", url: "", members: null, openAt: plan.openAt, endAt: plan.endAt, limitAt: plan.limitAt,
            parentName: plan.parentId ? voice.channelName(raid.guildId, plan.parentId) : "",
            error: entry.error || "", missingRights: missing || [], closeReason: entry.closeReason || "",
            canOpen: !isOpen(entry) && !creating && now < plan.limitAt,
        };
        if (isOpen(entry)) {
            return { ...out, state: "open", channelId: entry.channelId, url: voice.channelUrl(raid.guildId, entry.channelId), members: voice.memberCount(raid.guildId, entry.channelId) };
        }
        if (creating) return { ...out, state: "creating" };
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
    opening.clear();
}

module.exports = {
    runTempVoice, onVoiceStateUpdate, openNow, closeNow, voiceStatus, hasVoice, startTempVoice, stopTempVoice, _resetForTests,
};
