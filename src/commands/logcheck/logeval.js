const { evaluateLog } = require("../../web/logChannel");
const discord = require("../../web/discord");

// Button handler for the "Log auswerten" button posted under a detected log.
// The tracked log id is carried in the customId after the ":" (logcheck-eval:<id>).
// bot.js routes button customIds of the form "name:arg" to the command named "name".
module.exports = {
    name: "logcheck-eval",
    description: "Wertet einen im Log-Channel erkannten Warcraft-Logs-Report aus (Button).",
    async execute(interaction) {
        const logId = (interaction.customId || "").split(":")[1] || "";

        await interaction.deferReply({ ephemeral: true });

        const res = await evaluateLog(logId);
        if (!res.ok) {
            const suffix = res.url ? `\n🔗 ${res.url}` : "";
            return interaction.editReply({ content: `⚠️ ${res.error}${suffix}` });
        }

        // Update the button message (this very message, tracked ids as fallback) to "done".
        const log = res.log || {};
        try {
            await discord.finishLogButton(
                log.buttonChannelId || interaction.channelId,
                log.buttonMessageId || (interaction.message && interaction.message.id),
                { reportUrl: res.url, title: res.report.title }
            );
        } catch (e) {
            console.error("finishLogButton (button) failed:", e.message);
        }

        return interaction.editReply({
            content: `✅ Ausgewertet: **${res.report.title}**\n🔗 ${res.url}`,
        });
    },
};
