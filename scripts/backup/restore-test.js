#!/usr/bin/env node
// The restore probe by hand (#694) - the same code the bot's weekly job runs (src/services/backup/restoreTest.js):
// the newest snapshot checked, played back into $BACKUP_DIR/.restore-test-<id>/, read by every store, the counts
// compared with the manifest and the live data, the scratch directory removed, status/restore-test.json written
// (the monitoring shows it at once).
//
//   node scripts/backup/restore-test.js [--json]
//   npm run backup:restore-test
//
// Reads .env.dev, else .env, from the repository root like bot.js (DATA_DIR = EVENTHELPER_DATA_DIR, BACKUP_DIR).
// BACKUP_ENABLED does not apply: a probe asked for by hand always runs. Safe next to the running bot - it writes
// only into its scratch directory and the status file, and reads the live data only for the counts.
//
// Exit codes: 0 passed, 1 failed (the problems are listed), 2 wrong arguments.
const { loadEnv } = require("./snapshot");

const USAGE = "Aufruf: node scripts/backup/restore-test.js [--json]";

class UsageError extends Error {}

/** { json, help } of the arguments; throws UsageError for anything else. */
function parseArgs(argv) {
    const out = { json: false, help: false };
    for (const arg of argv) {
        if (arg === "--json") out.json = true;
        else if (arg === "--help" || arg === "-h") out.help = true;
        else throw new UsageError(`Unbekanntes Argument: ${arg}`);
    }
    return out;
}

function defaultDeps() {
    loadEnv();
    // Required only now: config/paths.js reads EVENTHELPER_DATA_DIR when it loads.
    const { runRestoreTest } = require("../../src/services/backup/restoreTest");
    const { resolveBackupDir } = require("../../src/services/backup/backupConfig");
    return { runRestoreTest, backupDir: () => resolveBackupDir(process.env) };
}

/** The human-readable lines of a result. */
function summaryLines(result) {
    const lines = [];
    const snap = result.snapshot ? `${result.snapshot.name}${result.snapshot.commit ? ` (${result.snapshot.commit.slice(0, 7)})` : ""}` : "-";
    lines.push(`${result.ok ? "Bestanden" : "DURCHGEFALLEN"}: Schnappschuss ${snap}, ${result.files} Dateien, ${result.bytes} Bytes, ${result.durationMs} ms`);
    if (result.stores) lines.push(`Stores gelesen: ${result.stores.checked}, davon unlesbar: ${result.stores.failed}, fehlend: ${result.stores.missing}`);
    const c = result.counts || {};
    if (c.snapshot) {
        const keys = Object.keys(c.snapshot);
        lines.push(`Kennzahlen (Schnappschuss / zurückgespielt / live): ${keys.map((k) => `${k} ${c.snapshot[k]}/${c.restored ? c.restored[k] : "-"}/${c.live ? c.live[k] : "-"}`).join(", ")}`);
    }
    if (result.loop) lines.push(`Event-Loop-Verzögerung: max ${result.loop.maxMs} ms, p99 ${result.loop.p99Ms} ms`);
    for (const p of result.problems || []) lines.push(`  - ${p.rel ? `${p.rel}: ` : ""}${p.problem}`);
    if (result.problemCount > (result.problems || []).length) lines.push(`  ... und ${result.problemCount - result.problems.length} weitere`);
    return lines;
}

/**
 * Runs one probe and returns the exit code. `deps` replace the real modules in tests.
 * @param {string[]} argv
 * @param {object} [o] { deps, out, err }
 */
async function main(argv = process.argv.slice(2), { deps, out = console.log, err = console.error } = {}) {
    let args;
    try {
        args = parseArgs(argv);
    } catch (e) {
        if (!(e instanceof UsageError)) throw e;
        err(e.message);
        err(USAGE);
        return 2;
    }
    if (args.help) {
        out(USAGE);
        return 0;
    }
    const d = deps || defaultDeps();
    const result = await d.runRestoreTest({ backupDir: d.backupDir() });
    if (args.json) out(JSON.stringify(result));
    else for (const line of summaryLines(result)) (result.ok ? out : err)(line);
    return result.ok ? 0 : 1;
}

if (require.main === module) {
    main().then((code) => {
        process.exitCode = code;
    }, (e) => {
        console.error(e && e.stack ? e.stack : e);
        process.exitCode = 1;
    });
}

module.exports = { parseArgs, main, summaryLines, USAGE };
