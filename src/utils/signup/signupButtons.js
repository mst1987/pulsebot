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
// for, per the event's category (web/signupNotes.js' noteMode); the service
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
const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const { getSignup, lastSignupOf } = require("../../stores/signupStore");
const { migrateSignup, MAX_CHARACTERS } = require("../../web/signupCharacters");
const profiles = require("../../stores/raiderProfileStore");
const { allowedStatuses, signupWindow } = require("../../web/signupService");
const { emojiOption, emojiText, specEmojiName, classEmojiName, uiEmojiName, statusEmojiName } = require("../../services/discord/appEmojis");
const { BUTTON_PREFIX } = require("../../services/events/eventMessage");
const { STATUS_CODES, STATUS_BY_CODE, STATUS_STATE, classesFor, buildCharacterModal } = require("./signupDialog");
const { characterOptions, defaultPick } = require("./joinPicker");
const { MIN_NOTE } = require("../../web/signupNotes");

const MAX_OPTIONS = 25;
const MAX_REASON = 100;
const GEAR_TEXT = { ready: "raid ready", usable: "usable", none: "no gear" };
// What a status is called in a sentence: "as **Late**".
const STATUS_WORD = { signed: "Signed up", tentative: "Tentative", late: "Late", bench: "Bench" };
// The English label of a class or spec, the German one as a fallback.
const en = (x) => (x && (x.labelEn || x.label)) || "";

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
function refusal(event, status, now = Date.now()) {
    if (!event) return "This event no longer exists.";
    if (event.status === "cancelled") return "The event was cancelled.";
    if (allowedStatuses(event, { now }).includes(status)) return "";
    const w = signupWindow(event, now);
    if (w.started) return "The raid has already started – signups are closed.";
    if (event.signupsClosed) return "Signups are closed – you can only sign off now.";
    return "The signup deadline has passed – only “Late” or Absence now.";
}

/**
 * "<spec icon> Zibbo" with the application emojis, else "Zibbo · Holy" as
 * plain text. `emojis` is opt-in (default none) so existing callers that
 * build their own icon alongside it (savedText) keep their exact old text.
 */
function characterText(profile, entry, emojis = {}) {
    const ch = ((profile && profile.characters) || []).find((c) => c.key === profiles.characterKey(entry.character));
    const name = ch ? ch.name : entry.character;
    const icon = emojiText(emojis, specEmojiName(entry.spec));
    if (icon) return `${icon} ${name}`;
    const info = profiles.specInfo(entry.spec) || {};
    return [name, en(info)].filter(Boolean).join(" · ");
}

/**
 * The confirmation after a save: one line per character with its status. With
 * the application emojis (#303) a status icon heads it and every line carries
 * the spec and the status icon; without them it stays plain text.
 */
function savedText(event, signup, profile, { emojis = {} } = {}) {
    const title = String((event && event.title) || "Raid");
    const icon = (name) => emojiText(emojis, name);
    const lead = (name, text) => [icon(name), text].filter(Boolean).join(" ");
    if (!signup || signup.status === "absence") {
        return `${lead(uiEmojiName("absence"), `Signed off from **${title}**`)}${signup && signup.comment ? ` – reason: ${signup.comment}` : ""}.`;
    }
    const s = migrateSignup(signup);
    const lines = s.characters.map((c, i) => {
        const word = STATUS_WORD[c.status] || STATUS_STATE[c.status] || c.status;
        const spec = icon(specEmojiName(c.spec));
        const status = icon(statusEmojiName(c.status));
        if (!spec && !status) return `\`${i + 1}.\` ${characterText(profile, c)} – **${word}**`;
        return `\`${i + 1}\` ${[spec, characterText(profile, c)].filter(Boolean).join(" ")}  ·  ${[status, `**${word}**`].filter(Boolean).join(" ")}`;
    });
    const headIcon = icon(uiEmojiName("signed"));
    return [headIcon ? `${headIcon} Saved for **${title}**` : `Saved for **${title}**:`, ...lines].join("\n");
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
function withAddedCharacter(signup, entry) {
    const s = signup ? migrateSignup(signup) : null;
    if (!s || s.status === "absence" || !(s.characters || []).length) return { characters: [entry], status: entry.status };
    const key = profiles.characterKey(entry.character);
    const list = s.characters.map((c) => ({ character: c.character, spec: c.spec, status: c.status }));
    const at = list.findIndex((c) => profiles.characterKey(c.character) === key);
    if (at >= 0) list[at] = entry;
    else if (list.length >= MAX_CHARACTERS) {
        return { error: `You are already signed up with ${MAX_CHARACTERS} characters – pick again under “My characters …”.` };
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
function pickOptions(profile, userId, eventId, { emojis = {} } = {}) {
    const options = characterOptions(profile);
    const mine = migrateSignup(getSignup(eventId, userId));
    const current = mine && mine.status !== "absence"
        ? (mine.characters || []).map((c) => options.find((o) => o.character === profiles.characterKey(c.character) && o.spec === c.spec)).filter(Boolean)
        : [];
    const likely = current.length ? null : defaultPick(options, { last: lastSignupOf(userId) });
    const first = current.length ? current : (likely ? [likely] : []);
    const ordered = [...first, ...options.filter((o) => !first.includes(o))];
    return ordered.slice(0, MAX_OPTIONS).map((o) => {
        const info = profiles.specInfo(o.spec) || {};
        const option = {
            label: `${o.name} · ${en(info) || o.spec}`.slice(0, 100),
            value: `${o.character}|${o.spec}`.slice(0, 100),
            description: [o.main ? "Main" : "", GEAR_TEXT[o.gear] || ""].filter(Boolean).join(" · ").slice(0, 100) || undefined,
        };
        const emoji = emojiOption(emojis, specEmojiName(o.spec));
        if (emoji) option.emoji = emoji;
        return option;
    });
}

const headLine = (event, status) => {
    const start = Number(event.startTime) || 0;
    return `**${String(event.title || "Raid")}**${start ? ` · <t:${start}:f>` : ""} · ${status === "signed" ? "Sign up" : `as **${STATUS_WORD[status]}**`}`;
};

const otherClassButton = (eventId, status, emojis, label = "Other class …") => {
    const button = { type: 2, style: 2, custom_id: btnId(eventId, "other", codeOf(status)), label };
    const emoji = emojiOption(emojis, uiEmojiName("class"));
    if (emoji) button.emoji = emoji;
    return button;
};

/** The class select of a step (`cls`): every class of the event's game version with its icon. */
function classSelect(event, status, emojis, placeholder = "Pick a class …") {
    return {
        type: 3,
        custom_id: btnId(event.id, "cls", codeOf(status)),
        placeholder,
        min_values: 1,
        max_values: 1,
        options: classesFor(event).slice(0, MAX_OPTIONS).map((c) => {
            const option = { label: en(c), value: c.id };
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
function buildCharacterPicker(event, userId, status, { emojis = {}, notice = "" } = {}) {
    const profile = profiles.getProfile(userId) || { characters: [] };
    const options = pickOptions(profile, userId, event.id, { emojis });
    const max = Math.min(MAX_CHARACTERS, options.length);
    const lines = [headLine(event, status)];
    const mine = migrateSignup(getSignup(event.id, userId));
    if (mine && mine.status !== "absence" && (mine.characters || []).length) {
        lines.push(`So far: ${mine.characters.map((c) => `${characterText(profile, c, emojis)} (${STATUS_WORD[c.status] || c.status})`).join(", ")}`);
    }
    lines.push(max > 1
        ? `Pick up to ${max} characters – the topmost in the list is your 1st choice.`
        : "Pick your character.");
    if (notice) lines.push("", notice);
    return {
        embeds: [{ description: lines.join("\n") }],
        components: [
            {
                type: 1,
                components: [{
                    type: 3,
                    custom_id: btnId(event.id, "pick", codeOf(status)),
                    placeholder: "Choose all Characters to sign up with",
                    min_values: 1,
                    max_values: Math.max(1, max),
                    options,
                }],
            },
            { type: 1, components: [classSelect(event, status, emojis, "Or a new character: pick a class …")] },
        ],
    };
}

/** Step: the classes of the event's game version. */
function buildClassPicker(event, status, { emojis = {}, notice = "" } = {}) {
    const lines = [headLine(event, status), "Which class?"];
    if (notice) lines.push("", notice);
    return {
        embeds: [{ description: lines.join("\n") }],
        components: [{ type: 1, components: [classSelect(event, status, emojis)] }],
    };
}

/** Step: the specs of the picked class, with a way back to the classes. null for an unknown class. */
function buildSpecPicker(event, status, classId, { emojis = {} } = {}) {
    const cls = classesFor(event).find((c) => c.id === classId);
    if (!cls) return null;
    return {
        embeds: [{ description: `${headLine(event, status)}\n**${en(cls)}** – which spec?` }],
        components: [
            {
                type: 1,
                components: [{
                    type: 3,
                    custom_id: btnId(event.id, "spec", codeOf(status)),
                    placeholder: "Pick a spec …",
                    min_values: 1,
                    max_values: 1,
                    options: cls.specs.slice(0, MAX_OPTIONS).map((s) => {
                        const option = { label: en(s), value: s.key };
                        const emoji = emojiOption(emojis, specEmojiName(s.key));
                        if (emoji) option.emoji = emoji;
                        return option;
                    }),
                }],
            },
            { type: 1, components: [otherClassButton(event.id, status, emojis, "Other class")] },
        ],
    };
}

/**
 * The name modal after a spec: prefilled with the member's character of that
 * class (the main first), else their Discord display name.
 */
function buildNameModal(event, userId, status, specKey, { displayName = "" } = {}) {
    const info = profiles.specInfo(specKey) || {};
    const profile = profiles.getProfile(userId) || { characters: [] };
    const sameClass = profile.characters.filter((c) => c.className === info.classId);
    const known = sameClass.find((c) => c.main) || sameClass[0];
    const cls = classesFor(event).find((c) => c.id === info.classId);
    return buildCharacterModal(btnId(event.id, "name", codeOf(status), specKey), {
        defaultName: known ? known.name : displayName,
        classText: [cls ? en(cls) : info.classId, en(info)].filter(Boolean).join(" · "),
        versionId: event.versionId,
    });
}

/**
 * The message modal of "Absagen" (`why`) and "Vielleicht" (`note:t`): short,
 * and required only when the event's category says so (signupNotes.noteMode).
 * The text goes into the signup's comment and from there to the orga's channel.
 */
function buildNoteModal(eventId, status, { required = false } = {}) {
    const absence = status === "absence";
    const input = new TextInputBuilder()
        .setCustomId("reason")
        .setLabel(required ? "Message to the raid lead" : "Message to the raid lead (optional)")
        .setPlaceholder(absence ? "e.g. work, holiday, sick" : "e.g. not sure yet, might be late")
        .setStyle(TextInputStyle.Short)
        .setMaxLength(MAX_REASON)
        .setRequired(required);
    if (required) input.setMinLength(MIN_NOTE);
    return new ModalBuilder()
        .setCustomId(absence ? btnId(eventId, "why") : btnId(eventId, "note", codeOf(status)))
        .setTitle(absence ? "Sign off" : "Tentative")
        .addComponents(new ActionRowBuilder().addComponents(input));
}

module.exports = {
    MAX_REASON, STATUS_WORD, btnId, parseButtonId, refusal, characterText, savedText,
    picksWithStatus, firstCharacterTo, withAddedCharacter, orderedValues, pickOptions,
    buildCharacterPicker, buildClassPicker, buildSpecPicker, buildNameModal, buildNoteModal,
};
