// "Kanal umbenennen …" under the confirmation of /event anlegen: a button that
// opens a modal with the channel's actual name, the submit renames the channel.
//
//   button / modal   event-rename:<channelId>
//
// The channel id comes back from the client, so it is read as untrusted: only a
// channel that exists on the event server *and* sits in one of the event
// categories can be renamed here (the button is no way to rename any channel).
// Access: the router has already checked the rule of /event (accessOf); on top
// of that the rename needs `channels` write — the area that gates renaming in
// the web (PATCH /api/channels) — so the button gives nobody more than the menu.
// That right is a role lookup at Discord, too slow to sit in front of the modal (it must
// open within three seconds): the button opens the modal, the *submit* acknowledges and
// then checks the right, and nothing is renamed without it.

const { ActionRowBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const { card } = require("../../utils/discord/card");
const { clip } = require("../../utils/discord/botLookup");
const { isSnowflake } = require("../../utils/ids");
const { normalizeChannelName, CHANNEL_NAME_MAX } = require("../../utils/channelNames");
const discord = require("../discord/discord");
const discordChannels = require("../discord/discordChannels");
const { userMayAny } = require("../discord/userAccess");
const { RENAME_PREFIX, eventCategories } = require("./eventDraft");

const FIELD = "name";

/** The channel id of an `event-rename:<id>` customId, "" for anything else. */
function channelIdOf(customId) {
    const [prefix, id = ""] = String(customId || "").split(":");
    return prefix === RENAME_PREFIX && isSnowflake(id) ? id : "";
}

/** `{ channel }` of the event server's cache, or `{ error }` when it is not one this flow may rename. */
function renamable(guildId, channelId) {
    if (!channelId) return { error: "Den Kanal gibt es nicht." };
    const channel = (discord.listAllChannels(guildId) || []).find((c) => String(c.id) === channelId);
    if (!channel) return { error: "Den Kanal gibt es nicht mehr." };
    const inEventCategory = eventCategories(guildId).some((c) => c.id === String(channel.parentId || ""));
    if (!inEventCategory) return { error: "Dieser Kanal liegt nicht in einer Event-Kategorie." };
    return { channel };
}

/** The modal with one field, prefilled with the channel's name. */
function renameModal(channel) {
    const field = new TextInputBuilder()
        .setCustomId(FIELD)
        .setLabel("Neuer Kanalname")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(CHANNEL_NAME_MAX)
        .setValue(String(channel.name || "").slice(0, CHANNEL_NAME_MAX));
    return new ModalBuilder()
        .setCustomId(`${RENAME_PREFIX}:${channel.id}`)
        .setTitle("Kanal umbenennen")
        .addComponents(new ActionRowBuilder().addComponents(field));
}

/**
 * The button opens the modal, the modal submit renames. Returns after having
 * answered the interaction.
 */
async function handleRename(interaction, guildId) {
    const channelId = channelIdOf(interaction.customId);
    const denied = "Zum Umbenennen von Kanälen fehlt dir das Recht „Kanäle“ (Schreiben).";

    if (!interaction.isModalSubmit()) {
        // The button has to answer with the modal within three seconds, and the right is a role lookup
        // at Discord (userMayAny) — so the modal opens first and the *submit* checks the right before
        // anything is renamed. Nobody gains anything by seeing the modal.
        const found = renamable(guildId, channelId);
        if (found.error) return interaction.reply(card({ kind: "error", title: found.error, ephemeral: true }));
        return interaction.showModal(renameModal(found.channel));
    }

    // Acknowledge first, then check; every refusal is an edit of that reply.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const refuse = (title, kind = "error") => interaction.editReply(card({ kind, title }));
    if (!(await userMayAny(interaction.user.id, ["channels"], "write"))) return refuse(denied, "warn");
    const found = renamable(guildId, channelId);
    if (found.error) return refuse(found.error);

    const name = normalizeChannelName(interaction.fields.getTextInputValue(FIELD));
    if (!name) return refuse("Daraus ergibt sich kein gültiger Kanalname.");
    if (name === found.channel.name) return refuse("Der Kanal heißt schon so.", "info");
    const taken = (discord.listAllChannels(guildId) || []).some((c) => String(c.id) !== channelId && String(c.name).toLowerCase() === name);
    if (taken) return refuse(`Einen Kanal **${clip(name, 80)}** gibt es schon.`, "warn");

    try {
        const edited = await discordChannels.editChannel(channelId, { name });
        return interaction.editReply(card({ kind: "ok", title: "Kanal umbenannt", text: `<#${channelId}> heißt jetzt \`${clip(edited.name || name, 100)}\`.` }));
    } catch (e) {
        return interaction.editReply(card({ kind: "error", title: "Nicht umbenannt", text: clip(discordChannels.discordErrorText(e), 300) }));
    }
}

module.exports = { channelIdOf, renamable, renameModal, handleRename };
