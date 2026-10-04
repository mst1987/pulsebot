// The signup buttons under an EventHelper event message (services/events/eventMessage.js):
// what the member sees after a click — short ephemeral messages, one select at
// a time. The handler is commands/signup/eventButton.js; this file holds the
// customIds, the builders and the pure rules, so both can be tested apart.
//
//   event-pick:<eventId>              the public select (#303, commands/signup/eventPick.js):
//                                     "My characters …" = what `join` does, a class = the spec step
//   event-btn:<eventId>:join          Anmelden: own characters (multi-select, the classes below), or directly
//                                     with only one — the button only sits under messages posted before #303
//   event-btn:<eventId>:class         Klasse wählen: class → spec → name modal (adds to an existing signup; same)
//   event-btn:<eventId>:late|tentative|bench
//                                     signed up: the FIRST character gets that status; otherwise the
//                                     character select (or the class way) with that status;
//                                     "Vielleicht" asks for a message first (below)
//   event-btn:<eventId>:absence       Absagen: a modal with the message
//
// The message of "Absagen" and "Vielleicht" is required, optional or not asked
// for, per the event's category (services/signups/signupNotes.js' noteMode); the service
// posts it to the orga's channel.
//
// Steps (the status rides along as the dialog's code s/t/l/b):
//   event-btn:<eventId>:pick:<code>          own characters · specs, up to MAX_CHARACTERS — saves
//   event-btn:<eventId>:other:<code>         "Other class …" → the class select
//   event-btn:<eventId>:cls:<code>           class select → spec select
//   event-btn:<eventId>:spec:<code>          spec select → name modal
//   event-btn:<eventId>:name:<code>:<spec>   the name modal — adds the character to the profile, saves
//   event-btn:<eventId>:why                  the absence modal — saves
//   event-btn:<eventId>:note:t               the "Vielleicht" modal — saves, or leads to the character
//                                            select (the message waits in memory for that step)
//
// Nothing is kept in memory; every step reads event, profile and signup again
// and every save goes through signupService.submitSignup (deadline, closed,
// cancelled, raider role, profile rules). A customId is a hint, never a permission.
// Every builder takes the reader's language (`lang`, services/discord/botLanguage.js):
// only the member sees these messages.
const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const { migrateSignup, MAX_CHARACTERS } = require("../../services/signups/signupCharacters");
const profiles = require("../../stores/raiderProfileStore");
const { allowedStatuses, signupWindow } = require("../../services/signups/signupService");
const { emojiOption, emojiText, specEmojiName, classEmojiName, uiEmojiName, statusEmojiName } = require("../../services/discord/appEmojis");
const { BUTTON_PREFIX } = require("../../services/events/eventMessage");
const { STATUS_CODES, STATUS_BY_CODE, statusState, gearText, classesFor, buildCharacterModal } = require("./signupDialog");
const { characterOptions, defaultPick, lastSignupInVersion } = require("./joinPicker");
const { getSignup } = require("../../stores/signupStore");
const { versionOfEvent } = require("../../services/events/mainVersion");
const { MIN_NOTE } = require("../../services/signups/signupNotes");
const { tr, serviceText, specLabel, classLabel } = require("../i18n/botText");
const { plainTitle, colorOf } = require("./signupReply");

const MAX_OPTIONS = 25;
const MAX_REASON = 100;
/** What a status is called in a sentence ("as **Late**"): "Dabei" / "Signed up" … */
const statusWord = (lang, status) => statusState(lang, status);

const btnId = (eventId, ...parts) => [BUTTON_PREFIX, eventId, ...parts].join(":");
const codeOf = (status) => STATUS_CODES[status] || "s";

/** `{ eventId, action, status, arg }` from a customId of this flow (status from the code, "" when none). */
function parseButtonId(customId) {
    const [, eventId = "", action = "", code = "", ...rest] = String(customId || "").split(":");
    const status = STATUS_BY_CODE[code] && code !== "a" ? STATUS_BY_CODE[code] : "";
    return { eventId, action, status, arg: rest.join(":") };
}

/**
 * Why a status cannot be chosen for this event right now, in the member's words — "" when it can.
 * The service refuses the same on save; this only saves a pointless step.
 */
function refusal(event, status, now = Date.now(), lang = "de") {
    if (!event) return tr(lang, "This event no longer exists.");
    if (event.status === "cancelled") return tr(lang, "The event was cancelled.");
    if (allowedStatuses(event, { now }).includes(status)) return "";
    const w = signupWindow(event, now);
    if (w.started) return tr(lang, "The raid has already started – signups are closed.");
    if (event.signupsClosed) return tr(lang, "Signups are closed – you can only sign off now.");
    return tr(lang, "The signup deadline has passed – only “Late” or Absence now.");
}

/**
 * "<spec icon> Zibbo" with the application emojis, else "Zibbo · Holy" as
 * plain text. `emojis` is opt-in (default none) so existing callers that
 * build their own icon alongside it (savedText) keep their exact old text.
 */
function characterText(profile, entry, emojis = {}, lang = "de") {
    const ch = profiles.findCharacter(profile, entry.character);
    const name = ch ? ch.name : entry.character;
    const icon = emojiText(emojis, specEmojiName(entry.spec));
    if (icon) return `${icon} ${name}`;
    return [name, specLabel(lang, profiles.specInfo(entry.spec))].filter(Boolean).join(" · ");
}

/**
 * The confirmation after a save: one line per character with its status. With
 * the application emojis (#303) a status icon heads it and every line carries
 * the spec and the status icon; without them it stays plain text.
 */
function savedText(event, signup, profile, { emojis = {}, lang = "de" } = {}) {
    const title = String((event && event.title) || "Raid");
    const icon = (name) => emojiText(emojis, name);
    const lead = (name, text) => [icon(name), text].filter(Boolean).join(" ");
    if (!signup || signup.status === "absence") {
        const text = signup && signup.comment
            ? tr(lang, "Signed off from **{title}** – reason: {reason}", { title, reason: signup.comment })
            : tr(lang, "Signed off from **{title}**", { title });
        return `${lead(uiEmojiName("absence"), text)}.`;
    }
    const s = migrateSignup(signup);
    const lines = s.characters.map((c, i) => {
        const word = statusWord(lang, c.status);
        const spec = icon(specEmojiName(c.spec));
        const status = icon(statusEmojiName(c.status));
        if (!spec && !status) return `\`${i + 1}.\` ${characterText(profile, c, {}, lang)} – **${word}**`;
        return `\`${i + 1}\` ${[spec, characterText(profile, c, {}, lang)].filter(Boolean).join(" ")}  ·  ${[status, `**${word}**`].filter(Boolean).join(" ")}`;
    });
    const headIcon = icon(uiEmojiName("signed"));
    const head = tr(lang, "Saved for **{title}**", { title });
    return [headIcon ? `${headIcon} ${head}` : `${head}:`, ...lines].join("\n");
}

/**
 * The confirmation after a save as an embed (#508): the head line of savedText
 * as the title ("Saved for …" / "Signed off from …"), one line per character
 * with spec and status icon as the description, then the raid start as a
 * Discord timestamp and the service's notice (waiting list) below it. The
 * colour is the raid's (embedLook).
 * @returns {{ title: string, description: string, color: number }}
 */
function savedEmbed(event, signup, profile, { emojis = {}, notice = "", lang = "de" } = {}) {
    const title = String((event && event.title) || "Raid");
    const icon = (name) => emojiText(emojis, name);
    let head;
    let lines;
    if (!signup || signup.status === "absence") {
        head = [icon(uiEmojiName("absence")), tr(lang, "Signed off from {title}", { title })].filter(Boolean).join(" ");
        lines = signup && signup.comment ? [tr(lang, "Reason: {reason}", { reason: signup.comment })] : [];
    } else {
        const [first, ...rest] = savedText(event, signup, profile, { emojis, lang }).split("\n");
        head = plainTitle(first).replace(/:$/, "");
        lines = rest;
    }
    const start = Number(event && event.startTime) || 0;
    const meta = [
        start ? `🗓️ <t:${start}:F> · <t:${start}:R>` : "",
        notice ? `⏳ ${serviceText(lang, notice)}` : "",
    ].filter(Boolean).join("\n");
    const out = { title: head };
    const description = [lines.join("\n"), meta].filter(Boolean).join("\n\n");
    if (description) out.description = description;
    const color = colorOf(event);
    if (color !== undefined) out.color = color;
    return out;
}

/**
 * The characters for "Anmelden" on an existing signup: the picks in their
 * listed order, each with the given status.
 */
function picksWithStatus(picks, status) {
    return picks.slice(0, MAX_CHARACTERS).map((p) => ({ character: p.character, spec: p.spec, status }));
}

/**
 * A status button on an existing signup: the first character gets the status,
 * the others keep theirs. null when there is nothing to move (no signup, an absence).
 */
function firstCharacterTo(signup, status) {
    const s = signup ? migrateSignup(signup) : null;
    if (!s || s.status === "absence" || !(s.characters || []).length) return null;
    return s.characters.map((c, i) => ({ character: c.character, spec: c.spec, status: i === 0 ? status : c.status }));
}

/**
 * A character added through the class way: appended to an existing signup
 * (replacing the same character's entry in place), or the only one of a new
 * signup. `{ error }` when the signup is already full.
 */
function withAddedCharacter(signup, entry, lang = "de") {
    const s = signup ? migrateSignup(signup) : null;
    if (!s || s.status === "absence" || !(s.characters || []).length) return { characters: [entry], status: entry.status };
    const key = profiles.nameKey(entry.character);
    const list = s.characters.map((c) => ({ character: c.character, spec: c.spec, status: c.status }));
    const at = list.findIndex((c) => profiles.nameKey(c.character) === key);
    if (at >= 0) list[at] = entry;
    else if (list.length >= MAX_CHARACTERS) {
        return { error: tr(lang, "You are already signed up with {max} characters – pick again under “My characters …”.", { max: MAX_CHARACTERS }) };
    } else list.push(entry);
    return { characters: list, status: list[0].status };
}

/**
 * The priority order of picked values: as the select listed its options
 * (Discord hands the values back in that order, not in click order).
 */
function orderedValues(values, listed) {
    const set = new Set((values || []).map(String));
    const order = (listed || []).map((o) => String(o.value));
    const known = order.filter((v) => set.has(v));
    const rest = [...set].filter((v) => !order.includes(v));
    return [...known, ...rest].map((v) => {
        const [character = "", spec = ""] = v.split("|");
        return { character, spec };
    });
}

/**
 * The own characters · specs as select options: the current signup's characters
 * first (in their order), then the rest — the likeliest pick (last used, else
 * the main's best spec) on top. Nothing is preselected: Discord only reports a
 * select whose picks changed, and choosing the same characters again must still
 * save (e.g. "Anmelden" after "Spät" sets them back to "Dabei").
 */
function pickOptions(profile, userId, eventId, { emojis = {}, versionId = "", lang = "de" } = {}) {
    const options = characterOptions(profile, versionId);
    const mine = migrateSignup(getSignup(eventId, userId));
    const current = mine && mine.status !== "absence"
        ? (mine.characters || []).map((c) => options.find((o) => profiles.nameKey(o.character) === profiles.nameKey(c.character) && o.spec === c.spec)).filter(Boolean)
        : [];
    const likely = current.length ? null : defaultPick(options, { last: versionId ? lastSignupInVersion(userId, versionId) : null });
    const first = current.length ? current : (likely ? [likely] : []);
    const ordered = [...first, ...options.filter((o) => !first.includes(o))];
    return ordered.slice(0, MAX_OPTIONS).map((o) => {
        const option = {
            label: `${o.name} · ${specLabel(lang, profiles.specInfo(o.spec)) || o.spec}`.slice(0, 100),
            value: `${o.character}|${o.spec}`.slice(0, 100),
            description: gearText(lang, o.gear).slice(0, 100) || undefined,
        };
        const emoji = emojiOption(emojis, specEmojiName(o.spec));
        if (emoji) option.emoji = emoji;
        return option;
    });
}

const headLine = (event, status, lang) => {
    const start = Number(event.startTime) || 0;
    const what = status === "signed" ? tr(lang, "Sign up") : tr(lang, "as **{status}**", { status: statusWord(lang, status) });
    return `**${String(event.title || "Raid")}**${start ? ` · <t:${start}:f>` : ""} · ${what}`;
};

const otherClassButton = (eventId, status, emojis, label) => {
    const button = { type: 2, style: 2, custom_id: btnId(eventId, "other", codeOf(status)), label };
    const emoji = emojiOption(emojis, uiEmojiName("class"));
    if (emoji) button.emoji = emoji;
    return button;
};

/** The class select of a step (`cls`): every class of the event's game version with its icon. */
function classSelect(event, status, emojis, placeholder, lang) {
    return {
        type: 3,
        custom_id: btnId(event.id, "cls", codeOf(status)),
        placeholder,
        min_values: 1,
        max_values: 1,
        options: classesFor(event).slice(0, MAX_OPTIONS).map((c) => {
            const option = { label: classLabel(lang, c), value: c.id };
            const emoji = emojiOption(emojis, classEmojiName(c.id));
            if (emoji) option.emoji = emoji;
            return option;
        }),
    };
}

/**
 * Step: pick own characters (up to MAX_CHARACTERS), the classes below them for
 * a new character (#303). Only the member sees it — an embed reads clearer
 * than plain content here (#356), so the lines go into its description.
 * @returns {{ embeds: object[], components: object[] }}
 */
function buildCharacterPicker(event, userId, status, { emojis = {}, notice = "", lang = "de" } = {}) {
    const profile = profiles.getProfile(userId) || { characters: [] };
    const options = pickOptions(profile, userId, event.id, { emojis, versionId: versionOfEvent(event), lang });
    const max = Math.min(MAX_CHARACTERS, options.length);
    const lines = [headLine(event, status, lang)];
    const mine = migrateSignup(getSignup(event.id, userId));
    if (mine && mine.status !== "absence" && (mine.characters || []).length) {
        const list = mine.characters.map((c) => `${characterText(profile, c, emojis, lang)} (${statusWord(lang, c.status)})`).join(", ");
        lines.push(tr(lang, "So far: {list}", { list }));
    }
    lines.push(max > 1
        ? tr(lang, "Pick up to {max} characters – the topmost in the list is your 1st choice.", { max })
        : tr(lang, "Pick your character."));
    if (notice) lines.push("", notice);
    return {
        embeds: [{ color: colorOf(event), description: lines.join("\n") }],
        components: [
            {
                type: 1,
                components: [{
                    type: 3,
                    custom_id: btnId(event.id, "pick", codeOf(status)),
                    placeholder: tr(lang, "Choose all Characters to sign up with"),
                    min_values: 1,
                    max_values: Math.max(1, max),
                    options,
                }],
            },
            { type: 1, components: [classSelect(event, status, emojis, tr(lang, "Or a new character: pick a class …"), lang)] },
        ],
    };
}

/** Step: the classes of the event's game version. */
function buildClassPicker(event, status, { emojis = {}, notice = "", lang = "de" } = {}) {
    const lines = [headLine(event, status, lang), tr(lang, "Which class?")];
    if (notice) lines.push("", notice);
    return {
        embeds: [{ color: colorOf(event), description: lines.join("\n") }],
        components: [{ type: 1, components: [classSelect(event, status, emojis, tr(lang, "Pick a class …"), lang)] }],
    };
}

/** Step: the specs of the picked class, with a way back to the classes. null for an unknown class. */
function buildSpecPicker(event, status, classId, { emojis = {}, lang = "de" } = {}) {
    const cls = classesFor(event).find((c) => c.id === classId);
    if (!cls) return null;
    return {
        embeds: [{ color: colorOf(event), description: `${headLine(event, status, lang)}\n${tr(lang, "**{class}** – which spec?", { class: classLabel(lang, cls) })}` }],
        components: [
            {
                type: 1,
                components: [{
                    type: 3,
                    custom_id: btnId(event.id, "spec", codeOf(status)),
                    placeholder: tr(lang, "Pick a spec …"),
                    min_values: 1,
                    max_values: 1,
                    options: cls.specs.slice(0, MAX_OPTIONS).map((s) => {
                        const option = { label: specLabel(lang, s), value: s.key };
                        const emoji = emojiOption(emojis, specEmojiName(s.key));
                        if (emoji) option.emoji = emoji;
                        return option;
                    }),
                }],
            },
            { type: 1, components: [otherClassButton(event.id, status, emojis, tr(lang, "Other class"))] },
        ],
    };
}

/**
 * The name modal after a spec: prefilled with the member's character of that
 * class (the main first), else their Discord display name.
 */
function buildNameModal(event, userId, status, specKey, { displayName = "", lang = "de" } = {}) {
    const info = profiles.specInfo(specKey) || {};
    const profile = profiles.getProfile(userId) || { characters: [] };
    const versionId = versionOfEvent(event);
    const sameClass = profiles.charactersOfVersion(profile, versionId).filter((c) => c.className === info.classId);
    // the raider's first character of that class, in their own order
    const known = sameClass[0];
    const cls = classesFor(event).find((c) => c.id === info.classId);
    return buildCharacterModal(btnId(event.id, "name", codeOf(status), specKey), {
        defaultName: known ? known.name : displayName,
        classText: [cls ? classLabel(lang, cls) : info.classId, specLabel(lang, info)].filter(Boolean).join(" · "),
        versionId,
        lang,
    });
}

/**
 * The message modal of "Absagen" (`why`) and "Vielleicht" (`note:t`): short,
 * and required only when the event's category says so (signupNotes.noteMode).
 * The text goes into the signup's comment and from there to the orga's channel.
 */
function buildNoteModal(eventId, status, { required = false, lang = "de" } = {}) {
    const absence = status === "absence";
    const input = new TextInputBuilder()
        .setCustomId("reason")
        .setLabel(required ? tr(lang, "Message to the raid lead") : tr(lang, "Message to the raid lead (optional)"))
        .setPlaceholder(absence ? tr(lang, "e.g. work, holiday, sick") : tr(lang, "e.g. not sure yet, might be late"))
        .setStyle(TextInputStyle.Short)
        .setMaxLength(MAX_REASON)
        .setRequired(required);
    if (required) input.setMinLength(MIN_NOTE);
    return new ModalBuilder()
        .setCustomId(absence ? btnId(eventId, "why") : btnId(eventId, "note", codeOf(status)))
        .setTitle(absence ? tr(lang, "Sign off") : tr(lang, "Tentative"))
        .addComponents(new ActionRowBuilder().addComponents(input));
}

module.exports = {
    MAX_REASON, statusWord, btnId, parseButtonId, refusal, characterText, savedText, savedEmbed,
    picksWithStatus, firstCharacterTo, withAddedCharacter, orderedValues, pickOptions,
    buildCharacterPicker, buildClassPicker, buildSpecPicker, buildNameModal, buildNoteModal,
};
