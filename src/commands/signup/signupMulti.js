const { MessageFlags } = require("discord.js");
const profiles = require("../../stores/raiderProfileStore");
const { getEvent } = require("../../stores/eventStore");
const { checkRaiderRole, allowedStatuses, submitSignups } = require("../../web/signupService");
const { appEmojiMap, loadAppEmojis } = require("../../web/appEmojis");
const {
    PREFIX, createSession, getSession, endSession, parseMultiId, pageCount,
    buildRaidPicker, buildCharacterModal, entriesFromModal, buildResults,
} = require("../../utils/signup/multiSignup");
const { STATUS_CODES } = require("../../utils/signup/signupDialog");
const { toEnglish } = require("../../utils/signup/botEnglish");

// Every step of signing up for several raids at once (#293) after the first
// click — see utils/signup/multiSignup.js for the flow and the customIds:
//
//   signup-multi:<token>:r | :s      step 1 selects (raids, status) — redraw
//   signup-multi:<token>:go:<page>   opens the modal of a page (never after a defer)
//   signup-multi:<token>:m:<page>    the submitted modal — saves through submitSignups
//   signup-multi:e:<eventId>:<code>  "Mehrere Charaktere …" of one event's character select
const EXPIRED = "This selection has expired – start the signup again from the raid overview.";
const NO_CHARACTER = "Your profile has no character with a spec yet – add one first (My profile).";

async function emojisFor(interaction) {
    if (interaction.client) await loadAppEmojis(interaction.client);
    return appEmojiMap();
}

const ephemeral = (interaction, content) => interaction.reply({ content: toEnglish(content), flags: MessageFlags.Ephemeral });

/** Open the modal of one page (a click, so the modal can still be shown). */
async function openModal(interaction, token, session, page) {
    const profile = profiles.getProfile(interaction.user.id) || { characters: [] };
    const events = session.eventIds.map((id) => getEvent(id)).filter(Boolean);
    const modal = buildCharacterModal(token, session, page, events, profile, { emojis: await emojisFor(interaction) });
    if (!modal) return ephemeral(interaction, NO_CHARACTER);
    return interaction.showModal(modal);
}

/** "Mehrere Charaktere …" under one event's character select. */
async function onOneEvent(interaction, eventId, status) {
    const uid = interaction.user.id;
    const event = getEvent(eventId);
    if (!event) return ephemeral(interaction, "This event no longer exists.");
    if (!allowedStatuses(event).includes(status)) {
        return ephemeral(interaction, "The signup deadline has passed – you can only sign off or sign up as “Late” now.");
    }
    const access = await checkRaiderRole(event, uid);
    if (access.error) return ephemeral(interaction, access.error);
    const token = createSession(uid, { mode: "one", eventIds: [event.id], status });
    return openModal(interaction, token, getSession(token, uid), 0);
}

/** A submitted modal page: save, then the results (and "Weiter" while pages are left). */
async function onSubmit(interaction, token, session, page) {
    const uid = interaction.user.id;
    // "Für alle" comes straight from the PUBLIC overview message: never edit that one,
    // answer only the member. The other modes sit under an ephemeral message of their own.
    const fromMessage = !!interaction.message && session.mode !== "all";
    if (fromMessage) await interaction.deferUpdate();
    else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { entries } = entriesFromModal(interaction, session, page);
    const results = await submitSignups(uid, entries);
    // A page submitted twice replaces its earlier results instead of listing them again.
    const ids = new Set(results.map((r) => r.eventId));
    session.results = [...session.results.filter((r) => !ids.has(r.eventId)), ...results];
    const last = page + 1 >= pageCount(session);
    const payload = buildResults(token, session, { nextPage: last ? null : page + 1, profile: profiles.getProfile(uid) });
    if (last) endSession(token);
    return interaction.editReply(payload);
}

module.exports = {
    name: PREFIX,
    description: "Mehrere Raids auf einmal anmelden: Raid-Auswahl, Charakter-Modal, Ergebnis",
    accessOf: "talk-signup",
    async execute(interaction) {
        const uid = interaction.user.id;
        const { token, action, page, eventId, status } = parseMultiId(interaction.customId);
        if (action === "one") return onOneEvent(interaction, eventId, status);

        const session = getSession(token, uid);
        if (!session) {
            if (interaction.isModalSubmit && interaction.isModalSubmit()) return ephemeral(interaction, EXPIRED);
            return interaction.update({ content: EXPIRED, embeds: [], components: [] });
        }
        if (action === "m") return onSubmit(interaction, token, session, page);
        if (action === "go") return openModal(interaction, token, session, page);

        if (action === "r") {
            // only raids step 1 offered; the order stays the offered (date) order
            session.selected = session.eventIds.filter((id) => (interaction.values || []).includes(id));
        } else if (action === "s") {
            const picked = String((interaction.values || [])[0] || "");
            if (STATUS_CODES[picked]) session.status = picked;
        } else {
            return interaction.update({ content: "Unknown action.", embeds: [], components: [] });
        }
        const events = session.eventIds.map((id) => getEvent(id)).filter(Boolean);
        return interaction.update(buildRaidPicker(token, session, events, { emojis: await emojisFor(interaction) }));
    },
};
