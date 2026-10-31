// /availability and the panel of absences and attendances — every step after
// the click, see utils/signup/availabilityDialog.js for the customIds and
// services/signups/availability.js for the rules. Everything answers only the
// member (ephemeral, in their language); the panel itself is a public message
// nobody edits.
//
//   /availability                    the own entries plus the three buttons (only on a server of the server list)
//   availability:a|p:<categoryId>    "Enter absence" / "Enter attendance" → the period modal
//   availability:ma|mp:<categoryId>  the submitted modal → the raid picker (a session)
//   availability:l:<categoryId>      "My entries"; availability:del:<categoryId> deletes one
//   availability:<token>:c|r|save|x  the picker: character · spec, raids, save, cancel
//   availability:r:<categoryId>      the organizer's "My raid": the category's next raid and the own signup
//   availability:o:<categoryId>      the organizer's "Evaluation": the newest evaluation with an own character
//   availability:b:<categoryId>      the organizer's guild bank: "Make a request" → with stock data the pick card
//                                    (utils/signup/guildBankPick.js), else the free-text modal availability:mb
//   availability:mb:<categoryId>     the submitted free-text modal → posted to the orga (services/signups/guildBank.js)
//   availability:bp:<categoryId>:<n> an item picked in the pick card's n-th group → the item modal
//   availability:mbi:<categoryId>:<itemId>  the submitted item modal → checked and posted to the orga;
//                                    what is not free goes on the item's waiting list (#775)
const { MessageFlags, SlashCommandBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const profiles = require("../../stores/roster/raiderProfileStore");
const settingsStore = require("../../stores/settings/settingsStore");
const availability = require("../../services/signups/availability");
const organizer = require("../../services/signups/organizer");
const guildBank = require("../../services/signups/guildBank");
const linking = require("../../services/guildbank/linking");
const { requestModal, requestSummary, waitingSummary } = require("../../utils/signup/guildBankPost");
const { pickPayload, itemModal, itemIdOfModal } = require("../../utils/signup/guildBankPick");
const { categoryNameFor } = require("../../services/signups/availabilityPanel");
const linkCheck = require("../../services/discord/linkCheck");
const { serverChoices, eventGuildIds } = require("../../services/discord/roles/guildRoles");
const { categoryContext, displayServerOf } = require("../../services/categories/categoryGuild");
const { scopeOf } = require("../../services/signups/availabilityScope");
const { specLabel } = require("../../utils/i18n/botText");
const { myRaidPayload, myReportPayload } = require("../../utils/signup/organizerPanel");
const { appEmojiMap } = require("../../services/discord/appEmojis");
const { mainVersionFor, visibleVersions } = require("../../services/versions/mainVersion");
const { langOfInteraction } = require("../../services/discord/botLanguage");
const { parseDayRange } = require("../../utils/time");
const { tr, serviceText } = require("../../utils/i18n/botText");
const { answerPayload, answerUpdate } = require("../../utils/signup/signupReply");
const { publicBaseUrl } = require("../../utils/publicUrl");
const {
    PREFIX, createSession, getSession, saveSession, endSession, parseId, periodModal, characterOptions, defaultCharacter,
    pickerPayload, listPayload, savedPayload,
} = require("../../utils/signup/availabilityDialog");
const { asEphemeral } = require("../../utils/discord/card");
const availabilityStore = require("../../stores/events/availabilityStore");

/**
 * The section of the raider organizer each step belongs to (availabilityStore.FEATURE_KEYS): the panel
 * buttons and every follow-up step of an open modal or pick card, so a section switched off meanwhile
 * refuses those too. "My entries" (l, del) from an own answer stays usable — it only shows and deletes
 * what the raider entered.
 */
const PANEL_FEATURES = {
    a: "attendance", p: "attendance", l: "attendance", ma: "attendance", mp: "attendance",
    r: "nextRaid", o: "evaluation",
    b: "guildBank", bp: "guildBank", mb: "guildBank", mbi: "guildBank",
};

const ephemeral = (interaction, payload) => interaction.reply(asEphemeral(payload));
const fromEphemeral = (interaction) => !!(interaction.message && interaction.message.flags
    && typeof interaction.message.flags.has === "function" && interaction.message.flags.has(MessageFlags.Ephemeral));

/** Whether the orga switched this section of the category's raid hub off (#969). */
const switchedOff = (categoryId, feature) => !!(feature && categoryId && availabilityStore.getFeatures(categoryId)[feature] === false);
const switchedOffText = (lang) => tr(lang, "This feature is switched off in this raid hub.");

/** The game versions an attendance may pick characters of: the category's, else every shown one. */
function versionsFor(categoryId, config) {
    return categoryId ? [mainVersionFor({ categoryId, config })] : visibleVersions(config);
}

/**
 * Where an entry counts, as the list shows it: "Server: Category, Category" per
 * server, "Server" for every category there. An older entry without scope shows
 * its category, or nothing (it counts everywhere, as before). Names from the
 * server list and the bot's category cache - no Discord request.
 */
function placeText(entry, config) {
    const scope = scopeOf(entry);
    if (!scope) return "";
    const names = Object.fromEntries(serverChoices(config).map((s) => [s.guildId, String(s.name || s.label || s.guildId)]));
    const catName = (id) => categoryNameFor(id, { config }) || id;
    // scopeOf never yields a part without both server and categories
    return scope.map((s) => {
        const server = s.guildId ? names[s.guildId] || s.guildId : "";
        const cats = s.categoryIds.map(catName).join(", ");
        return server && cats ? `${server}: ${cats}` : server || cats;
    }).join(" · ");
}

function listFor(userId, categoryId, lang, notice = "") {
    const config = settingsStore.getConfig();
    return listPayload(availability.activeEntries(userId), { categoryId, notice, lang, placeOf: (e) => placeText(e, config) });
}

/** "Enter attendance" without a character of the version: say so and link the profile. */
function noCharacterPayload(lang) {
    const link = new ButtonBuilder().setLabel(tr(lang, "Open profile")).setStyle(ButtonStyle.Link).setURL(`${publicBaseUrl()}/profile`);
    return answerPayload(tr(lang, "Your profile has no character with a usable spec for these raids yet – add one first."), { lang, components: [link] });
}

/** "Try again": the same button as the panel's, so a wrong date is one click from the modal again. */
function retryButton(kind, categoryId, lang) {
    return new ButtonBuilder().setCustomId(`${PREFIX}:${kind === "absence" ? "a" : "p"}:${categoryId || ""}`)
        .setLabel(tr(lang, "Try again")).setEmoji("🔁").setStyle(ButtonStyle.Primary);
}

/**
 * The submitted period modal: check it, then the picker in a fresh session. Finding
 * the raids of categories the raider is no raider of asks Discord for the roles per
 * server (no timeout there), so the modal is acknowledged first and answered by edit.
 */
async function onModal(interaction, kind, categoryId, lang) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const answer = (payload) => interaction.editReply(payload);
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
    // one field may carry the whole period ("24.10.-31.10."); an end without a year before the start is next year's
    const period = parseDayRange(toText ? `${fromText} bis ${toText}` : fromText);
    if (!period) {
        const wrong = parseDayRange(fromText) ? toText : fromText;
        const text = tr(lang, "I could not read **{text}** as a date. Write it like **24.10.**, **24.10.2026**, **24 Oct** or a whole period like **24.10.-31.10.**", { text: wrong || "–" });
        return answer(answerPayload(`⚠️ ${text}`, { lang, components: [retryButton(kind, categoryId, lang)] }));
    }
    const input = { kind, from: period.from, to: period.to, categoryId, comment: kind === "absence" ? read("reason") : "" };
    // a panel's category together with its server; without a category the entry
    // counts on the server the command ran on (execute refuses a DM) - never on every server
    input.scope = categoryId ? panelScope(categoryId, config) : commandScope(interaction);
    let pick = null;
    if (kind === "presence") {
        const versions = versionsFor(categoryId, config);
        pick = defaultCharacter(profiles.getProfile(uid), versions[0], versions);
        if (!pick) return answer(noCharacterPayload(lang));
        Object.assign(input, { characters: [{ character: pick.key, spec: pick.spec }] });
    }
    const checked = availability.checkInput(uid, input, { config });
    if (checked.error) return answer(answerPayload(`⚠️ ${serviceText(lang, checked.error)}`, { lang, components: [retryButton(kind, categoryId, lang)] }));
    // every category (/availability): the raids of categories the raider is no raider of are not offered at all
    const hidden = categoryId ? [] : await availability.foreignRaids(uid, checked.value, { config });
    // the picker shows and changes one character: its fields beside the entry's list
    const first = checked.value.characters[0];
    const one = first ? { character: first.character, spec: first.spec, versionId: first.versionId } : {};
    // categoryId stays the panel's: the picker's versions and the raid hub's switches hang on it
    const session = { ...checked.value, ...one, categoryId, characterKey: pick ? pick.key : "", hidden };
    const token = createSession(uid, session);
    return answer(picker(token, getSession(token, uid), config, lang));
}

/** The member's name as the orga reads it: the server nickname, else the Discord name. */
function displayName(interaction) {
    const member = interaction.member;
    const user = interaction.user || {};
    return String((member && (member.displayName || member.nick)) || user.globalName || user.username || "").trim();
}

/** The submitted guild bank modal: check, store and post it, answer the member. */
async function onGuildBankModal(interaction, categoryId, config, lang) {
    const read = (id) => {
        try {
            return String(interaction.fields.getTextInputValue(id) || "").trim();
        } catch {
            return "";
        }
    };
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await guildBank.createRequest(interaction.user.id, { item: read("item"), amount: read("amount"), purpose: read("purpose") }, {
        userName: displayName(interaction), categoryId, guildId: guildOf(interaction), config,
    });
    if (result.error) return interaction.editReply(answerPayload(`⚠️ ${serviceText(lang, result.error)}`, { lang }));
    return interaction.editReply(answerPayload(`✅ ${tr(lang, "Request sent – the orga will get back to you by DM.")}\n${requestSummary(result.request, lang)}`, { lang }));
}

/** The server an interaction ran on (#924: the guild bank channel is per server). */
const guildOf = (interaction) => String(interaction.guildId || (interaction.guild && interaction.guild.id) || "");

/**
 * Where an entry without a category counts: every category of the server the
 * command or button ran on. A DM or a server outside the server list never gets
 * this far (onServerList), so there is no "every server" entry from Discord.
 */
const commandScope = (interaction) => [{ guildId: guildOf(interaction), categoryIds: [] }];

/**
 * A panel's category together with its server. A category whose server cannot be
 * resolved is stored in the old form (no server: the category decides it, scopeOf).
 */
function panelScope(categoryId, config) {
    return [{ guildId: displayServerOf(categoryId, categoryContext(config)) || "", categoryIds: [categoryId] }];
}

/** Whether the interaction ran on a server of the server list - /availability without a category needs one. */
const onServerList = (interaction, config) => {
    const here = guildOf(interaction);
    return !!here && eventGuildIds(config).includes(here);
};
const notHereText = (lang) => tr(lang, "Please run this on the Discord server the absence or attendance is for – or enter it on the web under Signups.");

/** The guild bank offer for an organizer click: the clicked server's bank first, then the other servers'. */
const offerOf = (interaction, categoryId, config) => guildBank.offerFor({ guildIds: [interaction.guildId], categoryId, config });

/** "Make a request": the pick card when the bank offers something, else the free-text modal as before. */
function onGuildBankButton(interaction, categoryId, config, lang) {
    // a panel drawn before the channel was cleared still has the button
    const guildId = guildBank.requestGuildId({ guildId: guildOf(interaction), categoryId, config });
    if (!guildBank.guildBankChannelId(config, guildId)) return ephemeral(interaction, answerPayload(tr(lang, "The guild bank is not set up right now."), { lang }));
    const offer = offerOf(interaction, categoryId, config);
    if (offer.bank && offer.groups.length) return interaction.reply(pickPayload({ categoryId, bank: offer.bank, groups: offer.groups, lang }));
    return interaction.showModal(requestModal(categoryId, lang));
}

/** An item picked in the pick card: its modal — or a word that it is gone meanwhile. */
function onGuildBankPick(interaction, categoryId, config, lang) {
    const itemId = Number((interaction.values || [])[0]) || 0;
    const offer = offerOf(interaction, categoryId, config);
    const item = offer.bank ? offer.groups.flatMap((g) => g.items).find((it) => it.itemId === itemId) : null;
    if (!item) return ephemeral(interaction, answerPayload(`⚠️ ${serviceText(lang, guildBank.NOT_OFFERED)}`, { lang }));
    return interaction.showModal(itemModal({ categoryId, item, characters: guildBank.charactersFor(interaction.user.id, offer.bank), lang }));
}

/** The values of a select in a submitted modal, [] when it is missing (the character select shows only with two or more). */
function modalValues(interaction, id) {
    try {
        const f = interaction.fields;
        if (f && typeof f.getStringSelectValues === "function") return [...(f.getStringSelectValues(id) || [])];
    } catch {
        // not in this modal
    }
    return [];
}

/** The submitted item modal: check against the stock, store and post it, answer the member. */
async function onGuildBankItemModal(interaction, categoryId, config, lang) {
    const read = (id) => {
        try {
            return String(interaction.fields.getTextInputValue(id) || "").trim();
        } catch {
            return "";
        }
    };
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const offer = offerOf(interaction, categoryId, config);
    const result = await guildBank.createStockRequest(interaction.user.id, {
        bankKey: offer.bank ? offer.bank.key : "",
        itemId: itemIdOfModal(interaction.customId),
        amount: read("amount"),
        purpose: read("purpose"),
        characterKey: modalValues(interaction, "character")[0] || "",
    }, { userName: displayName(interaction), categoryId, guildId: guildOf(interaction), config });
    if (result.error) return interaction.editReply(answerPayload(`⚠️ ${serviceText(lang, result.error)}`, { lang }));
    // what went out as a request now and what waits (#775), each in its own block
    const parts = [];
    if (result.request) parts.push(`✅ ${tr(lang, "Request sent – the orga will get back to you by DM.")}\n${requestSummary(result.request, lang)}`);
    if (result.waiting) parts.push(`⏳ ${waitingSummary(result.waiting, result.position, lang, { portion: result.portion })}`);
    // no character of the bank's version: nothing to mail to, the orga cannot confirm it yet
    const stored = result.request || result.waiting;
    if (stored && !stored.characterName) parts.push(`⚠️ ${tr(lang, "Add a character in your profile, otherwise the orga cannot hand it out.")}`);
    // a character typed at a signup that no log, loot or armory knows: the mail could go nowhere
    else if (stored && linking.linkState(stored).linkProblem === "unverified") {
        parts.push(`⚠️ ${tr(lang, "Your character is not confirmed yet – add it in your profile from the logs or the armory, otherwise the orga cannot hand it out.")}`);
    }
    return interaction.editReply(answerPayload(parts.join("\n\n"), { lang }));
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

/** The raids the picker offers: those of the period, without the ones of categories the raider is no raider of (session.hidden). */
function offeredRaids(session, config) {
    const hidden = new Set(session.hidden || []);
    return availability.raidsInRange(session, { config }).filter((e) => !hidden.has(e.id));
}

function picker(token, session, config, lang, notice = "") {
    const raids = offeredRaids(session, config);
    const versions = versionsFor(session.categoryId, config);
    return pickerPayload(token, session, raids, { profile: profiles.getProfile(session.userId), versions, notice, lang });
}

/**
 * A picker opened before scopes existed has none: its panel's category, else the
 * server the click comes from (a DM or a server off the list stays without - the
 * service then refuses it). Changes the session in place.
 */
function withScope(session, interaction, config) {
    if (Array.isArray(session.scope) && session.scope.length) return;
    if (session.categoryId) session.scope = panelScope(session.categoryId, config);
    else if (onServerList(interaction, config)) session.scope = commandScope(interaction);
}

/** A step inside the picker. */
async function onPicker(interaction, token, action, lang) {
    const uid = interaction.user.id;
    const session = getSession(token, uid);
    if (!session) return interaction.update(answerUpdate(tr(lang, "This selection has expired – start again with the button or /availability."), { lang }));
    const config = settingsStore.getConfig();
    withScope(session, interaction, config);
    if (action === "x") {
        endSession(token);
        return interaction.update(answerUpdate(tr(lang, "Cancelled – nothing was saved."), { lang }));
    }
    // the attendance section was switched off while the picker was open (#969): nothing more is saved
    if (switchedOff(session.categoryId, "attendance")) {
        endSession(token);
        return interaction.update(answerUpdate(switchedOffText(lang), { lang }));
    }
    if (action === "c") {
        const [key, spec] = String((interaction.values || [])[0] || "").split("|");
        const option = characterOptions(profiles.getProfile(uid), versionsFor(session.categoryId, config))
            .find((o) => o.key === key && o.spec === spec);
        if (option) {
            const changedVersion = option.versionId !== session.versionId;
            Object.assign(session, {
                character: option.character, characterKey: option.key, spec: option.spec, versionId: option.versionId,
                // the one character the Discord picker carries (the web dialog takes several)
                characters: [{ character: option.character, spec: option.spec, versionId: option.versionId }],
            });
            // another game version has other raids: start from all of them again
            if (changedVersion) session.selected = null;
            saveSession(token, session);
        }
        return interaction.update(picker(token, session, config, lang));
    }
    if (action === "r") {
        session.selected = (interaction.values || []).map(String);
        saveSession(token, session);
        return interaction.update(picker(token, session, config, lang));
    }
    if (action === "save") {
        await interaction.deferUpdate();
        const input = { ...session };
        if (session.kind === "presence") {
            const first = (session.characters || [])[0] || {};
            input.characters = [{ character: session.characterKey || first.character || session.character, spec: session.spec || first.spec }];
        }
        // nothing picked by hand = every raid offered (the hidden ones of other categories stay out)
        const eventIds = session.selected || ((session.hidden || []).length ? offeredRaids(session, config).map((e) => e.id) : undefined);
        const result = await availability.createEntry(uid, input, { eventIds, config, via: "panel" });
        if (result.error) return interaction.editReply(picker(token, session, config, lang, `⚠️ ${serviceText(lang, result.error)}`));
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
        const config = settingsStore.getConfig();
        // without a category the entry counts on the server the command ran on: a DM or
        // a server outside the server list would mean every server - refused
        if (!interaction.customId) {
            if (!onServerList(interaction, config)) return ephemeral(interaction, answerPayload(notHereText(lang), { lang }));
            return ephemeral(interaction, listFor(uid, "", lang));
        }
        const { token, action, categoryId } = parseId(interaction.customId);
        if (token) return onPicker(interaction, token, action, lang);
        // the same for the buttons and modals of an older list without a category
        if (["a", "p", "ma", "mp"].includes(action) && !categoryId && !onServerList(interaction, config)) {
            return ephemeral(interaction, answerPayload(notHereText(lang), { lang }));
        }
        // A button of a section the orga switched off (#969) — an older panel message still shows it.
        if (!(action === "l" && fromEphemeral(interaction)) && switchedOff(categoryId, PANEL_FEATURES[action])) {
            return ephemeral(interaction, answerPayload(switchedOffText(lang), { lang }));
        }
        if (action === "a") return interaction.showModal(periodModal("absence", categoryId, lang));
        if (action === "p") {
            const versions = versionsFor(categoryId, config);
            if (!characterOptions(profiles.getProfile(uid), versions).length) return ephemeral(interaction, noCharacterPayload(lang));
            return interaction.showModal(periodModal("presence", categoryId, lang));
        }
        if (action === "ma" || action === "mp") return onModal(interaction, action === "ma" ? "absence" : "presence", categoryId, lang);
        if (action === "r") return ephemeral(interaction, myRaid(uid, categoryId, config, lang));
        if (action === "o") {
            // Walking the newest evaluations reads each report file once after a
            // start (a couple of MB each) — longer than Discord's three seconds,
            // so the click is acknowledged first and the answer follows.
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            return interaction.editReply(myReport(uid, lang));
        }
        if (action === "b") return onGuildBankButton(interaction, categoryId, config, lang);
        if (action === "bp") return onGuildBankPick(interaction, categoryId, config, lang);
        if (action === "mb") return onGuildBankModal(interaction, categoryId, config, lang);
        if (action === "mbi") return onGuildBankItemModal(interaction, categoryId, config, lang);
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
