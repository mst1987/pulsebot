// The game version a Discord lookup command answers for (#743). TBC and Forever
// run on the SAME Discord server, so the version never comes from the server:
//
//   1. the optional `version` choice of the command, when given
//   2. the version of the category of the channel the command runs in (a thread
//      counts as its parent channel's category)
//   3. outside a raid category: the main version
//
// A version the orga hid (config.hideOtherVersions, #563) is never answered
// for: it falls back to the main version, like every list does. The answer
// names the version (`versionNote`).
const { VERSIONS } = require("../../config/gameVersions");
const { knownVersion, mainVersionFor, versionOfEvent, isVersionVisible } = require("./mainVersion");
const { versionLabel } = require("./versionSettings");

/** The name of the choice option every lookup command carries. */
const VERSION_OPTION = "version";

/** Adds the optional `version` choice (every game version) to a command or subcommand builder. */
function addVersionOption(builder) {
    return builder.addStringOption((o) => o.setName(VERSION_OPTION)
        .setDescription("Spielversion (Standard: die Version dieser Kategorie)")
        .addChoices(...VERSIONS.map((v) => ({ name: v.label, value: v.id }))));
}

/** The id of the category a channel hangs in; a thread counts as the channel it hangs off. "" without one. */
function categoryIdOfChannel(channel, guild) {
    if (!channel) return "";
    const isThread = typeof channel.isThread === "function" && channel.isThread();
    if (!isThread) return String(channel.parentId || (channel.parent && channel.parent.id) || "");
    let parent = channel.parent;
    if (!parent && channel.parentId && guild && guild.channels && guild.channels.cache && typeof guild.channels.cache.get === "function") {
        parent = guild.channels.cache.get(channel.parentId);
    }
    return String((parent && (parent.parentId || (parent.parent && parent.parent.id))) || "");
}

/**
 * The version a command answers for.
 * @param {object} interaction
 * @param {{ config?: object }} [opts]
 * @returns {{ versionId: string, explicit: boolean, categoryId: string }}
 */
function versionOfCommand(interaction, { config } = {}) {
    const options = (interaction && interaction.options) || {};
    const asked = typeof options.getString === "function" ? knownVersion(options.getString(VERSION_OPTION)) : "";
    const categoryId = categoryIdOfChannel(interaction && interaction.channel, interaction && interaction.guild);
    const wanted = asked || mainVersionFor({ categoryId, config });
    const versionId = isVersionVisible(wanted, config) ? wanted : mainVersionFor({ config });
    return { versionId, explicit: !!asked, categoryId };
}

/** `events` of one version (their stored version, versionOfEvent). */
function eventsOfVersion(events, versionId, { config } = {}) {
    return (events || []).filter((e) => versionOfEvent(e, { config }) === versionId);
}

/** "Version: WoW Forever" - the line a reply names its version with. */
function versionNote(versionId) {
    return `Version: ${versionLabel(versionId)}`;
}

module.exports = { VERSION_OPTION, addVersionOption, categoryIdOfChannel, versionOfCommand, eventsOfVersion, versionNote };
