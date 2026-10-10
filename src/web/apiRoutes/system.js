const { ok } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { q } = require("../http/apiParams");
const systemStatus = require("../../services/system/systemStatus");
const backupStatus = require("../../services/backup/backupStatus");
const { runSnapshot } = require("../../services/backup/snapshotJob");

/**
 * GET /api/system/status — the "Systemstatus" page (docs/system-status.md): host and process figures with their
 * history, the route statistics, the disk and the verdict.
 *
 * Full admins only (`adminOnly`, and `full` in the handler): the page shows host details - the processes running next
 * to the bot, the files under data/ - that are nobody else's business, and no area grant should hand them out.
 *
 * ?processes=1 measures the top processes of the host anew (takes a second; the page asks when it opens and on its
 * refresh button, not on every poll). ?disk=1 walks data/ again instead of using the five-minute cache.
 */
const getStatus = withUser({ full: true }, async ({ res, query }) => {
    ok(res, await systemStatus.build({
        processes: q.bool(query, "processes"),
        forceDisk: q.bool(query, "disk"),
    }));
});

/**
 * GET /api/system/backup - the "Datensicherung" section (#696): the three parts with their traffic light and the list
 * of local snapshots. Full admins only. There is no download of a snapshot on purpose: it holds API keys and sessions.
 */
const getBackup = withUser({ full: true }, async ({ res }) => {
    ok(res, backupStatus.readBackupStatus());
});

/**
 * POST /api/system/backup/snapshot - "Jetzt sichern": one snapshot with the reason "manual". Answers 200 with the
 * result either way, so the page can say what happened: { ok, skipped, name, durationMs, bytes, error }. A snapshot
 * already running in this process is skipped: "locked".
 */
const postBackupSnapshot = withUser({ full: true, csrf: true }, async ({ res }) => {
    const r = await runSnapshot({ reason: "manual" });
    ok(res, {
        ok: !!r.ok,
        skipped: r.skipped || "",
        name: r.name || "",
        durationMs: r.durationMs || 0,
        bytes: r.bytes || 0,
        error: r.ok ? "" : String(r.error || ""),
    });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/system/status", handler: getStatus, adminOnly: true },
    { method: "GET", path: "/api/system/backup", handler: getBackup, adminOnly: true },
    { method: "POST", path: "/api/system/backup/snapshot", handler: postBackupSnapshot, adminOnly: true },
];

module.exports = { getStatus, getBackup, postBackupSnapshot, routes };
