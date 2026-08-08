const { ChannelType, ThreadAutoArchiveDuration } = require("discord.js");
const { pendingApplications } = require("../../utils/applicationState");
const { applyArmoryUrlTemplate, applyWclUrlTemplate } = require("../../config/variables");
// applicationChannelId + officerRoleId come from the admin-editable config (no restart).
const { getConfig } = require("../../web/settingsStore");
const { getClass } = require("../../config/applyClasses");
const WarcraftLogs = require("../../classes/warcraftlogs");
const { analyzeApplicant } = require("../../utils/logcheck/applicant");

function buildApplicantEmbeds(characterName, analysis) {
    const embeds = [];

    // 1) parse overview (best percentile per boss, current content)
    const ov = analysis.overview
        .map((p) => `\`${String(Math.round(p.percentile)).padStart(3)}%\` ${p.encounterName} — ${p.spec} (${Math.round(p.total)} dps)`)
        .join("\n");
    embeds.push({
        title: `📊 Parse-Übersicht — ${characterName}`,
        description: ov || "Keine Parses gefunden.",
        color: 0x3498db,
    });

    // 2) CLA analysis of the last raid
    const last = analysis.last;
    const reportUrl = `https://fresh.warcraftlogs.com/reports/${last.reportID}`;
    const date = new Date(last.startTime).toLocaleDateString("de-DE");
    const rel = new Set(analysis.relevant || []);
    const pots = analysis.potions || { destruction: 0, haste: 0, mana: 0 };
    const potLine = [["Destruction", "destruction"], ["Haste", "haste"], ["Mana", "mana"]]
        .map(([label, key]) => (rel.has(key) ? `**${label}: ${pots[key] || 0}** ✅` : `${label}: ${pots[key] || 0}`))
        .join(" · ");
    const c = analysis.consumables;
    const consLine = c
        ? `Flask ${c.flask}% · Elixiere ${c.elixir}% · Food ${c.food}% · Waffe ${c.weaponOiled ? "geölt ✅" : "nicht geölt ⚠️"}`
        : "keine Daten";
    const gi = analysis.gearIssues || [];
    const giLine = gi.length
        ? gi.map((i) => `• ${i.itemName} [${i.label}]`).join("\n").slice(0, 1000)
        : "✅ keine Gear-Probleme";

    embeds.push({
        title: `🔍 Log-Check — letzter Raid (${date})`,
        url: reportUrl,
        color: gi.length ? 0xe0a23a : 0x2ecc71,
        fields: [
            { name: "⚗️ Potions (✅ = passend für Spec)", value: potLine, inline: false },
            { name: "🧪 Consumables", value: consLine, inline: false },
            { name: "🛡️ Gear / Enchants", value: giLine, inline: false },
        ],
        footer: { text: `Report: ${last.reportID}` },
    });

    return embeds;
}

// Discord rejects the whole message when a single embed field value exceeds 1024
// characters — the modal allows up to 1500, so cut before the API does.
const FIELD_LIMIT = 1024;
function truncate(value, limit = FIELD_LIMIT) {
    const text = String(value ?? "");
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function getEmojiString(guildEmojis, iconName) {
    if (!guildEmojis || !iconName) return "";
    const emoji = guildEmojis.find((e) => e.name.toLowerCase() === iconName.toLowerCase());
    return emoji ? `<:${emoji.name}:${emoji.id}> ` : "";
}

module.exports = {
    name: "apply-modal",
    description: "Bewerbungs-Modal Submit",
    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true });

        const characterName = interaction.fields.getTextInputValue("characterName");
        let armoryLink = interaction.fields.getTextInputValue("armoryLink") || "";
        let logsLink = interaction.fields.getTextInputValue("logsLink") || "";
        const description = interaction.fields.getTextInputValue("description") || "";

        // auto-fill missing links from the configured templates ({char} placeholder)
        const fillTemplate = (tpl) => tpl.replace("{char}", encodeURIComponent(characterName.trim()));
        let armoryAuto = false;
        let logsAuto = false;
        if (!armoryLink && applyArmoryUrlTemplate) { armoryLink = fillTemplate(applyArmoryUrlTemplate); armoryAuto = true; }
        if (!logsLink && applyWclUrlTemplate) { logsLink = fillTemplate(applyWclUrlTemplate); logsAuto = true; }

        const pending = pendingApplications.get(interaction.user.id) || {};
        pendingApplications.delete(interaction.user.id);

        const guildEmojis = interaction.guild?.emojis.cache;
        const cls = getClass(pending.class);
        const classSpec = pending.className
            ? `${getEmojiString(guildEmojis, cls ? cls.icon : "")}${pending.className}${pending.spec ? ` – ${pending.spec}` : ""}`
            : "Unbekannt";
        const threadTitle = pending.spec ? `${pending.spec} - ${characterName}` : characterName;

        let thread = null;
        try {
            const { applicationChannelId, officerRoleId } = getConfig();
            const channel = await client.channels.fetch(applicationChannelId);
            thread = await channel.threads.create({
                name: threadTitle,
                autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
                type: ChannelType.PublicThread,
            });

            const auto = " (automatisch ermittelt)";
            const fields = [
                { name: "Bewerber", value: `<@${interaction.user.id}>`, inline: true },
                { name: "Charakter", value: characterName, inline: true },
                { name: "Klasse / Spec", value: classSpec, inline: true },
            ];
            if (armoryLink) fields.push({ name: `Armory${armoryAuto ? auto : ""}`, value: truncate(armoryLink), inline: false });
            if (logsLink) fields.push({ name: `WarcraftLogs${logsAuto ? auto : ""}`, value: truncate(logsLink), inline: false });
            // a long text goes into its own message instead of being cut off in the embed
            const descriptionTooLong = description.length > FIELD_LIMIT;
            if (description && !descriptionTooLong) {
                fields.push({ name: "Über den Bewerber", value: description, inline: false });
            }

            const embed = {
                title: `Neue Bewerbung von ${interaction.member?.displayName || interaction.user.username}`,
                color: 0x9b59b6,
                fields,
                footer: {
                    text: `Discord: ${interaction.user.username} | ${new Date().toLocaleDateString("de-DE")}`,
                },
            };

            const officerPing = officerRoleId ? `<@&${officerRoleId}> ` : "";
            const mentions = { users: [interaction.user.id], roles: officerRoleId ? [officerRoleId] : [] };
            const notice = `${officerPing}Neue Bewerbung von <@${interaction.user.id}>!`;
            let embedPosted = true;
            try {
                await thread.send({ content: notice, embeds: [embed], allowedMentions: mentions });
            } catch (sendError) {
                embedPosted = false;
                // never leave an empty thread behind: retry without the embed, so at least
                // the raw application survives a rejected embed
                console.error("application embed rejected:", sendError.code || "", sendError.message);
                const plain = [
                    notice,
                    `**Charakter:** ${characterName}`,
                    `**Klasse / Spec:** ${classSpec}`,
                    armoryLink ? `**Armory:** ${armoryLink}` : "",
                    logsLink ? `**WarcraftLogs:** ${logsLink}` : "",
                ].filter(Boolean).join("\n");
                await thread.send({ content: truncate(plain, 2000), allowedMentions: mentions });
            }

            if (description && (descriptionTooLong || !embedPosted)) {
                await thread.send({ content: truncate(`**Über den Bewerber:**\n${description}`, 2000) });
            }

            await interaction.editReply({
                content: "Deine Bewerbung wurde eingereicht! Wir melden uns bei dir.",
            });

            // Logs-Analyse des Bewerbers (Parse-Übersicht + CLA des letzten Raids) — best effort
            try {
                const wcl = new WarcraftLogs();
                const analysis = await analyzeApplicant(wcl, characterName, {
                    className: pending.className,
                    spec: pending.spec,
                });
                if (analysis) {
                    const embeds = buildApplicantEmbeds(characterName, analysis);
                    for (const e of embeds) await thread.send({ embeds: [e] });
                } else {
                    await thread.send({ content: `Keine Warcraft-Logs-Parses für **${characterName}** auf Thunderstrike gefunden.` });
                }
            } catch (analysisError) {
                console.error("applicant analysis failed:", analysisError.message);
            }
        } catch (error) {
            console.error("Error creating application thread:", error.code || "", error.message, error);
            // an empty thread tells the officers nothing — drop it if we could not fill it
            if (thread) {
                try {
                    await thread.delete("Bewerbung konnte nicht gepostet werden");
                } catch (cleanupError) {
                    console.error("could not remove the empty application thread:", cleanupError.message);
                }
            }
            await interaction.editReply({
                content: "Fehler beim Einreichen der Bewerbung. Bitte versuche es erneut oder kontaktiere einen Officer.",
            });
        }
    },
};
