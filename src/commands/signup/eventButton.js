const { MessageFlags } = require("discord.js");
const { getEvent } = require("../../web/eventStore");
const { getSignup } = require("../../web/signupStore");
const profiles = require("../../web/raiderProfileStore");
const { submitSignup, checkRaiderRole } = require("../../web/signupService");
const { BUTTON_PREFIX } = require("../../web/eventMessage");
const { appEmojiMap, loadAppEmojis } = require("../../web/appEmojis");
const { characterOptions } = require("../../utils/joinPicker");
const { classLabel } = require("../../utils/signupDialog");
const {
    parseButtonId, refusal, savedText, picksWithStatus, firstCharacterTo, withAddedCharacter, orderedValues,
    buildCharacterPicker, buildClassPicker, buildSpecPicker, buildNameModal, buildAbsenceModal, STATUS_WORD,
} = require("../../utils/signupButtons");

// The signup buttons under an EventHelper event message and every step after
// them — see utils/signupButtons.js for the flow and the customIds. Every answer
// is ephemeral: a click on the public message replies, a step inside the
// member's own message updates it. Saves go through signupService.submitSignup.
const STATUS_ACTIONS = ["late", "tentative", "bench"];

// After the public select reset itself (eventPick.js: interaction.update), the answer is a follow-up.
const reply = (interaction, payload) => {
    const body = { ...(typeof payload === "string" ? { content: payload } : payload), flags: MessageFlags.Ephemeral };
    return interaction.replied || interaction.deferred ? interaction.followUp(body) : interaction.reply(body);
};
const done = (interaction, content) => interaction.update({ content, embeds: [], components: [] });

async function emojisFor(interaction) {
    if (interaction.client) await loadAppEmojis(interaction.client);
    return appEmojiMap();
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
    const text = result.error ? `⚠️ ${result.error}` : savedText(event, result.signup, profiles.getProfile(uid), { emojis });
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
        return reply(interaction, buildClassPicker(event, "signed", { emojis, notice: "Noch kein Charakter in deinem Profil – wähle Klasse und Spec, danach fragt der Bot nach dem Namen." }));
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
    return reply(interaction, buildSpecPicker(event, "signed", classId, { emojis }) || "Unbekannte Klasse.");
}

/** Spät / Vielleicht / Bank:the first character of an existing signup, else ask for one. */
async function onStatus(interaction, event, status) {
    const uid = interaction.user.id;
    const why = await blocked(event, uid, status);
    if (why) return reply(interaction, why);
    const moved = firstCharacterTo(getSignup(event.id, uid), status);
    if (moved) {
        return save(interaction, event, { characters: moved, status });
    }
    const emojis = await emojisFor(interaction);
    const options = characterOptions(profiles.getProfile(uid) || { characters: [] });
    if (!options.length) {
        return reply(interaction, buildClassPicker(event, status, { emojis, notice: `Noch kein Charakter in deinem Profil – mit welcher Klasse kommst du als „${STATUS_WORD[status]}“?` }));
    }
    return reply(interaction, buildCharacterPicker(event, uid, status, { emojis }));
}

/** The character select: save the picks (listed order = priority) with the flow's status. */
async function onPick(interaction, event, status) {
    const listed = (interaction.component && interaction.component.options) || [];
    const picks = orderedValues(interaction.values, listed);
    if (!picks.length) return done(interaction, "Kein Charakter gewählt.");
    return save(interaction, event, { characters: picksWithStatus(picks, status), status }, { update: true });
}

/** The name modal: add the character (or its spec) to the profile, then add it to the signup. */
async function onName(interaction, event, status, specKey) {
    const uid = interaction.user.id;
    const info = profiles.specInfo(specKey);
    if (!info) return done(interaction, "⚠️ Unbekannte Spec – bitte neu wählen.");
    const why = await blocked(event, uid, status);
    if (why) return done(interaction, `⚠️ ${why}`);
    const name = String(interaction.fields.getTextInputValue("character") || "").trim();
    const profile = profiles.getProfile(uid) || { characters: [] };
    const existing = profile.characters.find((c) => c.key === profiles.characterKey(name));
    if (existing && existing.className !== info.classId) {
        return done(interaction, `⚠️ ${existing.name} steht in deinem Profil schon als ${classLabel(event, existing.className)} – nimm einen anderen Namen.`);
    }
    const added = profiles.addCharacter(uid, {
        name,
        className: info.classId,
        specs: [{ key: info.key, gear: "usable" }],
        source: "manual",
    }, { name: displayName(interaction) });
    if (added.error) return done(interaction, `⚠️ ${added.error}`);
    const next = withAddedCharacter(getSignup(event.id, uid), { character: added.character.name, spec: info.key, status });
    if (next.error) return done(interaction, `⚠️ ${next.error}`);
    return save(interaction, event, { characters: next.characters, status: next.status }, { update: true });
}

/** The absence modal: sign off with the reason as the comment (the characters stay on record). */
async function onAbsence(interaction, event) {
    const uid = interaction.user.id;
    const reason = String(interaction.fields.getTextInputValue("reason") || "").trim();
    if (reason.length < 2) return reply(interaction, "Bitte gib kurz einen Grund an.");
    const mine = getSignup(event.id, uid);
    return save(interaction, event, {
        characters: mine ? (mine.characters || []).map((c) => ({ character: c.character, spec: c.spec })) : [],
        character: mine ? mine.character : "",
        status: "absence",
        canAlso: mine ? mine.canAlso || [] : [],
        comment: reason,
    });
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
        const fromPublic = ["join", "class", "absence", "why", ...STATUS_ACTIONS].includes(action);
        if (!event) return fromPublic ? reply(interaction, "Dieses Event gibt es nicht mehr.") : done(interaction, "Dieses Event gibt es nicht mehr.");
        const uid = interaction.user.id;

        switch (action) {
        case "join":
            return onJoin(interaction, event);
        case "class":
            return onClass(interaction, event, "");
        case "late":
        case "tentative":
        case "bench":
            return onStatus(interaction, event, action);
        case "absence": {
            // Signing off is always allowed until the start — unless the event is cancelled.
            const why = refusal(event, "absence");
            if (why) return reply(interaction, why);
            return interaction.showModal(buildAbsenceModal(event.id));
        }
        case "why":
            return onAbsence(interaction, event);
        case "pick":
            return onPick(interaction, event, status || "signed");
        case "other":
            return interaction.update(buildClassPicker(event, status || "signed", { emojis: await emojisFor(interaction) }));
        case "cls": {
            const picker = buildSpecPicker(event, status || "signed", String((interaction.values || [])[0] || ""), { emojis: await emojisFor(interaction) });
            return picker ? interaction.update(picker) : done(interaction, "Unbekannte Klasse.");
        }
        case "spec": {
            const specKey = String((interaction.values || [])[0] || "");
            if (!profiles.specInfo(specKey)) return done(interaction, "Unbekannte Spec.");
            return interaction.showModal(buildNameModal(event, uid, status || "signed", specKey, { displayName: displayName(interaction) }));
        }
        case "name":
            if (!isModal) return done(interaction, "Unbekannte Aktion.");
            return onName(interaction, event, status || "signed", arg);
        default:
            return fromPublic ? reply(interaction, "Unbekannte Aktion.") : done(interaction, "Unbekannte Aktion.");
        }
    },
};
