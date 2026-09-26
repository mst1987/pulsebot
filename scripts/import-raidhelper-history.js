// Imports the last Raid-Helper signups as spec history (#291) — which spec every
// raider signed up with, so the one-click signup and the profile suggestions know
// it once the guild's raids run on the EventHelper's own events.
//
//   node scripts/import-raidhelper-history.js --dry-run        only show what would be stored
//   node scripts/import-raidhelper-history.js                  store it
//   --per-category <n>   the last n Raid-Helper events per category (default 10, max 50)
//   --guild <id>         the Discord server (default: the event server from the settings)
//   --no-live            only the stored snapshots, do not ask Raid-Helper
//   --dev                read .env.dev instead of .env
//
// The same import runs from Einstellungen → Verbindungen → Raid-Helper. It
// creates no events and never counts a raid twice: running it again only adds
// Raid-Helper events that were not imported before (data/settings/spec-history.json).
// Without a running bot there is no Discord channel list, so live events are only
// placed in a category when raidEventScan.js snapshotted them before — which the
// running bot does every five minutes.
// Requiring this file does nothing; only running it reads and writes.

function parseArgs(argv) {
    const valueOf = (name) => {
        const i = argv.indexOf(name);
        return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "";
    };
    return {
        dev: argv.includes("--dev"),
        dryRun: argv.includes("--dry-run"),
        live: !argv.includes("--no-live"),
        perCategory: valueOf("--per-category"),
        guildId: valueOf("--guild"),
    };
}

/** The result as German lines for the console. */
function formatResult(result) {
    const lines = [];
    const s = result.summary;
    lines.push(result.dryRun ? "Probelauf – nichts gespeichert." : "Import gespeichert.");
    lines.push(`Letzte ${result.perCategory} Raid-Helper-Events je Kategorie.`);
    for (const c of result.categories) {
        const name = c.categoryName || c.categoryId || "Ohne Kategorie";
        lines.push(`  ${name}: ${c.events} Events, ${c.entries} Einträge${c.skipped ? `, ${c.skipped} schon importiert` : ""}`);
    }
    lines.push(`Gesamt: ${s.events} Events, ${s.entries} Einträge, ${s.users} Raider${s.skippedEvents ? `, ${s.skippedEvents} Events schon importiert` : ""}.`);
    const unmapped = Object.entries(s.unmapped || {});
    if (unmapped.length) lines.push(`Nicht zuordenbar: ${unmapped.map(([n, c]) => `${n} (${c}×)`).join(", ")}`);
    if (result.liveError) lines.push(`Raid-Helper nicht abgefragt: ${result.liveError} – nur gespeicherte Events.`);
    if (result.stored) lines.push(`Neu gespeichert: ${result.stored.events} Events, ${result.stored.entries} Einträge.`);
    return lines;
}

async function main(argv, { log = console.log } = {}) {
    const flags = parseArgs(argv);
    require("dotenv").config({ path: flags.dev ? ".env.dev" : ".env" });
    const { getConfig } = require("../src/stores/settingsStore");
    const { runImport } = require("../src/web/raidhelperHistoryImport");
    const guildId = flags.guildId || getConfig().guildId || "";
    const result = await runImport({
        guildId, perCategory: flags.perCategory, dryRun: flags.dryRun, live: flags.live, byName: "Skript",
    });
    for (const line of formatResult(result)) log(line);
    return result;
}

if (require.main === module) {
    main(process.argv.slice(2)).catch((e) => {
        console.error(e);
        process.exit(1);
    });
}

module.exports = { parseArgs, formatResult, main };
