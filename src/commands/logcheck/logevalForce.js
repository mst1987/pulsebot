const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require("discord.js");
const { evaluateLog, SECTION_LABEL } = require("../../web/logChannel");
const { buildReport, reportSummaryLines, ReportError } = require("../../utils/logcheck/report");
const logStore = require("../../web/logStore");
const discord = require("../../web/discord");

// "Trotzdem auswerten" — the deliberate way past the guard that refuses to
// evaluate a raid whose final boss is not down yet (see utils/logcheck/
// raidProgress.js).
//
// Two interactions share this handler, because bot.js routes on the customId
// prefix before the first ":" and both carry the same one:
//
//   button       logcheck-force:<kind>:<ref>:<section>   → opens the modal
//   modal submit logcheck-force:<kind>:<ref>:<section>   → runs the evaluation
//
// The button cannot start the evaluation itself: the modal has to be the reply
// to an interaction, and a deferred one can no longer show it. So the click
// opens the modal, and submitting the modal — typing JA — is the confirmation.
//
// `kind` is "log" for a tracked log (ref = log id, the log-channel buttons) or
// "id" for a bare report id (ref = WCL report id, the /logcheck command).

const FORCE_PREFIX = "logcheck-force";
const CONFIRM_WORD = "JA";

/** customId for the confirm button under a refused evaluation. */
function forceCustomId(kind, ref, section) {
    return `${FORCE_PREFIX}:${kind}:${ref}:${section || "all"}`;
}

/** Reads a customId back apart. */
function parseCustomId(customId) {
    const [, kind = "", ref = "", section = "all"] = String(customId || "").split(":");
    return { kind, ref, section };
}

/**
 * The modal shown before a forced evaluation. The first field is the reason the
 * guard refused, prefilled and not read back — a modal has no way to show plain
 * text, and the person confirming should see what they are overriding.
 */
function buildForceModal(customId, { section, status }) {
    const label = section === "all" ? "Auswertung" : `${SECTION_LABEL[section] || section.toUpperCase()}-Auswertung`;
    return new ModalBuilder()
        .setCustomId(customId)
        .setTitle("Raid noch nicht abgeschlossen")
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("status")
                    .setLabel("Das sagt der Log")
                    .setStyle(TextInputStyle.Paragraph)
                    .setValue((status || "Der Raid sieht noch nicht abgeschlossen aus.").slice(0, 4000))
                    .setRequired(false),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("confirm")
                    .setLabel(`${label} trotzdem starten?`)
                    .setPlaceholder(`Zum Bestätigen ${CONFIRM_WORD} eintippen`)
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(10)
                    .setRequired(true),
            ),
        );
}

/** The confirm button offered under a refusal, ready to be attached to a reply. */
function forceButtonRow(kind, ref, section) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(forceCustomId(kind, ref, section))
            .setLabel("Trotzdem auswerten")
            .setStyle(ButtonStyle.Danger)
            .setEmoji("⚠️"),
    );
}

/** Run the forced evaluation of a tracked log and refresh its button message. */
async function runForcedLog(interaction, logId, section) {
    const res = await evaluateLog(logId, section, { force: true });
    if (!res.ok) {
        const suffix = res.url ? `\n🔗 ${res.url}` : "";
        return interaction.editReply({ content: `⚠️ ${res.error}${suffix}` });
    }

    const log = res.log || {};
    try {
        await discord.finishLogButton(log.buttonChannelId, log.buttonMessageId, {
            reportUrl: res.url,
            title: res.report.title,
            logId: log.id || logId,
            doneSections: logStore.evaluatedSections(log),
        });
    } catch (e) {
        console.error("finishLogButton (force) failed:", e.message);
    }

    const label = SECTION_LABEL[res.section] || res.section.toUpperCase();
    const summary = reportSummaryLines(res.report, res.section).join("\n");
    return interaction.editReply({
        content: `✅ **${label}** ausgewertet (Raid war noch nicht abgeschlossen): **${res.report.title}**\n${summary}\n🔗 ${res.url}`,
    });
}

/** Run the forced evaluation of a bare report id (the /logcheck path). */
async function runForcedReport(interaction, reportId) {
    let result;
    try {
        result = await buildReport(`https://classic.warcraftlogs.com/reports/${reportId}`, { force: true });
    } catch (e) {
        if (e instanceof ReportError) return interaction.editReply({ content: `⚠️ ${e.message}` });
        console.error("forced logcheck failed:", e);
        return interaction.editReply({ content: "⚠️ Unerwarteter Fehler beim Erstellen der Auswertung." });
    }
    const summary = reportSummaryLines(result.report).join("\n");
    return interaction.editReply({
        content: `✅ Ausgewertet (Raid war noch nicht abgeschlossen): **${result.report.title}**\n${summary}\n🔗 ${result.url}`,
    });
}

module.exports = {
    name: FORCE_PREFIX,
    description: "Bestätigt die Auswertung eines Logs, dessen Raid noch nicht abgeschlossen ist.",
    FORCE_PREFIX,
    CONFIRM_WORD,
    forceCustomId,
    parseCustomId,
    forceButtonRow,
    buildForceModal,

    async execute(interaction) {
        const { kind, ref, section } = parseCustomId(interaction.customId);
        if (!ref) return;

        // First half: the click. Ask before spending the analysis — and do it
        // without another API call, so the modal opens inside Discord's window.
        // The reason is taken from the refusal this button sits under; deriving
        // it again would mean fetching the fight list a second time.
        if (!interaction.isModalSubmit()) {
            const status = (interaction.message && interaction.message.content || "")
                .replace(/^⚠️\s*/, "")
                .trim();
            return interaction.showModal(buildForceModal(interaction.customId, { section, status }));
        }

        // Second half: the submitted modal.
        const typed = (interaction.fields.getTextInputValue("confirm") || "").trim().toUpperCase();
        if (typed !== CONFIRM_WORD) {
            return interaction.reply({
                content: `Abgebrochen — zum Bestätigen muss **${CONFIRM_WORD}** eingetippt werden.`,
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });
        if (kind === "log") return runForcedLog(interaction, ref, section);
        return runForcedReport(interaction, ref);
    },
};
