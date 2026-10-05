// /availability and the panel of absences and attendances — every step after
// the click, see utils/signup/availabilityDialog.js for the customIds and
// services/signups/availability.js for the rules. Everything answers only the
// member (ephemeral, in their language); the panel itself is a public message
// nobody edits.
//
//   /availability                    the own entries plus the three buttons
//   availability:a|p:<categoryId>    "Enter absence" / "Enter attendance" → the period modal
//   availability:ma|mp:<categoryId>  the submitted modal → the raid picker (a session)
//   availability:l:<categoryId>      "My entries"; availability:del:<categoryId> deletes one
//   availability:<token>:c|r|save|x  the picker: character · spec, raids, save, cancel
//   availability:r:<categoryId>      the organizer's "My raid": the category's next raid and the own signup
//   availability:o:<categoryId>      the organizer's "Evaluation": the newest evaluation with an own character
const { MessageFlags, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const profiles = require("../../stores/raiderProfileStore");
const settingsStore = require("../../stores/settingsStore");
const availability = require("../../services/signups/availability");
const organizer = require("../../services/signups/organizer");
const { categoryNameFor } = require("../../services/signups/availabilityPanel");
const linkCheck = require("../../services/discord/linkCheck");
const { specLabel } = require("../../utils/i18n/botText");
const { myRaidPayload, myReportPayload } = require("../../utils/signup/organizerPanel");
const { appEmojiMap } = require("../../services/discord/appEmojis");
const { mainVersionFor, visibleVersions } = require("../../services/events/mainVersion");
const { langOfInteraction } = require("../../services/discord/botLanguage");
const { parseGermanDate } = require("../../utils/time");
const { tr, serviceText } = require("../../utils/i18n/botText");
const { answerPayload, answerUpdate } = require("../../utils/signup/signupReply");
const { publicBaseUrl } = require("../../utils/publicUrl");
const {
    PREFIX, createSession, getSession, endSession, parseId, periodModal, characterOptions, defaultCharacter,
    pickerPayload, listPayload, savedPayload,
} = require("../../utils/signup/availabilityDialog");

const ephemeral = (interaction, payload) => interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
const fromEphemeral = (interaction) => !!(interaction.message && interaction.message.flags
    && typeof interaction.message.flags.has === "function" && interaction.message.flags.has(MessageFlags.Ephemeral));

/** The game versions an attendance may pick characters of: the category's, else every shown one. */
function versionsFor(categoryId, config) {
    return categoryId ? [mainVersionFor({ categoryId, config })] : visibleVersions(config);
}

function listFor(userId, categoryId, lang, notice = "") {
    return listPayload(availability.activeEntries(userId), { categoryId, notice, lang });
}

/** "Enter attendance" without a character of the version: say so and link the profile. */
function noCharacterPayload(lang) {
    const link = new ButtonBuilder().setLabel(tr(lang, "Open profile")).setStyle(ButtonStyle.Link).setURL(`${publicBaseUrl()}/profile`);
    return {
        ...answerPayload(tr(lang, "Your profile has no character with a usable spec for these raids yet – add one first."), { lang }),
        components: [new ActionRowBuilder().addComponents(link)],
    };
}

/** The submitted period modal: check it, then the picker in a fresh session. */
async function onModal(interaction, kind, categoryId, lang) {
    const uid = interaction.user.id;
    const config = settingsStore.getConfig();
    const read = (id) => {
        try {
            return String(interaction.fields.getTextInputValue(id) || "").trim();
        } catch {
            return "";
        }
    };
    const fromText = read("from");
    const toText = read("to");
    const from = parseGermanDate(fromText);
    const to = toText ? parseGermanDate(toText) : from;
    const input = { kind, from, to, categoryId, comment: kind === "absence" ? read("reason") : "" };
    let pick = null;
    if (kind === "presence") {
        const versions = versionsFor(categoryId, config);
        pick = defaultCharacter(profiles.getProfile(uid), versions[0], versions);
        if (!pick) return ephemeral(interaction, noCharacterPayload(lang));
        Object.assign(input, { character: pick.key, spec: pick.spec });
    }
    const checked = availability.checkInput(uid, input);
    if (checked.error) return interaction.reply(answerPayload(`⚠️ ${serviceText(lang, checked.error)}`, { lang }));
    const session = { ...checked.value, characterKey: pick ? pick.key : "" };
    const token = createSession(uid, session);
    return ephemeral(interaction, picker(token, getSession(token, uid), config, lang));
}

/** The organizer's "My raid", for this member. */
function myRaid(userId, categoryId, config, lang) {
    const event = organizer.nextRaid(categoryId);
    const signup = event ? organizer.signupOf(event.id, userId) : null;
    const first = signup && Array.isArray(signup.characters) && signup.characters[0];
    const specKey = (first && first.spec) || (signup && signup.spec) || "";
    return myRaidPayload({
        event,
        signup: signup ? { status: signup.status, character: (first && first.character) || signup.character } : null,
        specText: specKey ? specLabel(lang, profiles.specInfo(specKey), specKey) : "",
        specKey,
        signupUrl: event ? linkCheck.eventLink(event) : "",
        planUrl: event ? linkCheck.webTarget("raidplan", event.id) : "",
        categoryName: categoryNameFor(categoryId, { config }),
        lang,
        emojis: appEmojiMap(),
    });
}

/** The organizer's "Evaluation", for this member. */
function myReport(userId, lang) {
    const report = organizer.latestReportFor(userId);
    return myReportPayload({
        report,
        reportUrl: report ? linkCheck.webLink(`/r/${report.id}/p/${report.idx}`) : "",
        profileUrl: linkCheck.webLink("/profile"),
        lang,
    });
}

function picker(token, session, config, lang, notice = "") {
    const raids = availability.raidsInRange(session, { config });
    const versions = versionsFor(session.categoryId, config);
    return pickerPayload(token, session, raids, { profile: profiles.getProfile(session.userId), versions, notice, lang });
}

/** A step inside the picker. */
async function onPicker(interaction, token, action, lang) {
    const uid = interaction.user.id;
    const session = getSession(token, uid);
    if (!session) return interaction.update(answerUpdate(tr(lang, "This selection has expired – start again with the button or /availability."), { lang }));
    const config = settingsStore.getConfig();
    if (action === "x") {
        endSession(token);
        return interaction.update(answerUpdate(tr(lang, "Cancelled – nothing was saved."), { lang }));
    }
    if (action === "c") {
        const [key, spec] = String((interaction.values || [])[0] || "").split("|");
        const option = characterOptions(profiles.getProfile(uid), versionsFor(session.categoryId, config))
            .find((o) => o.key === key && o.spec === spec);
        if (option) {
            const changedVersion = option.versionId !== session.versionId;
            Object.assign(session, { character: option.character, characterKey: option.key, spec: option.spec, versionId: option.versionId });
            // another game version has other raids: start from all of them again
            if (changedVersion) session.selected = null;
        }
        return interaction.update(picker(token, session, config, lang));
    }
    if (action === "r") {
        session.selected = (interaction.values || []).map(String);
        return interaction.update(picker(token, session, config, lang));
    }
    if (action === "save") {
        await interaction.deferUpdate();
        const input = { ...session, character: session.characterKey || session.character };
        const result = await availability.createEntry(uid, input, { eventIds: session.selected || undefined, config });
        if (result.error) return interaction.editReply(picker(token, session, config, lang, `⚠️ ${result.error}`));
        endSession(token);
        const summary = availability.entrySummary(result.entry, result.results, lang);
        return interaction.editReply(savedPayload(summary, { kind: result.entry.kind, dm: result.dm, lang }));
    }
    return interaction.update(answerUpdate(tr(lang, "Unknown action."), { lang }));
}

module.exports = {
    name: PREFIX,
    description: "Abwesenheit oder Anwesenheit eintragen – meldet für die Raids des Zeitraums ab bzw. an",
    // Everyone's own entries; the panel's buttons and every step share this name and access.
    group: "signup",
    defaultAccess: "everyone",
    data: new SlashCommandBuilder()
        .setName(PREFIX)
        .setNameLocalizations({ de: "abwesenheit" })
        .setDescription("Enter an absence or attendance – signs you off or up for the raids of that period")
        .setDescriptionLocalizations({ de: "Abwesenheit oder Anwesenheit eintragen – meldet für die Raids des Zeitraums ab bzw. an" }),
    async execute(interaction) {
        const uid = interaction.user.id;
        const lang = langOfInteraction(interaction);
        if (!interaction.customId) return ephemeral(interaction, listFor(uid, "", lang));
        const { token, action, categoryId } = parseId(interaction.customId);
        if (token) return onPicker(interaction, token, action, lang);
        const config = settingsStore.getConfig();
        if (action === "a") return interaction.showModal(periodModal("absence", categoryId, lang));
        if (action === "p") {
            const versions = versionsFor(categoryId, config);
            if (!characterOptions(profiles.getProfile(uid), versions).length) return ephemeral(interaction, noCharacterPayload(lang));
            return interaction.showModal(periodModal("presence", categoryId, lang));
        }
        if (action === "ma" || action === "mp") return onModal(interaction, action === "ma" ? "absence" : "presence", categoryId, lang);
        if (action === "r") return ephemeral(interaction, myRaid(uid, categoryId, config, lang));
        if (action === "o") return ephemeral(interaction, myReport(uid, lang));
        if (action === "l") {
            return fromEphemeral(interaction) ? interaction.update(listFor(uid, categoryId, lang)) : ephemeral(interaction, listFor(uid, categoryId, lang));
        }
        if (action === "del") {
            const removed = availability.deleteEntry(String((interaction.values || [])[0] || ""), { userId: uid });
            return interaction.update(listFor(uid, categoryId, lang, removed.error ? `⚠️ ${removed.error}` : `✅ ${tr(lang, "Entry deleted.")}`));
        }
        return interaction.update(answerUpdate(tr(lang, "Unknown action."), { lang }));
    },
};
