// What the buttons of the Orga-Zentrale answer (commands/event/orgaHubButton.js; the
// hub itself is services/events/orgaHub.js). "Links ..." and its follow-ups are
// orgaHubLinks.js; the rest of this head is "Raid anlegen" (`orga:new:<categoryId>`).
//
// It opens the create flow of /event anlegen (eventDraft.js) as an ephemeral
// message, with the hub's category already chosen. Who may: whoever may run
// /event (the gate in bot.js judges the button by `accessOf: "event"`, like the
// create flow's own selects) AND is the orga of this category — the global
// orga (an admin or an orga role, permissions.userIsOrga) or a manager of the
// category's roster (rosterAccess.isRosterOrga). Everybody else gets a short
// refusal only they see.
const { MessageFlags } = require("discord.js");
const { card } = require("../../utils/discord/card");
const { initialState, stepMessage, clearNamePattern } = require("./eventDraft");
const { resolveAccess } = require("../discord/userAccess");
const { isRosterOrga } = require("../roster/rosterAccess");
const { currentRoster } = require("../roster/categoryRoster");

const links = require("./orgaHubLinks");

const DENIED = links.DENIED;

/** `{ action, categoryId }` of a customId `orga:<action>:<categoryId>`. */
function parseCustomId(customId) {
    const [, action = "", categoryId = ""] = String(customId || "").split(":");
    return { action, categoryId };
}

/** Whether the user is the orga of the category: global orga, or a manager of the roster it plays now. */
async function isCategoryOrga(userId, categoryId) {
    const user = { id: String(userId || ""), ...(await resolveAccess(userId)) };
    return isRosterOrga(user, currentRoster(categoryId));
}

/** The button's answer: the create flow with the category chosen, or the refusal. */
async function openCreateFlow(interaction, guildId) {
    const { action, categoryId } = parseCustomId(interaction.customId);
    if (action !== "new" || !categoryId) return interaction.reply(card({ kind: "error", title: "Diese Aktion gibt es nicht.", ephemeral: true }));
    // The role lookup and the category's events can take longer than Discord's three seconds.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!(await isCategoryOrga(interaction.user && interaction.user.id, categoryId))) {
        return interaction.editReply(card({ kind: "error", title: DENIED }));
    }
    const userId = String((interaction.user && interaction.user.id) || "");
    clearNamePattern(userId); // a new flow starts with the derived name
    const { payload } = await stepMessage(guildId, initialState(guildId, categoryId), { userId });
    return interaction.editReply(payload);
}

/** Every `orga:` customId: "Raid anlegen" or one of the links' (orgaHubLinks.js). */
async function handleOrga(interaction, guildId) {
    const { action } = parseCustomId(interaction.customId);
    if (links.LINK_ACTIONS.includes(action)) return links.handleLinkAction(interaction, guildId, isCategoryOrga);
    return openCreateFlow(interaction, guildId);
}

module.exports = { handleOrga, openCreateFlow, isCategoryOrga, parseCustomId, DENIED };
