const { MessageFlags } = require("discord.js");
const { evaluateLog, SECTION_LABEL } = require("../../services/logcheck/logChannel");
const { reportSummaryLines } = require("../../utils/logcheck/report");
const { forceButtonRow, refusalCard, resultCard, unsupportedCard } = require("./logevalForce");

// Button handler for the "CLA auswerten" / "RPB auswerten" buttons posted under a
// detected log. The customId carries the tracked log id and which half to run:
// logcheck-eval:<logId>:<section>. bot.js routes button customIds of the form
// "name:arg" to the command named "name", so the extra segment rides along.
// A missing third segment means an old (pre-split) button — treat it as CLA.
module.exports = {
    name: "logcheck-eval",
    description: "Wertet einen im Log-Channel erkannten Warcraft-Logs-Report aus (Button).",
    // A component of /logcheck: it needs the same access (services/discord/botAccess.js).
    accessOf: "logcheck",
    async execute(interaction) {
        const parts = (interaction.customId || "").split(":");
        const logId = parts[1] || "";
        const section = parts[2] === "rpb" ? "rpb" : "cla";
        const label = SECTION_LABEL[section] || section.toUpperCase();

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // the clicked message is the one under the log: a hint for logs that never stored theirs
        const button = { channelId: interaction.channelId, messageId: interaction.message && interaction.message.id };
        const res = await evaluateLog(logId, section, { button });
        if (!res.ok) {
            // The raid is still running: offer the deliberate way past instead of
            // a dead end. The button opens a confirmation modal (logevalForce.js).
            if (res.incomplete) {
                return interaction.editReply(refusalCard({ error: res.error }, {
                    title: "Raid noch nicht abgeschlossen",
                    buttons: [forceButtonRow("log", logId, section)],
                }));
            }
            // A version the log check has no rules for yet (#746): in the reader's language.
            if (res.unsupported) return interaction.editReply(unsupportedCard(interaction, res.versionId));
            return interaction.editReply(refusalCard(res));
        }

        // evaluateLog already redrew the message under the log (refreshLogButton)
        const summary = reportSummaryLines(res.report, section).join("\n");
        return interaction.editReply(resultCard({ label, reportTitle: res.report.title, summary, url: res.url }));
    },
};
