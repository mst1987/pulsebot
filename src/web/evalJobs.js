// Background jobs for the CLA/RPB log evaluations, and for a report built from
// a pasted Warcraft-Logs link — that is the same analysis, so it is tracked here
// too, keyed by a fresh job id under the pseudo-section "report" (see
// apiRoutes/cla.js). The key is just (subject, section); nothing here reads the
// log store, so a subject that is not a log id works fine.
//
// An RPB evaluation takes ~50s. Holding an HTTP response open that long dies at
// the 60s timeout of a typical reverse proxy, and the admin client then sees a
// gateway error page instead of its result. So the API starts the work here and
// answers immediately; the client polls for the outcome.
//
// In-memory on purpose: a job that is lost to a restart is not a problem, because
// the *result* is persisted anyway (the report file plus the log's `sections`),
// so the UI recovers the final state from the regular log list.

// key -> { status, section, logId, url, id, error, startedAt, finishedAt }
const jobs = new Map();

// How long a finished job stays queryable, so a client that polls slowly (or
// reloads the page mid-run) still picks up the outcome.
const KEEP_FINISHED_MS = 15 * 60 * 1000;

function keyOf(logId, section) {
    return `${logId}:${section}`;
}

/** Drop finished jobs that nobody collected in time. */
function prune(now = Date.now()) {
    for (const [key, job] of jobs) {
        if (job.finishedAt && now - job.finishedAt > KEEP_FINISHED_MS) jobs.delete(key);
    }
}

/**
 * Start an evaluation in the background, unless one is already running for this
 * log + section.
 *
 * @param {string} logId
 * @param {string} section  "cla" | "rpb"
 * @param {() => Promise<{ok:boolean,url?:string,id?:string,error?:string,already?:boolean}>} runner
 * @returns {{status: string, alreadyRunning: boolean}}
 */
function startJob(logId, section, runner) {
    prune();
    const key = keyOf(logId, section);
    const existing = jobs.get(key);
    if (existing && existing.status === "running") {
        return { status: "running", alreadyRunning: true };
    }

    const job = {
        logId,
        section,
        status: "running",
        startedAt: Date.now(),
        finishedAt: 0,
        url: "",
        id: "",
        error: "",
        already: false,
    };
    jobs.set(key, job);

    // Deliberately not awaited: the caller answers right away.
    Promise.resolve()
        .then(() => runner())
        .then((res) => {
            job.finishedAt = Date.now();
            if (res && res.ok) {
                job.status = "done";
                job.url = res.url || "";
                job.id = res.id || "";
            } else if (res && res.already) {
                // the other half (or an earlier run) already produced the page
                job.status = "done";
                job.url = res.url || "";
                job.already = true;
            } else {
                job.status = "error";
                job.error = (res && res.error) || "Auswertung fehlgeschlagen.";
            }
        })
        .catch((e) => {
            job.finishedAt = Date.now();
            job.status = "error";
            job.error = (e && e.message) || "Unerwarteter Fehler bei der Auswertung.";
            console.error(`eval job ${key} failed:`, (e && e.stack) || e);
        });

    return { status: "running", alreadyRunning: false };
}

/**
 * Current state of an evaluation.
 * @returns {null | {status:"running"|"done"|"error", url, id, error, already, runningMs}}
 */
function getJob(logId, section) {
    prune();
    const job = jobs.get(keyOf(logId, section));
    if (!job) return null;
    return {
        status: job.status,
        url: job.url,
        id: job.id,
        error: job.error,
        already: job.already,
        runningMs: (job.finishedAt || Date.now()) - job.startedAt,
    };
}

/** Is any evaluation currently running for this log? */
function isRunning(logId) {
    prune();
    for (const job of jobs.values()) {
        if (job.logId === logId && job.status === "running") return true;
    }
    return false;
}

/** Test seam: forget every tracked job. */
function reset() {
    jobs.clear();
}

module.exports = { startJob, getJob, isRunning, reset, KEEP_FINISHED_MS };
