const { MessageFlags } = require("discord.js");
const { getEvent } = require("../../stores/eventStore");
const { getSignup } = require("../../stores/signupStore");
const profiles = require("../../stores/raiderProfileStore");
const { submitSignup, checkRaiderRole } = require("../../web/signupService");
const { BUTTON_PREFIX } = require("../../web/eventMessage");
const { appEmojiMap, loadAppEmojis } = require("../../web/appEmojis");
const { characterOptions } = require("../../utils/signup/joinPicker");
const { classLabel } = require("../../utils/signup/signupDialog");
const {
    parseButtonId, refusal, savedText, picksWithStatus, firstCharacterTo, withAddedCharacter, orderedValues,
    buildCharacterPicker, buildClassPicker, buildSpecPicker, buildNameModal, buildNoteModal, STATUS_WORD,
} = require("../../utils/signup/signupButtons");
const { toEnglish } = require("../../utils/signup/botEnglish");
const { noteMode, MIN_NOTE } = require("../../web/signupNotes");

// The signup buttons under an EventHelper event message and every step after
// them — see utils/signup/signupButtons.js for the flow and the customIds. Every answer
// is ephemeral: a click on the public message replies, a step inside the
// member's own message updates it. Saves go through signupService.submitSignup.
const STATUS_ACTIONS = ["late", "tentative", "bench"];

// After the public select reset itself (eventPick.js: interaction.update), the answer is a follow-up.
const reply = (interaction, payload) => {
    const body = { ...(typeof payload === "string" ? { content: toEnglish(payload) } : payload), flags: MessageFlags.Ephemeral };
    return interaction.replied || interaction.deferred ? interaction.followUp(body) : interaction.reply(body);
};
const done = (interaction, content) => interaction.update({ content: toEnglish(content), embeds: [], components: [] });

async function emojisFor(interaction) {
    if (interaction.client) await loadAppEmojis(interaction.client);
    return appEmojiMap();
}

// The "Vielleicht" message of a member who still has to pick a character: the
// modal comes first, the character select after it, and a customId has no room
// for the text. Kept per event and member for a while, taken by the save.
const NOTE_TTL_MS = 30 * 60 * 1000;
const pendingNotes = new Map();
const noteKey = (eventId, uid) => `${eventId}:${uid}`;

function keepNote(eventId, uid, status, note, now = Date.now()) {
    for (const [key, entry] of pendingNotes) if (now - entry.at > NOTE_TTL_MS) pendingNotes.delete(key);
    pendingNotes.set(noteKey(eventId, uid), { status, note, at: now });
}

/** `{ comment }` for a save with this status, when a fresh message waits for it — else {}. */
function takeNote(eventId, uid, status, now = Date.now()) {
    const key = noteKey(eventId, uid);
    const entry = pendingNotes.get(key);
    if (!entry) return {};
    pendingNotes.delete(key);
    return entry.status === status && now - entry.at <= NOTE_TTL_MS ? { comment: entry.note } : {};
}

/** The message a modal brought, or `{ error }` when the category requires one and it is too short. */
function noteFrom(interaction, event) {
    const note = String(interaction.fields.getTextInputValue("reason") || "").replace(/\s+/g, " ").trim();
    if (noteMode(event.categoryId) === "required" && note.length < MIN_NOTE) return { error: "Please leave a short message." };
    return { note };
}

const displayName = (interaction) => (interaction.member && interaction.member.displayName) || (interaction.user && interaction.user.username) || "";

/** Refused status or raider role: the reason, else "". */
async function blocked(event, uid, status) {
    const why = refusal(event, status);
    if (why) return why;
    const access = await checkRaiderRole(event, uid);
    return access.error || "";
}

/** Save and answer with the confirmation or the service's reason. */
async function save(interaction, event, input, { update = false } = {}) {
    const uid = interaction.user.id;
    const previous = getSignup(event.id, uid);
    const result = await submitSignup(event.id, uid, {
        comment: previous ? previous.comment : "",
        canAlso: previous && previous.spec === ((input.characters || [])[0] || {}).spec ? previous.canAlso : undefined,
        ...input,
    });
    const emojis = result.error ? {} : await emojisFor(interaction);
    // "You are on the waiting list" belongs under the confirmation, not into the roster (#306).
    const text = result.error
        ? `⚠️ ${result.error}`
        : [savedText(event, result.signup, profiles.getProfile(uid), { emojis }), result.notice ? `⏳ ${result.notice}` : ""].filter(Boolean).join("\n");
    return update ? done(interaction, text) : reply(interaction, text);
}

/** Anmelden: one fitting character signs up at once, several get the select, none the class way. */
async function onJoin(interaction, event) {
    const uid = interaction.user.id;
    const why = await blocked(event, uid, "signed");
    if (why) return reply(interaction, why);
    const options = characterOptions(profiles.getProfile(uid) || { characters: [] });
    const emojis = await emojisFor(interaction);
    if (!options.length) {
        return reply(interaction, buildClassPicker(event, "signed", { emojis, notice: "No character in your profile yet – pick class and spec, then the bot asks for the name." }));
    }
    if (options.length === 1) {
        const [only] = options;
        return save(interaction, event, { characters: [{ character: only.character, spec: only.spec, status: "signed" }], status: "signed" });
    }
    return reply(interaction, buildCharacterPicker(event, uid, "signed", { emojis }));
}

/** A class from the public select (#303), or the old "Klasse wählen" button (no class yet): spec step, then the name modal. */
async function onClass(interaction, event, classId) {
    const why = await blocked(event, interaction.user.id, "signed");
    if (why) return reply(interaction, why);
    const emojis = await emojisFor(interaction);
    if (!classId) return reply(interaction, buildClassPicker(event, "signed", { emojis }));
    return reply(interaction, buildSpecPicker(event, "signed", classId, { emojis }) || "Unknown class.");
}

/**
 * Spät / Vielleicht / Bank: the first character of an existing signup, else ask for one.
 * `note` is the message of the "Vielleicht" modal (undefined = none was asked for).
 */
async function onStatus(interaction, event, status, { note } = {}) {
    const uid = interaction.user.id;
    const why = await blocked(event, uid, status);
    if (why) return reply(interaction, why);
    const comment = note === undefined ? {} : { comment: note };
    const moved = firstCharacterTo(getSignup(event.id, uid), status);
    if (moved) {
        return save(interaction, event, { characters: moved, status, ...comment });
    }
    if (note !== undefined) keepNote(event.id, uid, status, note);
    const emojis = await emojisFor(interaction);
    const options = characterOptions(profiles.getProfile(uid) || { characters: [] });
    if (!options.length) {
        return reply(interaction, buildClassPicker(event, status, { emojis, notice: `No character in your profile yet – which class are you coming with as “${STATUS_WORD[status]}”?` }));
    }
    return reply(interaction, buildCharacterPicker(event, uid, status, { emojis }));
}

/** The character select: save the picks (listed order = priority) with the flow's status. */
async function onPick(interaction, event, status) {
    const listed = (interaction.component && interaction.component.options) || [];
    const picks = orderedValues(interaction.values, listed);
    if (!picks.length) return done(interaction, "No character picked.");
    const note = takeNote(event.id, interaction.user.id, status);
    return save(interaction, event, { characters: picksWithStatus(picks, status), status, ...note }, { update: true });
}

/** The name modal: add the character (or its spec) to the profile, then add it to the signup. */
async function onName(interaction, event, status, specKey) {
    const uid = interaction.user.id;
    const info = profiles.specInfo(specKey);
    if (!info) return done(interaction, "⚠️ Unknown spec – please pick again.");
    const why = await blocked(event, uid, status);
    if (why) return done(interaction, `⚠️ ${why}`);
    const name = String(interaction.fields.getTextInputValue("character") || "").trim();
    const profile = profiles.getProfile(uid) || { characters: [] };
    const existing = profile.characters.find((c) => c.key === profiles.characterKey(name));
    if (existing && existing.className !== info.classId) {
        return done(interaction, `⚠️ ${existing.name} is already in your profile as a ${classLabel(event, existing.className)} – pick another name.`);
    }
    const added = profiles.addCharacter(uid, {
        name,
        className: info.classId,
        specs: [{ key: info.key, gear: "usable" }],
        source: "manual",
    }, { name: displayName(interaction), versionId: event.versionId });
    if (added.error) return done(interaction, `⚠️ ${added.error}`);
    const next = withAddedCharacter(getSignup(event.id, uid), { character: added.character.name, spec: info.key, status });
    if (next.error) return done(interaction, `⚠️ ${next.error}`);
    const note = takeNote(event.id, uid, next.status);
    return save(interaction, event, { characters: next.characters, status: next.status, ...note }, { update: true });
}

/**
 * Sign off with the message as the comment (the characters stay on record).
 * `note` undefined = the category asks for none: the stored comment stays.
 */
async function signOff(interaction, event, note) {
    const mine = getSignup(event.id, interaction.user.id);
    return save(interaction, event, {
        characters: mine ? (mine.characters || []).map((c) => ({ character: c.character, spec: c.spec })) : [],
        character: mine ? mine.character : "",
        status: "absence",
        canAlso: mine ? mine.canAlso || [] : [],
        ...(note === undefined ? {} : { comment: note }),
    });
}

/** The absence modal: its message (required or optional per category), then sign off. */
async function onAbsence(interaction, event) {
    const { note, error } = noteFrom(interaction, event);
    if (error) return reply(interaction, error);
    return signOff(interaction, event, note);
}

/** The "Vielleicht" modal: its message, then the same way as the button without one. */
async function onNote(interaction, event, status) {
    const { note, error } = noteFrom(interaction, event);
    if (error) return reply(interaction, error);
    return onStatus(interaction, event, status, { note });
}

module.exports = {
    // The public select (eventPick.js) runs the same steps.
    onJoin, onClass, reply, emojisFor,
    name: BUTTON_PREFIX,
    description: "Anmelde-Buttons unter einer EventHelper-Event-Nachricht",
    // Signing up is for every raider; every step of the flow shares this access.
    group: "signup",
    defaultAccess: "everyone",
    async execute(interaction) {
        const { eventId, action, status, arg } = parseButtonId(interaction.customId);
        const event = getEvent(eventId);
        const isModal = !!(interaction.isModalSubmit && interaction.isModalSubmit());
        // A click on the public message replies; a step in the member's own message updates it.
        const fromPublic = ["join", "class", "absence", "why", "note", ...STATUS_ACTIONS].includes(action);
        if (!event) return fromPublic ? reply(interaction, "This event no longer exists.") : done(interaction, "This event no longer exists.");
        const uid = interaction.user.id;

        switch (action) {
            case "join":
                return onJoin(interaction, event);
            case "class":
                return onClass(interaction, event, "");
            case "late":
            case "bench":
                return onStatus(interaction, event, action);
            case "tentative": {
                // The message first (unless the category asks for none), refused cases before it.
                const mode = noteMode(event.categoryId);
                if (mode === "none") return onStatus(interaction, event, action);
                const why = await blocked(event, uid, action);
                if (why) return reply(interaction, why);
                return interaction.showModal(buildNoteModal(event.id, action, { required: mode === "required" }));
            }
            case "absence": {
                // Signing off is always allowed until the start — unless the event is cancelled.
                const why = refusal(event, "absence");
                if (why) return reply(interaction, why);
                const mode = noteMode(event.categoryId);
                if (mode === "none") return signOff(interaction, event);
                return interaction.showModal(buildNoteModal(event.id, "absence", { required: mode === "required" }));
            }
            case "why":
                return onAbsence(interaction, event);
            case "note":
                if (!isModal || !status) return reply(interaction, "Unknown action.");
                return onNote(interaction, event, status);
            case "pick":
                return onPick(interaction, event, status || "signed");
            case "other":
                return interaction.update(buildClassPicker(event, status || "signed", { emojis: await emojisFor(interaction) }));
            case "cls": {
                const picker = buildSpecPicker(event, status || "signed", String((interaction.values || [])[0] || ""), { emojis: await emojisFor(interaction) });
                return picker ? interaction.update(picker) : done(interaction, "Unknown class.");
            }
            case "spec": {
                const specKey = String((interaction.values || [])[0] || "");
                if (!profiles.specInfo(specKey)) return done(interaction, "Unknown spec.");
                return interaction.showModal(buildNameModal(event, uid, status || "signed", specKey, { displayName: displayName(interaction) }));
            }
            case "name":
                if (!isModal) return done(interaction, "Unknown action.");
                return onName(interaction, event, status || "signed", arg);
            default:
                return fromPublic ? reply(interaction, "Unknown action.") : done(interaction, "Unknown action.");
        }
    },
};
