// The newest release of the public EventHelper addon repo (sync tool + WoW
// addon), for the download page "Sync-Tool & Addon".
//
// Same shape as web/http/deployStatus.js: one unauthenticated GitHub call,
// cached in memory so a page view never reaches GitHub (project rule: external
// APIs are asked by one cached lookup, not per request). The cache lives one
// hour; when GitHub fails the last good answer is served stale, and a failure
// is itself remembered for a few minutes so an outage is not retried per view.
// Nothing here throws: no release known at all is `null`.
const axios = require("axios");
const httpsAgent = require("../utils/httpAgent");

const REPO = "mst1987/eventhelper-addon";
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;
const CACHE_MS = 60 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 8000;

let good = null; // { at, value } last successful answer
let failedAt = 0;
let inflight = null;

function assetOf(asset) {
    if (!asset) return null;
    return { name: String(asset.name), url: String(asset.browser_download_url), size: Number(asset.size) || 0 };
}

/** Reduces GitHub's release JSON to what the page needs; null when it is not a usable release. Pure. */
function reduceRelease(data) {
    if (!data || typeof data !== "object" || !data.tag_name) return null;
    const assets = Array.isArray(data.assets) ? data.assets : [];
    const exe = assets.find((a) => /\.exe$/i.test(a.name || ""));
    const zip = assets.find((a) => /\.zip$/i.test(a.name || ""));
    const tag = String(data.tag_name);
    return {
        version: tag.replace(/^v/i, ""),
        tag,
        url: String(data.html_url || RELEASES_URL),
        publishedAt: String(data.published_at || ""),
        exe: assetOf(exe),
        zip: assetOf(zip),
    };
}

async function load() {
    const { data } = await axios.get(API, {
        httpsAgent,
        timeout: TIMEOUT_MS,
        headers: { "User-Agent": "EventHelper-Bot", Accept: "application/vnd.github+json" },
    });
    return reduceRelease(data);
}

/** The latest release or null (nothing cached and GitHub unreachable). */
async function latestRelease({ force = false } = {}) {
    const now = Date.now();
    if (!force && good && now - good.at < CACHE_MS) return good.value;
    if (!force && failedAt && now - failedAt < RETRY_MS) return good ? good.value : null;
    if (!inflight) {
        inflight = load()
            .then((value) => {
                if (value) {
                    good = { at: Date.now(), value };
                    failedAt = 0;
                } else {
                    failedAt = Date.now();
                }
            })
            .catch(() => { failedAt = Date.now(); })
            .finally(() => { inflight = null; });
    }
    await inflight;
    return good ? good.value : null;
}

/** Tests only: drop the cached answer. */
function resetAddonReleaseCache() {
    good = null;
    failedAt = 0;
    inflight = null;
}

module.exports = { latestRelease, reduceRelease, resetAddonReleaseCache, RELEASES_URL, CACHE_MS, RETRY_MS };
