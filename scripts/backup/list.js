#!/usr/bin/env node
// The local data snapshots (#693): time, reason, size and the plausibility counts from each manifest, newest first.
// Pick a name from here for `npm run backup:restore -- <name>`.
//
//   node scripts/backup/list.js [--json]
//   npm run backup:list
//
// Reads .env.dev, else .env, from the repository root like bot.js (BACKUP_DIR). Exit codes: 0 listed (also when
// there is none), 2 wrong arguments.
const path = require("path");
const { loadEnv } = require("./snapshot");

const USAGE = "Aufruf: node scripts/backup/list.js [--json]";

class UsageError extends Error {}

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
    const { listSnapshots, latestSnapshot, readManifest } = require("../../src/services/backup/snapshot");
    const { resolveBackupDir } = require("../../src/services/backup/backupConfig");
    return { listSnapshots, latestSnapshot, readManifest, backupDir: () => resolveBackupDir(process.env) };
}

/** The snapshots of `backupDir`, newest first: [{ name, reason, at, dir, latest, bytes, files, counts, commit, ok }]. */
function collect(backupDir, { listSnapshots, latestSnapshot, readManifest }) {
    const latest = latestSnapshot(backupDir);
    return listSnapshots(backupDir).reverse().map((s) => {
        const manifest = readManifest(s.dir);
        const files = manifest && manifest.files && typeof manifest.files === "object" ? Object.values(manifest.files) : null;
        return {
            name: s.name,
            reason: s.reason,
            at: new Date(s.at).toISOString(),
            dir: s.dir,
            latest: !!latest && latest.name === s.name,
            ok: !!files,
            bytes: files ? files.reduce((sum, f) => sum + (Number(f && f.size) || 0), 0) : null,
            files: files ? files.length : null,
            commit: manifest ? String(manifest.commit || "") : "",
            counts: manifest && manifest.counts ? manifest.counts : null,
        };
    });
}

const mb = (bytes) => `${(Math.round((bytes / 1024 / 1024) * 10) / 10).toFixed(1)} MB`;

/** One line per snapshot for a terminal. */
function formatTable(rows) {
    const head = `${"Name".padEnd(30)} ${"Zeit (UTC)".padEnd(16)} ${"Größe".padStart(9)}  Events Anmeld. Roster Reports Dateien`;
    const lines = [head];
    for (const r of rows) {
        const c = r.counts || {};
        const num = (v, w) => String(v ?? "-").padStart(w);
        lines.push(`${(r.name + (r.latest ? " *" : "")).padEnd(30)} ${r.at.slice(0, 16).replace("T", " ")} `
            + `${(r.ok ? mb(r.bytes) : "kaputt").padStart(9)}  ${num(c.events, 6)} ${num(c.signups, 7)} ${num(c.rosters, 6)} `
            + `${num(c.reports, 7)} ${num(r.files, 7)}`);
    }
    return lines;
}

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
    const backupDir = d.backupDir();
    const rows = collect(backupDir, d);
    if (args.json) {
        out(JSON.stringify({ backupDir, snapshots: rows }));
        return 0;
    }
    if (!rows.length) {
        out(`Keine Schnappschüsse unter ${path.join(backupDir, "snapshots")}`);
        return 0;
    }
    for (const line of formatTable(rows)) out(line);
    out(`${rows.length} Schnappschüsse unter ${path.join(backupDir, "snapshots")}; * = latest. Zurückspielen: npm run backup:restore -- <Name> --dry-run`);
    return 0;
}

if (require.main === module) {
    main().then((code) => {
        process.exitCode = code;
    }, (e) => {
        console.error(e && e.stack ? e.stack : e);
        process.exitCode = 1;
    });
}

module.exports = { parseArgs, collect, formatTable, main, USAGE };
