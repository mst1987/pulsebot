// "Event verwalten" (#288): everything the orga does with an EventHelper event
// after it was created — move it, close or open the signup, sign raiders up or
// off, cancel it (and take the cancellation back). One service for the web
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
//
// Discord calls are best-effort after the store changed: a channel that cannot be
// renamed or a DM that does not arrive is reported, never a rolled-back action.
const { DateTime } = require("luxon");
const eventStore = require("./eventStore");
const signupStore = require("./signupStore");
const signupService = require("./signupService");
const profiles = require("./raiderProfileStore");
const reminderStore = require("./reminderStore");
const channelNaming = require("./channelNaming");
const discordChannels = require("./discordChannels");
const archiveStore = require("./channelArchiveStore");
const discord = require("./discord");
const { refreshEventMessage } = require("./eventMessage");
const { scheduleOverviewSync } = require("./talkOverview");
const { deliverUserPing, sendDms } = require("./pingDelivery");
const { getConfig } = require("./settingsStore");
const { setupSummary } = require("./setupEditor");
const { rulesFor, DEFAULT_VERSION } = require("../config/gameVersions");
const { toRaidHelperDate } = require("../utils/date");
const { SIGNUP_STATUSES } = require("../utils/attendance");

const ZONE = "Europe/Berlin";
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const SNOWFLAKE = /^\d{5,25}$/;
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
    cancel: "Abgesagt",
    reopen: "Absage zurückgenommen",
};

const STATUS_LABELS = {
    signed: "Dabei", tentative: "Vielleicht", late: "Spät", bench: "Bank", absence: "Abgemeldet",
};

const fail = (status, code, message) => ({ error: { status, code, message } });
const str = (v) => String(v === null || v === undefined ? "" : v).trim();

/** "Do 24.09. 19:30" in Berlin time. */
function whenLabel(startTime) {
    const n = Number(startTime) || 0;
    if (!n) return "";
    const dt = DateTime.fromSeconds(n, { zone: ZONE });
    return `${WEEKDAYS[dt.weekday - 1]} ${dt.toFormat("dd.MM. HH:mm")}`;
}

/** Unix seconds of a date ("2026-09-24", "24-09-2026") and "19:30" in Berlin time, or 0. */
function startTimeOf(date, time) {
    const d = toRaidHelperDate(date);
    const t = String(time || "").trim();
    if (!d || !/^\d{1,2}:\d{2}$/.test(t)) return 0;
    const dt = DateTime.fromFormat(`${d} ${t}`, "dd-MM-yyyy H:mm", { zone: ZONE });
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
    try {
        await refreshEventMessage(eventId);
        return null;
    } catch (e) {
        return (e && e.message) || "Die Event-Nachricht konnte nicht aktualisiert werden.";
    }
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

const isoDay = (startTime) => DateTime.fromSeconds(Number(startTime), { zone: ZONE }).toISODate();

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

    let notified = 0;
    let notifyError = null;
    const recipients = recipientsOf(plan.eventId).map((s) => s.userId);
    if (notify && recipients.length) {
        const event = eventStore.getEvent(plan.eventId);
        const start = plan.to.startTime;
        try {
            await deliverUserPing({
                target: "event", event, userIds: recipients, guildId,
                text: `📅 **${event.title}** wurde verschoben: jetzt <t:${start}:F> (<t:${start}:R>).`,
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
            warnings: [channelError, messageError, notifyError].filter(Boolean),
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
 */
async function addRaider({ guildId, eventId, userId, character, spec, status = "signed", comment, user, byName }) {
    const found = ownEvent(guildId, eventId);
    if (found.error) return found;
    const uid = str(userId);
    if (!SNOWFLAKE.test(uid)) return fail(400, "bad_request", "Kein Raider gewählt.");
    const name = str(character);
    if (!name) return fail(400, "character", "Bitte einen Charakter angeben.");
    if (!SIGNUP_STATUSES.includes(status)) return fail(400, "status", `Unbekannter Anmeldestatus „${status}“.`);
    const info = profiles.specInfo(spec);
    if (!info) return fail(400, "spec", "Bitte eine Spezialisierung wählen.");

    const profile = profiles.getProfile(uid);
    const existing = signupService.findCharacter(profile, name);
    let profileChanged = false;
    if (!existing || existing.className !== info.classId || !existing.specs.some((s) => s.key === info.key)) {
        if (existing && existing.className !== info.classId) {
            return fail(400, "spec", `${existing.name} ist im Profil ${existing.className} — die Spec passt nicht.`);
        }
        const added = profiles.addCharacter(uid, { name, className: info.classId, specs: [{ key: info.key }], source: "manual" });
        if (added.error) return fail(400, "character", added.error);
        profileChanged = true;
    }
    const result = await signupService.submitSignup(found.event.id, uid, { character: name, spec: info.key, status, comment }, { byOrga: true });
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
        `❌ **${event.title}**${start ? ` am <t:${start}:F>` : ""} wurde abgesagt.`,
        `Grund: ${reason}`,
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
    scheduleOverviewSync();
    log(event.id, "reopen", actorOf(user, byName));
    return {
        status: 200,
        body: {
            message: `Absage zurückgenommen — Anmeldung wieder offen.${wasArchived ? " Der Kanal liegt noch im Archiv (Kanäle)." : ""}`,
            event: eventStore.getEvent(event.id),
            warnings: [messageError].filter(Boolean),
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
        if (!SNOWFLAKE.test(id)) return null;
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
    ACTION_LABELS, STATUS_LABELS, MIN_REASON,
    whenLabel, startTimeOf, ownEvent, recipientsOf, channelPlan, movePlan, moveEvent, setSignupsOpen,
    addRaider, removeRaider, cancelEvent, reopenEvent, manageInfo, raiderCandidates, logView, setupPath, cancelDm,
};
