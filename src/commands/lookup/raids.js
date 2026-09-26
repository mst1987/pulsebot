// /raids — the next raids and where the asking user stands in each (issue #265).
const { SlashCommandBuilder } = require("discord.js");
const { listEvents, statusOf, STATUS_LABELS, STATUS_ICONS } = require("../../services/events/eventLookup");
const { webUrl, lookupReply, deferLookup, discordTime, clip } = require("../../utils/discord/botLookup");

/** How many raids the reply lists. */
const MAX_RAIDS = 8;

/** One raid as a line: title, start, and the user's own status. */
function raidLine(event, userId) {
    const status = statusOf(event, userId);
    const mine = status ? `${STATUS_ICONS[status]} ${STATUS_LABELS[status]}` : "⚪ nicht reagiert";
    const channel = event.channelId ? ` · <#${event.channelId}>` : "";
    return `**${clip(event.title || "Raid", 80)}** · ${discordTime(event.startTime, "f")}${channel}\n${mine}`;
}

module.exports = {
    name: "raids",
    description: "Deine nächsten Raids und ob du angemeldet bist.",
    group: "raids",
    defaultAccess: "everyone",
    data: new SlashCommandBuilder()
        .setName("raids")
        .setDescription("Deine nächsten Raids und dein Anmeldestatus"),
    MAX_RAIDS,
    async execute(interaction) {
        await deferLookup(interaction);
        const { events, error } = await listEvents();
        const now = Date.now() / 1000;
        const upcoming = events.filter((ev) => (ev.startTime || 0) >= now - 3 * 3600);
        const link = [{ label: "Im Web öffnen", url: webUrl("/raids") }];
        if (!upcoming.length) {
            return lookupReply(interaction, {
                title: "Nächste Raids",
                description: error ? `Die Raids konnten nicht geladen werden: ${clip(error, 200)}` : "Keine Raids geplant.",
            }, link);
        }
        const userId = interaction.user.id;
        const open = upcoming.filter((ev) => !statusOf(ev, userId)).length;
        const shown = upcoming.slice(0, MAX_RAIDS);
        const more = upcoming.length - shown.length;
        return lookupReply(interaction, {
            title: "Nächste Raids",
            description: [
                open ? `**${open} ohne Antwort von dir**` : "**Überall geantwortet**",
                "",
                shown.map((ev) => raidLine(ev, userId)).join("\n\n"),
                more > 0 ? `\n… und ${more} weitere` : "",
            ].join("\n").trim(),
        }, link);
    },
};
