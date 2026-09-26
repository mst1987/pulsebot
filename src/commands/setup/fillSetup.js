const { MessageFlags, SlashCommandBuilder } = require("discord.js");
const { createRaidhelperClient } = require("../../utils/raidhelperClient");
const SheetsClient = require("../../classes/sheets");
const { fillSetupSheet } = require("../../utils/fillSetup");
const { botEditReply } = require("../../utils/helper");
const { isOwnEventId, getEvent } = require("../../web/eventStore");
const { ownEventInChannel } = require("../../web/eventSources");
const { raidHelperSlots } = require("../../web/setupEditor");

/**
 * The own EventHelper event the command is about (#291): an `eh-` id given as
 * setup_id, else — without an id — the event of this channel. Null otherwise,
 * so a numeric id still means a Raid-Helper raidplan.
 */
function ownTarget(setupId, channelId) {
    if (setupId && isOwnEventId(setupId)) return getEvent(setupId) || { missing: true };
    if (!setupId) return ownEventInChannel(channelId);
    return null;
}

module.exports = {
    name: "fillsetup",
    description: "Befüllt das Setup-Sheet aus dem freigegebenen Setup oder einem Raidhelper-Raidplan",
    group: "raids",
    defaultAccess: "admins",
    data: new SlashCommandBuilder()
        .setName("fillsetup")
        .setDescription("Befüllt das Setup-Sheet aus dem freigegebenen Setup oder einem Raidhelper-Raidplan")
        .addStringOption((o) => o.setName("setup_id").setDescription("Raidhelper Setup-ID oder EventHelper-Event (eh-…); leer = Event dieses Kanals").setRequired(false))
        .addStringOption((o) => o.setName("tank3").setDescription("3. Tank (Charaktername fuer B13, optional)").setRequired(false)),
    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const setupId = String(interaction.options.getString("setup_id") || "").trim();
        const tank3   = interaction.options.getString("tank3") || "";

        let slots;
        const own = ownTarget(setupId, interaction.channel && interaction.channel.id);
        if (own) {
            // ---- An own event: only its APPROVED setup fills a sheet ----
            if (own.missing) return botEditReply(interaction, "Fehler", "Event nicht gefunden. ID prüfen.");
            slots = raidHelperSlots(own);
            if (!slots.length) {
                return botEditReply(interaction, "Fehler", `**${own.title}** hat noch kein freigegebenes Setup. Erst im Web unter Raid-Details › Setup freigeben.`);
            }
        } else if (!setupId) {
            return botEditReply(interaction, "Fehler", "Keine Setup-ID angegeben und in diesem Kanal gibt es kein eigenes Event.");
        }

        // ---- Fetch Raidhelper setup ----
        if (!slots) {
            try {
                const rh = createRaidhelperClient();
                const result = await rh.getSetup(setupId);
                if (!result?.setup?.length) {
                    return botEditReply(interaction, "Fehler", "Setup nicht gefunden oder leer. Setup-ID prüfen.");
                }
                slots = result.setup;
            } catch (e) {
                console.error("[fillsetup] Raidhelper error:", e.message);
                return botEditReply(interaction, "Fehler", `Raidhelper Fehler: ${e.message}`);
            }
        }

        // ---- Fill the sheet (compute + write) ----
        const tab = process.env.GOOGLE_SHEET_NAME || "Setup";
        let summary;
        try {
            const sheetsClient = new SheetsClient();
            summary = await fillSetupSheet(sheetsClient, slots, { tab, tank3 });
        } catch (e) {
            console.error("[fillsetup] Sheets error:", e.message);
            return botEditReply(interaction, "Fehler", `Google Sheets Fehler: ${e.message}`);
        }

        const sheetUrl = `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SPREADSHEET_ID}/edit`;
        return botEditReply(
            interaction,
            "Setup befüllt",
            [
                `✅ **${summary.playerCount}** Spieler eingetragen`,
                `Tanks: ${summary.tanks[0]} / ${summary.tanks[1]} / ${summary.tanks[2]}`,
                `Heiler: ${summary.healers} | Warlocks: ${summary.warlocks} | Priester: ${summary.priests} | Mages: ${summary.mages} | Hunter: ${summary.hunters}`,
                `\n${sheetUrl}`,
            ].join("\n"),
            0,
            true
        );
    },
};
