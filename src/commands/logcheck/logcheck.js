const WarcraftLogs = require("../../classes/warcraftlogs");
const { buildGearIssues, buildArmory } = require("../../utils/logcheck/gearIssues");
const { analyzeConsumables } = require("../../utils/logcheck/consumables");
const { analyzeShadowResi } = require("../../utils/logcheck/shadowResi");
const { analyzeDrums } = require("../../utils/logcheck/drums");
const { analyzePotions, potionsByName } = require("../../utils/logcheck/potions");
const { analyzeSunder } = require("../../utils/logcheck/sunder");
const { analyzeBossUptimes } = require("../../utils/logcheck/bossUptimes");
const { selectPlayers } = require("../../utils/logcheck/common");
const { saveReport } = require("../../web/reportStore");
const { botEditReply } = require("../../utils/helper");
const { publicBaseUrl } = require("../../config/variables");

module.exports = {
    name: "logcheck",
    description: "Prüft einen Warcraft-Logs-Report: Gear, Consumables, Drums, Potions, Shadow-Resi.",
    async execute(interaction) {
        const link = interaction.options.getString("link");
        const reportId = WarcraftLogs.parseReportId(link);
        if (!reportId) {
            return botEditReply(interaction, "Fehler", "Konnte keine Report-ID aus dem Link lesen.");
        }

        await interaction.deferReply({ ephemeral: false });

        let wcl;
        try {
            wcl = new WarcraftLogs();
        } catch {
            return botEditReply(interaction, "Fehler", "WCL-API-Key fehlt (WARCRAFTLOGS_API_KEY in .env).");
        }

        let fights, table;
        try {
            fights = await wcl.getFights(reportId);
            table = await wcl.getCasts(reportId, 0, fights.end || 999999999999);
        } catch (e) {
            const status = e.response ? ` (HTTP ${e.response.status})` : "";
            return botEditReply(interaction, "Fehler", `Report konnte nicht geladen werden${status}. Stimmt der Link und ist der Report öffentlich?`);
        }

        const players = buildGearIssues(table, { gemsToConsider: 3 });
        const playerEntries = selectPlayers(table);

        // these hit the API; failures should not abort the whole report
        const idToPlayer = {};
        for (const p of playerEntries) idToPlayer[p.id] = { name: p.name, type: p.type };

        let consumables = null;
        let drums = null;
        let potions = null;
        let shadowResi = null;
        let sunder = null;
        let bossUptimes = null;
        try { consumables = await analyzeConsumables(wcl, reportId, fights, playerEntries); } catch (e) { console.error("consumables failed:", e.message); }
        try { drums = await analyzeDrums(wcl, reportId, fights); } catch (e) { console.error("drums failed:", e.message); }
        try { potions = await analyzePotions(wcl, reportId, fights); } catch (e) { console.error("potions failed:", e.message); }
        try { shadowResi = analyzeShadowResi(table, fights); } catch (e) { console.error("shadowResi failed:", e.message); }
        try { sunder = await analyzeSunder(wcl, reportId, fights, idToPlayer); } catch (e) { console.error("sunder failed:", e.message); }
        try { bossUptimes = await analyzeBossUptimes(wcl, reportId, fights); } catch (e) { console.error("bossUptimes failed:", e.message); }

        // aggregate the icons captured from the API (for headers / detail page)
        const icons = {
            ...(consumables && consumables.icons),
            destruction: potions && potions.icons && potions.icons.destruction,
            haste: potions && potions.icons && potions.icons.haste,
            mana: potions && potions.icons && potions.icons.mana,
            drums: drums && drums.icon,
        };

        // per-raider detail data (armory + their issues + potions)
        const issuesByName = {};
        for (const p of players) issuesByName[p.name] = p.issues;
        const potionMap = potionsByName(potions);
        const roster = playerEntries.map((p) => ({
            name: p.name,
            type: p.type,
            armory: buildArmory(p, { gemsToConsider: 3 }),
            issues: issuesByName[p.name] || [],
            potions: potionMap[p.name] || { destruction: 0, haste: 0, mana: 0 },
        }));

        const report = {
            title: fights.title || reportId,
            zone: fights.zoneName || (fights.zone ? String(fights.zone) : ""),
            date: fights.start ? new Date(fights.start).toLocaleString("de-DE") : "",
            reportId,
            reportUrl: `https://classic.warcraftlogs.com/reports/${reportId}`,
            generatedAt: Date.now(),
            players,
            consumables,
            shadowResi,
            drums,
            potions,
            sunder,
            bossUptimes,
            roster,
            icons,
        };

        const id = saveReport(report);
        const url = `${publicBaseUrl}/r/${id}`;

        const gearIssues = players.reduce((n, p) => n + p.issues.length, 0);
        const lines = [
            `👥 Raider: **${roster.length}**`,
            `🛡️ Gear: **${players.length}** mit **${gearIssues}** Problem(en)`,
            consumables && consumables.players.length ? `🧪 Consumables: ${consumables.players.length}` : "",
            potions ? `⚗️ Potions: ${potions.players.length}` : "",
            shadowResi ? `🌑 Shadow-Resi (${shadowResi.boss}): ${shadowResi.players.length}` : "",
            drums ? `🥁 Drums: ${drums.players.length}` : "",
            sunder ? `🪓 Sunder: ${sunder.length} Spieler` : "",
            bossUptimes ? `📊 Boss-Uptimes: ${bossUptimes.rows.length} Kämpfe` : "",
        ].filter(Boolean).join("\n");

        return botEditReply(
            interaction,
            `Log-Check: ${report.title}`,
            `${lines}\n\n🔗 **Auswertung:** ${url}`,
            0,
            false
        );
    },
};
