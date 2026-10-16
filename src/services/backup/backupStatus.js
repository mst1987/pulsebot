// What the monitoring (#696) knows about the backup: the three parts (local snapshot, off-site copy, restore test),
// each with its time, result, size and a traffic light, plus the list of local snapshots. The evaluation is a pure
// function over the status files (layout: snapshot.js head comment, docs/system-status.md); reading them is separate.
//
// Light per part: "ok" (green), "warn" (yellow), "bad" (red), "none" (grey, nothing known yet).
//   snapshot, offsite   green < 26 h, yellow < 48 h, red above or failed
//   restore test        green < 8 days, yellow < 15 days, red above or failed
//   never ran           grey; the off-site copy turns red 26 h after the first known snapshot (it should have run
//                       by then), the restore test stays grey until #694 writes status/restore-test.json
// Besides the three parts, the newest deploy snapshot (status/deploy-snapshot.json, written by deploy.sh, #695):
//   deploy              green when it worked, yellow for 7 days after a failed one (the hourly snapshot stays the
//                       fallback, so never red), grey after that or when no deploy wrote the file yet
// The overall light is the worst of the parts that know something, the deploy snapshot included (grey only when all
// are grey). The DM job and the overview task look at the three parts only.
const fs = require("fs");
const path = require("path");
const { readJsonFile } = require("../../stores/jsonStore");
const { resolveBackupDir, backupEnabled } = require("./backupConfig");
const { listSnapshots, latestSnapshot, readManifest, readStatus } = require("./snapshot");

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
const FRESH = { snapshot: [26 * HOUR_MS, 48 * HOUR_MS], offsite: [26 * HOUR_MS, 48 * HOUR_MS], restoreTest: [8 * DAY_MS, 15 * DAY_MS] };
const PARTS = ["snapshot", "offsite", "restoreTest"];
const RANK = { none: 0, ok: 1, warn: 2, bad: 3 };
const LIST_LIMIT = 30;
/** A failed deploy snapshot is yellow this long; after that the deploys since have their own snapshots or none. */
const DEPLOY_WARN_MS = 7 * DAY_MS;

const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : 0);

function timeOf(entry) {
    const ms = entry && entry.at ? new Date(entry.at).getTime() : NaN;
    return Number.isFinite(ms) ? ms : 0;
}

/** The light of a time by age, against the part's limits. */
function lightByAge(age, [warnAt, badAt]) {
    if (age < warnAt) return "ok";
    return age < badAt ? "warn" : "bad";
}

/**
 * One part: { key, light, at, ok, bytes, error, state } - `state` says why the light is what it is: "fresh",
 * "stale" (too old), "failed" (last run failed) or "never".
 */
function evalPart(key, entry, now, { firstKnown = 0 } = {}) {
    const at = timeOf(entry);
    const limits = FRESH[key];
    if (!entry || typeof entry !== "object" || !at) {
        const overdue = key === "offsite" && firstKnown && now - firstKnown > limits[0];
        return { key, light: overdue ? "bad" : "none", at: 0, ok: null, bytes: 0, error: "", state: "never" };
    }
    const bytes = key === "offsite" ? num(entry.totalBytes) : num(entry.bytes);
    if (entry.ok === false) {
        return { key, light: "bad", at, ok: false, bytes, error: String(entry.error || ""), state: "failed" };
    }
    const light = lightByAge(Math.max(0, now - at), limits);
    return { key, light, at, ok: true, bytes, error: "", state: light === "ok" ? "fresh" : "stale" };
}

/** The worst light of the parts that know something; "none" only when none does. */
function overallLight(parts) {
    let worst = "none";
    for (const p of parts) if (RANK[p.light] > RANK[worst]) worst = p.light;
    return worst;
}

/**
 * The evaluation: { light, parts: [snapshot, offsite, restoreTest], snapshots } from the status files' content.
 * @param {object} o
 * @param {object|null} o.snapshot      status/snapshot.json
 * @param {object|null} o.offsite       status/offsite.json
 * @param {object|null} o.restoreTest   status/restore-test.json
 * @param {object|null} o.deploy        status/deploy-snapshot.json (#695)
 * @param {number} [o.firstKnown]       ms of the oldest snapshot (the "first known run")
 * @param {number} [o.now]
 */
function evaluate({ snapshot = null, offsite = null, restoreTest = null, deploy = null, firstKnown = 0, now = Date.now() } = {}) {
    const parts = [
        evalPart("snapshot", snapshot, now),
        evalPart("offsite", offsite, now, { firstKnown: firstKnown || timeOf(snapshot) }),
        evalPart("restoreTest", restoreTest, now),
    ];
    // restore-test.json may carry its own duration; the page shows it as the "size" slot's neighbour
    parts[2].durationMs = num(restoreTest && restoreTest.durationMs);
    parts[0].durationMs = num(snapshot && snapshot.durationMs);
    parts[1].durationMs = num(offsite && offsite.durationMs);
    parts[1].addedBytes = num(offsite && offsite.addedBytes);
    const deploySnap = evalDeploy(deploy, now);
    return { light: overallLight(deploySnap ? [...parts, deploySnap] : parts), parts, deploy: deploySnap };
}

const commitOf = (v) => (typeof v === "string" && /^[0-9a-f]{7,40}$/i.test(v) ? v.toLowerCase() : "");

/**
 * The newest deploy snapshot (status/deploy-snapshot.json of deploy.sh, #695), or null when no deploy wrote one:
 * { light, at, ok, fromCommit, toCommit, name, bytes, durationMs, attempts, error }. Failed: yellow for
 * DEPLOY_WARN_MS, grey after that - never red, the hourly snapshot is the fallback.
 */
function evalDeploy(entry, now) {
    const at = timeOf(entry);
    if (!entry || typeof entry !== "object" || !at) return null;
    const result = entry.result && typeof entry.result === "object" ? entry.result : {};
    const ok = entry.ok !== false;
    return {
        light: ok ? "ok" : now - at < DEPLOY_WARN_MS ? "warn" : "none",
        at,
        ok,
        fromCommit: commitOf(entry.fromCommit),
        toCommit: commitOf(entry.toCommit),
        name: typeof result.name === "string" ? result.name : "",
        bytes: num(result.bytes),
        durationMs: num(result.durationMs),
        attempts: num(entry.attempts),
        error: ok ? "" : String(entry.error || result.error || ""),
    };
}

// A manifest never changes after the snapshot was built, so its total size is looked up once per snapshot.
const sizeCache = new Map();

function manifestInfo(snap) {
    if (sizeCache.has(snap.name)) return sizeCache.get(snap.name);
    const manifest = readManifest(snap.dir);
    let info = null;
    if (manifest) {
        const files = manifest.files && typeof manifest.files === "object" ? Object.values(manifest.files) : [];
        info = { bytes: files.reduce((sum, f) => sum + num(f && f.size), 0), files: files.length, commit: String(manifest.commit || "") };
        sizeCache.set(snap.name, info);
        if (sizeCache.size > 500) sizeCache.delete(sizeCache.keys().next().value);
    }
    return info;
}

/** The newest local snapshots, newest first: { name, reason, at, bytes, files, commit, complete }. */
function snapshotList(backupDir, limit = LIST_LIMIT) {
    return listSnapshots(backupDir).slice(-limit).reverse().map((snap) => {
        const info = manifestInfo(snap);
        return { name: snap.name, reason: snap.reason, at: snap.at, bytes: info ? info.bytes : 0, files: info ? info.files : 0, commit: info ? info.commit : "", complete: !!info };
    });
}

/** Only the parts, the deploy snapshot and the overall light - cheap (four small files), for the overview task and the DM job. */
function readParts({ backupDir = resolveBackupDir(), now = Date.now() } = {}) {
    const all = listSnapshots(backupDir);
    const snapshot = readStatus(backupDir) || fromLatest(backupDir);
    const statusFile = (name) => readJsonFile(path.join(backupDir, "status", name), null);
    const offsite = statusFile("offsite.json");
    const restoreTest = statusFile("restore-test.json");
    const deploy = statusFile("deploy-snapshot.json");
    return { ...evaluate({ snapshot, offsite, restoreTest, deploy, firstKnown: all.length ? all[0].at : 0, now }), count: all.length };
}

/** No status/snapshot.json yet (a backup directory from before the status file): the newest snapshot stands in. */
function fromLatest(backupDir) {
    const latest = latestSnapshot(backupDir);
    return latest ? { at: new Date(latest.at).toISOString(), ok: true, reason: latest.reason } : null;
}

/** The whole answer of GET /api/system/backup: the parts plus the snapshot list. */
function readBackupStatus({ backupDir = resolveBackupDir(), now = Date.now(), env = process.env } = {}) {
    const parts = readParts({ backupDir, now });
    return {
        now,
        enabled: backupEnabled(env),
        exists: fs.existsSync(backupDir),
        ...parts,
        snapshots: snapshotList(backupDir),
    };
}

module.exports = {
    evaluate, evalPart, evalDeploy, overallLight, readParts, DEPLOY_WARN_MS, readBackupStatus, snapshotList, PARTS, FRESH, HOUR_MS, DAY_MS, _clearSizeCache: () => sizeCache.clear(),
};
