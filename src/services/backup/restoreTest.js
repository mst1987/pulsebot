// The weekly restore probe (#694, docs/backup.md "Wiederherstellungsprobe"): does the newest snapshot really come
// back? A backup that quietly broke (full disk, permissions, a store that suddenly writes somewhere else) shows here,
// not on the day it is needed.
//
// One run:
//   1. The newest complete snapshot (not a pre-restore one) is checked with verifySnapshot (#693) - manifest, size
//      and sha256 of every file, every *.json parses.
//   2. restoreSnapshot (#693) plays it back into a fresh scratch directory $BACKUP_DIR/.restore-test-<id>/data -
//      on the backup disk, not in os.tmpdir() (on the server that may be a small tmpfs or another disk), with a dot
//      name, so every reader of the snapshot directory passes it by. Before that the free space is checked.
//   3. Every store on jsonStore.js reads its restored file through its own normalize, via store.readStrict(file):
//      no fallback to the defaults (read() would hand out the defaults for an unreadable file and the probe would
//      pass), and no useFile() - the probe runs inside the live bot, and between a useFile(probe) and the
//      useFile(null) any request (or a write!) of the bot would have gone to the probe's files. readStrict touches
//      neither the store's file nor its cache. A store file the snapshot lacks although it existed live before the
//      snapshot was taken is a problem too ("a store writes somewhere else").
//   4. The counts: the restored data must give exactly the manifest's counts, and against the live data no count may
//      be more than 20 % lower in the snapshot (when live has at least 10) - a backup that quietly went empty.
//   5. The scratch directory is always removed (finally), and the result goes to $BACKUP_DIR/status/restore-test.json
//      for the monitoring (#696, backupStatus.js): { at, ok, durationMs, bytes, snapshot, problems, counts:
//      { snapshot, restored, live }, stores, loop, error? }.
// Low load: the copy and the checks are asynchronous file by file, and the store reads give the event loop a turn
// (setImmediate) after every file; the run measures the event-loop delay it saw (`loop`). Never throws.
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { monitorEventLoopDelay, performance } = require("perf_hooks");
const { DATA_DIR } = require("../../config/paths");
const { writeJsonAtomic, readJsonFile, registeredStores } = require("../../stores/jsonStore");
const { newId } = require("../../utils/ids");
const { diskSpace } = require("../system/diskUsage");
const { listSnapshots, readManifest } = require("./snapshot");
const { verifySnapshot, restoreSnapshot, countDataDir } = require("./restore");
const { resolveBackupDir } = require("./backupConfig");
const logger = require("../../logger").child("backup");

const STATUS_NAME = "restore-test.json";
const SCRATCH_PREFIX = ".restore-test-";
/** A count of the snapshot this much below the live one is a problem ... */
const MAX_DROP = 0.2;
/** ... once the live count is at least this. */
const MIN_LIVE = 10;
/** The counts compared with the live data: sessions come and go on their own and are left out. */
const LIVE_KEYS = ["events", "signups", "rosters", "raidplans", "reports", "raidplanMaps", "files"];
/** The restore needs room for one copy of the data, and the disk keeps this share free besides. */
const MIN_FREE_RATIO = 0.1;
/** At most this many problems go into the status file. */
const MAX_PROBLEMS = 50;
/** A live file this much older than the snapshot should be in it (mtime vs. the snapshot's second). */
const MTIME_SLACK_MS = 2000;
const STORES_DIR = path.join(__dirname, "..", "..", "stores");

let running = false;

const round1 = (n) => Math.round(n * 10) / 10;
const yieldToLoop = () => new Promise((resolve) => setImmediate(resolve));
const absOf = (root, rel) => path.join(root, ...rel.split("/"));
const statusFileOf = (backupDir) => path.join(backupDir, "status", STATUS_NAME);

function isInside(child, parent) {
    const rel = path.relative(parent, child);
    return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Every store on jsonStore.js below `root`: [{ rel, readStrict }]. Requires each src/stores/*Store.js first, so a
 * store the running process has not needed yet is checked as well (in the bot they are all loaded already).
 */
function storeChecks(root = DATA_DIR) {
    for (const name of fs.readdirSync(STORES_DIR)) {
        if (name.endsWith("Store.js")) require(path.join(STORES_DIR, name));
    }
    // Two stores over one file (configStore's raw view next to the normalised one) are both read: their normalize differs.
    return registeredStores()
        .filter((store) => isInside(store.defaultFile, root)) // not a test's or a script's own store elsewhere
        .map((store) => ({ rel: path.relative(root, store.defaultFile).split(path.sep).join("/"), readStrict: store.readStrict }))
        .sort((a, b) => a.rel.localeCompare(b.rel));
}

/** The newest snapshot with a manifest that is not a pre-restore one (that is the state a restore threw away). */
function newestSnapshot(backupDir) {
    const list = listSnapshots(backupDir).filter((s) => s.reason !== "pre-restore");
    for (let i = list.length - 1; i >= 0; i -= 1) {
        if (fs.existsSync(path.join(list[i].dir, "manifest.json"))) return list[i];
    }
    return null;
}

/** Scratch directories a crashed probe left behind. */
async function removeStaleScratch(backupDir) {
    let names;
    try {
        names = await fsp.readdir(backupDir);
    } catch {
        return;
    }
    for (const name of names) {
        if (name.startsWith(SCRATCH_PREFIX)) await fsp.rm(path.join(backupDir, name), { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    }
}

/** Each store reads its restored file; a store file missing from the snapshot although it existed live before. */
async function readStores({ checks, files, restoredDir, liveDir, snapshotAt, problems }) {
    const result = { checked: 0, missing: 0, failed: 0 };
    for (const { rel, readStrict } of checks) {
        if (Object.prototype.hasOwnProperty.call(files, rel)) {
            result.checked += 1;
            try {
                readStrict(absOf(restoredDir, rel));
            } catch (e) {
                result.failed += 1;
                problems.push({ rel, problem: `Der Store liest die Datei nicht: ${(e && e.message) || e}` });
            }
            await yieldToLoop();
            continue;
        }
        const st = await fsp.stat(absOf(liveDir, rel)).catch(() => null);
        if (st && st.isFile() && st.mtimeMs < snapshotAt - MTIME_SLACK_MS) {
            result.missing += 1;
            problems.push({ rel, problem: "Fehlt im Schnappschuss, obwohl die Datei schon vorher existierte" });
        }
    }
    return result;
}

/** The restored counts must equal the manifest's; none may lie more than MAX_DROP below the live one. */
function compareCounts({ snapshot, restored, live }, problems) {
    if (snapshot && restored) {
        for (const key of Object.keys(snapshot)) {
            if (restored[key] !== snapshot[key]) {
                problems.push({ rel: `counts.${key}`, problem: `Nach dem Zurückspielen ${restored[key]} statt ${snapshot[key]} laut Manifest` });
            }
        }
    }
    if (snapshot && live) {
        for (const key of LIVE_KEYS) {
            const l = Number(live[key]) || 0;
            const s = Number(snapshot[key]) || 0;
            if (l >= MIN_LIVE && s < l * (1 - MAX_DROP)) {
                problems.push({ rel: `counts.${key}`, problem: `Im Schnappschuss ${s}, live ${l}: mehr als ${Math.round(MAX_DROP * 100)} % weniger` });
            }
        }
    }
}

/** "2 Probleme - settings/events.json: kein gültiges JSON; ..." - the short line for the status tile and the DM. */
function errorLine(problems) {
    const head = problems.slice(0, 3).map((p) => (p.rel ? `${p.rel}: ${p.problem}` : p.problem)).join("; ");
    const more = problems.length > 3 ? ` (und ${problems.length - 3} weitere)` : "";
    return `${problems.length} Problem${problems.length === 1 ? "" : "e"} - ${head}${more}`;
}

function chmodQuiet(file, mode) {
    try {
        fs.chmodSync(file, mode);
    } catch {
        // Windows knows no 600 beyond read-only
    }
}

function writeStatus(backupDir, status) {
    try {
        const file = statusFileOf(backupDir);
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        writeJsonAtomic(file, status);
        chmodQuiet(file, 0o600);
        return true;
    } catch (e) {
        logger.error(`Wiederherstellungsprobe: Status nicht geschrieben: ${e.message}`);
        return false;
    }
}

/** The body of one run, filling `ctx` (problems, counts, ...). Throws only for the unexpected. */
async function probe(ctx) {
    const { backupDir, dataDir, problems } = ctx;
    await removeStaleScratch(backupDir);
    const snap = newestSnapshot(backupDir);
    if (!snap) {
        problems.push({ rel: "", problem: "Kein Schnappschuss vorhanden" });
        return;
    }
    const manifest = readManifest(snap.dir) || {};
    ctx.snapshot = { name: snap.name, reason: snap.reason, at: new Date(snap.at).toISOString(), commit: String(manifest.commit || "") };

    const verification = await verifySnapshot(snap.dir);
    if (!verification.ok) {
        problems.push(...verification.problems);
        return;
    }
    ctx.bytes = verification.bytes;
    ctx.files = verification.rels.length;
    ctx.counts.snapshot = verification.manifest.counts || null;

    const space = await diskSpace(backupDir);
    if (space && space.free - verification.bytes < space.total * MIN_FREE_RATIO) {
        problems.push({ rel: "", problem: `Zu wenig Platz für die Probe: ${verification.bytes} Bytes nötig, ${space.free} frei` });
        return;
    }

    ctx.scratch = path.join(backupDir, `${SCRATCH_PREFIX}${newId(6)}`);
    const restoredDir = path.join(ctx.scratch, "data");
    await fsp.mkdir(ctx.scratch, { recursive: true, mode: 0o700 });
    const restored = await restoreSnapshot({ snapshotDir: snap.dir, dataDir: restoredDir, verification });
    if (!restored.ok) {
        problems.push({ rel: "", problem: `Zurückspielen fehlgeschlagen: ${restored.error}` }, ...(restored.problems || []));
        return;
    }
    ctx.counts.restored = restored.countsAfter;
    ctx.stores = await readStores({
        checks: ctx.checks(), files: verification.manifest.files, restoredDir, liveDir: dataDir, snapshotAt: snap.at, problems,
    });
    ctx.counts.live = await countDataDir(dataDir);
    compareCounts(ctx.counts, problems);
}

/**
 * One restore probe. Never throws; a second call while one runs in this process gets { ok: false, skipped: "locked" }
 * and writes nothing.
 *
 * @param {object} [o]
 * @param {string} [o.backupDir]   resolveBackupDir() by default
 * @param {string} [o.dataDir]     the live data, DATA_DIR by default: the counts and the "existed before" check
 * @param {Function|number} [o.now]  clock (ms), Date.now by default
 * @param {Function} [o.stores]    () => [{ rel, readStrict }] instead of storeChecks() (tests)
 * @returns {Promise<object>} what went into status/restore-test.json, plus `statusWritten`
 */
async function runRestoreTest(o = {}) {
    if (running) return { ok: false, skipped: "locked", error: "Eine Wiederherstellungsprobe läuft gerade" };
    running = true;
    const clock = typeof o.now === "function" ? o.now : () => (Number.isFinite(o.now) ? o.now : Date.now());
    const backupDir = path.resolve(o.backupDir || resolveBackupDir());
    const dataDir = path.resolve(o.dataDir || DATA_DIR);
    const at = clock();
    const started = performance.now();
    const loop = monitorEventLoopDelay({ resolution: 10 });
    loop.enable();
    const ctx = {
        backupDir, dataDir, problems: [], snapshot: null, bytes: 0, files: 0, scratch: null,
        counts: { snapshot: null, restored: null, live: null }, stores: null,
        checks: o.stores || (() => storeChecks()),
    };
    try {
        await probe(ctx);
    } catch (e) {
        ctx.problems.push({ rel: "", problem: `Unerwarteter Fehler: ${(e && e.message) || e}` });
    } finally {
        if (ctx.scratch) {
            await fsp.rm(ctx.scratch, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
            if (fs.existsSync(ctx.scratch)) ctx.problems.push({ rel: "", problem: `Probe-Verzeichnis ließ sich nicht löschen: ${ctx.scratch}` });
        }
        loop.disable();
        running = false;
    }
    const ok = ctx.problems.length === 0;
    const status = {
        at: new Date(at).toISOString(),
        ok,
        durationMs: Math.round(performance.now() - started),
        bytes: ctx.bytes,
        files: ctx.files,
        snapshot: ctx.snapshot,
        problems: ctx.problems.slice(0, MAX_PROBLEMS),
        problemCount: ctx.problems.length,
        counts: ctx.counts,
        stores: ctx.stores,
        loop: { maxMs: round1(loop.max / 1e6), p99Ms: round1(loop.percentile(99) / 1e6), meanMs: round1((loop.mean || 0) / 1e6) },
        ...(ok ? {} : { error: errorLine(ctx.problems) }),
    };
    const statusWritten = writeStatus(backupDir, status);
    if (ok) {
        logger.info(`Wiederherstellungsprobe bestanden: ${ctx.snapshot.name}, ${ctx.files} Dateien, ${ctx.stores.checked} Stores, ${status.durationMs} ms`);
    } else {
        logger.error(`Wiederherstellungsprobe durchgefallen: ${status.error}`);
    }
    return { ...status, statusWritten };
}

/** status/restore-test.json, or null. */
function readRestoreTestStatus(backupDir = resolveBackupDir()) {
    return readJsonFile(statusFileOf(backupDir), null);
}

module.exports = {
    runRestoreTest, readRestoreTestStatus, storeChecks, newestSnapshot, compareCounts, errorLine,
    STATUS_NAME, SCRATCH_PREFIX, MAX_DROP, MIN_LIVE, LIVE_KEYS,
};
