// Checking a data snapshot and playing it back into a data directory (#693, docs/backup.md "Wiederherstellen").
//
// A snapshot is any directory with manifest.json + data/ as snapshot.js lays it out: one under
// $BACKUP_DIR/snapshots/, or one the off-site copy brought back (restic restore ... --target /tmp/restore gives
// /tmp/restore/var/backups/pulsebot/offsite-stage/latest). Nothing here knows about BACKUP_DIR, the running bot or
// the pre-restore snapshot - that is the CLI's job (scripts/backup/restore.js) - so the weekly restore probe (#694)
// can call the same two functions against a scratch directory:
//
//   verifySnapshot(dir, { only })                    manifest readable, every file there, size + sha256 equal,
//                                                    every *.json parses
//   restoreSnapshot({ snapshotDir, dataDir, only, dryRun, prune, verification })
//                                                    the changes and the counts before/after (countsOf of #691)
//
// How a restore writes:
//   1. Plan: per file of the snapshot (or of `only`) create / update / unchanged (same size and sha256 in the
//      target). Files in the target but not in the snapshot are listed as `extra` and stay unless `prune`.
//   2. Stage: every file to create or update is copied to a temporary sibling (`.<name>.<pid>.<id>.tmp`, the name
//      the stores and the snapshot already skip) and hashed on the way; a hash that differs from the manifest stops
//      everything before a single target changed, and the temporary files are removed.
//   3. Swap: all renames in one synchronous loop - each file atomically, and a bot running anyway (--force) sees
//      either the old or the new state of every file.
//   4. Prune (only with `prune`), then the counts after.
// The mode of a replaced file is kept (owner too where we may); a new file gets 600 when it is sensitive
// (SENSITIVE_FILES, the "Sensibel" column of docs/data-storage.md), else 644; new directories 700.
// Files are always copied, never hard-linked: snapshots share their files through hard links, and a store that
// writes in place (sessions.json) would otherwise change every snapshot holding that file.
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { DATA_DIR } = require("../../config/paths");
const { tempPathFor } = require("../../stores/jsonStore");
const { countsOf, hashFile, copyAndHash, isTempName, MANIFEST_VERSION } = require("./snapshot");
const logger = require("../../logger").child("backup");

/** Files of DATA_DIR with credentials, sessions or personal reasons: a new copy gets 600. */
const SENSITIVE_FILES = new Set([
    "sessions.json",
    "settings/config.json",
    "settings/ingest-tokens.json",
    "settings/calendar-tokens.json",
    "settings/availability.json",
    "settings/attendance-overrides.json",
]);
const SENSITIVE_MODE = 0o600;
const PLAIN_MODE = 0o644;
const DIR_MODE = 0o700;

class RestoreError extends Error {}

const absOf = (root, rel) => path.join(root, ...rel.split("/"));
const isSha256 = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

function isInside(child, parent) {
    const rel = path.relative(parent, child);
    return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

/** A relative path of the manifest that stays inside data/: no "..", no absolute path, forward slashes only. */
function isSafeRel(rel) {
    if (typeof rel !== "string" || !rel || rel.includes("\\") || rel.includes("\0")) return false;
    if (rel.startsWith("/") || /^[A-Za-z]:/.test(rel)) return false;
    return rel.split("/").every((part) => part && part !== "." && part !== "..");
}

/** An `only` entry as the manifest spells paths: forward slashes, without "./", "data/" or a trailing slash. */
function normalizeOnly(value) {
    let rel = String(value || "").trim().replace(/\\/g, "/");
    while (rel.startsWith("./")) rel = rel.slice(2);
    if (rel.startsWith("data/")) rel = rel.slice(5);
    return rel.replace(/\/+$/, "");
}

const normalizeOnlyList = (only) => [].concat(only || []).map(normalizeOnly).filter(Boolean);

/** Whether `rel` is one of `only` or lies below one of them (a directory such as "reports"). No `only`: all. */
function matchesOnly(rel, only) {
    return !only.length || only.some((o) => rel === o || rel.startsWith(`${o}/`));
}

/** The manifest of `dir` and what is wrong with it: { manifest, problems }. */
function loadManifest(dir) {
    const file = path.join(dir, "manifest.json");
    let text;
    try {
        text = fs.readFileSync(file, "utf8");
    } catch {
        return { manifest: null, problems: [{ rel: "manifest.json", problem: "fehlt" }] };
    }
    let manifest;
    try {
        manifest = JSON.parse(text);
    } catch {
        return { manifest: null, problems: [{ rel: "manifest.json", problem: "kein gültiges JSON" }] };
    }
    const problems = [];
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
        return { manifest: null, problems: [{ rel: "manifest.json", problem: "kein Objekt" }] };
    }
    if (manifest.version !== MANIFEST_VERSION) {
        problems.push({ rel: "manifest.json", problem: `unbekannte Version ${JSON.stringify(manifest.version)} (erwartet ${MANIFEST_VERSION})` });
    }
    if (!manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files)) {
        problems.push({ rel: "manifest.json", problem: "ohne Dateiliste (files)" });
    }
    return { manifest: problems.length ? null : manifest, problems };
}

/** The problems of one file of the snapshot against its manifest entry (empty: fine). */
async function checkFile(dataRoot, rel, entry) {
    if (!isSafeRel(rel)) return ["ungültiger Pfad im Manifest"];
    if (!entry || !Number.isInteger(entry.size) || entry.size < 0 || !isSha256(entry.sha256)) return ["Eintrag im Manifest unvollständig"];
    const file = absOf(dataRoot, rel);
    let st;
    try {
        st = await fsp.stat(file);
    } catch {
        return ["fehlt"];
    }
    if (!st.isFile()) return ["keine Datei"];
    if (st.size !== entry.size) return [`Größe ${st.size} statt ${entry.size} Bytes`];
    const problems = [];
    if (rel.endsWith(".json")) {
        const buf = await fsp.readFile(file);
        if (crypto.createHash("sha256").update(buf).digest("hex") !== entry.sha256) problems.push("Prüfsumme weicht ab");
        try {
            JSON.parse(buf.toString("utf8"));
        } catch {
            problems.push("kein gültiges JSON");
        }
    } else if (await hashFile(file) !== entry.sha256) {
        problems.push("Prüfsumme weicht ab");
    }
    return problems;
}

/**
 * Checks a snapshot directory: manifest.json readable and of a known version, every file of the manifest (or of
 * `only`) present in data/ with the recorded size and sha256, every *.json among them parseable. Never throws.
 *
 * @param {string} snapshotDir  a directory with manifest.json and data/
 * @param {object} [o]
 * @param {string[]} [o.only]   relative paths (files or directories) - only these are checked; one the manifest
 *                              does not know is a problem
 * @returns {Promise<{ ok, dir, only, manifest, rels, problems: Array<{ rel, problem }>, checked, bytes }>}
 *   `rels` are the checked paths, `checked` how many of them passed, `bytes` their size
 */
async function verifySnapshot(snapshotDir, { only } = {}) {
    const dir = path.resolve(String(snapshotDir || ""));
    const onlyList = normalizeOnlyList(only);
    const result = { ok: false, dir, only: onlyList, manifest: null, rels: [], problems: [], checked: 0, bytes: 0 };
    const loaded = loadManifest(dir);
    result.problems.push(...loaded.problems);
    if (!loaded.manifest) return result;
    const all = Object.keys(loaded.manifest.files).sort();
    for (const o of onlyList) {
        if (!all.some((rel) => matchesOnly(rel, [o]))) result.problems.push({ rel: o, problem: "nicht im Schnappschuss" });
    }
    result.rels = all.filter((rel) => matchesOnly(rel, onlyList));
    const dataRoot = path.join(dir, "data");
    for (const rel of result.rels) {
        const entry = loaded.manifest.files[rel];
        const problems = await checkFile(dataRoot, rel, entry);
        for (const problem of problems) result.problems.push({ rel, problem });
        if (!problems.length) {
            result.checked += 1;
            result.bytes += entry.size;
        }
    }
    result.manifest = loaded.manifest;
    result.ok = result.problems.length === 0;
    return result;
}

/** Every file below `dataDir` as a sorted relative path; symlinks and temporary store files left out. */
async function listDataFiles(dataDir) {
    const out = [];
    async function walk(dir, rel) {
        let entries;
        try {
            entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const ent of entries) {
            if (ent.isSymbolicLink() || isTempName(ent.name)) continue;
            const childRel = rel ? `${rel}/${ent.name}` : ent.name;
            if (ent.isDirectory()) await walk(path.join(dir, ent.name), childRel);
            else if (ent.isFile()) out.push(childRel);
        }
    }
    await walk(path.resolve(dataDir), "");
    return out.sort();
}

/** The manifest's `counts` for a live data directory - the same figures, computed by snapshot.js's countsOf. */
async function countDataDir(dataDir) {
    const rels = await listDataFiles(dataDir);
    return countsOf(path.resolve(dataDir), Object.fromEntries(rels.map((rel) => [rel, true])));
}

/** What restoring `rels` would do to `dest`: [{ rel, action: create|update, size }] and the unchanged count. */
async function planChanges(dest, rels, files) {
    const changes = [];
    let unchanged = 0;
    for (const rel of rels) {
        const entry = files[rel];
        const target = absOf(dest, rel);
        let st = null;
        try {
            st = await fsp.lstat(target);
        } catch {
            // not there: create
        }
        if (!st) {
            changes.push({ rel, action: "create", size: entry.size });
            continue;
        }
        if (st.isDirectory()) throw new RestoreError(`${rel}: im Ziel ist das ein Verzeichnis, im Schnappschuss eine Datei`);
        if (st.isFile() && st.size === entry.size && await hashFile(target) === entry.sha256) {
            unchanged += 1;
            continue;
        }
        changes.push({ rel, action: "update", size: entry.size });
    }
    return { changes, unchanged };
}

function chmodQuiet(file, mode) {
    try {
        fs.chmodSync(file, mode);
    } catch {
        // Windows knows no 600/644 beyond read-only; tolerated
    }
}

/** The mode (and owner, where allowed) a staged file gets: the replaced file's, else by sensitivity. */
function applyMode(tmp, rel, previous) {
    if (previous && previous.isFile()) {
        chmodQuiet(tmp, previous.mode & 0o777);
        if (typeof process.getuid === "function" && (previous.uid !== process.getuid() || previous.gid !== process.getgid())) {
            try { fs.chownSync(tmp, previous.uid, previous.gid); } catch { /* not root: stays ours */ }
        }
        return;
    }
    chmodQuiet(tmp, SENSITIVE_FILES.has(rel) ? SENSITIVE_MODE : PLAIN_MODE);
}

/** Copies every change to a temporary sibling, checks its hash, then renames them all in one synchronous loop. */
async function applyChanges(src, dest, changes, files) {
    const staged = [];
    let bytes = 0;
    try {
        for (const change of changes) {
            const target = absOf(dest, change.rel);
            await fsp.mkdir(path.dirname(target), { recursive: true, mode: DIR_MODE });
            const previous = await fsp.lstat(target).catch(() => null);
            const tmp = tempPathFor(target);
            staged.push({ tmp, target, rel: change.rel });
            const sha = await copyAndHash(absOf(path.join(src, "data"), change.rel), tmp);
            if (sha !== files[change.rel].sha256) {
                throw new RestoreError(`${change.rel}: die Kopie hat eine andere Prüfsumme als das Manifest (Schnappschuss während des Zurückspielens geändert?)`);
            }
            applyMode(tmp, change.rel, previous);
            bytes += files[change.rel].size;
        }
    } catch (e) {
        for (const { tmp } of staged) fs.rmSync(tmp, { force: true });
        throw e;
    }
    // ---- one tick: every target swaps without an await in between ----
    let done = 0;
    try {
        for (const { tmp, target } of staged) {
            fs.renameSync(tmp, target);
            done += 1;
        }
    } catch (e) {
        for (const { tmp } of staged.slice(done)) fs.rmSync(tmp, { force: true });
        throw new RestoreError(`Zurückspielen nach ${done} von ${staged.length} Dateien abgebrochen: ${e.message}`);
    }
    return bytes;
}

function summaryLine(result) {
    return `${result.updated} geändert, ${result.created} neu, ${result.unchanged} unverändert, `
        + `${result.prune ? `${result.deleted} gelöscht` : `${result.extra.length} nur im Ziel`}`;
}

/**
 * Plays a snapshot back into a data directory. Checks it first (unless an ok `verification` of the same snapshot
 * and `only` is handed in). Never throws: `ok` says how it went, `error` (and `problems` for a failed check) why.
 * A failure before the swap leaves the target untouched.
 *
 * @param {object} o
 * @param {string} o.snapshotDir       a directory with manifest.json and data/
 * @param {string} [o.dataDir]         the target, DATA_DIR by default; created when missing
 * @param {string[]} [o.only]          relative paths (files or directories) to restore; default all
 * @param {boolean} [o.dryRun]         plan and count only, write nothing
 * @param {boolean} [o.prune]          delete files of the target (within `only`) that the snapshot does not hold
 * @param {object} [o.verification]    the result of verifySnapshot(snapshotDir, { only }) - saves the second check
 * @returns {Promise<{ ok, dryRun, prune, snapshotDir, dataDir, only, changes: Array<{ rel, action, size? }>,
 *   created, updated, unchanged, deleted, extra: string[], bytesWritten, countsSnapshot, countsBefore,
 *   countsAfter, error?, problems? }>}  action: create | update | delete; countsAfter is null on a dry run
 */
async function restoreSnapshot(o = {}) {
    const src = path.resolve(String(o.snapshotDir || ""));
    const dest = path.resolve(o.dataDir || DATA_DIR);
    const only = normalizeOnlyList(o.only);
    const dryRun = !!o.dryRun;
    const prune = !!o.prune;
    const result = {
        ok: false, dryRun, prune, snapshotDir: src, dataDir: dest, only, changes: [],
        created: 0, updated: 0, unchanged: 0, deleted: 0, extra: [], bytesWritten: 0,
        countsSnapshot: null, countsBefore: null, countsAfter: null,
    };
    try {
        if (!o.snapshotDir) throw new RestoreError("Kein Schnappschuss angegeben");
        if (isInside(src, dest) || isInside(dest, src)) {
            throw new RestoreError("Schnappschuss und Datenverzeichnis dürfen nicht ineinander liegen");
        }
        const check = o.verification && o.verification.ok && o.verification.dir === src
            && JSON.stringify(o.verification.only || []) === JSON.stringify(only)
            ? o.verification
            : await verifySnapshot(src, { only });
        if (!check.ok) {
            result.problems = check.problems;
            throw new RestoreError(`Schnappschuss fehlerhaft (${check.problems.length} Problem${check.problems.length === 1 ? "" : "e"}), nichts zurückgespielt`);
        }
        const files = check.manifest.files;
        result.countsSnapshot = check.manifest.counts || null;
        result.countsBefore = await countDataDir(dest);
        const plan = await planChanges(dest, check.rels, files);
        result.unchanged = plan.unchanged;
        result.created = plan.changes.filter((c) => c.action === "create").length;
        result.updated = plan.changes.filter((c) => c.action === "update").length;
        result.extra = (await listDataFiles(dest)).filter((rel) => matchesOnly(rel, only) && !Object.prototype.hasOwnProperty.call(files, rel));
        result.changes = [...plan.changes, ...(prune ? result.extra.map((rel) => ({ rel, action: "delete" })) : [])];

        if (!dryRun) {
            await fsp.mkdir(dest, { recursive: true, mode: DIR_MODE });
            result.bytesWritten = await applyChanges(src, dest, plan.changes, files);
            if (prune) {
                for (const rel of result.extra) await fsp.rm(absOf(dest, rel), { force: true });
            }
            result.countsAfter = await countDataDir(dest);
        }
        if (prune) result.deleted = result.extra.length;
        result.ok = true;
        if (!dryRun) logger.info(`Wiederhergestellt aus ${src} nach ${dest}: ${summaryLine(result)}`);
    } catch (e) {
        result.ok = false;
        result.error = (e && e.message) || String(e);
        if (!dryRun) logger.error(`Wiederherstellen aus ${src} fehlgeschlagen: ${result.error}`);
    }
    return result;
}

module.exports = {
    verifySnapshot, restoreSnapshot, countDataDir, listDataFiles, normalizeOnly, matchesOnly, isSafeRel,
    summaryLine, SENSITIVE_FILES, RestoreError,
};
