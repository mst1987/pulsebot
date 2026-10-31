const {
    MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require("discord.js");
const { card } = require("../../utils/discord/card");
const { evaluateLog, SECTION_LABEL } = require("../../services/logcheck/logChannel");
const { buildReport, reportSummaryLines, ReportError } = require("../../utils/logcheck/report");
const logStore = require("../../stores/loot/logStore");
const { tr } = require("../../utils/i18n/botText");
const { langOfInteraction } = require("../../services/discord/botLanguage");
const { versionLabel } = require("../../services/versions/versionSettings");

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
// "id" for a bare report id (ref = WCL report id, the /logcheck command). An
// "id" button carries the Warcraft-Logs host of the link as a fifth part
// (logcheck-force:id:<reportId>:all:<host>, #746), so the run asks the host the
// link was posted with instead of a fixed one.

const FORCE_PREFIX = "logcheck-force";
const CONFIRM_WORD = "JA";
const HOST_RE = /^([a-z0-9-]+\.)*warcraftlogs\.com$/;

/** customId for the confirm button under a refused evaluation. */
function forceCustomId(kind, ref, section, host) {
    const h = HOST_RE.test(String(host || "")) ? `:${host}` : "";
    return `${FORCE_PREFIX}:${kind}:${ref}:${section || "all"}${h}`;
}

/** Reads a customId back apart. */
function parseCustomId(customId) {
    const [, kind = "", ref = "", section = "all", host = ""] = String(customId || "").split(":");
    return { kind, ref, section, host: HOST_RE.test(host) ? host : "" };
}

/**
 * The card for a log of a version the log check has no rules for yet (#746),
 * in the reader's language.
 */
function unsupportedCard(interaction, versionId) {
    const lang = langOfInteraction(interaction);
    return card({
        kind: "warn",
        title: tr(lang, "Not evaluated yet"),
        text: tr(lang, "Logs from {version} are not evaluated yet.", { version: versionLabel(versionId) }),
    });
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
function forceButtonRow(kind, ref, section, host) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(forceCustomId(kind, ref, section, host))
            .setLabel("Trotzdem auswerten")
            .setStyle(ButtonStyle.Danger)
            .setEmoji("⚠️"),
    );
}

/** The "Zum Report" link button for a card, or nothing without a (valid) url. */
function reportLink(url) {
    return /^https?:\/\//.test(String(url || ""))
        ? [new ButtonBuilder().setLabel("Zum Report").setStyle(ButtonStyle.Link).setURL(String(url))]
        : [];
}

/** The card for a refused or failed evaluation; the link button points at the report when there is one. */
function refusalCard({ error, url }, { title = "Auswertung nicht möglich", buttons = [] } = {}) {
    return card({ kind: "warn", title, text: error, buttons: [...buttons, ...reportLink(url)] });
}

/** The card for a finished evaluation: the report title, the summary lines and the link to the report. */
function resultCard({ label, reportTitle, summary, url, note }) {
    return card({
        kind: "ok",
        title: label ? `${label} ausgewertet` : "Ausgewertet",
        text: `**${reportTitle}**\n${summary}`,
        note,
        buttons: reportLink(url),
    });
}

/**
 * The reason a refusal gave, read back from the message the "Trotzdem auswerten" button sits under: its plain text, or
 * for a card the text without the heading and the small lines (the modal shows it prefilled).
 */
function refusalStatus(message) {
    const plain = String((message && message.content) || "").replace(/^⚠️\s*/, "").trim();
    if (plain) return plain;
    const texts = [];
    const walk = (list) => {
        for (const c of Array.isArray(list) ? list : []) {
            const json = c && typeof c.toJSON === "function" ? c.toJSON() : c;
            if (!json) continue;
            if (json.type === 10 && typeof json.content === "string") texts.push(json.content);
            walk(json.components);
        }
    };
    walk(message && message.components);
    return texts.join("\n").split("\n").filter((l) => l.trim() && !/^(##|-#)\s/.test(l)).join("\n").trim();
}

/** Run the forced evaluation of a tracked log (evaluateLog redraws its message under the log). */
async function runForcedLog(interaction, logId, section) {
    const res = await evaluateLog(logId, section, { force: true });
    if (!res.ok && res.unsupported) return interaction.editReply(unsupportedCard(interaction, res.versionId));
    if (!res.ok) return interaction.editReply(refusalCard(res));

    const label = SECTION_LABEL[res.section] || res.section.toUpperCase();
    const summary = reportSummaryLines(res.report, res.section).join("\n");
    return interaction.editReply(resultCard({
        label, reportTitle: res.report.title, summary, url: res.url, note: "Der Raid war noch nicht abgeschlossen.",
    }));
}

/**
 * The link to run a bare report id with: on the host the button carries, else
 * the one of the log tracked under that id, else the id alone (buildReport then
 * takes TBC, #746).
 */
function forcedLink(reportId, host) {
    if (host) return `https://${host}/reports/${reportId}`;
    const tracked = logStore.getByReportId(reportId);
    return (tracked && tracked.link) || reportId;
}

/** Run the forced evaluation of a bare report id (the /logcheck path). */
async function runForcedReport(interaction, reportId, host) {
    let result;
    try {
        result = await buildReport(forcedLink(reportId, host), { force: true, guildId: interaction.guildId || "" });
    } catch (e) {
        if (e && e.unsupported) return interaction.editReply(unsupportedCard(interaction, e.versionId));
        if (e instanceof ReportError) return interaction.editReply(refusalCard({ error: e.message }));
        console.error("forced logcheck failed:", e);
        return interaction.editReply(card({ kind: "error", title: "Fehler", text: "Unerwarteter Fehler beim Erstellen der Auswertung." }));
    }
    const summary = reportSummaryLines(result.report).join("\n");
    return interaction.editReply(resultCard({
        reportTitle: result.report.title, summary, url: result.url, note: "Der Raid war noch nicht abgeschlossen.",
    }));
}

module.exports = {
    name: FORCE_PREFIX,
    description: "Bestätigt die Auswertung eines Logs, dessen Raid noch nicht abgeschlossen ist.",
    // A component of /logcheck: it needs the same access (services/discord/botAccess.js).
    accessOf: "logcheck",
    FORCE_PREFIX,
    CONFIRM_WORD,
    forceCustomId,
    parseCustomId,
    forceButtonRow,
    buildForceModal,
    refusalCard,
    resultCard,
    refusalStatus,
    unsupportedCard,
    forcedLink,

    async execute(interaction) {
        const { kind, ref, section, host } = parseCustomId(interaction.customId);
        if (!ref) return;

        // First half: the click. Ask before spending the analysis — and do it
        // without another API call, so the modal opens inside Discord's window.
        // The reason is taken from the refusal this button sits under; deriving
        // it again would mean fetching the fight list a second time.
        if (!interaction.isModalSubmit()) {
            const status = refusalStatus(interaction.message);
            return interaction.showModal(buildForceModal(interaction.customId, { section, status }));
        }

        // Second half: the submitted modal.
        const typed = (interaction.fields.getTextInputValue("confirm") || "").trim().toUpperCase();
        if (typed !== CONFIRM_WORD) {
            return interaction.reply(card({
                kind: "info", title: "Abgebrochen", text: `Zum Bestätigen muss **${CONFIRM_WORD}** eingetippt werden.`, ephemeral: true,
            }));
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (kind === "log") return runForcedLog(interaction, ref, section);
        return runForcedReport(interaction, ref, host);
    },
};
