// /addons — the guild's own addons in short (#818): name, newest version and
// what it does, for the game version of the channel (or the one picked). Only
// the asking member sees the card; the files are never linked from Discord —
// the button opens the page "Addons" in the web, where the download needs a
// login (the files of private repos must not leak through a forwarded link).
const { SlashCommandBuilder } = require("discord.js");
const { getConfig } = require("../../stores/configStore");
const { addVersionOption, versionOfCommand, versionNote } = require("../../services/events/commandVersion");
const { userIsOrga } = require("../../config/permissions");
const { resolveAccess } = require("../../services/discord/userAccess");
const { enabledAddons, releaseFor } = require("../../services/addons/addonReleases");
const { webUrl, lookupReply, deferLookup, discordTime, clip } = require("../../utils/discord/botLookup");

/** The status of one addon as the card says it. */
function statusLine(result) {
    if (result.release) {
        const date = result.release.publishedAt ? discordTime(Date.parse(result.release.publishedAt), "d") : "";
        return `v${result.release.version}${date ? ` · ${date}` : ""}`;
    }
    if (result.state === "no_release") return "noch kein Release";
    return "gerade nicht verfügbar";
}

/**
 * The card (buildEmbed input) and its link for the addons of one version. Pure:
 * `entries` are `{ addon, result }` with releaseFor()'s result.
 */
function addonsCard(entries, versionId) {
    const footer = { text: versionNote(versionId) };
    const link = [{ label: "Zur Download-Seite", url: webUrl("/addon") }];
    if (!entries.length) {
        return { embed: { title: "Addons", description: "Für diese Version gibt es keine Addons zum Herunterladen.", footer }, link };
    }
    const lines = entries.map(({ addon, result }) => [
        `**${clip(addon.name, 60)}** · ${statusLine(result)}`,
        addon.description ? clip(addon.description, 200) : "",
    ].filter(Boolean).join("\n"));
    return {
        embed: {
            title: "Addons der Gilde",
            description: [...lines, "Herunterladen im Web, nach dem Login."].join("\n\n"),
            footer,
        },
        link,
    };
}

module.exports = {
    name: "addons",
    description: "Die Addons der Gilde mit Version und Link zur Download-Seite.",
    group: "signup",
    defaultAccess: "everyone",
    data: addVersionOption(new SlashCommandBuilder()
        .setName("addons")
        .setDescription("The guild's addons with their version and a link to the download page")
        .setDescriptionLocalizations({ de: "Die Addons der Gilde mit Version und Link zur Download-Seite" })),
    addonsCard,
    async execute(interaction) {
        await deferLookup(interaction);
        const config = getConfig();
        const { versionId } = versionOfCommand(interaction, { config });
        // orga-only addons only for the orga; a failed role lookup falls back to the base access (= not orga)
        const hasOrgaOnly = enabledAddons(config, versionId, { orga: true }).some((a) => a.orgaOnly);
        const orga = hasOrgaOnly && userIsOrga(await resolveAccess(interaction.user.id));
        const addons = enabledAddons(config, versionId, { orga });
        const results = await Promise.all(addons.map((addon) => releaseFor(addon, { config })));
        const { embed, link } = addonsCard(addons.map((addon, i) => ({ addon, result: results[i] })), versionId);
        return lookupReply(interaction, embed, link);
    },
};
