// How far behind main the running process is (#314).
//
// version.js says which commit is running; this module asks GitHub what main
// looks like now and works out the distance. The repository is public, so the
// call needs no token — and deliberately does not take one: a deploy status is
// not worth a credential, and an unauthenticated call cannot leak anything.
//
// ⚠️ Best-effort throughout. GitHub down, rate-limited, offline, an unknown
// commit — every one of those is "nicht prüfbar" (status "unknown"), never an
// error state, never a thrown exception, and never anything that stops a page
// from rendering.
const axios = require("axios");
const httpsAgent = require("../utils/httpAgent");
const { versionInfo } = require("./version");

const REPO = "mst1987/pulsebot";
const API = `https://api.github.com/repos/${REPO}/commits`;
// One page of main. A server more than this many commits behind is so far gone
// that the exact number no longer matters — it reads as "nicht prüfbar" and the
// footer says so instead of inventing a figure.
const PER_PAGE = 100;
const CACHE_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 8000;

let cache = null; // { at: <ms>, value: <status> }
let inflight = null;

/** The commits of main, newest first, or null on any failure. */
async function fetchMainCommits() {
    const { data } = await axios.get(API, {
        params: { sha: "main", per_page: PER_PAGE },
        httpsAgent,
        timeout: TIMEOUT_MS,
        headers: {
            // GitHub refuses a request without one, and it makes the caller
            // identifiable in their logs, which is only fair.
            "User-Agent": "EventHelper-Bot",
            Accept: "application/vnd.github+json",
        },
    });
    return Array.isArray(data) ? data : null;
}

/** The fields worth keeping from one GitHub commit entry. */
function commitOf(entry) {
    const sha = String((entry && entry.sha) || "").toLowerCase();
    const info = (entry && entry.commit) || {};
    const at = (info.committer && info.committer.date) || (info.author && info.author.date) || "";
    return {
        commit: sha,
        short: sha.slice(0, 7),
        committedAt: String(at || ""),
        // Only the first line: a commit body is a paragraph and this is one line
        // in a footer.
        subject: String(info.message || "").split("\n")[0].trim(),
    };
}

/**
 * Compares the running commit against a list of main's commits, newest first.
 * Pure — this is what the tests drive.
 *
 * Behind by n = the running commit sits at index n of main's list. Not in the
 * list at all means we cannot say: it may be a branch commit, or older than the
 * page we fetched. "Cannot tell" is reported as such, never as zero.
 */
function compare(running, commits) {
    const latest = commits && commits.length ? commitOf(commits[0]) : null;
    const sha = String((running && running.commit) || "").toLowerCase();
    if (!sha) return { status: "unknown", reason: "no_commit", behind: 0, behindSince: "", latest };
    if (!commits || !commits.length) return { status: "unknown", reason: "unreachable", behind: 0, behindSince: "", latest };
    const index = commits.findIndex((c) => String((c && c.sha) || "").toLowerCase() === sha);
    if (index < 0) return { status: "unknown", reason: "not_found", behind: 0, behindSince: "", latest };
    if (index === 0) return { status: "current", reason: "", behind: 0, behindSince: "", latest };
    // How long the server has been behind: the age of the *oldest* commit it is
    // missing, which is the one directly above it in the list.
    const oldestMissing = commitOf(commits[index - 1]);
    return { status: "behind", reason: "", behind: index, behindSince: oldestMissing.committedAt, latest };
}

/** The full answer for a comparison result — version fields plus the distance. */
function withVersion(version, result, checkedAt) {
    return {
        ...version,
        behind: result.behind,
        behindSince: result.behindSince,
        latest: result.latest,
        status: result.status,
        reason: result.reason,
        checkedAt,
    };
}

async function load() {
    const version = versionInfo();
    let commits = null;
    if (version.commit) {
        try {
            commits = await fetchMainCommits();
        } catch {
            commits = null;
        }
    }
    return withVersion(version, compare(version, commits), new Date().toISOString());
}

/**
 * { commit, short, committedAt, subject, startedAt, behind, behindSince,
 *   latest, status, reason, checkedAt }
 *
 * Cached for ten minutes — including a failure, so a GitHub outage is asked
 * about once every ten minutes and not once per page load. Concurrent callers
 * share the one in-flight request.
 */
async function deployStatus({ force = false } = {}) {
    if (!force && cache && Date.now() - cache.at < CACHE_MS) return { ...cache.value };
    if (inflight) return { ...(await inflight) };
    inflight = load()
        .then((value) => {
            cache = { at: Date.now(), value };
            return value;
        })
        .catch(() => {
            // load() already swallows the network error; this is the belt to its
            // braces, so a caller never sees a rejected promise.
            const value = withVersion(versionInfo(), { status: "unknown", reason: "unreachable", behind: 0, behindSince: "", latest: null }, new Date().toISOString());
            cache = { at: Date.now(), value };
            return value;
        })
        .finally(() => { inflight = null; });
    return { ...(await inflight) };
}

/** Tests only: drop the cached answer. */
function resetDeployCache() {
    cache = null;
    inflight = null;
}

module.exports = { deployStatus, compare, commitOf, resetDeployCache, REPO, CACHE_MS };
