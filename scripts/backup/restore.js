#!/usr/bin/env node
// Plays a data snapshot back into DATA_DIR (#693) - the runbook in docs/backup.md "Wiederherstellen" uses this.
//
//   node scripts/backup/restore.js <snapshot|latest|path> [--dry-run] [--only <relpath>]... [--force] [--prune] [--json]
//   npm run backup:restore -- latest --dry-run
//
// <snapshot>  a name under $BACKUP_DIR/snapshots/ (20261010-140000-hourly), `latest` (the newest snapshot that is
//             not a pre-restore one - those are the way back and are only restored by name), or a path to any
//             directory with manifest.json + data/, e.g. one restic brought back:
//             /tmp/restore/var/backups/pulsebot/offsite-stage/latest
//
// In this order, stopping at the first failure:
//   1. check the snapshot (manifest, size + sha256 of every file, every *.json parses; with --only just those),
//   2. refuse while the bot answers on http://127.0.0.1:$WEB_PORT/health (--force overrides),
//   3. take a pre-restore snapshot of the current state (the way back; scripts/backup/snapshot.js logic),
//   4. restore under the snapshot lock (src/services/backup/restore.js), then print what changed and the counts
//      before -> after.
// --dry-run checks and plans only: nothing is written, no snapshot is taken.
//
// Reads .env.dev, else .env, from the repository root like bot.js (EVENTHELPER_DATA_DIR, BACKUP_DIR, WEB_PORT).
// Exit codes: 0 done, 1 check or restore failed, 2 wrong arguments / snapshot not found, 3 a snapshot is running,
// 4 the bot is running.
const fs = require("fs");
const path = require("path");
const http = require("http");
const { loadEnv } = require("./snapshot");

const USAGE = "Aufruf: node scripts/backup/restore.js <schnappschuss|latest|pfad> [--dry-run] [--only <relpfad>]... [--force] [--prune] [--json]";
const HEALTH_TIMEOUT_MS = 2000;
const MAX_LISTED = 20;
const COUNT_KEYS = ["events", "signups", "rosters", "raidplans", "reports", "raidplanMaps", "sessions", "files"];

class UsageError extends Error {}

/** { snapshot, dryRun, only, force, prune, json, help } of the arguments; throws UsageError for anything wrong. */
function parseArgs(argv) {
    const out = { snapshot: "", dryRun: false, only: [], force: false, prune: false, json: false, help: false };
    const args = [...argv];
    while (args.length) {
        const arg = args.shift();
        if (arg === "--only" || arg.startsWith("--only=")) {
            const v = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : args.shift();
            if (!v || v.startsWith("--")) throw new UsageError("--only braucht einen Pfad (z. B. settings/rosters.json)");
            out.only.push(v);
        } else if (arg === "--dry-run") out.dryRun = true;
        else if (arg === "--force") out.force = true;
        else if (arg === "--prune") out.prune = true;
        else if (arg === "--json") out.json = true;
        else if (arg === "--help" || arg === "-h") out.help = true;
        else if (arg.startsWith("-")) throw new UsageError(`Unbekanntes Argument: ${arg}`);
        else if (out.snapshot) throw new UsageError(`Nur ein Schnappschuss auf einmal (zweiter: ${arg})`);
        else out.snapshot = arg;
    }
    if (!out.help && !out.snapshot) throw new UsageError("Welcher Schnappschuss? Name, latest oder Pfad angeben (Liste: npm run backup:list)");
    return out;
}

/**
 * The directory a snapshot argument names: `latest` (newest that is not pre-restore), a snapshot name under
 * BACKUP_DIR, or a path to a directory with manifest.json. Throws UsageError when there is none.
 */
function resolveSnapshot(arg, backupDir, { listSnapshots, parseSnapshotName }, cwd = process.cwd()) {
    if (arg === "latest") {
        const candidates = listSnapshots(backupDir)
            .filter((s) => s.reason !== "pre-restore" && fs.existsSync(path.join(s.dir, "manifest.json")));
        if (!candidates.length) throw new UsageError(`Kein Schnappschuss unter ${path.join(backupDir, "snapshots")}`);
        return candidates[candidates.length - 1].dir;
    }
    if (parseSnapshotName(arg)) {
        const dir = path.join(backupDir, "snapshots", arg);
        if (!fs.existsSync(path.join(dir, "manifest.json"))) throw new UsageError(`Schnappschuss ${arg} gibt es unter ${backupDir} nicht`);
        return dir;
    }
    const dir = path.resolve(cwd, arg);
    if (fs.existsSync(path.join(dir, "manifest.json"))) return dir;
    const hint = fs.existsSync(path.join(dir, "var", "backups", "pulsebot", "offsite-stage", "latest", "manifest.json"))
        ? ` - gemeint ist wohl ${path.join(dir, "var", "backups", "pulsebot", "offsite-stage", "latest")}`
        : "";
    throw new UsageError(`${dir} ist kein Schnappschuss (keine manifest.json)${hint}`);
}

/**
 * Whether the bot answers on 127.0.0.1:<port>/health: any HTTP answer counts as running, a refused connection
 * as stopped, a timeout as running (something holds the port and does not answer - better stop it first).
 */
function checkHealth(port, { timeoutMs = HEALTH_TIMEOUT_MS, get = http.get } = {}) {
    return new Promise((resolve) => {
        let settled = false;
        const done = (value) => {
            if (!settled) {
                settled = true;
                resolve(value);
            }
        };
        const req = get({ host: "127.0.0.1", port, path: "/health", timeout: timeoutMs }, (res) => {
            res.resume();
            done({ running: true, detail: `HTTP ${res.statusCode} auf Port ${port}` });
        });
        req.on("timeout", () => {
            done({ running: true, detail: `Port ${port} antwortet nicht innerhalb von ${timeoutMs} ms` });
            req.destroy();
        });
        req.on("error", (e) => done({ running: false, detail: `Port ${port}: ${e.code || e.message}` }));
    });
}

function defaultDeps() {
    loadEnv();
    // Required only now: config/paths.js reads EVENTHELPER_DATA_DIR when it loads.
    const snapshot = require("../../src/services/backup/snapshot");
    const { verifySnapshot, restoreSnapshot } = require("../../src/services/backup/restore");
    const { resolveBackupDir, normalizeBackupSettings } = require("../../src/services/backup/backupConfig");
    const { DATA_DIR } = require("../../src/config/paths");
    const { webPort } = require("../../src/config/defaults");
    const { versionInfo } = require("../../src/web/http/version");
    const retention = () => {
        try {
            return normalizeBackupSettings(require("../../src/stores/configStore").getConfig().backup).retention;
        } catch {
            return normalizeBackupSettings(null).retention;
        }
    };
    return {
        snapshot, verifySnapshot, restoreSnapshot, retention,
        createSnapshot: snapshot.createSnapshot,
        acquireLock: snapshot.acquireLock,
        backupDir: () => resolveBackupDir(process.env),
        dataDir: () => DATA_DIR,
        port: () => Number(process.env.WEB_PORT) || webPort,
        health: (port) => checkHealth(port),
        commit: () => versionInfo().commit,
    };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const mb = (bytes) => `${(Math.round((bytes / 1024 / 1024) * 10) / 10).toFixed(1)} MB`;

/** The lines of the summary a person reads after a restore or a dry run. */
function formatSummary(r, { snapshotLabel, preRestore }) {
    const lines = [];
    const verb = r.dryRun ? "Trockenlauf - würde zurückspielen" : "Zurückgespielt";
    lines.push(`${verb}: ${snapshotLabel} -> ${r.dataDir}${r.only.length ? ` (nur ${r.only.join(", ")})` : ""}`);
    lines.push(`  ${r.updated} geändert, ${r.created} neu, ${r.unchanged} unverändert, `
        + (r.prune ? `${r.deleted} ${r.dryRun ? "zu löschen" : "gelöscht"}` : `${r.extra.length} nur im Ziel (bleiben; --prune löscht sie)`));
    const label = { create: "neu     ", update: "geändert", delete: "gelöscht" };
    const listed = [...r.changes, ...(r.prune ? [] : r.extra.map((rel) => ({ rel, action: "extra" })))];
    for (const c of listed.slice(0, MAX_LISTED)) lines.push(`  ${c.action === "extra" ? "nur Ziel" : label[c.action]}  ${c.rel}`);
    if (listed.length > MAX_LISTED) lines.push(`  ... und ${listed.length - MAX_LISTED} weitere (--json zeigt alle)`);
    const after = r.dryRun ? r.countsSnapshot : r.countsAfter;
    if (r.countsBefore && after) {
        lines.push(`  Kennzahlen      vorher -> ${r.dryRun ? "Schnappschuss" : "nachher"}`);
        for (const key of COUNT_KEYS) {
            const a = r.countsBefore[key];
            const b = after[key];
            if (a === undefined && b === undefined) continue;
            lines.push(`    ${key.padEnd(13)} ${String(a ?? "-").padStart(6)} -> ${String(b ?? "-").padStart(6)}${a !== b ? "  *" : ""}`);
        }
        if (r.dryRun && r.only.length) lines.push("    (Schnappschuss-Werte gelten für den ganzen Schnappschuss, nicht nur --only)");
    }
    if (preRestore) lines.push(`Rückweg (bei gestopptem Bot): npm run backup:restore -- ${preRestore}`);
    return lines;
}

/** "20261010-140000-hourly (hourly, 2026-10-10T14:00:00.000Z, Commit abc1234)" */
function labelOf(snapshotDir, manifest) {
    const m = manifest || {};
    if (!m.createdAt) return path.basename(snapshotDir);
    return `${path.basename(snapshotDir)} (${m.reason || "?"}, ${m.createdAt}${m.commit ? `, Commit ${String(m.commit).slice(0, 7)}` : ""})`;
}

/** Step 1: the check. Returns an exit code when it failed, else null. */
async function stepVerify(run) {
    const { args, d, report, say, finish } = run;
    const v = await d.verifySnapshot(run.snapshotDir, { only: args.only });
    run.verification = v;
    run.snapshotLabel = labelOf(run.snapshotDir, v.manifest);
    report.verification = { ok: v.ok, checked: v.checked, bytes: v.bytes, problems: v.problems };
    if (v.ok) {
        say(`Prüfung ok: ${run.snapshotLabel}, ${plural(v.checked, "Datei", "Dateien")}, ${mb(v.bytes)}, Prüfsummen und JSON in Ordnung`);
        return null;
    }
    if (!args.json) {
        run.err(`Schnappschuss ${run.snapshotDir} ist fehlerhaft - nichts geändert:`);
        for (const p of v.problems.slice(0, MAX_LISTED)) run.err(`  ${p.rel}: ${p.problem}`);
        if (v.problems.length > MAX_LISTED) run.err(`  ... und ${v.problems.length - MAX_LISTED} weitere`);
    }
    return finish(1, `Prüfung fehlgeschlagen: ${plural(v.problems.length, "Problem", "Probleme")}`);
}

/** Step 2: the bot must not run (a dry run only says so). Returns an exit code when it refuses, else null. */
async function stepHealth(run) {
    const { args, d, report, say, finish } = run;
    report.health = await d.health(d.port());
    const { running, detail } = report.health;
    if (!running) return null;
    if (args.dryRun) {
        say(`Hinweis: der Bot läuft (${detail}); vor dem echten Lauf stoppen (pm2 stop pulsebot)`);
        return null;
    }
    if (!args.force) {
        return finish(4, `Der Bot läuft noch (${detail}). Erst stoppen (pm2 stop pulsebot), oder --force, wenn er wirklich weiterlaufen soll.`);
    }
    say(`Achtung: der Bot läuft (${detail}), --force spielt trotzdem zurück. Danach neu starten (pm2 restart pulsebot), sonst schreibt er seinen alten Stand aus dem Speicher zurück.`);
    return null;
}

/** Step 3: the pre-restore snapshot, then the snapshot lock for step 4. Returns an exit code when either fails. */
async function stepWayBack(run) {
    const { d, report, say, finish } = run;
    const pre = await d.createSnapshot({
        reason: "pre-restore", dataDir: run.dataDir, backupDir: run.backupDir, retention: d.retention(), commit: d.commit(),
    });
    report.preRestore = { ok: pre.ok, name: pre.name, dir: pre.dir, error: pre.error };
    if (!pre.ok) return finish(pre.skipped === "locked" ? 3 : 1, `Kein Rückweg-Schnappschuss, daher nichts zurückgespielt: ${pre.error}`);
    say(`Rückweg-Schnappschuss: ${pre.name}`);
    // under the snapshot lock, so no snapshot of a half-restored state is taken meanwhile
    run.lock = d.acquireLock(run.backupDir, Date.now());
    if (!run.lock) return finish(3, "Ein Schnappschuss läuft gerade - in ein paar Minuten noch einmal versuchen");
    return null;
}

/** Step 4: restore, release the lock, print the summary. Returns the exit code. */
async function stepRestore(run) {
    const { args, d, report, finish } = run;
    let result;
    try {
        result = await d.restoreSnapshot({
            snapshotDir: run.snapshotDir, dataDir: run.dataDir, only: args.only, dryRun: args.dryRun, prune: args.prune,
            verification: run.verification,
        });
    } finally {
        if (run.lock) run.lock.release();
    }
    report.restore = result;
    report.ok = result.ok;
    const preName = report.preRestore && report.preRestore.name;
    if (!result.ok) {
        return finish(1, `Zurückspielen fehlgeschlagen: ${result.error}.${preName ? ` Rückweg (bei gestopptem Bot): npm run backup:restore -- ${preName}` : ""}`);
    }
    if (args.json) {
        run.out(JSON.stringify(report));
        return 0;
    }
    for (const line of formatSummary(result, { snapshotLabel: run.snapshotLabel, preRestore: preName })) run.out(line);
    if (!args.dryRun) run.out("Jetzt den Bot starten (pm2 start pulsebot) und /health prüfen.");
    return 0;
}

/**
 * The whole restore and its exit code. `deps` replace the real modules in tests.
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
    if (!deps && args.json && !process.env.LOG_LEVEL) process.env.LOG_LEVEL = "warn"; // stdout stays pure JSON
    const d = deps || defaultDeps();
    const report = { ok: false, snapshotDir: null, verification: null, health: null, preRestore: null, restore: null };
    const run = {
        args, d, report, out, err, backupDir: d.backupDir(), dataDir: d.dataDir(), lock: null,
        say: (line) => { if (!args.json) out(line); },
        finish: (code, message) => {
            report.error = message;
            if (args.json) out(JSON.stringify(report));
            else err(message);
            return code;
        },
    };
    try {
        run.snapshotDir = resolveSnapshot(args.snapshot, run.backupDir, d.snapshot);
    } catch (e) {
        if (!(e instanceof UsageError)) throw e;
        return run.finish(2, e.message);
    }
    report.snapshotDir = run.snapshotDir;
    for (const step of [stepVerify, stepHealth, ...(args.dryRun ? [] : [stepWayBack])]) {
        const code = await step(run);
        if (code !== null) return code;
    }
    return stepRestore(run);
}

if (require.main === module) {
    main().then((code) => {
        process.exitCode = code;
    }, (e) => {
        console.error(e && e.stack ? e.stack : e);
        process.exitCode = 1;
    });
}

module.exports = { parseArgs, resolveSnapshot, checkHealth, formatSummary, main, USAGE };
