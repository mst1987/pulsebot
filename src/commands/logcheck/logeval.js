const { evaluateLog, SECTION_LABEL } = require("../../web/logChannel");
const { reportSummaryLines } = require("../../utils/logcheck/report");
const { forceButtonRow } = require("./logevalForce");
const logStore = require("../../web/logStore");
const discord = require("../../web/discord");

// Button handler for the "CLA auswerten" / "RPB auswerten" buttons posted under a
// detected log. The customId carries the tracked log id and which half to run:
// logcheck-eval:<logId>:<section>. bot.js routes button customIds of the form
// "name:arg" to the command named "name", so the extra segment rides along.
// A missing third segment means an old (pre-split) button — treat it as CLA.
module.exports = {
    name: "logcheck-eval",
    description: "Wertet einen im Log-Channel erkannten Warcraft-Logs-Report aus (Button).",
    async execute(interaction) {
        const parts = (interaction.customId || "").split(":");
        const logId = parts[1] || "";
        const section = parts[2] === "rpb" ? "rpb" : "cla";
        const label = SECTION_LABEL[section] || section.toUpperCase();

        await interaction.deferReply({ ephemeral: true });

        const res = await evaluateLog(logId, section);
        if (!res.ok) {
            // The raid is still running: offer the deliberate way past instead of
            // a dead end. The button opens a confirmation modal (logevalForce.js).
            if (res.incomplete) {
                return interaction.editReply({
                    content: `⚠️ ${res.error}`,
                    components: [forceButtonRow("log", logId, section)],
                });
            }
            const suffix = res.url ? `\n🔗 ${res.url}` : "";
            return interaction.editReply({ content: `⚠️ ${res.error}${suffix}` });
        }

        // Refresh the button message: the finished half loses its button, the other
        // one stays clickable, and the report link is added.
        const log = res.log || {};
        try {
            await discord.finishLogButton(
                log.buttonChannelId || interaction.channelId,
                log.buttonMessageId || (interaction.message && interaction.message.id),
                {
                    reportUrl: res.url,
                    title: res.report.title,
                    logId: log.id || logId,
                    doneSections: logStore.evaluatedSections(log),
                },
            );
        } catch (e) {
            console.error("finishLogButton (button) failed:", e.message);
        }

        const summary = reportSummaryLines(res.report, section).join("\n");
        return interaction.editReply({
            content: `✅ **${label}** ausgewertet: **${res.report.title}**\n${summary}\n🔗 ${res.url}`,
        });
    },
};
