#!/usr/bin/env node
// One data snapshot from the command line (#691) - the same code the bot's hourly job runs
// (src/services/backup/snapshot.js), usable without a running bot. The deploy (#695) calls it before it switches
// the code, the restore (#693) before it overwrites anything.
//
//   node scripts/backup/snapshot.js --reason manual|deploy|pre-restore [--from <sha>] [--to <sha>] [--json]
//   npm run backup:snapshot -- --reason manual
//
// Reads .env.dev, else .env, from the repository root like bot.js (DATA_DIR = EVENTHELPER_DATA_DIR, BACKUP_DIR),
// and the retention from the settings (config.json `backup`). BACKUP_ENABLED does not apply: a snapshot asked for
// by hand is always taken. Runs alongside the bot - the lock in BACKUP_DIR keeps the two apart.
//
// Exit codes: 0 done, 1 failed (status/snapshot.json says why), 2 wrong arguments, 3 another snapshot is running.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const CLI_REASONS = ["manual", "deploy", "pre-restore"];
const SHA_RE = /^[0-9a-f]{7,40}$/i;
const USAGE = "Aufruf: node scripts/backup/snapshot.js --reason manual|deploy|pre-restore [--from <sha>] [--to <sha>] [--json]";

class UsageError extends Error {}

/** { reason, fromCommit, toCommit, json, help } of the arguments; throws UsageError for anything wrong. */
function parseArgs(argv) {
    const out = { reason: "", fromCommit: "", toCommit: "", json: false, help: false };
    const args = [...argv];
    const value = (flag) => {
        const v = args.shift();
        if (v === undefined || v.startsWith("--")) throw new UsageError(`${flag} braucht einen Wert`);
        return v;
    };
    while (args.length) {
        const arg = args.shift();
        const [flag, inline] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
        const take = () => (inline !== undefined ? inline : value(flag));
        if (flag === "--reason") out.reason = take();
        else if (flag === "--from") out.fromCommit = take();
        else if (flag === "--to") out.toCommit = take();
        else if (flag === "--json") out.json = true;
        else if (flag === "--help" || flag === "-h") out.help = true;
        else throw new UsageError(`Unbekanntes Argument: ${arg}`);
    }
    if (out.help) return out;
    if (!CLI_REASONS.includes(out.reason)) {
        throw new UsageError(`--reason muss eins von ${CLI_REASONS.join(", ")} sein (stündliche Schnappschüsse macht der Bot)`);
    }
    for (const [key, flag] of [["fromCommit", "--from"], ["toCommit", "--to"]]) {
        if (out[key] && !SHA_RE.test(out[key])) throw new UsageError(`${flag} ist kein Commit-Hash: ${out[key]}`);
        out[key] = out[key].toLowerCase();
    }
    return out;
}

/** Loads .env.dev, else .env, like bot.js - before anything reads DATA_DIR. */
function loadEnv(root = ROOT) {
    const envDev = path.join(root, ".env.dev");
    const envFile = fs.existsSync(envDev) ? envDev : path.join(root, ".env");
    require("dotenv").config({ path: envFile, quiet: true });
    if (!process.env.EVENTHELPER_ENV_FILE) process.env.EVENTHELPER_ENV_FILE = path.basename(envFile);
}

function defaultDeps() {
    loadEnv();
    // Required only now: config/paths.js reads EVENTHELPER_DATA_DIR when it loads.
    const { createSnapshot } = require("../../src/services/backup/snapshot");
    const { resolveBackupDir, normalizeBackupSettings } = require("../../src/services/backup/backupConfig");
    const { versionInfo } = require("../../src/web/http/version");
    const settings = () => {
        try {
            return normalizeBackupSettings(require("../../src/stores/configStore").getConfig().backup);
        } catch {
            return normalizeBackupSettings(null);
        }
    };
    return {
        createSnapshot,
        backupDir: () => resolveBackupDir(process.env),
        retention: () => settings().retention,
        commit: () => versionInfo().commit,
    };
}

/**
 * Runs one snapshot and returns the exit code. `deps` replace the real modules in tests.
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
    const result = await d.createSnapshot({
        reason: args.reason,
        fromCommit: args.fromCommit || undefined,
        toCommit: args.toCommit || undefined,
        commit: d.commit(),
        backupDir: d.backupDir(),
        retention: d.retention(),
    });
    if (args.json) out(JSON.stringify(result));
    else if (result.ok) out(`Schnappschuss ${result.name}: ${result.files} Dateien, ${result.bytes} Bytes, ${result.durationMs} ms (${result.dir})`);
    else err(`Kein Schnappschuss: ${result.error}`);
    if (result.ok) return 0;
    return result.skipped === "locked" ? 3 : 1;
}

if (require.main === module) {
    main().then((code) => {
        process.exitCode = code;
    }, (e) => {
        console.error(e && e.stack ? e.stack : e);
        process.exitCode = 1;
    });
}

module.exports = { parseArgs, main, loadEnv, CLI_REASONS, USAGE };
