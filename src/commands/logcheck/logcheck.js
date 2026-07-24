const { buildReport, reportSummaryLines, ReportError } = require("../../utils/logcheck/report");
const { botEditReply } = require("../../utils/helper");

module.exports = {
    name: "logcheck",
    description: "Prüft einen Warcraft-Logs-Report: Gear, Consumables, Drums, Potions, Shadow-Resi.",
    async execute(interaction) {
        const link = interaction.options.getString("link");

        await interaction.deferReply({ ephemeral: false });

        let result;
        try {
            result = await buildReport(link);
        } catch (e) {
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
