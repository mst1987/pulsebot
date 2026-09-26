// A button, select or modal that only hands the interaction on to its logic in
// src/web/ (#413): the module is just its name, its description, whose access
// it inherits and the handler. Lives directly in src/commands/, not in a
// subfolder, so the loaders do not take it for a command.
//
// With `guild` (the default) the interaction must come from the event server
// (services/events/eventDraft.js `guildFor`); the handler then gets `(interaction, guildId)`,
// otherwise the error is answered — as an ephemeral reply, or with
// `onGuildError: "update"` by replacing the message the component sits on.
const { MessageFlags } = require("discord.js");
const { guildFor } = require("../services/events/eventDraft");

function componentRoute({ name, description, accessOf, handler, guild = true, onGuildError = "reply" }) {
    return {
        name,
        description,
        accessOf,
        async execute(interaction) {
            if (!guild) return handler(interaction);
            const { guildId, error } = guildFor(interaction);
            if (error) {
                return onGuildError === "update"
                    ? interaction.update({ content: error, embeds: [], components: [] })
                    : interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
            }
            return handler(interaction, guildId);
        },
    };
}

module.exports = { componentRoute };
