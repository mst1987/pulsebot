// /report — the latest log evaluations, each linked to its report page (#265).
// Building one stays /logcheck; this only finds what exists.
const { SlashCommandBuilder } = require("discord.js");
const { listReports } = require("../../stores/reportStore");
const { prepareReportList } = require("../../web/reportList");
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
    data: new SlashCommandBuilder()
        .setName("report")
        .setDescription("Die letzten Log-Auswertungen mit Link"),
    MAX_REPORTS,
    progressText,
    async execute(interaction) {
        const { items, total } = prepareReportList(listReports(), { sort: "date", dir: "desc" }, { pageSize: MAX_REPORTS });
        if (!items.length) {
            return lookupReply(interaction, {
                title: "Letzte Auswertungen",
                description: "Noch keine Auswertung erstellt. Eine neue gibt es mit `/logcheck`.",
            });
        }
        const lines = items.map((r) => {
            const meta = [progressText(r.raids) || r.zone, discordTime(r.generatedAt, "d")].filter(Boolean).join(" · ");
            return `**[${clip(r.title || r.id, 80)}](${webUrl(`/r/${r.id}`)})**${meta ? `\n${meta}` : ""}`;
        });
        return lookupReply(interaction, {
            title: "Letzte Auswertungen",
            description: `**${plural(total, "Auswertung", "Auswertungen")}**\n\n${lines.join("\n\n")}`,
        }, [{ label: "Neueste öffnen", url: webUrl(`/r/${items[0].id}`) }]);
    },
};
