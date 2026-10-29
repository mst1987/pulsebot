// What the buttons of the Orga-Zentrale answer (commands/event/orgaHubButton.js; the
// hub itself is services/events/orgaHub.js). "Links ..." and its follow-ups are
// orgaHubLinks.js; the rest of this head is "Raid anlegen" (`orga:new:<categoryId>`).
//
// It opens the create flow of /event anlegen (eventDraft.js) as an ephemeral
// message, with the hub's category already chosen. Who may: whoever may run
// /event (the gate in bot.js judges the button by `accessOf: "event"`, like the
// create flow's own selects) AND is the orga of this category — the global
// orga (an admin or an orga role, permissions.userIsOrga) or a manager of the
// category's roster - the rule the web shares (services/roster/categoryOrga.js).
// Everybody else gets a short refusal only they see.
//
// A part the orga switched off in the web (#969, orgaHubStore.getFeatures) answers
// a button of an older message with a short ephemeral note instead.
const { MessageFlags } = require("discord.js");
const { card } = require("../../utils/discord/card");
const { initialState, stepMessage, clearNamePattern } = require("./eventDraft");
const categoryOrga = require("../roster/categoryOrga");
const store = require("../../stores/orgaHubStore");

const links = require("./orgaHubLinks");

const DENIED = links.DENIED;
const SWITCHED_OFF = "Diese Funktion ist in dieser Orga-Zentrale ausgeschaltet.";

/** The hub part an action belongs to ("newRaid", "links"), "" for none. */
function featureOf(action) {
    if (action === "new") return "newRaid";
    if (links.LINK_ACTIONS.includes(action)) return "links";
    return "";
}

/** `{ action, categoryId }` of a customId `orga:<action>:<categoryId>`. */
function parseCustomId(customId) {
    const [, action = "", categoryId = ""] = String(customId || "").split(":");
    return { action, categoryId };
}

/** Whether the user is the orga of the category: global orga, or a manager of the roster it plays now. */
function isCategoryOrga(userId, categoryId, guildId) {
    return categoryOrga.isCategoryOrgaById(userId, categoryId, { guildId });
}

/** The button's answer: the create flow with the category chosen, or the refusal. */
async function openCreateFlow(interaction, guildId) {
    const { action, categoryId } = parseCustomId(interaction.customId);
    if (action !== "new" || !categoryId) return interaction.reply(card({ kind: "error", title: "Diese Aktion gibt es nicht.", ephemeral: true }));
    // The role lookup and the category's events can take longer than Discord's three seconds.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!(await isCategoryOrga(interaction.user && interaction.user.id, categoryId, guildId))) {
        return interaction.editReply(card({ kind: "error", title: DENIED }));
    }
    const userId = String((interaction.user && interaction.user.id) || "");
    clearNamePattern(userId); // a new flow starts with the derived name
    const { payload } = await stepMessage(guildId, initialState(guildId, categoryId), { userId });
    return interaction.editReply(payload);
}

/** Every `orga:` customId: "Raid anlegen" or one of the links' (orgaHubLinks.js). */
async function handleOrga(interaction, guildId) {
    const { action, categoryId } = parseCustomId(interaction.customId);
    const feature = featureOf(action);
    // one read of a small store before anything else: cheap enough before Discord's acknowledgement
    if (feature && categoryId && store.getFeatures(categoryId)[feature] === false) {
        return interaction.reply(card({ kind: "info", title: SWITCHED_OFF, ephemeral: true }));
    }
    if (links.LINK_ACTIONS.includes(action)) return links.handleLinkAction(interaction, guildId);
    return openCreateFlow(interaction, guildId);
}

module.exports = { handleOrga, openCreateFlow, isCategoryOrga, parseCustomId, featureOf, DENIED, SWITCHED_OFF };
