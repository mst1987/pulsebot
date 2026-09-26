// Which code the running process is: the commit it was started from.
//
// Eight PRs were merged in a row while the deploy failed every single time, and
// nobody noticed, because nothing said what was actually running on the server
// (#314). So the bot reads its own commit once per process and hands it to
// /health and to the menu.
//
// Read once, never again: a process does not change its code while it runs, and
// a git call per request would be both pointless and one more way to fail.
//
// ⚠️ Nothing in here may throw. No git, no repository, a broken or empty output,
// git hanging — every one of those leaves the fields empty and the bot running.
const { execFileSync } = require("child_process");
const path = require("path");

// The project root (src/web/ -> ../..), the working directory of the git call.
// Deliberately never reported: a filesystem path is nobody's business.
const REPO_DIR = path.resolve(__dirname, "..", "..", "..");
const GIT_TIMEOUT_MS = 2000;
const SHORT_LEN = 7;

// The moment this process came up. process.uptime() is seconds since the start,
// so this holds even for a module that is required late.
const STARTED_AT = new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString();

let cached = null;

/** A full or abbreviated sha and nothing else — anything else is a broken output. */
function isSha(value) {
    return /^[0-9a-f]{7,40}$/i.test(String(value || "").trim());
}

/** An ISO timestamp, or "" — a date the Date constructor rejects is worthless. */
function isoOrEmpty(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    const at = new Date(text);
    return Number.isNaN(at.getTime()) ? "" : at.toISOString();
}

/**
 * One line each of sha, commit date and subject from git log, or null.
 *
 * stderr is swallowed on purpose: "not a git repository" is an expected state
 * (a deploy from a tarball, a Docker image) and not something to log on start.
 */
function readGit() {
    try {
        const out = execFileSync("git", ["log", "-1", "--format=%H%n%cI%n%s"], {
            cwd: REPO_DIR,
            encoding: "utf8",
            timeout: GIT_TIMEOUT_MS,
            stdio: ["ignore", "pipe", "ignore"],
            windowsHide: true,
        });
        const [commit, committedAt, ...rest] = String(out || "").split("\n");
        if (!isSha(commit)) return null;
        return {
            commit: String(commit).trim().toLowerCase(),
            committedAt: isoOrEmpty(committedAt),
            // A subject holds anything but a newline; the rest is joined back
            // in case the format ever grows a line.
            subject: rest.join(" ").trim(),
        };
    } catch {
        return null;
    }
}

/** GIT_COMMIT from the environment — for a checkout without git (Docker, tarball). */
function fromEnv() {
    const commit = String(process.env.GIT_COMMIT || "").trim();
    if (!isSha(commit)) return null;
    return { commit: commit.toLowerCase(), committedAt: "", subject: "" };
}

function build() {
    const info = readGit() || fromEnv() || { commit: "", committedAt: "", subject: "" };
    return {
        commit: info.commit,
        short: info.commit.slice(0, SHORT_LEN),
        committedAt: info.committedAt,
        subject: info.subject,
        startedAt: STARTED_AT,
    };
}

/**
 * { commit, short, committedAt, subject, startedAt } — empty strings where
 * nothing could be read. Cached for the life of the process, and every call
 * gets its own copy so no caller can edit the cache.
 */
function versionInfo() {
    if (!cached) cached = build();
    return { ...cached };
}

/** Tests only: forget the cached read. */
function resetVersionCache() {
    cached = null;
}

module.exports = { versionInfo, resetVersionCache, STARTED_AT };
