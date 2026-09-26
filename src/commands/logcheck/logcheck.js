const { SlashCommandBuilder } = require("discord.js");
const WarcraftLogs = require("../../classes/warcraftlogs");
const { buildReport, reportSummaryLines, ReportError } = require("../../utils/logcheck/report");
const { forceButtonRow } = require("./logevalForce");
const { botEditReply } = require("../../utils/discord/reply");

module.exports = {
    name: "logcheck",
    description: "Prüft einen Warcraft-Logs-Report: Gear, Consumables, Drums, Potions, Shadow-Resi.",
    group: "logs",
    defaultAccess: "everyone",
    data: new SlashCommandBuilder()
        .setName("logcheck")
        .setDescription("Prüft einen Warcraft-Logs-Report auf Gear-Probleme (Verzauberungen, Edelsteine)")
        .addStringOption((o) => o.setName("link").setDescription("Warcraft-Logs-Report-Link oder Report-ID").setRequired(true)),
    async execute(interaction) {
        const link = interaction.options.getString("link");

        await interaction.deferReply();

        let result;
        try {
            result = await buildReport(link);
        } catch (e) {
            // A raid that is still running is not an error but a question: the
            // button under the refusal opens the confirmation modal that runs it
            // anyway (see logevalForce.js).
            if (e && e.incomplete) {
                const reportId = WarcraftLogs.parseReportId(link);
                return interaction.editReply({
                    content: `⚠️ ${e.message}`,
                    components: reportId ? [forceButtonRow("id", reportId, "all")] : [],
                });
            }
            if (e instanceof ReportError) return botEditReply(interaction, "Fehler", e.message);
            console.error("logcheck failed:", e);
            return botEditReply(interaction, "Fehler", "Unerwarteter Fehler beim Erstellen der Auswertung.");
        }

        const lines = reportSummaryLines(result.report).join("\n");
        return botEditReply(
            interaction,
            `Log-Check: ${result.report.title}`,
            `${lines}\n\n🔗 **Auswertung:** ${result.url}`,
            0,
            false
        );
    },
};
