// "Event verwalten" (#288): everything the orga does with an EventHelper event
// after it was created — move it, close or open the signup, sign raiders up or
// off, cancel it (and take the cancellation back), delete it. One service for the web
// (apiRoutes/eventManage.js) and Discord (commands/event/eventManage*.js).
//
// Three rules hold for every action:
//   * only an own event of the server the caller works on (a Raid-Helper event
//     is managed at Raid-Helper);
//   * the logic stays visible — a move is previewed first (`movePlan`: the new
//     date, the channel's new name and where that name came from, how many are
//     told), a cancellation says whom it DMs;
//   * everything is logged on the event (`eventStore.appendEventLog`): who, when,
//     what. Editing through the create dialog (eventCreate.updateEvent) logs too.
//     Deleting takes the log along, so `deleteEvent` writes who deleted what to
//     the console instead.
//
// Discord calls are best-effort after the store changed: a channel that cannot be
// renamed or a DM that does not arrive is reported, never a rolled-back action.
const { DateTime } = require("luxon");
const eventStore = require("../stores/eventStore");
const signupStore = require("../stores/signupStore");
const raidplanStore = require("../stores/raidplanStore");
const signupService = require("./signupService");
const profiles = require("../stores/raiderProfileStore");
const reminderStore = require("../stores/reminderStore");
const seriesStore = require("../stores/eventSeriesStore");
const logStore = require("../stores/logStore");
const lootStore = require("../stores/lootStore");
const channelNaming = require("./channelNaming");
const discordChannels = require("./discordChannels");
const archiveStore = require("../stores/channelArchiveStore");
const discord = require("./discord");
const { refreshEventMessage } = require("./eventMessage");
const { refreshSetupMessage } = require("./setupMessage");
const discordEvent = require("./discordEvent");
const { scheduleOverviewSync } = require("./talkOverview");
const { deliverUserPing, sendDms } = require("./pingDelivery");
const { getConfig } = require("../stores/settingsStore");
const { setupSummary } = require("./setupEditor");
const { rulesFor, DEFAULT_VERSION } = require("../config/gameVersions");
const { toRaidHelperDate } = require("../utils/time");
const { SIGNUP_STATUSES } = require("../utils/attendance");
const { str } = require("../utils/text");
const { isSnowflake } = require("../utils/ids");

const { TIMEZONE } = require("../config/timezone");
const { fail } = require("./apiResult");
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MIN_REASON = 3;
const MAX_REASON = 300;

/** What a log entry's action reads as. */
const ACTION_LABELS = {
    edit: "Bearbeitet",
    move: "Verschoben",
    close: "Anmeldung geschlossen",
    open: "Anmeldung geöffnet",
    add: "Raider eingetragen",
    remove: "Raider ausgetragen",
    ping: "Fehlende gepingt",
    invite: "Invite gecallt",
    cancel: "Abgesagt",
    reopen: "Absage zurückgenommen",
    series: "Von Serie angelegt",
    lock: "Anmeldung automatisch geschlossen",
    announce: "Angekündigt",
};

const STATUS_LABELS = {
    signed: "Dabei", tentative: "Vielleicht", late: "Spät", bench: "Bank", absence: "Abgemeldet",
};

/** "Do 24.09. 19:30" in Berlin time. */
function whenLabel(startTime) {
    const n = Number(startTime) || 0;
    if (!n) return "";
    const dt = DateTime.fromSeconds(n, { zone: TIMEZONE });
    return `${WEEKDAYS[dt.weekday - 1]} ${dt.toFormat("dd.MM. HH:mm")}`;
}

/** Unix seconds of a date ("2026-09-24", "24-09-2026") and "19:30" in Berlin time, or 0. */
function startTimeOf(date, time) {
    const d = toRaidHelperDate(date);
    const t = String(time || "").trim();
    if (!d || !/^\d{1,2}:\d{2}$/.test(t)) return 0;
    const dt = DateTime.fromFormat(`${d} ${t}`, "dd-MM-yyyy H:mm", { zone: TIMEZONE });
    return dt.isValid ? Math.floor(dt.toSeconds()) : 0;
}

/** The actor of an action as the log keeps it. */
function actorOf(user, byName = "") {
    return { by: str(user && user.id), byName: str(byName || (user && (user.name || user.username))) };
}

/**
 * The own event an action is about, or a failure. A Raid-Helper id, an event of
 * another server and (unless `allowCancelled`) a cancelled event are refused.
 */
function ownEvent(guildId, eventId, { allowCancelled = false } = {}) {
    const id = str(eventId);
    if (!eventStore.isOwnEventId(id)) return fail(400, "not_own_event", "Nur EventHelper-Events lassen sich hier verwalten.");
    const event = eventStore.getEvent(id);
    if (!event || (guildId && event.guildId && event.guildId !== guildId)) return fail(404, "not_found", "Event nicht gefunden.");
    if (!allowCancelled && event.status === "cancelled") return fail(409, "cancelled", "Das Event ist abgesagt.");
    return { event };
}

function log(eventId, action, actor, detail = "") {
    eventStore.appendEventLog(eventId, { action, ...actor, detail });
}

/** Signed-up raiders who hear about a move or a cancellation: everyone who did not sign off. */
function recipientsOf(eventId) {
    return signupStore.listSignups(eventId).filter((s) => s.status !== "absence");
}

/** Discord display names by user id; {} when Discord cannot tell. */
async function namesOf(guildId, userIds) {
    if (!userIds.length) return {};
    try {
        return (await discord.resolveUserNames(guildId, userIds)) || {};
    } catch {
        return {};
    }
}

async function refreshMessage(eventId) {
    let error = null;
    try {
        await refreshEventMessage(eventId);
    } catch (e) {
        error = (e && e.message) || "Die Event-Nachricht konnte nicht aktualisiert werden.";
    }
    // A posted setup (#290) is marked "Abgesagt" resp. shown again — never posted anew here.
    const setupError = await refreshSetupMessage(eventId).catch((e) => (e && e.message) || "Fehler");
    if (setupError) error = [error, `Setup-Nachricht: ${setupError}`].filter(Boolean).join(" · ");
    return error;
}

/** The current name of the event's channel: live from Discord, else the stored one. */
function channelNameOf(event) {
    try {
        const hit = (discord.listAllChannels(event.guildId) || []).find((c) => String(c.id) === String(event.channelId));
        if (hit && hit.name) return hit.name;
    } catch {
        // offline — the stored name stands in
    }
    return event.channelName || "";
}

const isoDay = (startTime) => DateTime.fromSeconds(Number(startTime), { zone: TIMEZONE }).toISODate();

/**
 * What moving the channel along means (#285's naming): the name the channel
 * gets for the new day, or why it keeps its name. A name is only rewritten
 * when it follows a rule the old day is visible in — the category's own schema
 * (and the channel still carries the old day's schema name) or its own date
 * (derived from its own name). A hand-made name is never replaced.
 */
async function channelPlan(event, startTime) {
    const current = channelNameOf(event);
    const base = { id: event.channelId, current, next: current, rename: false, label: "", detail: "", reason: "" };
    if (!event.channelId) return { ...base, reason: "Das Event hat keinen Kanal." };
    const day = isoDay(startTime);
    const oldDay = isoDay(event.startTime);
    const common = { guildId: event.guildId, categoryId: event.categoryId, instanceIds: event.instanceIds };
    let naming;
    try {
        naming = await channelNaming.deriveChannelName({ ...common, date: day, fromEventId: event.id, excludeChannelId: event.channelId });
    } catch {
        return { ...base, reason: "Der Name ließ sich nicht ableiten — er bleibt." };
    }
    const described = { label: naming.label || "", detail: naming.detail || "" };
    if (day === oldDay) return { ...base, ...described, reason: "Gleicher Tag — der Name bleibt." };
    let follows = false;
    if (naming.source === "previous") {
        follows = String(naming.fromChannelId || "") === String(event.channelId);
    } else if (naming.source === "schema") {
        try {
            const before = await channelNaming.deriveChannelName({ ...common, date: oldDay, fromEventId: event.id, excludeChannelId: event.channelId });
            follows = before.name === current;
        } catch {
            follows = false;
        }
    }
    if (!follows || !naming.name) {
        return { ...base, ...described, reason: "Im Kanalnamen ist kein Datum erkennbar — der Name bleibt." };
    }
    if (naming.name === current) return { ...base, ...described, reason: "Der Name ändert sich nicht." };
    return { ...base, ...described, next: naming.name, rename: true, placement: naming.placement || null };
}

/**
 * The preview of a move: new start, shifted deadline, the channel's name and
 * who hears about it. Nothing changes.
 * @returns {Promise<{ plan?: object, error?: object }>}
 */
async function movePlan({ guildId, eventId, date, time, now = Date.now() }) {
    const found = ownEvent(guildId, eventId);
    if (found.error) return found;
    const { event } = found;
    const startTime = startTimeOf(date, time);
    if (!startTime) return fail(400, "invalid_time", "Datum oder Uhrzeit fehlen oder sind ungültig.");
    if (startTime * 1000 <= now) return fail(400, "past", `${whenLabel(startTime)} liegt in der Vergangenheit.`);
    if (startTime === event.startTime) return fail(400, "unchanged", "Das ist schon der Termin des Events.");
    // The deadline keeps its distance to the start.
    const signupDeadline = event.signupDeadline ? startTime - (event.startTime - event.signupDeadline) : 0;
    const channel = await channelPlan(event, startTime);
    return {
        plan: {
            eventId: event.id,
            title: event.title,
            from: { startTime: event.startTime, label: whenLabel(event.startTime) },
            to: { startTime, label: whenLabel(startTime) },
            signupDeadline,
            deadlineLabel: signupDeadline ? whenLabel(signupDeadline) : "",
            channel,
            recipients: recipientsOf(event.id).length,
        },
    };
}

/**
 * Move an event: new start (the deadline keeps its distance), the channel
 * renamed as previewed (`renameChannel`), a note with mentions in the event
 * channel to everyone signed up (`notify`), the reminders armed again.
 */
async function moveEvent({ guildId, eventId, date, time, renameChannel = true, notify = true, user, byName, now = Date.now() }) {
    const planned = await movePlan({ guildId, eventId, date, time, now });
    if (planned.error) return planned;
    const { plan } = planned;
    const updated = eventStore.updateEvent(plan.eventId, { startTime: plan.to.startTime, signupDeadline: plan.signupDeadline });
    if (updated.error) return fail(400, "invalid_plan", updated.error);
    // A reminder sent for the old date says nothing about the new one.
    for (const kind of ["missing", "signed"]) reminderStore.clearSent(plan.eventId, kind);

    let channelError = null;
    let renamed = "";
    if (renameChannel && plan.channel.rename) {
        try {
            const edited = await discordChannels.editChannel(plan.channel.id, { name: plan.channel.next });
            renamed = edited.name || plan.channel.next;
            eventStore.updateEvent(plan.eventId, { channelName: renamed });
            if (plan.channel.placement) await discordChannels.placeChannel(plan.channel.id, plan.channel.placement);
        } catch (e) {
            channelError = `Kanal nicht umbenannt: ${discordChannels.discordErrorText(e)}`;
        }
    }
    const messageError = await refreshMessage(plan.eventId);
    // The Discord event moves along (#305); a refusal is a warning, never a failed move.
    const discordEventError = discordEvent.warningOf(await discordEvent.syncForEvent(plan.eventId).catch((e) => ({ warning: (e && e.message) || "Fehler" })));

    let notified = 0;
    let notifyError = null;
    const recipients = recipientsOf(plan.eventId).map((s) => s.userId);
    if (notify && recipients.length) {
        const event = eventStore.getEvent(plan.eventId);
        const start = plan.to.startTime;
        try {
            await deliverUserPing({
                target: "event", event, userIds: recipients, guildId,
                text: `📅 **${event.title}** has been moved: now <t:${start}:F> (<t:${start}:R>).`,
            });
            notified = recipients.length;
        } catch (e) {
            notifyError = `Hinweis nicht gepostet: ${(e && e.message) || "unbekannter Fehler"}`;
        }
    }
    scheduleOverviewSync();

    const detail = [
        `${plan.from.label} → ${plan.to.label}`,
        renamed ? `Kanal #${renamed}` : "",
        notified ? `${notified} benachrichtigt` : "",
    ].filter(Boolean).join(" · ");
    log(plan.eventId, "move", actorOf(user, byName), detail);

    const parts = [`Verschoben auf ${plan.to.label}`];
    if (renamed) parts.push(`Kanal heißt jetzt #${renamed}`);
    if (notified) parts.push(`${notified} Angemeldete benachrichtigt`);
    return {
        status: 200,
        body: {
            message: `${parts.join(" · ")}.`,
            event: eventStore.getEvent(plan.eventId),
            renamed, notified,
            warnings: [channelError, messageError, notifyError, discordEventError].filter(Boolean),
        },
    };
}

/** Close (`open: false`) or open the signup. Members may still sign off while it is closed. */
async function setSignupsOpen({ guildId, eventId, open, user, byName }) {
    const found = ownEvent(guildId, eventId);
    if (found.error) return found;
    const close = open !== true;
    if (found.event.signupsClosed === close) {
        return fail(409, "unchanged", close ? "Die Anmeldung ist schon geschlossen." : "Die Anmeldung ist schon offen.");
    }
    const event = eventStore.setEventState(found.event.id, { signupsClosed: close });
    const messageError = await refreshMessage(event.id);
    log(event.id, close ? "close" : "open", actorOf(user, byName));
    return {
        status: 200,
        body: {
            message: close ? "Anmeldung geschlossen — Abmelden geht weiter." : "Anmeldung wieder offen.",
            event: eventStore.getEvent(event.id),
            warnings: [messageError].filter(Boolean),
        },
    };
}

/**
 * Sign a raider up as the orga (`byOrga`: deadline, start of the window and the
 * closed signup do not apply). A character the raider's profile does not have
 * yet — or a spec it lacks — is added to the profile first, the way the Discord
 * signup does it for a new raider.
 *
 * `alternates` (#293, optional): further `{ character, spec }` the raider "kann
 * auch mit", in priority order after `character` — each goes through the same
 * profile check. Without it an existing signup keeps its alternates.
 */
async function addRaider({ guildId, eventId, userId, character, spec, alternates, status = "signed", comment, user, byName }) {
    const found = ownEvent(guildId, eventId);
    if (found.error) return found;
    const uid = str(userId);
    if (!isSnowflake(uid)) return fail(400, "bad_request", "Kein Raider gewählt.");
    const name = str(character);
    if (!name) return fail(400, "character", "Bitte einen Charakter angeben.");
    if (!SIGNUP_STATUSES.includes(status)) return fail(400, "status", `Unbekannter Anmeldestatus „${status}“.`);
    const info = profiles.specInfo(spec);
    if (!info) return fail(400, "spec", "Bitte eine Spezialisierung wählen.");
    const extra = Array.isArray(alternates) ? alternates.filter((a) => a && str(a.character)) : null;
    if (extra && extra.length + 1 > signupService.MAX_CHARACTERS) {
        return fail(400, "characters", `Höchstens ${signupService.MAX_CHARACTERS} Charaktere je Anmeldung.`);
    }

    let profileChanged = false;
    /** The character in the raider's profile with this spec — added when missing. */
    const ensure = (charName, specInfo) => {
        const existing = signupService.findCharacter(profiles.getProfile(uid), charName);
        if (existing && existing.className === specInfo.classId && existing.specs.some((s) => s.key === specInfo.key)) return null;
        if (existing && existing.className !== specInfo.classId) {
            return fail(400, "spec", `${existing.name} ist im Profil ${existing.className} — die Spec passt nicht.`);
        }
        const added = profiles.addCharacter(uid, { name: charName, className: specInfo.classId, specs: [{ key: specInfo.key }], source: "manual" });
        if (added.error) return fail(400, "character", added.error);
        profileChanged = true;
        return null;
    };
    const wanted = [{ character: name, info }];
    for (const a of extra || []) {
        const altInfo = profiles.specInfo(a.spec);
        if (!altInfo) return fail(400, "spec", `Für ${str(a.character)} fehlt die Spezialisierung.`);
        wanted.push({ character: str(a.character), info: altInfo });
    }
    for (const w of wanted) {
        const refused = ensure(w.character, w.info);
        if (refused) return refused;
    }
    const input = extra
        ? { characters: wanted.map((w) => ({ character: w.character, spec: w.info.key })), status, comment }
        : { character: name, spec: info.key, status, comment };
    const result = await signupService.submitSignup(found.event.id, uid, input, { byOrga: true });
    if (result.error) return fail(signupService.httpStatusFor(result.code), result.code, result.error);
    const who = result.signup.character || name;
    log(found.event.id, "add", actorOf(user, byName), `${who} · ${info.label} · ${STATUS_LABELS[status] || status}${profileChanged ? " · ins Profil übernommen" : ""}`);
    return {
        status: 200,
        body: {
            message: `${who} eingetragen (${STATUS_LABELS[status] || status}).${profileChanged ? " Der Charakter steht jetzt auch im Profil." : ""}`,
            signup: result.signup,
            profileChanged,
        },
    };
}

/** Take a raider's signup off the event entirely. */
async function removeRaider({ guildId, eventId, userId, user, byName }) {
    const found = ownEvent(guildId, eventId, { allowCancelled: true });
    if (found.error) return found;
    const uid = str(userId);
    const signup = signupStore.getSignup(found.event.id, uid);
    if (!signup) return fail(404, "not_signed_up", "Dieser Raider ist nicht eingetragen.");
    signupStore.removeSignup(found.event.id, uid);
    const who = signup.character || uid;
    log(found.event.id, "remove", actorOf(user, byName), who);
    return { status: 200, body: { message: `${who} ausgetragen.` } };
}

/** The DM a raider gets when an event is cancelled. */
function cancelDm(event, reason, guildId) {
    const start = Number(event.startTime) || 0;
    const url = guildId && event.channelId ? `https://discord.com/channels/${guildId}/${event.channelId}` : "";
    return [
        `❌ **${event.title}**${start ? ` on <t:${start}:F>` : ""} has been cancelled.`,
        `Reason: ${reason}`,
        url,
    ].filter(Boolean).join("\n");
}

/** The archive category of a server, or "" when none is set (Kanäle → Archiv). */
function archiveCategoryOf(guildId) {
    try {
        return str(archiveStore.getChannelConfig(guildId).archiveCategoryId);
    } catch {
        return "";
    }
}

/**
 * Cancel an event: nobody can sign up any more, the message says ABGESAGT with
 * the reason, everyone signed up gets a DM (`notify`), the channel optionally
 * goes into the archive. Reminders and the automatic setup proposal skip it,
 * the talk overview strikes it through.
 */
async function cancelEvent({ guildId, eventId, reason, archiveChannel = false, notify = true, user, byName, now = Date.now() }) {
    const found = ownEvent(guildId, eventId);
    if (found.error) return found;
    const text = str(reason).replace(/\s+/g, " ").slice(0, MAX_REASON);
    if (text.length < MIN_REASON) return fail(400, "reason", "Bitte einen Grund angeben — er geht an alle Angemeldeten.");
    const archiveId = archiveChannel ? archiveCategoryOf(found.event.guildId || guildId) : "";
    if (archiveChannel && !archiveId) return fail(400, "no_archive", "Für diesen Server ist keine Archiv-Kategorie festgelegt (Kanäle → Archiv).");

    const actor = actorOf(user, byName);
    const cancel = { reason: text, at: now, by: actor.by, byName: actor.byName, archived: false };
    let event = eventStore.setEventState(found.event.id, { status: "cancelled", signupsClosed: true, cancel });
    const messageError = await refreshMessage(event.id);
    // The Discord event is called off too — an event still listed for a raid
    // that is not happening is worse than none (#305).
    const discordEventError = discordEvent.warningOf(await discordEvent.cancelForEvent(event.id).catch((e) => ({ warning: (e && e.message) || "Fehler" })));

    let dm = { sent: [], failed: [] };
    const recipients = recipientsOf(event.id).map((s) => s.userId);
    if (notify && recipients.length) {
        try {
            dm = await sendDms(recipients, { content: cancelDm(event, text, event.guildId || guildId) });
        } catch (e) {
            dm = { sent: [], failed: recipients, error: (e && e.message) || "Bot nicht verbunden." };
        }
    }

    let archiveError = null;
    if (archiveId && event.channelId) {
        try {
            const moved = await discordChannels.archiveChannel(event.channelId, archiveId);
            archiveStore.recordArchived({ ...moved, guildId: moved.guildId || event.guildId, channelId: moved.id, by: actor.by, byName: actor.byName, at: now });
            event = eventStore.setEventState(event.id, { cancel: { ...cancel, archived: true } });
        } catch (e) {
            archiveError = `Kanal nicht archiviert: ${discordChannels.discordErrorText(e)}`;
        }
    }
    scheduleOverviewSync();

    const archived = !!(event.cancel && event.cancel.archived);
    log(event.id, "cancel", actor, [
        `Grund: ${text}`,
        dm.sent.length ? `${dm.sent.length} DMs` : "",
        dm.failed.length ? `${dm.failed.length} DMs fehlgeschlagen` : "",
        archived ? "Kanal archiviert" : "",
    ].filter(Boolean).join(" · "));

    const parts = ["Event abgesagt"];
    if (dm.sent.length) parts.push(`${dm.sent.length} per DM informiert`);
    if (archived) parts.push("Kanal im Archiv");
    return {
        status: 200,
        body: {
            message: `${parts.join(" · ")}.`,
            event: eventStore.getEvent(event.id),
            dm: { sent: dm.sent.length, failed: dm.failed.length },
            archived,
            warnings: [
                messageError,
                dm.failed.length ? `${dm.failed.length} ${dm.failed.length === 1 ? "DM kam" : "DMs kamen"} nicht an (DMs geschlossen?)` : "",
                archiveError,
                discordEventError,
            ].filter(Boolean),
        },
    };
}

/** Take a cancellation back: the event is open for signups again. An archived channel stays in the archive. */
async function reopenEvent({ guildId, eventId, user, byName }) {
    const found = ownEvent(guildId, eventId, { allowCancelled: true });
    if (found.error) return found;
    if (found.event.status !== "cancelled") return fail(409, "unchanged", "Das Event ist nicht abgesagt.");
    const wasArchived = !!(found.event.cancel && found.event.cancel.archived);
    const event = eventStore.setEventState(found.event.id, { status: "active", signupsClosed: false, cancel: null });
    const messageError = await refreshMessage(event.id);
    // A cancelled Discord event cannot be revived — a new one is created (#305).
    const discordEventError = discordEvent.warningOf(await discordEvent.reopenForEvent(event.id).catch((e) => ({ warning: (e && e.message) || "Fehler" })));
    scheduleOverviewSync();
    log(event.id, "reopen", actorOf(user, byName));
    return {
        status: 200,
        body: {
            message: `Absage zurückgenommen — Anmeldung wieder offen.${wasArchived ? " Der Kanal liegt noch im Archiv (Kanäle)." : ""}`,
            event: eventStore.getEvent(event.id),
            warnings: [messageError, discordEventError].filter(Boolean),
        },
    };
}

// ---- Löschen ---------------------------------------------------------------

/** Discord's "this is gone already": unknown message / unknown channel. */
const isGone = (e) => !!(e && (e.code === 10008 || e.code === 10003 || /unknown (message|channel)/i.test(e.message || "")));

/** Delete one bot message; a message that is already gone counts as deleted. Throws on anything else. */
async function deleteMessage(where) {
    if (!where || !where.messageId || !where.channelId) return false;
    if (!discord.isOnline()) throw new Error("Bot nicht verbunden.");
    try {
        const channel = await discord.fetchTextChannel(where.channelId);
        const message = await channel.messages.fetch(where.messageId);
        await message.delete();
        return true;
    } catch (e) {
        if (isGone(e) || (e && e.code === "channel_not_found")) return false;
        throw e;
    }
}

/**
 * What deleting an event takes along and what stays: its signups (and with them
 * the attendance of a raid that already started), the posted messages — while
 * linked logs and imported loot keep their own copy of the raid's name and stay.
 * Pure over the stores; nothing changes.
 */
function deletionInfo(event, now = Date.now()) {
    const signups = signupStore.listSignups(event.id);
    const started = (Number(event.startTime) || 0) * 1000 <= now;
    const cancelled = event.status === "cancelled";
    let logs = 0;
    let loot = 0;
    try {
        logs = logStore.listLogsForEvent(event.id).length;
        loot = lootStore.listByEvent(event.id).length;
    } catch {
        // counts are a hint only
    }
    return {
        started,
        cancelled,
        signups: signups.length,
        recipients: signups.filter((s) => s.status !== "absence").length,
        messages: (event.message && event.message.messageId ? 1 : 0) + (event.setupPost && event.setupPost.messageId ? 1 : 0),
        logs,
        loot,
        // A DM only makes sense for a raid that is still ahead and was not called off already.
        canNotify: !started && !cancelled,
    };
}

/** The DM a raider gets when an event they signed up for is deleted (only on request). */
function deleteDm(event) {
    const start = Number(event.startTime) || 0;
    return `🗑️ **${event.title}**${start ? ` on <t:${start}:F>` : ""} will not take place — the event has been removed.`;
}

/**
 * A series (#289) must never create a deleted date anew: its run mark becomes
 * `deleted` — when the series made this event, or when the category has a
 * series at all (a hand-made event on a series date stands for that date too).
 * A mark that belongs to another event of that day stays as it is.
 */
function markSeriesDeleted(event, actor, now) {
    const categoryId = str(event.categoryId);
    if (!categoryId || !event.startTime) return false;
    const date = isoDay(event.startTime);
    const mark = seriesStore.getRuns(categoryId)[date];
    if (!mark && !seriesStore.getSeries(categoryId)) return false;
    if (mark && mark.eventId && mark.eventId !== event.id) return false;
    seriesStore.setRun(categoryId, date, { status: "deleted", at: now, eventId: event.id, error: "", deletedBy: actor.byName || actor.by });
    return true;
}

/**
 * Delete an own event for good: the event, its signups, its reminder marks, the
 * signup and setup messages in Discord (best-effort), a series date stays taken.
 * A raid that already started needs `confirmStarted` — its signups are its
 * attendance. Optionally the channel goes into the archive (never deleted) and,
 * for a raid still ahead that was not cancelled, the signed-up raiders get a DM
 * (`notify`, off by default: mostly test or mistaken events are deleted).
 * Linked logs and loot are left alone; they carry the raid's name themselves.
 */
async function deleteEvent({ guildId, eventId, archiveChannel = false, notify = false, confirmStarted = false, user, byName, now = Date.now() }) {
    const found = ownEvent(guildId, eventId, { allowCancelled: true });
    if (found.error) return found;
    const { event } = found;
    const info = deletionInfo(event, now);
    if (info.started && !confirmStarted) {
        return fail(409, "started", `Der Raid hat schon begonnen — mit dem Event gehen ${info.signups} ${info.signups === 1 ? "Anmeldung" : "Anmeldungen"} und die Anwesenheit verloren. Bitte bestätigen.`);
    }
    const archiveId = archiveChannel ? archiveCategoryOf(event.guildId || guildId) : "";
    if (archiveChannel && !archiveId) return fail(400, "no_archive", "Für diesen Server ist keine Archiv-Kategorie festgelegt (Kanäle → Archiv).");

    const actor = actorOf(user, byName);
    const recipients = recipientsOf(event.id).map((s) => s.userId);

    // The stores first: a sync that runs meanwhile finds no event and posts nothing.
    eventStore.deleteEvent(event.id);
    signupStore.deleteEventSignups(event.id);
    reminderStore.clearEvent(event.id);
    raidplanStore.deletePlan(event.id);
    const seriesMarked = markSeriesDeleted(event, actor, now);

    const warnings = [];
    // The Discord event goes with it (#305) — the store no longer knows the
    // event, so the record is only read, never written back.
    const discordEventWarning = discordEvent.warningOf(await discordEvent.deleteForEvent(event, { store: false }).catch((e) => ({ warning: (e && e.message) || "Fehler" })));
    if (discordEventWarning) warnings.push(discordEventWarning);
    let messagesDeleted = 0;
    for (const [label, where] of [["Anmelde-Nachricht", event.message], ["Setup-Nachricht", event.setupPost]]) {
        if (!where || !where.messageId) continue;
        try {
            if (await deleteMessage(where)) messagesDeleted += 1;
        } catch (e) {
            warnings.push(`${label} nicht gelöscht: ${discordChannels.discordErrorText(e)}`);
        }
    }

    let dm = { sent: [], failed: [] };
    if (notify && info.canNotify && recipients.length) {
        try {
            dm = await sendDms(recipients, { content: deleteDm(event) });
        } catch (e) {
            dm = { sent: [], failed: recipients, error: (e && e.message) || "Bot nicht verbunden." };
        }
        if (dm.failed.length) warnings.push(`${dm.failed.length} ${dm.failed.length === 1 ? "DM kam" : "DMs kamen"} nicht an (DMs geschlossen?)`);
    }

    let archived = false;
    if (archiveId && event.channelId) {
        try {
            const moved = await discordChannels.archiveChannel(event.channelId, archiveId);
            archiveStore.recordArchived({ ...moved, guildId: moved.guildId || event.guildId, channelId: moved.id, by: actor.by, byName: actor.byName, at: now });
            archived = true;
        } catch (e) {
            warnings.push(`Kanal nicht archiviert: ${discordChannels.discordErrorText(e)}`);
        }
    }
    scheduleOverviewSync();

    // The event's own log went with it — the console keeps who deleted what.
    console.log(`[eventManage] Event ${event.id} „${event.title}“ (${whenLabel(event.startTime)}) gelöscht von ${actor.byName || "?"} (${actor.by || "?"}) · ${[
        `${info.signups} Anmeldungen`,
        messagesDeleted ? `${messagesDeleted} Nachrichten` : "",
        dm.sent.length ? `${dm.sent.length} DMs` : "",
        archived ? "Kanal archiviert" : "",
        seriesMarked ? "Serientermin gesperrt" : "",
    ].filter(Boolean).join(" · ")}`);

    const parts = [`„${event.title}“ gelöscht`];
    if (info.signups) parts.push(`${info.signups} ${info.signups === 1 ? "Anmeldung" : "Anmeldungen"} entfernt`);
    if (dm.sent.length) parts.push(`${dm.sent.length} per DM informiert`);
    if (archived) parts.push("Kanal im Archiv");
    return {
        status: 200,
        body: {
            message: `${parts.join(" · ")}.`,
            deleted: { eventId: event.id, signups: info.signups, messages: messagesDeleted },
            dm: { sent: dm.sent.length, failed: dm.failed.length },
            archived,
            seriesMarked,
            warnings,
        },
    };
}

/** An event's log for display, newest first. */
function logView(event) {
    return [...(event.log || [])].reverse().map((e) => ({ ...e, label: ACTION_LABELS[e.action] || e.action }));
}

/**
 * What the manage menu shows about an event: state, counts, who would be told,
 * whether an archive exists, the setup state and the log.
 */
async function manageInfo({ guildId, eventId, now = Date.now() }) {
    const found = ownEvent(guildId, eventId, { allowCancelled: true });
    if (found.error) return found;
    const { event } = found;
    const signups = signupStore.listSignups(event.id);
    const names = await namesOf(event.guildId || guildId, signups.map((s) => s.userId));
    const counts = signupService.roleCounts(event, signups);
    const archiveId = archiveCategoryOf(event.guildId || guildId);
    const win = signupService.signupWindow(event, now);
    return {
        status: 200,
        body: {
            event: {
                id: event.id, title: event.title, startTime: event.startTime, when: whenLabel(event.startTime),
                signupDeadline: event.signupDeadline, status: event.status, signupsClosed: event.signupsClosed,
                cancel: event.cancel, channelId: event.channelId, channelName: channelNameOf(event), categoryId: event.categoryId,
            },
            started: win.started,
            counts: { attending: counts.attending, size: counts.size, tentative: counts.tentative, bench: counts.bench, absence: counts.absence },
            recipients: signups.filter((s) => s.status !== "absence").map((s) => ({
                userId: s.userId, name: names[s.userId] || "", character: s.character, status: s.status,
            })),
            archive: { configured: !!archiveId },
            setup: setupSummary(event),
            log: logView(event),
            deletion: deletionInfo(event, now),
        },
    };
}

/**
 * Who the "Raider eintragen" dialog offers: every raider with a profile, the
 * holders of the category's raider roles (best-effort) and whoever is signed
 * up — each with their profile characters — plus the rule set's classes, so a
 * character that is not in any profile yet can be typed in.
 */
async function raiderCandidates({ guildId, eventId }) {
    const found = ownEvent(guildId, eventId, { allowCancelled: true });
    if (found.error) return found;
    const { event } = found;
    const rules = rulesFor(event.versionId) || rulesFor(DEFAULT_VERSION);
    const specOf = (key) => {
        const info = profiles.specInfo(key);
        return info ? { key: info.key, label: info.label, role: info.role, icon: info.icon || "" } : null;
    };
    const byId = new Map();
    const add = (userId, name) => {
        const id = str(userId);
        if (!isSnowflake(id)) return null;
        const row = byId.get(id) || { userId: id, name: "", characters: [], signup: null };
        if (name && !row.name) row.name = name;
        byId.set(id, row);
        return row;
    };
    for (const p of profiles.listProfiles()) {
        const row = add(p.userId, p.name);
        if (!row) continue;
        row.characters = p.characters.map((c) => ({
            key: c.key, name: c.name, className: c.className, main: c.main, specs: c.specs.map((s) => specOf(s.key)).filter(Boolean),
        }));
    }
    const roleIds = (getConfig().categoryRoles || {})[event.categoryId] || [];
    if (roleIds.length) {
        try {
            const { members = [] } = (await discord.listMembersWithRoles(event.guildId || guildId, roleIds)) || {};
            for (const m of members) add(m.id, m.displayName || m.username || "");
        } catch {
            // the member list is a convenience; profiles and signups still come
        }
    }
    const signups = signupStore.listSignups(event.id);
    for (const s of signups) {
        const row = add(s.userId, "");
        if (row) row.signup = { character: s.character, spec: s.spec, status: s.status };
    }
    const missingNames = [...byId.values()].filter((r) => !r.name).map((r) => r.userId);
    if (missingNames.length) {
        const names = await namesOf(event.guildId || guildId, missingNames);
        for (const id of missingNames) byId.get(id).name = names[id] || "";
    }
    const raiders = [...byId.values()].sort((a, b) => (a.name || a.userId).localeCompare(b.name || b.userId, "de"));
    return {
        status: 200,
        body: {
            raiders,
            classes: rules.classes.map((c) => ({
                id: c.id, label: c.label, color: c.color, icon: c.icon,
                specs: c.specs.map((s) => ({ key: s.key, label: s.label, role: s.role, icon: s.icon || "" })),
            })),
        },
    };
}

/** Where the setup editor of an event opens in the web. */
function setupPath(eventId) {
    return `/raids/detail?event=${encodeURIComponent(eventId)}&tab=setup`;
}

module.exports = {
    STATUS_LABELS, whenLabel, ownEvent, movePlan, moveEvent, setSignupsOpen, addRaider, removeRaider, cancelEvent, reopenEvent, deleteEvent,
    deletionInfo, manageInfo, raiderCandidates, logView, setupPath,
};
