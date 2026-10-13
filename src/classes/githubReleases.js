// GitHub's release API for the addon downloads (#818): the newest release of a
// repo and one release file as a stream.
//
// The token (config.github.token, a fine-grained token with read-only
// "Contents") goes only into the Authorization header of the api.github.com
// calls. It is never logged and never part of an error this module throws:
// every failure becomes a GithubError with a short code, its status and a
// message without headers. A file download is answered by GitHub with a
// redirect to a signed storage url; axios follows it, and its redirect layer
// (follow-redirects) drops the Authorization header on the way to the other
// host, which the storage requires anyway.
const axios = require("axios");
const httpsAgent = require("../utils/httpAgent");

const API = "https://api.github.com";
const TIMEOUT_MS = 10000;
/** A file download may take a while; this only bounds waiting for the first byte. */
const DOWNLOAD_TIMEOUT_MS = 30000;
/** Release notes are cut to this many characters (the page shows them folded). */
const NOTES_MAX = 4000;

/** A failed GitHub call: `code` is one of no_release, unauthorized, forbidden, rate_limited, not_found, unreachable. */
class GithubError extends Error {
    constructor(code, status, message) {
        super(message);
        this.name = "GithubError";
        this.code = code;
        this.status = status || 0;
    }
}

function headers(token, accept) {
    const out = {
        "User-Agent": "EventHelper-Bot",
        Accept: accept,
        "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) out.Authorization = `Bearer ${token}`;
    return out;
}

/** The GithubError of an axios failure; `what` decides how a 404 reads ("release" = no release yet). */
function toGithubError(err, what) {
    const res = err && err.response;
    if (!res) return new GithubError("unreachable", 0, "GitHub ist nicht erreichbar.");
    const status = Number(res.status) || 0;
    const h = res.headers || {};
    const remaining = h["x-ratelimit-remaining"];
    if (status === 429 || (status === 403 && String(remaining) === "0")) {
        return new GithubError("rate_limited", status, "GitHub-Limit erreicht, später erneut versuchen.");
    }
    if (status === 401) return new GithubError("unauthorized", status, "Der GitHub-Token ist ungültig oder abgelaufen.");
    if (status === 403) return new GithubError("forbidden", status, "Der GitHub-Token hat keinen Zugriff.");
    if (status === 404) {
        return what === "release"
            ? new GithubError("no_release", status, "Noch kein Release.")
            : new GithubError("not_found", status, "Datei nicht gefunden.");
    }
    return new GithubError("unreachable", status, `GitHub antwortet mit ${status}.`);
}

/** "sha256:<hex>" of GitHub's `digest` field as the bare hex; "" without one. */
function sha256Of(digest) {
    const m = /^sha256:([0-9a-f]{64})$/i.exec(String(digest || ""));
    return m ? m[1].toLowerCase() : "";
}

/** GitHub's release JSON reduced to what the page needs; null when it is no usable release. Pure. */
function reduceRelease(data) {
    if (!data || typeof data !== "object" || !data.tag_name) return null;
    const tag = String(data.tag_name);
    const notes = String(data.body || "").replace(/\r\n?/g, "\n").trim();
    const assets = (Array.isArray(data.assets) ? data.assets : [])
        .filter((a) => a && a.id && a.name && (a.state === undefined || a.state === "uploaded"))
        .map((a) => ({
            id: Number(a.id),
            name: String(a.name),
            size: Number(a.size) || 0,
            contentType: String(a.content_type || ""),
            sha256: sha256Of(a.digest),
        }));
    return {
        version: tag.replace(/^v/i, ""),
        tag,
        name: String(data.name || ""),
        publishedAt: String(data.published_at || data.created_at || ""),
        notes: notes.length > NOTES_MAX ? `${notes.slice(0, NOTES_MAX).trimEnd()} …` : notes,
        assets,
    };
}

/**
 * The newest release of `repo` ("owner/name"), reduced. Throws a GithubError
 * (`no_release` when the repo has none or — for a private repo — the token does
 * not reach it; GitHub answers both with 404).
 */
async function fetchLatestRelease({ repo, token = "" }) {
    let res;
    try {
        res = await axios.get(`${API}/repos/${repo}/releases/latest`, {
            httpsAgent,
            timeout: TIMEOUT_MS,
            headers: headers(token, "application/vnd.github+json"),
        });
    } catch (err) {
        throw toGithubError(err, "release");
    }
    const release = reduceRelease(res && res.data);
    if (!release) throw new GithubError("no_release", 404, "Noch kein Release.");
    return release;
}

/**
 * One release file as a readable stream: `{ stream, size, contentType }`.
 * Throws a GithubError. The caller pipes the stream and destroys it when the
 * client goes away.
 */
async function openAssetStream({ repo, assetId, token = "" }) {
    let res;
    try {
        res = await axios.get(`${API}/repos/${repo}/releases/assets/${Number(assetId)}`, {
            httpsAgent,
            timeout: DOWNLOAD_TIMEOUT_MS,
            responseType: "stream",
            maxRedirects: 5,
            // a release file is up to ~100 MB; the stream is never buffered
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            headers: headers(token, "application/octet-stream"),
        });
    } catch (err) {
        throw toGithubError(err, "asset");
    }
    const h = (res && res.headers) || {};
    const size = Number(h["content-length"]) || 0;
    return { stream: res.data, size, contentType: String(h["content-type"] || "") };
}

module.exports = { fetchLatestRelease, openAssetStream, reduceRelease, toGithubError, sha256Of, GithubError, NOTES_MAX };
