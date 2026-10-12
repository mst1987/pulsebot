// What "Raid anlegen" on the Orga-Zentrale answers (customId `orga:new:<categoryId>`,
// commands/event/orgaHubButton.js; the hub itself is services/events/orgaHub.js).
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
const { initialState, stepMessage } = require("./eventDraft");
const { resolveAccess } = require("../discord/userAccess");
const { isRosterOrga } = require("../roster/rosterAccess");
const { currentRoster } = require("../roster/categoryRoster");

const DENIED = "Dafür fehlt dir das Recht.";

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
    const { payload } = await stepMessage(guildId, initialState(guildId, categoryId));
    return interaction.editReply(payload);
}

module.exports = { openCreateFlow, isCategoryOrga, parseCustomId, DENIED };
