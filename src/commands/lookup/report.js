// /report — the latest log evaluations, each linked to its report page (#265).
// Building one stays /logcheck; this only finds what exists.
const { SlashCommandBuilder } = require("discord.js");
const { listReports } = require("../../stores/reportStore");
const { listLogs } = require("../../stores/logStore");
const { reportsOfGuild } = require("../../services/logcheck/reportGuild");
const { prepareReportList } = require("../../services/logcheck/reportList");
const { recordVersion } = require("../../services/logcheck/logVersion");
const { addVersionOption, versionOfCommand, versionNote } = require("../../services/versions/commandVersion");
const { webUrl, lookupReply, discordTime, clip, plural } = require("../../utils/discord/botLookup");

/** How many evaluations the reply lists. */
const MAX_REPORTS = 5;

/** "Hyjal 5/5 · BT 3/9" — how far each raid of the log got, "" when unknown. */
function progressText(raids) {
    return (Array.isArray(raids) ? raids : [])
        .filter((r) => r && r.label)
        .map((r) => (r.total ? `${r.label} ${r.killed}/${r.total}` : r.label))
        .join(" · ");
}

module.exports = {
    name: "report",
    description: "Die letzten Log-Auswertungen mit Link.",
    group: "logs",
    defaultAccess: "everyone",
    data: addVersionOption(new SlashCommandBuilder()
        .setName("report")
        .setDescription("Die letzten Log-Auswertungen mit Link")),
    MAX_REPORTS,
    progressText,
    async execute(interaction) {
        const { versionId } = versionOfCommand(interaction);
        const footer = { text: versionNote(versionId) };
        // only the evaluations of the server the command runs on (#920): a report follows its log, else the
        // server it was made on - never another server's
        const guildId = interaction.guildId || (interaction.guild && interaction.guild.id) || "";
        const reports = reportsOfGuild(listReports(), guildId, listLogs()).filter((r) => recordVersion(r) === versionId);
        const { items, total } = prepareReportList(reports, { sort: "date", dir: "desc" }, { pageSize: MAX_REPORTS });
        if (!items.length) {
            return lookupReply(interaction, {
                footer,
                title: "Letzte Auswertungen",
                description: "Noch keine Auswertung erstellt. Eine neue gibt es mit `/logcheck`.",
            });
        }
        const lines = items.map((r) => {
            const meta = [progressText(r.raids) || r.zone, discordTime(r.generatedAt, "d")].filter(Boolean).join(" · ");
            return `**[${clip(r.title || r.id, 80)}](${webUrl(`/r/${r.id}`)})**${meta ? `\n${meta}` : ""}`;
        });
        return lookupReply(interaction, {
            footer,
            title: "Letzte Auswertungen",
            description: `**${plural(total, "Auswertung", "Auswertungen")}**\n\n${lines.join("\n\n")}`,
        }, [{ label: "Neueste öffnen", url: webUrl(`/r/${items[0].id}`) }]);
    },
};
