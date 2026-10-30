// /event anlegen (#260): creating an event from Discord in two steps.
//
//   1. an ephemeral message with selects — category, raid template, channel
//      mode (new by schema / duplicate an event's channel / existing channel)
//      and, as toggle buttons, where the signup runs (proposed by the category)
//      and whether the raiders are pinged on create (#306, likewise proposed);
//   2. "Weiter" opens a modal — title, date, time, "Größe/T/H/Dauer", description.
//      A modal takes five fields and no more, which is why the duration (#305)
//      shares the composition field instead of getting one of its own.
//
// The work itself is eventCreate.js' createEvent(), the same as the web dialog's;
// this module only turns the Discord state into its body and the answer back
// into a message.
//
// Nothing is remembered between the steps: every selection travels in the
// customId of the next component ("event-new:<field>:<state>",
// "event-form:<state>[:<token>]", ≤ 100 characters), and because a customId
// comes back from the client, every step reads it again as untrusted — the
// category, template and channel are checked against what exists *now*. Access
// is checked by the router (bot.js) on every click, through `accessOf`.
//
// The one exception is what was typed into the modal: a description does not
// fit into a customId, so a failed submit keeps the values in memory under a
// short token for "Nochmal" (half an hour; after a restart the modal simply
// opens with the template's values again).

const crypto = require("crypto");
const { DateTime } = require("luxon");
const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const discord = require("../discord/discord");
const linkCheck = require("../discord/linkCheck");
const channelNaming = require("../discord/channelNaming");
const { namingLine } = channelNaming;
const { getConfig, listRaidTemplates, getRaidTemplate } = require("../../stores/settingsStore");
const { announceSetting } = require("./eventAnnounce");
const { signupSourceFor } = require("./eventSources");
const { loadEventGroups, eventLookbackSince } = require("./raidEventGroups");
const { serverIds } = require("../discord/guildRoles");
const { createEvent } = require("./eventCreate");
const { templateVersionProblem } = require("../categories/categoryEras");
const icon = require("./eventIcon");
const { firstEmojiOf } = require("../../utils/leadEmoji");
const archiveStore = require("../../stores/channelArchiveStore");
const { MIN_DURATION, MAX_DURATION } = require("../../stores/eventStore");
const { instanceById } = require("../../config/gameVersions");
const { WEEKDAYS, renderChannelName, unknownPlaceholders, PATTERN_KEYS } = require("../../utils/channelNames");
const { parseGermanDate, parseClockTime } = require("../../utils/time");
const { webUrl, clip } = require("../../utils/discord/botLookup");
const { isSnowflake } = require("../../utils/ids");

const STEP_PREFIX = "event-new";
const FORM_PREFIX = "event-form";
/** "Kanal umbenennen …" under the confirmation: event-rename:<channelId> (eventChannelRename.js). */
const RENAME_PREFIX = "event-rename";
const CUSTOM_ID_MAX = 100;
const MAX_OPTIONS = 25;
const NAME_FIELD = "name";
const { TIMEZONE } = require("../../config/timezone");

const MODES = ["n", "d", "e"]; // new by schema · duplicate · existing channel
const MODE_LABELS = { n: "Neu nach Schema", d: "Kanal eines Events duplizieren", e: "Bestehender Kanal" };
const SOURCES = { e: "eventhelper", r: "raidhelper" };
const SOURCE_LABELS = { e: "EventHelper", r: "Raid-Helper" };

// Template ids are 12 hex characters or "rh-<id>"; a longer one is not offered,
// so the state always fits a customId.
const TEMPLATE_ID = /^[A-Za-z0-9_-]{1,24}$/;
const REF_ID = /^[A-Za-z0-9_-]{1,24}$/;

const COLOR = 0x38bdf8;
const COLOR_OK = 0x57a55a;
const COLOR_ERR = 0xe5534b;

// ---- the state in the customId ----

/** A state read from anywhere, with every part checked. */
function cleanState(raw = {}) {
    const s = String;
    return {
        cat: isSnowflake(s(raw.cat || "")) ? s(raw.cat) : "",
        tpl: TEMPLATE_ID.test(s(raw.tpl || "")) ? s(raw.tpl) : "",
        mode: MODES.includes(raw.mode) ? raw.mode : "n",
        src: SOURCES[raw.src] ? raw.src : "",
        ref: REF_ID.test(s(raw.ref || "")) ? s(raw.ref) : "",
        // "Beim Anlegen ankündigen" (#306): "" = as the category has it, "1"/"0" = decided here.
        ann: raw.ann === "1" || raw.ann === "0" ? raw.ann : "",
        // "Kanal-Icon" (eventIcon.js): a short code, resolved again against the current options on every use.
        ico: icon.cleanIcon(raw.ico),
    };
}

function encodeState(state) {
    const c = cleanState(state);
    return [c.cat, c.tpl, c.mode, c.src, c.ref, c.ann, c.ico].join(":");
}

function stepId(field, state) {
    return `${STEP_PREFIX}:${field}:${encodeState(state)}`;
}

function formId(state, token = "") {
    return `${FORM_PREFIX}:${encodeState(state)}${token ? `:${token}` : ""}`;
}

/** `{ prefix, field, state, token }` from a customId of either prefix. */
function parseCustomId(customId) {
    const parts = String(customId || "").split(":");
    const prefix = parts[0];
    if (prefix === STEP_PREFIX) {
        const [, field = "", cat, tpl, mode, src, ref, ann, ico] = parts;
        return { prefix, field, state: cleanState({ cat, tpl, mode, src, ref, ann, ico }), token: "" };
    }
    const [, cat, tpl, mode, src, ref, ann, ico, token = ""] = parts;
    return { prefix, field: "", state: cleanState({ cat, tpl, mode, src, ref, ann, ico }), token: /^[a-f0-9]{8}$/.test(token) ? token : "" };
}

// ---- the channel name typed by hand ("Kanalname anpassen …") ----
//
// The pattern the orga typed ("🏔️👑》hyjal-bt-{dd}-{mon}") is kept per user, not in the
// customId: the worst-case state already uses all 100 characters, so a token would not fit.
// It belongs to one combination of category, template, channel mode and duplicated event
// (`slotKey`): choosing another one drops it, like the icon pick. The slot also keeps the
// pattern step 1 *derived* last — the modal opens from it without any slow call, because
// a modal has to be the direct answer to the click.

const NAME_PATTERN_MAX = 150;
const nameSlots = new Map();
const slotKey = (state) => [state.cat, state.tpl, state.mode, state.ref].join("|");

/** The user's slot for this state (a changed state or an expired slot starts over); `derived` updates the derived pattern. */
function touchNameSlot(userId, state, { derived, now = Date.now() } = {}) {
    const id = String(userId || "");
    for (const [k, slot] of nameSlots) if (now - slot.at > DRAFT_TTL) nameSlots.delete(k);
    const key = slotKey(state);
    const old = nameSlots.get(id);
    const same = !!old && old.key === key;
    const slot = { key, derived: derived !== undefined ? derived : same ? old.derived : "", custom: same ? old.custom : "", at: now };
    nameSlots.delete(id);
    while (nameSlots.size >= DRAFT_MAX) nameSlots.delete(nameSlots.keys().next().value);
    nameSlots.set(id, slot);
    return slot;
}

/** The pattern typed for this state, "" without one (or in the mode of an existing channel). */
function getNamePattern(userId, state, now = Date.now()) {
    const slot = nameSlots.get(String(userId || ""));
    if (!slot || state.mode === "e" || slot.key !== slotKey(state) || now - slot.at > DRAFT_TTL) return "";
    return slot.custom;
}

/** Forgets the user's typed name and derived pattern (a flow starting, finishing or cancelled). */
function clearNamePattern(userId) {
    nameSlots.delete(String(userId || ""));
}

/** What the modal starts with: the typed pattern, else the derived one. */
function namePrefill(userId, state, now = Date.now()) {
    const slot = nameSlots.get(String(userId || ""));
    if (!slot || slot.key !== slotKey(state) || now - slot.at > DRAFT_TTL) return "";
    return slot.custom || slot.derived;
}

/** The modal of "Kanalname anpassen …": one field, the same customId as the button (event-new:n:<state>). */
function nameModal(state, prefill = "") {
    const field = new TextInputBuilder()
        .setCustomId(NAME_FIELD)
        .setLabel("Kanalname ({dd} {mm} {mon} {tag} {raid})")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(NAME_PATTERN_MAX)
        .setPlaceholder(clip("Leer = automatisch · {dd} Tag, {mm} Monat, {mon} sep, {tag} mi, {raid} ssc-tk", 100));
    if (prefill) field.setValue(String(prefill).slice(0, NAME_PATTERN_MAX));
    return new ModalBuilder()
        .setCustomId(stepId("n", state))
        .setTitle("Kanalname anpassen")
        .addComponents(new ActionRowBuilder().addComponents(field));
}

/**
 * The submit of that modal: keeps the pattern for this user and state, or forgets it
 * (empty field = back to the derived name). Returns `{ error }` for a pattern that
 * cannot become a channel name; the earlier pattern stays then.
 */
function submitNamePattern(userId, state, typed, now = Date.now()) {
    const text = String(typed || "").trim();
    if (!text) {
        touchNameSlot(userId, state, { now }).custom = "";
        return { cleared: true };
    }
    if (text.length > NAME_PATTERN_MAX) return { error: `Das Muster ist zu lang (höchstens ${NAME_PATTERN_MAX} Zeichen).` };
    const unknown = unknownPlaceholders(text);
    if (unknown.length) {
        const known = PATTERN_KEYS.map((k) => `{${k}}`).join(" ");
        return { error: `Unbekannter Platzhalter ${unknown.map((k) => `{${k}}`).join(", ")}. Möglich: ${known}.` };
    }
    if (!renderChannelName(text, { date: "2026-10-14", raid: "ssc-tk" })) return { error: "Daraus ergibt sich kein gültiger Kanalname." };
    touchNameSlot(userId, state, { now }).custom = text;
    return { pattern: text };
}

// ---- what there is to choose from ----

/** The server this flow may create events on, or an error line. */
function guildFor(interaction) {
    const here = String((interaction.guild && interaction.guild.id) || interaction.guildId || "");
    if (!here) return { error: "Events legst du auf einem Raid-Server an, nicht per Direktnachricht." };
    // every server of the list may hold raids (#890, #897)
    const ids = serverIds();
    if (ids.length && !ids.includes(here)) return { error: "Events legst du auf einem Raid-Server an." };
    return { guildId: here };
}

/** The event categories of the server (Einstellungen → Kategorien), else all of them. */
function eventCategories(guildId) {
    const all = discord.listCategories(guildId) || [];
    const ids = (getConfig().categoryIds || []).map(String);
    const list = ids.length ? all.filter((c) => ids.includes(c.id)) : all;
    return list.filter((c) => isSnowflake(c.id)).slice(0, MAX_OPTIONS);
}

/**
 * Templates that make sense for a source (a size for EventHelper, a Raid-Helper link for Raid-Helper)
 * and for the category: only those of the game version it plays — the rule createEvent enforces
 * (categoryEras.templateVersionProblem), so nothing is offered that would be refused with
 * 409 template_version_mismatch.
 */
function templatesFor(src, cat = "") {
    const config = getConfig();
    return listRaidTemplates()
        .filter((t) => TEMPLATE_ID.test(t.id))
        .filter((t) => !templateVersionProblem({ template: t, categoryId: cat, config }))
        .filter((t) => (src === "r" ? !!t.raidhelperTemplateId : !!(t.size || (t.instanceIds || []).length)))
        .slice(0, MAX_OPTIONS);
}

/** The template chosen, else the category's default, else the first that fits the source. */
function fitTemplate(state) {
    const templates = templatesFor(state.src, state.cat);
    if (templates.some((t) => t.id === state.tpl)) return state;
    const preferred = (getConfig().categoryRaidTemplate || {})[state.cat];
    const pick = templates.find((t) => t.id === preferred) || templates[0];
    return { ...state, tpl: pick ? pick.id : "" };
}

/** A category chosen: its source and default template are proposed again. */
function withCategory(state, cat) {
    const src = signupSourceFor(cat) === "eventhelper" ? "e" : "r";
    return fitTemplate({ ...state, cat, src, tpl: "", ref: "", ico: "" });
}

/** Where /event anlegen starts: the category of the channel it was typed in, if it is one. */
function initialState(guildId, parentId = "") {
    const categories = eventCategories(guildId);
    const cat = (categories.find((c) => c.id === parentId) || categories[0] || {}).id || "";
    return withCategory(cleanState({ mode: "n" }), cat);
}

/** The instance shorts of a template ("SSC + TK"), "" without instances. */
function instancesLabel(template) {
    return ((template && template.instanceIds) || [])
        .map((id) => (instanceById(id) || {}).short || id.toUpperCase())
        .join(" + ");
}

/** "SSC + TK · 25er · 3 T / 6 H / 16 DPS". */
function templateSummary(template) {
    if (!template) return "";
    const head = instancesLabel(template) || template.name;
    if (!template.size) return `${head} · Größe fehlt`;
    const comp = template.composition || {};
    const tank = comp.tank || 0;
    const healer = comp.healer || 0;
    const duration = template.durationMinutes ? ` · ${template.durationMinutes} Min.` : "";
    return `${head} · ${template.size}er · ${tank} T / ${healer} H / ${Math.max(0, template.size - tank - healer)} DPS${duration}`;
}

/**
 * How the new channel is named and what it copies (#285, channelNaming.js):
 * like the category's previous event channel, or — duplicating — like the
 * chosen event's channel. `date` "2026-09-24", empty in step 1.
 */
function channelNamingFor(guildId, state, template, date = "") {
    return channelNaming.deriveChannelName({
        guildId, categoryId: state.cat, date,
        instanceIds: (template && template.instanceIds) || [],
        fromEventId: state.mode === "d" ? state.ref : "",
    });
}

/** The options of the "Kanal-Icon" select for a naming result; the emojis of the category's channels come from the live list. */
function iconsFor(guildId, state, template, naming) {
    let channels;
    try {
        channels = discord.listAllChannels(guildId) || [];
    } catch {
        channels = [];
    }
    return icon.iconOptions({
        derivedName: (naming && naming.name) || "",
        raidLabel: instancesLabel(template),
        instanceIds: (template && template.instanceIds) || [],
        categoryNames: channels.filter((c) => String(c.parentId || "") === state.cat).map((c) => String(c.name || "")),
    });
}

/** Events of a category whose channel can be duplicated, newest first. */
async function duplicateCandidates(guildId, cat) {
    const { groups } = await loadEventGroups(guildId, { sinceSeconds: eventLookbackSince() });
    return (groups || [])
        .filter((g) => g.categoryId === cat)
        .flatMap((g) => g.events || [])
        .filter((ev) => ev.channelId && REF_ID.test(String(ev.id || "")))
        .sort((a, b) => (b.startTime || 0) - (a.startTime || 0))
        .slice(0, MAX_OPTIONS);
}

const dayLabel = (seconds) => {
    if (!seconds) return "";
    const dt = DateTime.fromSeconds(Number(seconds), { zone: TIMEZONE });
    const wd = WEEKDAYS[dt.weekday % 7];
    return `${wd.charAt(0).toUpperCase()}${wd.slice(1)} ${dt.toFormat("dd.MM.")}`;
};

/**
 * Whether this event pings the raiders on create, and where (#306): the
 * category's switch unless the toggle button decided otherwise.
 */
function announceFor(state) {
    const want = state.ann === "1" ? true : (state.ann === "0" ? false : undefined);
    return announceSetting(state.cat, { want });
}

/** "Raider-Rolle pingen (Event-Kanal)" / "aus". */
function announceLine(announce) {
    if (!announce.enabled) return "aus";
    // always the raid's own channel (#894)
    return "Raider-Rolle pingen (Event-Kanal)";
}

// ---- step 1: the message with the selects ----

const row = (...components) => ({ type: 1, components });
const button = (customId, label, style = 2, disabled = false) => ({ type: 2, custom_id: customId, label, style, disabled });
const option = (label, value, selected, description) => ({
    label: clip(label, 100), value, default: !!selected, ...(description ? { description: clip(description, 100) } : {}),
});

/**
 * The step-1 message for a state. Async because duplicating lists the
 * category's events. Returns `{ state, payload }` — the state as it was shown
 * (a missing template or event is filled in), so the buttons carry that one.
 * With `userId` the channel name typed by that user shows up, and the pattern step 1
 * derives is kept for the "Kanalname anpassen …" modal.
 */
async function stepMessage(guildId, rawState, { userId = "" } = {}) {
    let state = cleanState(rawState);
    const categories = eventCategories(guildId);
    const cancel = button(stepId("x", state), "Abbrechen");
    if (!categories.length) {
        return {
            state,
            payload: {
                embeds: [{ title: "Neues Event", description: "Keine Event-Kategorie gefunden — im Menü unter Einstellungen → Kategorien festlegen.", color: COLOR_ERR }],
                components: [row(cancel)],
            },
        };
    }
    if (!categories.some((c) => c.id === state.cat)) state = withCategory(state, categories[0].id);
    if (!state.src) state = fitTemplate({ ...state, src: signupSourceFor(state.cat) === "eventhelper" ? "e" : "r" });
    state = fitTemplate(state);

    const category = categories.find((c) => c.id === state.cat);
    const templates = templatesFor(state.src, state.cat);
    const template = templates.find((t) => t.id === state.tpl) || null;

    let candidates = [];
    if (state.mode === "d") {
        candidates = await duplicateCandidates(guildId, state.cat);
        if (!candidates.some((ev) => ev.id === state.ref)) state = { ...state, ref: candidates[0] ? candidates[0].id : "" };
    }

    let channelLine;
    let icons = null; // the "Kanal-Icon" options, only where a channel is created
    let naming = null;
    if (state.mode === "n") {
        naming = await channelNamingFor(guildId, state, template);
        channelLine = naming.step;
    } else if (state.mode === "d") {
        const source = candidates.find((ev) => ev.id === state.ref);
        if (source) naming = await channelNamingFor(guildId, state, template);
        channelLine = source
            ? `Kanal von **${clip(source.title, 60)}** duplizieren · Name ${naming.step.replace(/^neu /, "")}`
            : "kein Event in dieser Kategorie zum Duplizieren";
    } else channelLine = state.ref ? `<#${state.ref}>` : "Kanal unten wählen";
    if (naming) icons = iconsFor(guildId, state, template, naming);
    const iconChoice = icons ? icon.resolveIcon(icons.options, state.ico) : null;
    if (iconChoice && iconChoice.code !== state.ico) state = { ...state, ico: iconChoice.code };

    // The name typed by hand wins over the derived one and over the icon pick (see buildBody):
    // with it the icon select and button are gone, the line says so.
    let custom = "";
    if (naming && userId) {
        const slot = touchNameSlot(userId, state, {
            derived: icon.applyIcon(naming.patternText || naming.name, iconChoice.code, icons, { raw: true }),
        });
        custom = slot.custom;
        if (custom) {
            const shown = `Name \`${clip(custom, 70)}\` · von Hand angepasst`;
            channelLine = state.mode === "d" ? channelLine.replace(/ · Name .*$/, ` · ${shown}`) : `neu · ${shown}`;
        }
    }

    const announce = announceFor(state);
    const templateLine = template
        ? templateSummary(template)
        : (state.src === "r" ? "keine mit Raid-Helper-Vorlage verknüpft — im Menü unter Raid-Vorlagen" : "keine — Instanz aus dem Titel");

    const lines = [
        `**Kategorie:** ${clip(category.name, 80)}`,
        `**Vorlage:** ${templateLine}`,
        `**Kanal:** ${channelLine}`,
        `**Anmeldung über:** ${SOURCE_LABELS[state.src]}`,
    ];
    if (custom) lines.push("**Kanal-Icon:** steckt im Namen von Hand");
    else if (iconChoice) {
        // The previous channel's name with the pick applied: what the icon does to the name, the date is filled in later.
        const preview = icon.applyIcon(naming.fromChannel || naming.name, iconChoice.code, icons);
        lines.push(`**Kanal-Icon:** ${[iconChoice.emoji, iconChoice.label].filter(Boolean).join(" ")}${preview ? ` · \`${clip(preview, 60)}\`` : ""}`);
    }
    if (state.src === "e") lines.push(`**Ankündigung:** ${announceLine(announce)}`);

    const components = [
        row({
            type: 3, custom_id: stepId("c", state), placeholder: "Kategorie",
            options: categories.map((c) => option(c.name, c.id, c.id === state.cat)),
        }),
    ];
    if (templates.length) {
        components.push(row({
            type: 3, custom_id: stepId("t", state), placeholder: "Raid-Vorlage",
            options: templates.map((t) => option(t.name || instancesLabel(t) || t.id, t.id, t.id === state.tpl, templateSummary(t))),
        }));
    }
    components.push(row({
        type: 3, custom_id: stepId("k", state), placeholder: "Kanal",
        options: MODES.map((m) => option(MODE_LABELS[m], m, m === state.mode)),
    }));
    // A message holds five rows: with "Kanal-Icon" as a select only while the duplicate mode's
    // event select does not need its row (then a button cycles through the same options).
    if (icons && !custom && state.mode === "n") {
        components.push(row({
            type: 3, custom_id: stepId("i", state), placeholder: "Kanal-Icon",
            options: icons.options.map((o) => {
                // One emoji per option or Discord refuses the message: a lead of several
                // ("🏔️👑") shows its first as the icon and the whole lead as the description.
                const first = firstEmojiOf(o.emoji);
                return {
                    label: clip(o.label, 100), value: o.code || "w", default: o.code === iconChoice.code,
                    ...(first ? { emoji: { name: first } } : {}),
                    ...(first && first !== o.emoji ? { description: clip(o.emoji, 100) } : {}),
                };
            }),
        }));
    }
    if (state.mode === "d" && candidates.length) {
        components.push(row({
            type: 3, custom_id: stepId("r", state), placeholder: "Event, dessen Kanal kopiert wird",
            options: candidates.map((ev) => option(ev.title || ev.id, ev.id, ev.id === state.ref,
                [dayLabel(ev.startTime), ev.channelName ? `#${ev.channelName}` : ""].filter(Boolean).join(" · "))),
        }));
    } else if (state.mode === "e") {
        components.push(row({
            type: 8, custom_id: stepId("r", state), placeholder: "Kanal wählen", channel_types: [0],
            ...(state.ref && isSnowflake(state.ref) ? { default_values: [{ id: state.ref, type: "channel" }] } : {}),
        }));
    }
    const ready = !!state.cat && (state.mode === "n" || !!state.ref) && (state.src === "e" || !!state.tpl);
    const other = state.src === "e" ? "r" : "e";
    const buttons = [
        button(formId(state), "Weiter", 1, !ready),
        button(stepId("s", state), `Anmeldung über ${SOURCE_LABELS[other]}`),
        ...(state.src === "e" ? [button(stepId("a", state), announce.enabled ? "Ankündigung: an" : "Ankündigung: aus")] : []),
        ...(icons && !custom && state.mode === "d" ? [button(
            // the customId already carries the *next* choice; "j" applies nothing but the state
            stepId("j", { ...state, ico: icon.nextIcon(icons.options, state.ico) }),
            `Icon: ${iconChoice.emoji || iconChoice.label}`,
        )] : []),
        ...(naming ? [button(stepId("n", state), custom ? "Kanalname: von Hand …" : "Kanalname anpassen …", custom ? 1 : 2)] : []),
        button(stepId("x", state), "Abbrechen"),
    ];
    // A row holds five buttons. Duplicating with the signup source EventHelper has six: the cancel button goes
    // then — the ephemeral message can be dismissed anyway, and every other button does something the flow needs.
    components.push(row(...(buttons.length > 5 ? buttons.slice(0, 5) : buttons)));

    return {
        state,
        payload: {
            embeds: [{
                title: "Neues Event",
                description: `${lines.join("\n")}\n\nDatum, Uhrzeit und Titel kommen im nächsten Schritt.`,
                footer: { text: "Schritt 1 von 2" },
                color: COLOR,
            }],
            components,
        },
    };
}

/** The state after a select or button of step 1 (`field` from the customId, `value` the picked one). */
function applyStep(state, field, value = "") {
    const v = String(value || "");
    switch (field) {
        case "c": return withCategory(state, isSnowflake(v) ? v : "");
        // the suggestions "Passt zu <Raid>" belong to the template: its icon pick is over
        case "t": return { ...state, tpl: TEMPLATE_ID.test(v) ? v : "", ico: "" };
        case "i": return { ...state, ico: icon.cleanIcon(v) };
        case "k": return { ...state, mode: MODES.includes(v) ? v : "n", ref: "" };
        case "r": return { ...state, ref: REF_ID.test(v) ? v : "" };
        case "s": return fitTemplate({ ...state, src: state.src === "e" ? "r" : "e", ico: "" });
        case "a": return { ...state, ann: announceFor(state).enabled ? "0" : "1" };
        default: return state;
    }
}

// ---- step 2: the modal ----

const FIELDS = ["title", "date", "time", "comp", "description"];

/**
 * "40/4/10/300" → { size, tank, healer, durationMinutes }; null for an empty
 * field, { error } for garbage. The duration (#305) rides in this one field
 * rather than in a sixth: a Discord modal takes five, and every one of the
 * others is needed.
 */
function parseComposition(value) {
    const str = String(value || "").trim();
    if (!str) return null;
    const match = str.match(/^(\d{1,2})\s*(?:[/,; ]\s*(\d{1,2})\s*[/,; ]\s*(\d{1,2})\s*(?:[/,; ]\s*(\d{2,3}))?)?$/);
    if (!match) return { error: `„${clip(str, 20)}“ passt nicht zu Größe/T/H/Dauer (z. B. 25/3/6/240).` };
    const size = Number(match[1]);
    if (size < 1 || size > 40) return { error: "Die Größe muss zwischen 1 und 40 liegen." };
    if (match[2] === undefined) return { size };
    const tank = Number(match[2]);
    const healer = Number(match[3]);
    if (tank + healer > size) return { error: `${tank} Tanks und ${healer} Heiler passen nicht in ${size} Plätze.` };
    if (match[4] === undefined) return { size, tank, healer };
    const durationMinutes = Number(match[4]);
    if (durationMinutes < MIN_DURATION || durationMinutes > MAX_DURATION) {
        return { error: `Die Dauer muss zwischen ${MIN_DURATION} und ${MAX_DURATION} Minuten liegen.` };
    }
    return { size, tank, healer, durationMinutes };
}

/** The start time the category's quick-create remembers ("19:30", Kanäle → Schnell anlegen), "" without one. */
function rememberedTime(guildId, cat) {
    if (!guildId || !cat) return "";
    try {
        return parseClockTime((((archiveStore.getChannelConfig(guildId) || {}).schemas || {})[cat] || {}).time);
    } catch {
        return "";
    }
}

/** The "Größe/T/H/Dauer" a template proposes ("25/3/6/240"), "" without a size. */
function compositionOf(template) {
    if (!template || !template.size) return "";
    const comp = template.composition || {};
    const head = `${template.size}/${comp.tank || 0}/${comp.healer || 0}`;
    return template.durationMinutes ? `${head}/${template.durationMinutes}` : head;
}

/**
 * The modal of step 2, prefilled from the template — or, after a failed
 * submit, with what was typed. The composition field only exists for an
 * EventHelper event: Raid-Helper has no place to keep it.
 */
function formModal(state, { values = null, guildId = "" } = {}) {
    const template = state.tpl ? getRaidTemplate(state.tpl) : null;
    const label = instancesLabel(template) || (template && template.name) || "Event";
    const v = values || {};
    const input = (id, lab, style, { value, placeholder, required = true, max } = {}) => {
        const field = new TextInputBuilder().setCustomId(id).setLabel(lab).setStyle(style).setRequired(required);
        if (max) field.setMaxLength(max);
        if (placeholder) field.setPlaceholder(placeholder);
        if (value) field.setValue(String(value).slice(0, max || 4000));
        return new ActionRowBuilder().addComponents(field);
    };
    const rows = [
        input("title", "Titel", TextInputStyle.Short, { value: v.title !== undefined ? v.title : label === "Event" ? "" : label, max: 100 }),
        input("date", "Datum", TextInputStyle.Short, { value: v.date, placeholder: "24.09.2026 oder 24.09.", max: 10 }),
        input("time", "Uhrzeit", TextInputStyle.Short, { value: v.time !== undefined ? v.time : rememberedTime(guildId, state.cat), placeholder: "19:30", max: 5 }),
    ];
    if (state.src !== "r") {
        rows.push(input("comp", "Größe/T/H/Dauer (Dauer optional, Min.)", TextInputStyle.Short, {
            value: v.comp !== undefined ? v.comp : compositionOf(template), placeholder: "25/3/6 oder 25/3/6/240", required: false, max: 12,
        }));
    }
    rows.push(input("description", "Beschreibung", TextInputStyle.Paragraph, { value: v.description, required: false, max: 1000 }));
    return new ModalBuilder()
        .setCustomId(formId(state))
        .setTitle(clip(`${label} anlegen`, 45))
        .addComponents(...rows);
}

/** What was typed into the modal. */
function readForm(interaction) {
    const out = {};
    for (const id of FIELDS) {
        let value;
        try {
            value = interaction.fields.getTextInputValue(id);
        } catch {
            value = ""; // the field is not in this modal (Raid-Helper has no composition)
        }
        out[id] = String(value || "").trim();
    }
    return out;
}

// ---- values kept for "Nochmal" ----

const DRAFT_TTL = 30 * 60 * 1000;
const DRAFT_MAX = 200;
const drafts = new Map();

function saveDraft(userId, values, now = Date.now()) {
    for (const [token, d] of drafts) if (now - d.at > DRAFT_TTL) drafts.delete(token);
    while (drafts.size >= DRAFT_MAX) drafts.delete(drafts.keys().next().value);
    const token = crypto.randomBytes(4).toString("hex");
    drafts.set(token, { userId: String(userId), values, at: now });
    return token;
}

/** The typed values under a token — only for the user who typed them. */
function getDraft(token, userId, now = Date.now()) {
    const d = drafts.get(String(token || ""));
    if (!d || d.userId !== String(userId) || now - d.at > DRAFT_TTL) return null;
    return d.values;
}

// ---- submit: check again, create, answer ----

/**
 * The createEvent body for a submitted modal, or `{ error }`. Re-reads the
 * step-1 state against what exists now: a category, template or channel that
 * vanished since the message was opened is an error, not a guess.
 */
async function buildBody(guildId, rawState, values, { userId, now = Date.now() } = {}) {
    const state = cleanState(rawState);
    const fail = (error) => ({ error });
    if (!eventCategories(guildId).some((c) => c.id === state.cat)) return fail("Die Kategorie gibt es nicht mehr oder sie ist keine Event-Kategorie.");
    const src = state.src || (signupSourceFor(state.cat) === "eventhelper" ? "e" : "r");
    const template = state.tpl ? getRaidTemplate(state.tpl) : null;
    if (state.tpl && !template) return fail("Die Raid-Vorlage gibt es nicht mehr.");
    if (src === "r" && !(template && template.raidhelperTemplateId)) {
        return fail("Für Raid-Helper braucht es eine Raid-Vorlage mit verknüpfter Raid-Helper-Vorlage.");
    }

    if (!values.title) return fail("Das Event braucht einen Titel.");
    const date = parseGermanDate(values.date, now);
    if (!date) return fail(`„${clip(values.date, 20)}“ ist kein Datum (z. B. 24.09.2026 oder 24.09.).`);
    const time = parseClockTime(values.time);
    if (!time) return fail(`„${clip(values.time, 20)}“ ist keine Uhrzeit (z. B. 19:30).`);
    // Berlin time, the same reading eventCreate.startTimeOf() gives the stored event.
    const start = DateTime.fromISO(`${date}T${time}`, { zone: TIMEZONE });
    if (!start.isValid) return fail("Datum oder Uhrzeit ergeben keinen Zeitpunkt.");
    const startTime = Math.floor(start.toSeconds());
    if (startTime * 1000 <= now) return fail(`${dayLabel(startTime)} ${time} liegt in der Vergangenheit.`);

    const body = {
        title: values.title, date, time, description: values.description || "",
        leaderId: String(userId || ""), raidTemplateId: state.tpl, templateId: (template && template.raidhelperTemplateId) || "",
        signupSource: SOURCES[src],
    };
    // Only a decision made here travels; "" leaves the category's switch alone (#306).
    if (state.ann === "1" || state.ann === "0") body.announce = state.ann === "1";

    if (src === "e") {
        const comp = parseComposition(values.comp);
        if (comp && comp.error) return fail(comp.error);
        if (comp) {
            body.size = comp.size;
            // The field is prefilled with the template's duration; a field
            // without one means "no duration" (#305: optional, null = not set).
            body.durationMinutes = comp.durationMinutes !== undefined ? comp.durationMinutes : null;
            if (comp.tank !== undefined) {
                const tplComp = (template && template.composition) || {};
                body.composition = {
                    tank: comp.tank, healer: comp.healer,
                    melee: (tplComp.melee && tplComp.melee.min) || 0, ranged: (tplComp.ranged && tplComp.ranged.min) || 0,
                };
                // The modal only carries the minimums; the template's maxima (#261) travel along, as
                // the web dialog sends them — capped at the size the field names.
                const max = (range) => (range && Number.isFinite(Number(range.max)) && range.max !== null ? Math.min(Number(range.max), comp.size) : null);
                const compositionMax = { melee: max(tplComp.melee), ranged: max(tplComp.ranged) };
                if (compositionMax.melee !== null || compositionMax.ranged !== null) body.compositionMax = compositionMax;
            }
        }
    }

    const channels = discord.listAllChannels(guildId) || [];
    let naming = null;
    if (state.mode === "e") {
        if (!state.ref || !channels.some((c) => c.id === state.ref)) return fail("Den gewählten Kanal gibt es auf diesem Server nicht (mehr).");
        body.channelId = state.ref;
    } else {
        if (state.mode === "d" && !state.ref) return fail("Kein Event gewählt, dessen Kanal dupliziert wird.");
        naming = await channelNamingFor(guildId, state, template, date);
        // A name typed by hand ("Kanalname anpassen …") is final: filled with this event's date and
        // raid, normalised like Discord does, and the icon pick does not touch it any more.
        const custom = userId ? getNamePattern(userId, state, now) : "";
        let name;
        if (custom) {
            name = renderChannelName(custom, { date, raid: channelNaming.raidTagFor((template && template.instanceIds) || []) });
            if (!name) return fail(`Aus dem Muster \`${clip(custom, 80)}\` ergibt sich kein Kanalname.`);
            naming = { ...naming, name, source: "manual", label: "von Hand angepasst", detail: `Muster ${clip(custom, 80)}` };
        } else {
            if (!naming.name) return fail("Aus dem letzten Kanal und dem Namensschema der Kategorie ergibt sich kein Kanalname.");
            // The icon pick, resolved again against what the category has now.
            name = icon.applyIcon(naming.name, state.ico, iconsFor(guildId, state, template, naming));
            naming = { ...naming, name };
        }
        if (channels.some((c) => String(c.name).toLowerCase() === name)) {
            return fail(`Einen Kanal **${name}** gibt es schon (${namingLine(naming)}).${custom ? " Passe den Namen über „Zurück“ und „Kanalname anpassen …“ an." : ""}`);
        }
        if (state.mode === "d") {
            body.sourceEventId = state.ref;
            body.channelName = name;
        } else {
            body.newChannel = { name, categoryId: state.cat, templateChannelId: naming.templateChannelId };
        }
    }
    return { body, startTime, naming };
}

/** The confirmation with the three links. */
function successMessage(guildId, state, { body, startTime, naming }, result) {
    const event = result.event || {};
    const eventId = String(result.id || event.id || "");
    const channelId = String(event.channelId || result.channelId || body.channelId || "");
    const size = event.size || body.size;
    const how = { n: "angelegt", d: "dupliziert", e: "gewählt" }[state.mode];
    const parts = [`${dayLabel(startTime)} · ${body.time}`];
    if (size) parts.push(`${size}er`);
    if (channelId) parts.push(`Kanal <#${channelId}> ${how}`);
    const lines = [parts.join(" · ")];
    if (naming && naming.name) {
        // Where the name and the design came from, so the logic stays visible (#285).
        const channelName = (result.channelNaming && result.channelNaming.name) || event.channelName || naming.name;
        lines.push(clip(`Name: \`${channelName}\` · ${namingLine(naming)}`, 500));
        if (state.mode === "n") lines.push(clip(naming.design, 200));
    }
    if (result.messageError) lines.push(`⚠️ Die Event-Nachricht wurde nicht gepostet: ${clip(result.messageError, 200)}`);
    if (result.announced) lines.push("📣 Ankündigung gepostet.");
    if (result.announceError) lines.push(`⚠️ Die Ankündigung wurde nicht gepostet: ${clip(result.announceError, 200)}`);

    const links = [];
    // A channel just made is in the cache; one that failed is not linked (#537).
    const channelUrl = channelId ? linkCheck.channelLink(guildId, channelId) : "";
    if (channelUrl) links.push({ type: 2, style: 5, label: "Zum Kanal", url: channelUrl });
    const detail = eventId ? `/raids/detail?event=${encodeURIComponent(eventId)}` : "/raids";
    links.push({ type: 2, style: 5, label: "Im Web bearbeiten", url: webUrl(detail) });
    if (eventId) links.push({ type: 2, style: 5, label: "Ankündigung pingen", url: webUrl(`${detail}&tab=actions`) });
    // A link without PUBLIC_BASE_URL is relative, and Discord refuses the whole message for one.
    const buttons = links.filter((l) => /^https?:\/\//.test(l.url));
    // A channel made here (new or duplicated) can be renamed right away; a chosen one is not ours to rename.
    if (channelUrl && state.mode !== "e") buttons.push(button(`${RENAME_PREFIX}:${channelId}`, "Kanal umbenennen …"));
    return {
        embeds: [{ title: clip(`Event angelegt · ${body.title}`, 256), description: lines.join("\n"), color: COLOR_OK }],
        components: buttons.length ? [row(...buttons)] : [],
    };
}

/** An error with "Nochmal" (reopens the modal with the typed values) and "Zurück" (step 1). */
function errorMessage(state, token, error) {
    return {
        embeds: [{ title: "Nicht angelegt", description: clip(error, 1000), color: COLOR_ERR }],
        components: [row(
            button(formId(state, token), "Nochmal", 1),
            button(stepId("b", state), "Zurück"),
            button(stepId("x", state), "Abbrechen"),
        )],
    };
}

/** Everything after the modal was submitted; returns the payload for the message. */
async function submitForm(guildId, rawState, values, { userId, now = Date.now() } = {}) {
    const state = cleanState(rawState);
    const built = await buildBody(guildId, state, values, { userId, now });
    if (built.error) return { ok: false, payload: errorMessage(state, saveDraft(userId, values, now), built.error) };
    const result = await createEvent({ guildId, user: { id: String(userId || "") }, body: built.body });
    if (result.error) return { ok: false, payload: errorMessage(state, saveDraft(userId, values, now), result.error.message) };
    clearNamePattern(userId);
    return { ok: true, payload: successMessage(guildId, state, built, result.body || {}) };
}

module.exports = {
    STEP_PREFIX, FORM_PREFIX, RENAME_PREFIX, eventCategories, parseCustomId, guildFor, initialState, applyStep, stepMessage, parseComposition, formModal, readForm,
    getDraft, submitForm, nameModal, namePrefill, submitNamePattern, getNamePattern, clearNamePattern, NAME_FIELD,
    // only for the tests (#424): not part of the module's API
    _internal: {
        CUSTOM_ID_MAX, cleanState, stepId, formId, compositionOf, buildBody,
    },
};
