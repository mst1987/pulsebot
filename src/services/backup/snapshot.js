// A consistent snapshot of DATA_DIR into BACKUP_DIR (#691, docs/data-storage.md "Sichern und Wiederherstellen").
//
// The layout is a contract shared with the off-site copy (#692), the restore (#693), the deploy (#695) and the
// monitoring (#696) - change it only together with them:
//
//   $BACKUP_DIR/                              700
//     snapshots/<YYYYMMDD-HHMMSS>-<reason>/   UTC; reason hourly | deploy | manual | pre-restore
//       manifest.json                         { version: 1, createdAt, reason, commit, fromCommit?, toCommit?,
//                                               files: { "<relpath>": { size, sha256 } }, counts: { ... } }
//       data/...                              mirror of DATA_DIR
//     latest -> snapshots/<newest>            symlink; where the OS refuses one (Windows without the right), a
//                                             file holding "snapshots/<newest>" - read it with latestSnapshot()
//     status/snapshot.json                    { at, ok, reason, durationMs, bytes, error? }
//   A snapshot is built in snapshots/.<name>.part/ and renamed when complete; readers skip names with a dot.
//
// How one run goes:
//   1. Lock ($BACKUP_DIR/.snapshot.lock, also against the CLI in another process) and the space guard (under 10 %
//      free on the backup filesystem: no snapshot, status ok:false).
//   2. settings/ and sessions.json are copied SYNCHRONOUSLY, in one tick of the event loop. Every store writes
//      synchronously (jsonStore.js: writeFileSync + rename; auth.js and categoryNames.js write in place, but also
//      synchronously), so no write can land between two files: the copy is one state across all of them. This is
//      the only part that blocks - a few MB of copy_file_range.
//   3. Everything else (reports/, raidplan-maps/, sim/, ...) asynchronously, file by file: a file whose size and
//      mtime equal its copy in the previous snapshot is hard-linked to it (rsnapshot), with the sha256 taken from
//      the previous manifest; a new or changed one is streamed across and hashed on the way. Copies keep the mtime
//      of the original, which is what makes the next comparison work. Where a link fails (another filesystem, an
//      FS without hard links) the file is copied.
//   4. manifest.json, rename .part -> final, point `latest` at it, prune by retention (retention.js).
//   5. status/snapshot.json and one log line - also on failure. Nothing here throws to the caller.
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { Transform } = require("stream");
const { pipeline } = require("stream/promises");
const { performance } = require("perf_hooks");
const { DATA_DIR } = require("../../config/paths");
const { writeJsonAtomic, writeFileAtomic, readJsonFile } = require("../../stores/jsonStore");
const { diskSpace } = require("../system/diskUsage");
const { snapshotsToDelete } = require("./retention");
const { resolveBackupDir, BACKUP_DEFAULTS } = require("./backupConfig");
const logger = require("../../logger").child("backup");

const REASONS = ["hourly", "deploy", "manual", "pre-restore"];
const NAME_RE = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(hourly|deploy|manual|pre-restore)$/;
const MANIFEST_VERSION = 1;
/** Under this share of free space on the backup filesystem no snapshot is taken. */
const MIN_FREE_RATIO = 0.1;
const LOCK_NAME = ".snapshot.lock";
/** A lock older than this is a crashed run's, whoever holds it. */
const LOCK_STALE_MS = 2 * 60 * 60 * 1000;
/** Top-level entries of DATA_DIR copied in the synchronous part. */
const SYNC_ENTRIES = ["settings", "sessions.json"];
/** Two mtimes closer than this are the same (utimes goes through a double of seconds). */
const MTIME_TOLERANCE_MS = 1;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

class BackupError extends Error {}

const round1 = (n) => Math.round(n * 10) / 10;

/** "20261010-143005-hourly": the UTC time of `ms` and the reason. */
function snapshotName(ms, reason) {
    const iso = new Date(ms).toISOString();
    return `${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 19).replace(/:/g, "")}-${reason}`;
}

/** { name, reason, at } of a snapshot directory name, or null for anything else (dot names included). */
function parseSnapshotName(name) {
    const m = NAME_RE.exec(String(name || ""));
    if (!m) return null;
    const at = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return Number.isFinite(at) ? { name: m[0], reason: m[7], at } : null;
}

const snapshotsDirOf = (backupDir) => path.join(backupDir, "snapshots");
const statusFileOf = (backupDir) => path.join(backupDir, "status", "snapshot.json");

/** The finished snapshots under `backupDir`, oldest first: [{ name, reason, at, dir }]. */
function listSnapshots(backupDir) {
    const dir = snapshotsDirOf(backupDir);
    let names;
    try {
        names = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
    return names
        .filter((ent) => ent.isDirectory())
        .map((ent) => parseSnapshotName(ent.name))
        .filter(Boolean)
        .map((snap) => ({ ...snap, dir: path.join(dir, snap.name) }))
        .sort((a, b) => a.at - b.at || a.name.localeCompare(b.name));
}

/** The manifest of a snapshot directory, or null. */
function readManifest(snapshotDir) {
    return readJsonFile(path.join(snapshotDir, "manifest.json"), null);
}

const hasManifest = (dir) => fs.existsSync(path.join(dir, "manifest.json"));

/** The snapshot name `latest` names: the target of the symlink or the content of the fallback file. */
function latestName(backupDir) {
    const link = path.join(backupDir, "latest");
    try {
        const st = fs.lstatSync(link);
        const target = st.isSymbolicLink() ? fs.readlinkSync(link) : st.isFile() ? fs.readFileSync(link, "utf8") : "";
        return path.basename(String(target).trim().replace(/[\\/]+$/, ""));
    } catch {
        return "";
    }
}

/**
 * The newest complete snapshot: what `latest` points at (symlink or the Windows fallback file), else the newest
 * directory with a manifest. { name, reason, at, dir } or null. For the restore (#693) and the monitoring (#696).
 */
function latestSnapshot(backupDir = resolveBackupDir()) {
    const named = parseSnapshotName(latestName(backupDir));
    if (named) {
        const dir = path.join(snapshotsDirOf(backupDir), named.name);
        if (hasManifest(dir)) return { ...named, dir };
    }
    const list = listSnapshots(backupDir).filter((s) => hasManifest(s.dir));
    return list.length ? list[list.length - 1] : null;
}

/**
 * Point `latest` at snapshots/<name>: a relative symlink, swapped in by rename; where no symlink can be made, a
 * file with the relative path. Returns "symlink" or "file".
 */
function setLatest(backupDir, name, fsApi = fs) {
    const link = path.join(backupDir, "latest");
    const target = `snapshots/${name}`;
    const tmp = path.join(backupDir, `.latest.${process.pid}.tmp`);
    try {
        fsApi.rmSync(tmp, { force: true });
        fsApi.symlinkSync(target, tmp, "dir");
        fsApi.renameSync(tmp, link);
        return "symlink";
    } catch {
        try { fsApi.rmSync(tmp, { force: true }); } catch { /* not there */ }
    }
    try {
        // A symlink left from a run that could make one would be followed by the rename on some systems.
        if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link);
    } catch {
        // no latest yet
    }
    writeFileAtomic(link, `${target}\n`);
    chmodQuiet(link, FILE_MODE);
    return "file";
}

/** chmod that never fails: Windows knows no 700/600 beyond read-only, and a foreign owner may refuse it. */
function chmodQuiet(file, mode) {
    try {
        fs.chmodSync(file, mode);
    } catch {
        // tolerated: see above
    }
}

function ensurePrivateDir(dir) {
    fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
    chmodQuiet(dir, DIR_MODE);
}

function isInside(child, parent) {
    const rel = path.relative(parent, child);
    return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

/** The temporary sibling of an atomic store write (jsonStore.tempPathFor): never part of a snapshot. */
const isTempName = (name) => name.startsWith(".") && name.endsWith(".tmp");

const relOf = (...parts) => parts.filter(Boolean).join("/");
const absOf = (root, rel) => path.join(root, ...rel.split("/"));

// --- lock ------------------------------------------------------------------------------------------------------

function pidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return !!e && e.code === "EPERM";
    }
}

function lockIsStale(file, now) {
    const info = readJsonFile(file, null);
    if (!info) {
        // Being written this very moment, or garbage: only its age can tell.
        try { return now - fs.statSync(file).mtimeMs > LOCK_STALE_MS; } catch { return true; }
    }
    if (!(now - Number(info.at) <= LOCK_STALE_MS)) return true;
    return info.host === os.hostname() && Number.isInteger(info.pid) && !pidAlive(info.pid);
}

/** The lock of `backupDir`, or null while another run (this process or another) holds it. */
function acquireLock(backupDir, now) {
    const file = path.join(backupDir, LOCK_NAME);
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const fd = fs.openSync(file, "wx", FILE_MODE);
            try {
                fs.writeSync(fd, JSON.stringify({ pid: process.pid, host: os.hostname(), at: now }));
            } finally {
                fs.closeSync(fd);
            }
            return { file, release: () => { try { fs.unlinkSync(file); } catch { /* gone */ } } };
        } catch (e) {
            if (!e || e.code !== "EEXIST") throw e;
            if (!lockIsStale(file, now)) return null;
            try { fs.unlinkSync(file); } catch { /* someone else cleared it */ }
        }
    }
    return null;
}

// --- the synchronous part --------------------------------------------------------------------------------------

function copyFileSyncInto(src, dest, rel, out) {
    try {
        fs.copyFileSync(src, dest, fs.constants.COPYFILE_FICLONE);
    } catch (e) {
        if (e && e.code === "ENOENT") return;
        throw e;
    }
    chmodQuiet(dest, FILE_MODE);
    out.push({ rel, abs: dest, size: fs.statSync(dest).size });
}

function copyTreeSync(src, dest, rel, out) {
    let entries;
    try {
        entries = fs.readdirSync(src, { withFileTypes: true });
    } catch (e) {
        if (e && e.code === "ENOENT") return;
        throw e;
    }
    fs.mkdirSync(dest, { recursive: true, mode: DIR_MODE });
    for (const ent of entries) {
        if (ent.isSymbolicLink() || isTempName(ent.name)) continue;
        const childRel = relOf(rel, ent.name);
        if (ent.isDirectory()) copyTreeSync(path.join(src, ent.name), path.join(dest, ent.name), childRel, out);
        else if (ent.isFile()) copyFileSyncInto(path.join(src, ent.name), path.join(dest, ent.name), childRel, out);
    }
}

/**
 * settings/ and sessions.json into `destData`, synchronously - no await, no callback, so no store write can come
 * between two files. Returns [{ rel, abs, size }].
 */
function copySyncPart(dataDir, destData) {
    const out = [];
    copyTreeSync(path.join(dataDir, "settings"), path.join(destData, "settings"), "settings", out);
    const sessions = path.join(dataDir, "sessions.json");
    if (fs.existsSync(sessions)) copyFileSyncInto(sessions, path.join(destData, "sessions.json"), "sessions.json", out);
    return out;
}

// --- the asynchronous part -------------------------------------------------------------------------------------

async function hashFile(file) {
    const hash = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    return hash.digest("hex");
}

/** Streams `src` to `dest` (which must not exist yet) and returns the sha256 of what was written. */
async function copyAndHash(src, dest) {
    const hash = crypto.createHash("sha256");
    const tap = new Transform({
        transform(chunk, _enc, done) {
            hash.update(chunk);
            done(null, chunk);
        },
    });
    await pipeline(fs.createReadStream(src), tap, fs.createWriteStream(dest, { flags: "wx", mode: FILE_MODE }));
    return hash.digest("hex");
}

const isSha256 = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

/** The previous snapshot as { dir, files } for the comparison, or null. */
function previousSnapshot(backupDir) {
    const prev = latestSnapshot(backupDir);
    if (!prev) return null;
    const manifest = readManifest(prev.dir);
    if (!manifest || !manifest.files || typeof manifest.files !== "object") return null;
    return { dir: prev.dir, files: manifest.files };
}

/** Its sha256 when `rel` is unchanged since the previous snapshot and is now hard-linked to it, else null. */
async function linkUnchanged(rel, st, dest, prev, fsApi) {
    if (!prev) return null;
    const entry = prev.files[rel];
    if (!entry || entry.size !== st.size || !isSha256(entry.sha256)) return null;
    const prevFile = absOf(path.join(prev.dir, "data"), rel);
    let pst;
    try {
        pst = await fsApi.stat(prevFile);
    } catch {
        return null;
    }
    if (pst.size !== st.size || Math.abs(pst.mtimeMs - st.mtimeMs) >= MTIME_TOLERANCE_MS) return null;
    try {
        await fsApi.link(prevFile, dest);
        return entry.sha256;
    } catch {
        return null;
    }
}

/**
 * A copy whose content turned out to equal the previous snapshot's file (same sha256, other mtime): swap it for a
 * hard link, which saves the space. The copy stays where the link fails.
 */
async function relinkSameContent(rel, sha, size, dest, prev, fsApi) {
    if (!prev) return false;
    const entry = prev.files[rel];
    if (!entry || entry.sha256 !== sha || entry.size !== size) return false;
    const tmp = `${dest}.link`;
    try {
        await fsApi.link(absOf(path.join(prev.dir, "data"), rel), tmp);
        await fsp.rename(tmp, dest);
        return true;
    } catch {
        await fsp.rm(tmp, { force: true }).catch(() => {});
        return false;
    }
}

/** Every file of DATA_DIR but the synchronous part, as [{ rel, abs }]; symlinks and temp files left out. */
async function listAsyncFiles(dataDir) {
    const out = [];
    async function walk(dir, rel) {
        let entries;
        try {
            entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const ent of entries) {
            if (!rel && SYNC_ENTRIES.includes(ent.name)) continue;
            if (ent.isSymbolicLink() || isTempName(ent.name)) continue;
            const childRel = relOf(rel, ent.name);
            if (ent.isDirectory()) await walk(path.join(dir, ent.name), childRel);
            else if (ent.isFile()) out.push({ rel: childRel, abs: path.join(dir, ent.name) });
        }
    }
    await walk(dataDir, "");
    return out;
}

/** The incremental part: fills `files` and `stats`. */
async function copyAsyncPart({ dataDir, destData, prev, fsApi, files, stats }) {
    for (const { rel, abs } of await listAsyncFiles(dataDir)) {
        let st;
        try {
            st = await fsp.stat(abs);
        } catch {
            continue; // deleted since the listing
        }
        const dest = absOf(destData, rel);
        await fsp.mkdir(path.dirname(dest), { recursive: true, mode: DIR_MODE });
        const linkedSha = await linkUnchanged(rel, st, dest, prev, fsApi);
        if (linkedSha) {
            files[rel] = { size: st.size, sha256: linkedSha };
            stats.linked += 1;
            continue;
        }
        let sha;
        try {
            sha = await copyAndHash(abs, dest);
        } catch (e) {
            if (e && e.code === "ENOENT") {
                await fsp.rm(dest, { force: true }).catch(() => {});
                continue;
            }
            throw e;
        }
        const size = (await fsp.stat(dest)).size;
        if (await relinkSameContent(rel, sha, size, dest, prev, fsApi)) {
            stats.linked += 1;
        } else {
            // The original's mtime, so the next run sees the file as unchanged.
            await fsp.utimes(dest, st.atime, st.mtime).catch(() => {});
            chmodQuiet(dest, FILE_MODE);
            stats.copied += 1;
            stats.copiedBytes += size;
        }
        files[rel] = { size, sha256: sha };
    }
}

// --- manifest --------------------------------------------------------------------------------------------------

async function readJsonAsync(file) {
    try {
        return JSON.parse(await fsp.readFile(file, "utf8"));
    } catch {
        return null;
    }
}

const sizeOf = (value) => (Array.isArray(value) ? value.length : value && typeof value === "object" ? Object.keys(value).length : 0);

/** Plausibility figures for the restore check (#693/#694): how much of the important data a snapshot holds. */
async function countsOf(destData, files) {
    const rels = Object.keys(files);
    const events = await readJsonAsync(path.join(destData, "settings", "events.json"));
    const signups = await readJsonAsync(path.join(destData, "settings", "signups.json"));
    const rosters = await readJsonAsync(path.join(destData, "settings", "rosters.json"));
    const raidplans = await readJsonAsync(path.join(destData, "settings", "raidplans.json"));
    const sessions = await readJsonAsync(path.join(destData, "sessions.json"));
    const bySignupEvent = signups && signups.signups && typeof signups.signups === "object" ? Object.values(signups.signups) : [];
    return {
        events: sizeOf(events && events.events),
        signups: bySignupEvent.reduce((sum, users) => sum + sizeOf(users), 0),
        rosters: sizeOf(rosters && rosters.rosters),
        raidplans: sizeOf(raidplans && raidplans.plans),
        reports: rels.filter((r) => r.startsWith("reports/") && r.endsWith(".json")).length,
        raidplanMaps: rels.filter((r) => r.startsWith("raidplan-maps/")).length,
        sessions: sizeOf(sessions),
        files: rels.length,
    };
}

// --- pruning ---------------------------------------------------------------------------------------------------

/** Snapshot directories a crashed run left half-built (`.<name>.part`). Only under the lock. */
async function removeStaleParts(backupDir) {
    let entries;
    try {
        entries = await fsp.readdir(snapshotsDirOf(backupDir));
    } catch {
        return;
    }
    for (const name of entries) {
        if (name.startsWith(".") && name.endsWith(".part")) {
            await fsp.rm(path.join(snapshotsDirOf(backupDir), name), { recursive: true, force: true }).catch(() => {});
        }
    }
}

/** Deletes what the retention lets go; returns the deleted names. Only under the lock. */
async function pruneSnapshots(backupDir, now, retention) {
    const gone = [];
    for (const snap of snapshotsToDelete(listSnapshots(backupDir), now, retention)) {
        await fsp.rm(snap.dir, { recursive: true, force: true });
        gone.push(snap.name);
    }
    return gone;
}

// --- status ----------------------------------------------------------------------------------------------------

/** status/snapshot.json, or null. For the monitoring (#696). */
function readStatus(backupDir = resolveBackupDir()) {
    return readJsonFile(statusFileOf(backupDir), null);
}

function writeStatus(backupDir, status) {
    const file = statusFileOf(backupDir);
    writeJsonAtomic(file, status);
    chmodQuiet(file, FILE_MODE);
}

/** A free name: the next second when this one is taken (two runs within one second). */
function freeName(backupDir, at, reason) {
    for (let t = at; ; t += 1000) {
        const name = snapshotName(t, reason);
        const dir = snapshotsDirOf(backupDir);
        if (!fs.existsSync(path.join(dir, name)) && !fs.existsSync(path.join(dir, `.${name}.part`))) return name;
    }
}

// --- the run ---------------------------------------------------------------------------------------------------

/** The space guard: throws when the backup filesystem has less than `minFreeRatio` free. Unknown space passes. */
async function checkSpace(backupDir, fsApi, minFreeRatio) {
    const space = await diskSpace(backupDir, fsApi);
    if (space && space.free / space.total < minFreeRatio) {
        const pct = round1((space.free / space.total) * 100);
        throw new BackupError(`Zu wenig freier Speicher: ${pct} % frei, mindestens ${Math.round(minFreeRatio * 100)} % nötig`);
    }
}

/**
 * Builds the snapshot under the lock: .part directory, the synchronous and the asynchronous part, the manifest,
 * the rename and `latest`. `ctx.partDir` names the .part directory while there is one, so the caller can remove it
 * after a failure. Fills `result`.
 */
async function build(ctx, result) {
    const { o, dataDir, backupDir, reason, startedAt, fsApi, hooks } = ctx;
    await checkSpace(backupDir, fsApi, ctx.minFreeRatio);
    await removeStaleParts(backupDir);
    const name = freeName(backupDir, startedAt, reason);
    const partDir = path.join(snapshotsDirOf(backupDir), `.${name}.part`);
    ctx.partDir = partDir;
    const destData = path.join(partDir, "data");
    fs.mkdirSync(destData, { recursive: true, mode: DIR_MODE });
    chmodQuiet(partDir, DIR_MODE);

    // ---- one tick: nothing asynchronous between these two lines ----
    const s0 = performance.now();
    const syncFiles = copySyncPart(dataDir, destData);
    result.syncMs = round1(performance.now() - s0);
    // ----------------------------------------------------------------

    if (hooks.afterSync) await hooks.afterSync();
    const prev = previousSnapshot(backupDir);
    const files = {};
    for (const f of syncFiles) files[f.rel] = { size: f.size, sha256: await hashFile(f.abs) };
    const stats = { linked: 0, copied: syncFiles.length, copiedBytes: syncFiles.reduce((s, f) => s + f.size, 0) };
    await copyAsyncPart({ dataDir, destData, prev, fsApi, files, stats });

    const sorted = Object.fromEntries(Object.keys(files).sort().map((k) => [k, files[k]]));
    const manifest = {
        version: MANIFEST_VERSION,
        createdAt: new Date(startedAt).toISOString(),
        reason,
        commit: String(o.commit || ""),
        ...(o.fromCommit ? { fromCommit: String(o.fromCommit) } : {}),
        ...(o.toCommit ? { toCommit: String(o.toCommit) } : {}),
        files: sorted,
        counts: await countsOf(destData, sorted),
    };
    const manifestFile = path.join(partDir, "manifest.json");
    writeJsonAtomic(manifestFile, manifest);
    chmodQuiet(manifestFile, FILE_MODE);
    if (hooks.beforeFinish) await hooks.beforeFinish();

    const finalDir = path.join(snapshotsDirOf(backupDir), name);
    await fsp.rename(partDir, finalDir);
    ctx.partDir = null;
    result.latest = setLatest(backupDir, name);
    Object.assign(result, {
        ok: true, name, dir: finalDir,
        bytes: Object.values(sorted).reduce((s, f) => s + f.size, 0),
        files: Object.keys(sorted).length,
        linked: stats.linked, copied: stats.copied, copiedBytes: stats.copiedBytes,
    });
}

/** status/snapshot.json and the log line of a finished (or failed) run. Never throws. */
function report(backupDir, result, at, writeStatusFile = true) {
    if (writeStatusFile) {
        try {
            writeStatus(backupDir, {
                at: new Date(at).toISOString(),
                ok: result.ok,
                reason: result.reason,
                durationMs: result.durationMs,
                bytes: result.bytes,
                ...(result.ok ? {} : { error: result.error }),
            });
        } catch (e) {
            logger.error(`Status der Sicherung nicht geschrieben: ${e.message}`);
        }
    }
    if (!result.ok) {
        logger.error(`Schnappschuss (${result.reason}) fehlgeschlagen: ${result.error}`);
        return;
    }
    const mb = (n) => `${round1(n / 1024 / 1024)} MB`;
    logger.info(`Schnappschuss ${result.name}: ${result.files} Dateien, ${mb(result.bytes)} (${result.linked} verlinkt, `
        + `${result.copied} kopiert = ${mb(result.copiedBytes)}), synchron ${result.syncMs} ms, gesamt ${result.durationMs} ms`
        + (result.pruned.length ? `, ${result.pruned.length} alte entfernt` : ""));
}

/**
 * One snapshot. Never throws: the result says how it went, status/snapshot.json and the log say it too (a run
 * skipped because another one holds the lock writes no status - that one will).
 *
 * @param {object} [o]
 * @param {string} [o.reason]       hourly | deploy | manual | pre-restore
 * @param {string} [o.dataDir]      DATA_DIR
 * @param {string} [o.backupDir]    BACKUP_DIR
 * @param {string} [o.commit]       the commit of the running code (src/web/http/version.js)
 * @param {string} [o.fromCommit]   deploy: the commit before ...
 * @param {string} [o.toCommit]     ... and after it
 * @param {object} [o.retention]    the `retention` block of the backup settings; null = no pruning
 * @param {Function} [o.now]        clock (ms)
 * @param {number} [o.minFreeRatio] the space guard
 * @param {object} [o.fsApi]        over fs/promises: { stat, link, statfs } - tests replace single calls
 * @param {object} [o.hooks]        tests: { afterSync, beforeFinish } (may be async)
 * @returns {Promise<{ ok, reason, name, dir, bytes, files, linked, copied, copiedBytes, syncMs, durationMs,
 *   latest, pruned, error?, skipped? }>}
 */
async function createSnapshot(o = {}) {
    const now = o.now || Date.now;
    const ctx = {
        o,
        reason: o.reason || "manual",
        dataDir: path.resolve(o.dataDir || DATA_DIR),
        backupDir: path.resolve(o.backupDir || resolveBackupDir()),
        fsApi: { ...fsp, ...(o.fsApi || {}) },
        hooks: o.hooks || {},
        minFreeRatio: o.minFreeRatio === undefined ? MIN_FREE_RATIO : o.minFreeRatio,
        startedAt: now(),
        partDir: null,
    };
    const { backupDir, reason } = ctx;
    const retention = o.retention === null ? null : { ...BACKUP_DEFAULTS.retention, ...(o.retention || {}) };
    const t0 = performance.now();
    const result = {
        ok: false, reason, name: null, dir: null, bytes: 0, files: 0, linked: 0, copied: 0, copiedBytes: 0,
        syncMs: 0, durationMs: 0, latest: null, pruned: [],
    };
    let lock = null;
    let writeStatusFile = true;
    try {
        if (!REASONS.includes(reason)) throw new BackupError(`Unbekannter Anlass "${reason}" (erlaubt: ${REASONS.join(", ")})`);
        if (isInside(backupDir, ctx.dataDir) || isInside(ctx.dataDir, backupDir)) {
            // No status either: it would land inside DATA_DIR.
            throw Object.assign(new BackupError("BACKUP_DIR und DATA_DIR dürfen nicht ineinander liegen"), { noStatus: true });
        }
        ensurePrivateDir(backupDir);
        ensurePrivateDir(snapshotsDirOf(backupDir));
        ensurePrivateDir(path.dirname(statusFileOf(backupDir)));
        lock = acquireLock(backupDir, ctx.startedAt);
        if (lock) {
            await build(ctx, result);
            if (retention) result.pruned = await pruneSnapshots(backupDir, now(), retention).catch((e) => {
                logger.warn(`Aufräumen alter Schnappschüsse fehlgeschlagen: ${e.message}`);
                return [];
            });
        } else {
            result.skipped = "locked";
            result.error = "Ein anderer Schnappschuss läuft gerade";
        }
    } catch (e) {
        result.ok = false;
        result.error = (e && e.message) || String(e);
        if (e && e.noStatus) writeStatusFile = false;
    } finally {
        if (ctx.partDir) await fsp.rm(ctx.partDir, { recursive: true, force: true }).catch(() => {});
        if (lock) lock.release();
    }
    result.durationMs = Math.round(performance.now() - t0);
    if (result.skipped) logger.warn(`Schnappschuss (${reason}) übersprungen: ${result.error}`);
    else report(backupDir, result, now(), writeStatusFile);
    return result;
}

module.exports = {
    createSnapshot, latestSnapshot, listSnapshots, readManifest, readStatus,
    snapshotName, parseSnapshotName, setLatest, pruneSnapshots, copySyncPart, acquireLock,
    REASONS, MIN_FREE_RATIO, LOCK_NAME, MANIFEST_VERSION,
};
