// "Event verwalten" in Discord (#288): `/event verwalten` and the message
// context menu "Event verwalten" on the event's signup message open one
// ephemeral message with the actions — the same service the web uses
// (eventManage.js), only turned into Discord messages here.
//
//   event-manage:e:<id>             Bearbeiten → modal (Titel, Größe/T/H, Beschreibung)
//   event-manage:v:<id>             Verschieben → modal (Datum, Uhrzeit) → preview
//   event-manage:m:<id>:<start>:<rn> confirm the previewed move (r = rename, n = notify, 1/0)
//   event-manage:s:<id>             Anmeldung schließen / öffnen
//   event-manage:u:<id>             user select → that raider's panel
//   event-manage:a:<id>:<userId>    character · spec select → signs the raider up
//   event-manage:d:<id>:<userId>    Austragen
//   event-manage:p:<id>             Fehlende pingen (event channel)
//   event-manage:x:<id>             Absagen → modal (Grund, Kanal archivieren)
//   event-manage:r:<id>             Absage zurücknehmen
//   event-manage:l:<id>             Löschen → modal ("LÖSCHEN" eintippen, Kanal archivieren, DM)
//   event-manage:b:<id>             back to the overview
//   event-manage-form:<e|v|x|l>:<id> the four modals' submits
//
// Stateless like /event anlegen: everything rides in the customId (≤ 100
// characters; own ids are "eh-" plus 14 characters), every click re-reads the
// event. Access is `/event`'s (accessOf in the command files), checked by the
// router on every click.
const { DateTime } = require("luxon");
const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const manage = require("./eventManage");
const eventStore = require("./eventStore");
const signupStore = require("./signupStore");
const profiles = require("./raiderProfileStore");
const { roleCounts } = require("./signupService");
const { updateEvent } = require("./eventCreate");
const { pingMissingRaiders } = require("./missingPing");
const { setupSummary } = require("./setupEditor");
const { parseComposition } = require("./eventDraft");
const { parseGermanDate, parseClockTime } = require("../utils/date");
const { webUrl, clip } = require("../utils/botLookup");
const { isSnowflake } = require("../utils/ids");

const MANAGE_PREFIX = "event-manage";
const FORM_PREFIX = "event-manage-form";
const { TIMEZONE } = require("../config/timezone");
const EVENT_ID = /^eh-[a-z0-9]{1,40}$/;
const MAX_OPTIONS = 25;

const COLOR = 0x38bdf8;
const COLOR_OK = 0x57a55a;
const COLOR_ERR = 0xe5534b;

const row = (...components) => ({ type: 1, components });
const button = (customId, label, style = 2, disabled = false) => ({ type: 2, custom_id: customId, label, style, disabled });
const link = (label, url) => ({ type: 2, style: 5, label, url });

function manageId(field, eventId, ...rest) {
    return [MANAGE_PREFIX, field, eventId, ...rest].join(":");
}

/** `{ prefix, field, eventId, args }` from a customId of either prefix; eventId "" when it is no own id. */
function parseManageId(customId) {
    const [prefix, field = "", eventId = "", ...args] = String(customId || "").split(":");
    return { prefix, field, eventId: EVENT_ID.test(eventId) ? eventId : "", args };
}

/** Who acts, as the log names them. */
function actorOf(interaction) {
    const user = interaction.user || {};
    const member = interaction.member || {};
    return { user: { id: String(user.id || "") }, byName: member.displayName || user.globalName || user.username || "" };
}

/**
 * The own event a context-menu click or `/event verwalten` means: the one whose
 * message was clicked, else the channel's event (the next one that did not
 * start yet, else the newest).
 */
function findEvent(guildId, { eventId = "", messageId = "", channelId = "" } = {}, now = Date.now()) {
    const events = eventStore.listEvents(guildId);
    if (eventId) return events.find((e) => e.id === eventId) || null;
    if (messageId) {
        const hit = events.find((e) => e.message && e.message.messageId === String(messageId));
        if (hit) return hit;
    }
    if (!channelId) return null;
    const inChannel = events.filter((e) => e.channelId === String(channelId));
    const nowSec = Math.floor(now / 1000);
    const upcoming = inChannel.filter((e) => e.startTime >= nowSec).sort((a, b) => a.startTime - b.startTime);
    return upcoming[0] || inChannel[0] || null;
}

/** The overview line: "22/25 · Anmeldung offen bis Di 22.09. 20:00 · Setup: Entwurf". */
function summaryLine(event) {
    const c = roleCounts(event, signupStore.listSignups(event.id));
    const parts = [c.size ? `${c.attending}/${c.size}` : `${c.attending} angemeldet`];
    if (event.status === "cancelled") parts.push("abgesagt");
    else if (event.signupsClosed) parts.push("Anmeldung geschlossen");
    else parts.push(event.signupDeadline ? `Anmeldung offen bis ${manage.whenLabel(event.signupDeadline)}` : "Anmeldung offen");
    const setup = setupSummary(event);
    parts.push(`Setup: ${!setup ? "keins" : setup.status === "approved" ? "freigegeben" : "Entwurf"}`);
    return parts.join(" · ");
}

/** The ephemeral overview with every action. */
function manageView(event, { notice = "", tone = "" } = {}) {
    const id = event.id;
    const cancelled = event.status === "cancelled";
    const lines = [`${manage.whenLabel(event.startTime)} · ${summaryLine(event)}`];
    if (cancelled && event.cancel && event.cancel.reason) lines.push(`Grund: ${clip(event.cancel.reason, 300)}`);
    const last = manage.logView(event)[0];
    if (last) lines.push(`Zuletzt: ${last.label}${last.byName ? ` von ${last.byName}` : ""} · <t:${Math.floor(last.at / 1000)}:R>`);
    if (notice) lines.push("", clip(notice, 1500));

    const components = [
        row(
            button(manageId("e", id), "Bearbeiten", 2, cancelled),
            button(manageId("v", id), "Verschieben", 2, cancelled),
            button(manageId("s", id), event.signupsClosed ? "Anmeldung öffnen" : "Anmeldung schließen", 2, cancelled),
        ),
        row({ type: 5, custom_id: manageId("u", id), placeholder: "Raider eintragen / austragen …", min_values: 1, max_values: 1, disabled: cancelled }),
    ];
    const setupUrl = webUrl(manage.setupPath(id));
    const last3 = [button(manageId("p", id), "Fehlende pingen", 2, cancelled)];
    if (/^https?:\/\//.test(setupUrl)) last3.push(link("Setup öffnen", setupUrl));
    last3.push(cancelled ? button(manageId("r", id), "Absage zurücknehmen", 1) : button(manageId("x", id), "Absagen", 4));
    last3.push(button(manageId("l", id), "Löschen", 4));
    components.push(row(...last3));
    const color = tone === "ok" ? COLOR_OK : tone === "err" || cancelled ? COLOR_ERR : COLOR;
    return {
        content: "",
        embeds: [{ title: clip(`${cancelled ? "ABGESAGT · " : ""}${event.title} verwalten`, 256), description: lines.join("\n"), color }],
        components,
    };
}

/** One raider's panel: their signup and the characters to sign them up with. */
function raiderView(event, userId) {
    const signup = signupStore.getSignup(event.id, userId);
    const profile = profiles.getProfile(userId) || { characters: [] };
    const chars = profile.characters.filter((c) => c.specs.length);
    const lines = [`<@${userId}>`];
    lines.push(signup
        ? `Eingetragen: **${manage.STATUS_LABELS[signup.status] || signup.status}**${signup.character ? ` · ${signup.character}` : ""}${signup.spec ? ` · ${(profiles.specInfo(signup.spec) || {}).label || signup.spec}` : ""}`
        : "Nicht eingetragen.");
    const components = [];
    if (chars.length) {
        const options = [];
        for (const c of chars) {
            for (const s of c.specs) {
                if (options.length >= MAX_OPTIONS) break;
                const info = profiles.specInfo(s.key) || {};
                options.push({
                    label: clip(`${c.name} · ${info.label || s.key}`, 100),
                    value: clip(`${c.key}|${s.key}`, 100),
                    default: !!signup && signup.character === c.name && signup.spec === s.key,
                });
            }
        }
        components.push(row({ type: 3, custom_id: manageId("a", event.id, userId), placeholder: "Als „Dabei“ eintragen mit …", options }));
        lines.push("Charakter wählen, um als „Dabei“ einzutragen.");
    } else {
        lines.push("Kein Charakter im Profil — im Web eintragen (dort lässt sich ein Charakter anlegen).");
    }
    const buttons = [button(manageId("b", event.id), "Zurück")];
    if (signup) buttons.unshift(button(manageId("d", event.id, userId), "Austragen", 4));
    const rosterUrl = webUrl(`/raids/detail?event=${encodeURIComponent(event.id)}&tab=roster`);
    if (/^https?:\/\//.test(rosterUrl)) buttons.push(link("Im Web eintragen", rosterUrl));
    components.push(row(...buttons));
    return { content: "", embeds: [{ title: clip(`${event.title} · Raider`, 256), description: lines.join("\n"), color: COLOR }], components };
}

/** The preview of a move with its confirm buttons — the logic stays visible (#285 naming). */
function movePreviewView(plan) {
    const ch = plan.channel;
    const lines = [`**${plan.from.label}** → **${plan.to.label}**`];
    if (plan.deadlineLabel) lines.push(`Anmeldeschluss: ${plan.deadlineLabel}`);
    if (ch.rename) lines.push(`Kanal: \`${ch.current}\` → \`${ch.next}\`${ch.label ? ` · ${ch.label}${ch.detail ? ` (${ch.detail})` : ""}` : ""}`);
    else lines.push(`Kanal: \`${ch.current || "—"}\` bleibt · ${ch.reason}`);
    lines.push(plan.recipients ? `Hinweis mit Erwähnung im Event-Kanal an ${plan.recipients} Angemeldete.` : "Niemand angemeldet — kein Hinweis.");
    const id = (rename, notify) => manageId("m", plan.eventId, plan.to.startTime, `${rename ? 1 : 0}${notify ? 1 : 0}`);
    const buttons = [button(id(ch.rename, plan.recipients > 0), "Verschieben", 1)];
    if (ch.rename) buttons.push(button(id(false, plan.recipients > 0), "Ohne Umbenennen"));
    if (plan.recipients) buttons.push(button(id(ch.rename, false), "Ohne Hinweis"));
    buttons.push(button(manageId("b", plan.eventId), "Zurück"));
    return {
        content: "",
        embeds: [{ title: clip(`${plan.title} verschieben?`, 256), description: lines.join("\n"), color: COLOR }],
        components: [row(...buttons)],
    };
}

function textInput(id, label, style, { value = "", placeholder = "", required = true, max } = {}) {
    const field = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required);
    if (max) field.setMaxLength(max);
    if (placeholder) field.setPlaceholder(placeholder);
    if (value) field.setValue(String(value).slice(0, max || 4000));
    return new ActionRowBuilder().addComponents(field);
}

function editModal(event) {
    const comp = event.composition || {};
    return new ModalBuilder()
        .setCustomId(`${FORM_PREFIX}:e:${event.id}`)
        .setTitle(clip(`${event.title} bearbeiten`, 45))
        .addComponents(
            textInput("title", "Titel", TextInputStyle.Short, { value: event.title, max: 100 }),
            textInput("comp", "Größe/T/H", TextInputStyle.Short, { value: event.size ? `${event.size}/${comp.tank || 0}/${comp.healer || 0}` : "", placeholder: "25/3/6", required: false, max: 8 }),
            textInput("description", "Beschreibung", TextInputStyle.Paragraph, { value: event.description, required: false, max: 1000 }),
        );
}

function moveModal(event) {
    const dt = DateTime.fromSeconds(event.startTime, { zone: TIMEZONE });
    return new ModalBuilder()
        .setCustomId(`${FORM_PREFIX}:v:${event.id}`)
        .setTitle(clip(`${event.title} verschieben`, 45))
        .addComponents(
            textInput("date", "Neues Datum", TextInputStyle.Short, { value: dt.toFormat("dd.MM.yyyy"), placeholder: "24.09.2026 oder 24.09.", max: 10 }),
            textInput("time", "Uhrzeit", TextInputStyle.Short, { value: dt.toFormat("HH:mm"), placeholder: "19:30", max: 5 }),
        );
}

function cancelModal(event) {
    return new ModalBuilder()
        .setCustomId(`${FORM_PREFIX}:x:${event.id}`)
        .setTitle(clip(`${event.title} absagen`, 45))
        .addComponents(
            textInput("reason", "Grund (geht per DM an alle Angemeldeten)", TextInputStyle.Paragraph, { placeholder: "Zu wenig Heiler, wir verschieben auf Do.", max: 300 }),
            textInput("archive", "Kanal archivieren? (ja / nein)", TextInputStyle.Short, { value: "nein", required: false, max: 4 }),
        );
}

/** The word the delete modal wants typed. */
const DELETE_WORD = "LÖSCHEN";

/**
 * Löschen: "LÖSCHEN" typed is the confirmation — for a raid that already started
 * too, which the placeholder says. A DM is offered only for a raid still ahead
 * that was not cancelled, default "nein".
 */
function deleteModal(event, now = Date.now()) {
    const info = manage.deletionInfo(event, now);
    const lost = info.started
        ? `${info.signups} Anmeldungen und die Anwesenheit gehen verloren`
        : `${info.signups} Anmeldungen und die Nachricht werden entfernt`;
    const rows = [
        textInput("confirm", `Zum Bestätigen ${DELETE_WORD} eintippen`, TextInputStyle.Short, { placeholder: clip(lost, 100), max: 10 }),
        textInput("archive", "Kanal archivieren? (ja / nein)", TextInputStyle.Short, { value: "nein", required: false, max: 4 }),
    ];
    if (info.canNotify && info.recipients) {
        rows.push(textInput("notify", `DM an ${info.recipients} Angemeldete? (ja / nein)`, TextInputStyle.Short, { value: "nein", required: false, max: 4 }));
    }
    return new ModalBuilder()
        .setCustomId(`${FORM_PREFIX}:l:${event.id}`)
        .setTitle(clip(`${event.title} löschen`, 45))
        .addComponents(...rows);
}

const YES = /^(j|ja|y|yes|1)$/i;

function field(interaction, id) {
    try {
        return String(interaction.fields.getTextInputValue(id) || "").trim();
    } catch {
        return "";
    }
}

/** A service result as the notice under the overview. */
function noticeOf(result) {
    if (result.error) return { notice: `⚠️ ${result.error.message}`, tone: "err" };
    const body = result.body || {};
    const warnings = (body.warnings || []).map((w) => `⚠️ ${w}`);
    return { notice: [body.message, ...warnings].filter(Boolean).join("\n"), tone: warnings.length ? "" : "ok" };
}

/** Overview of the event, re-read, with a notice. */
function overview(eventId, notice = {}) {
    const event = eventStore.getEvent(eventId);
    if (!event) return { content: "Das Event gibt es nicht mehr.", embeds: [], components: [] };
    return manageView(event, notice);
}

/** Answer when a click names no event this server knows. */
const GONE = { content: "Das Event gibt es nicht (mehr) oder es gehört zu einem anderen Server.", embeds: [], components: [] };

/** The event of a click, checked against the server. */
function eventOfClick(guildId, eventId) {
    const found = manage.ownEvent(guildId, eventId, { allowCancelled: true });
    return found.error ? null : found.event;
}

/**
 * A button or select of the overview. Modals are opened directly (never after
 * a defer); everything else defers the update first, since Discord calls can
 * take longer than three seconds.
 */
async function handleComponent(interaction, guildId) {
    const { field: f, eventId, args } = parseManageId(interaction.customId);
    const event = eventOfClick(guildId, eventId);
    if (!event) return interaction.update(GONE);
    const actor = actorOf(interaction);

    if (f === "e") return interaction.showModal(editModal(event));
    if (f === "v") return interaction.showModal(moveModal(event));
    if (f === "x") return interaction.showModal(cancelModal(event));
    if (f === "l") return interaction.showModal(deleteModal(event));

    await interaction.deferUpdate();
    const edit = (payload) => interaction.editReply(payload);
    if (f === "b") return edit(overview(event.id));
    if (f === "s") {
        return edit(overview(event.id, noticeOf(await manage.setSignupsOpen({ guildId, eventId: event.id, open: !!event.signupsClosed, ...actor }))));
    }
    if (f === "u") {
        const userId = String((interaction.values || [])[0] || "");
        if (!isSnowflake(userId)) return edit(overview(event.id, { notice: "⚠️ Kein Raider gewählt.", tone: "err" }));
        return edit(raiderView(event, userId));
    }
    if (f === "a") {
        const userId = isSnowflake(args[0] || "") ? args[0] : "";
        const [charKey = "", specKey = ""] = String((interaction.values || [])[0] || "").split("|");
        const character = (profiles.getProfile(userId) || { characters: [] }).characters.find((c) => c.key === charKey);
        if (!userId || !character) return edit(overview(event.id, { notice: "⚠️ Den Charakter gibt es im Profil nicht mehr.", tone: "err" }));
        const result = await manage.addRaider({ guildId, eventId: event.id, userId, character: character.name, spec: specKey, status: "signed", ...actor });
        return edit(overview(event.id, noticeOf(result)));
    }
    if (f === "d") {
        const result = await manage.removeRaider({ guildId, eventId: event.id, userId: args[0] || "", ...actor });
        return edit(overview(event.id, noticeOf(result)));
    }
    if (f === "p") {
        const result = await pingMissingRaiders({ guildId, eventId: event.id, target: "event" });
        if (!result.error && result.count) eventStore.appendEventLog(event.id, { action: "ping", by: actor.user.id, byName: actor.byName, detail: `${result.count} Raider` });
        return edit(overview(event.id, result.error ? { notice: `⚠️ ${result.error.message}`, tone: "err" } : { notice: result.message, tone: "ok" }));
    }
    if (f === "r") return edit(overview(event.id, noticeOf(await manage.reopenEvent({ guildId, eventId: event.id, ...actor }))));
    if (f === "m") {
        const start = Number(args[0]) || 0;
        const flags = String(args[1] || "11");
        if (!start) return edit(overview(event.id, { notice: "⚠️ Kein Termin.", tone: "err" }));
        const dt = DateTime.fromSeconds(start, { zone: TIMEZONE });
        const result = await manage.moveEvent({
            guildId, eventId: event.id, date: dt.toISODate(), time: dt.toFormat("HH:mm"),
            renameChannel: flags[0] === "1", notify: flags[1] === "1", ...actor,
        });
        return edit(overview(event.id, noticeOf(result)));
    }
    return edit(overview(event.id));
}

/** The submit of one of the three modals. */
async function handleForm(interaction, guildId, now = Date.now()) {
    const { field: f, eventId } = parseManageId(interaction.customId);
    await interaction.deferUpdate();
    const edit = (payload) => interaction.editReply(payload);
    const event = eventOfClick(guildId, eventId);
    if (!event) return edit(GONE);
    const actor = actorOf(interaction);

    if (f === "e") {
        const body = { id: event.id, title: field(interaction, "title"), description: field(interaction, "description") };
        const comp = parseComposition(field(interaction, "comp"));
        if (comp && comp.error) return edit(overview(event.id, { notice: `⚠️ ${comp.error}`, tone: "err" }));
        if (comp) {
            body.size = comp.size;
            if (comp.tank !== undefined) body.composition = { ...event.composition, tank: comp.tank, healer: comp.healer };
        }
        const result = await updateEvent({ guildId, body, ...actor });
        const notice = result.error
            ? { notice: `⚠️ ${result.error.message}`, tone: "err" }
            : { notice: `Gespeichert.${result.body.messageError ? `\n⚠️ ${result.body.messageError}` : ""}`, tone: "ok" };
        return edit(overview(event.id, notice));
    }
    if (f === "v") {
        const date = parseGermanDate(field(interaction, "date"), now);
        const time = parseClockTime(field(interaction, "time"));
        if (!date || !time) return edit(overview(event.id, { notice: "⚠️ Datum (24.09.2026) oder Uhrzeit (19:30) nicht lesbar.", tone: "err" }));
        const planned = await manage.movePlan({ guildId, eventId: event.id, date, time, now });
        if (planned.error) return edit(overview(event.id, { notice: `⚠️ ${planned.error.message}`, tone: "err" }));
        return edit(movePreviewView(planned.plan));
    }
    if (f === "x") {
        const archive = YES.test(field(interaction, "archive"));
        const result = await manage.cancelEvent({ guildId, eventId: event.id, reason: field(interaction, "reason"), archiveChannel: archive, notify: true, ...actor });
        return edit(overview(event.id, noticeOf(result)));
    }
    if (f === "l") {
        if (field(interaction, "confirm").toUpperCase() !== DELETE_WORD) {
            return edit(overview(event.id, { notice: `⚠️ Nicht gelöscht — zum Bestätigen „${DELETE_WORD}“ eintippen.`, tone: "err" }));
        }
        const result = await manage.deleteEvent({
            guildId, eventId: event.id, confirmStarted: true,
            archiveChannel: YES.test(field(interaction, "archive")), notify: YES.test(field(interaction, "notify")), ...actor, now,
        });
        if (result.error) return edit(overview(event.id, { notice: `⚠️ ${result.error.message}`, tone: "err" }));
        const warnings = (result.body.warnings || []).map((w) => `⚠️ ${w}`);
        return edit({
            content: "",
            embeds: [{ title: clip(`${event.title} gelöscht`, 256), description: [result.body.message, ...warnings].join("\n"), color: warnings.length ? COLOR : COLOR_OK }],
            components: [],
        });
    }
    return edit(overview(event.id));
}

/** The first answer of `/event verwalten` and the context menu, or a German refusal line. */
function openPayload(guildId, where, now = Date.now()) {
    const event = findEvent(guildId, where, now);
    if (!event) {
        return { error: where.messageId
            ? "Diese Nachricht gehört zu keinem EventHelper-Event. Rechtsklick auf die Anmelde-Nachricht des Events."
            : "In diesem Kanal gibt es kein EventHelper-Event. Wähle eins bei `event`." };
    }
    return { payload: manageView(event) };
}

module.exports = {
    MANAGE_PREFIX, FORM_PREFIX,
    manageId, parseManageId, findEvent, summaryLine, manageView, raiderView, movePreviewView,
    editModal, moveModal, cancelModal, deleteModal, DELETE_WORD, handleComponent, handleForm, openPayload,
};
