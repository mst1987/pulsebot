const Raidhelper = require("../../classes/raidhelper");
const SheetsClient = require("../../classes/sheets");
const { fillSetupSheet } = require("../../utils/fillSetup");
const { botEditReply } = require("../../utils/helper");

module.exports = {
    name: "fillsetup",
    description: "Befüllt das Setup-Sheet aus einem Raidhelper-Raidplan",
    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true });

        const setupId = interaction.options.getString("setup_id");
        const tank3   = interaction.options.getString("tank3") || "";

        // ---- Fetch Raidhelper setup ----
        let slots;
        try {
            const rh = new Raidhelper();
            const result = await rh.getSetup(setupId);
            if (!result?.setup?.length) {
                return botEditReply(interaction, "Fehler", "Setup nicht gefunden oder leer. Setup-ID prüfen.");
            }
            slots = result.setup;
            console.log("[fillsetup] Slot sample:", JSON.stringify(slots[0], null, 2));
        } catch (e) {
            console.error("[fillsetup] Raidhelper error:", e.message);
            return botEditReply(interaction, "Fehler", `Raidhelper Fehler: ${e.message}`);
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
