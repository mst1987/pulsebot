// The newest release of every configured addon (#818), cached, and what the
// page "Addons", the download route and /addons make of it.
//
// One cached lookup per repo, never a GitHub call per page view (project rule
// for external APIs): a good answer — a release, or "no release yet" — lives
// CACHE_MS (10 minutes). When GitHub fails, the last good answer is served
// stale (marked `stale`, the page says so) and the failure itself is remembered
// RETRY_MS, so an outage is not retried per view. Concurrent callers share one
// request. Changing the token starts over (the cache entry remembers a
// fingerprint of it, never the token).
//
// A private repo without a token is not asked at all: GitHub would answer 404,
// which reads exactly like "no release yet".
const crypto = require("crypto");
const { fetchLatestRelease } = require("../../classes/githubReleases");
const { assetMatches, VERSION_IDS } = require("./addonConfig");

const CACHE_MS = 10 * 60 * 1000;
const RETRY_MS = 2 * 60 * 1000;

/** repo -> { fp, good: { at, release } | null, failedAt, errorCode, inflight } */
const cache = new Map();

/** A short fingerprint of the token, so a changed token is a new cache entry; "-" without one. */
function tokenFingerprint(token) {
    return token ? crypto.createHash("sha256").update(String(token)).digest("hex").slice(0, 12) : "-";
}

/** The token of a config ("" = none). */
function tokenOf(config) {
    return String(((config && config.github) || {}).token || "").trim();
}

function entryFor(repo, fp) {
    let entry = cache.get(repo);
    if (!entry || entry.fp !== fp) {
        // a new token: nothing it found yet, but the old answer stays as the fallback
        entry = { fp, good: entry ? entry.good : null, fresh: false, failedAt: 0, errorCode: "", inflight: null };
        cache.set(repo, entry);
    }
    return entry;
}

/** The result shape of releaseFor() from what the entry knows. */
function answerOf(entry, { failed }) {
    const good = entry.good;
    if (!failed && good) return { state: good.release ? "ok" : "no_release", release: good.release, stale: false, errorCode: "", fetchedAt: good.at };
    if (good && good.release) return { state: "ok", release: good.release, stale: true, errorCode: entry.errorCode, fetchedAt: good.at };
    return { state: "error", release: null, stale: false, errorCode: entry.errorCode || "unreachable", fetchedAt: good ? good.at : 0 };
}

/**
 * The newest release of one addon:
 *   { state: "ok" | "no_release" | "token_missing" | "error", release, stale, errorCode, fetchedAt }
 * `release` may be set with state "ok" and `stale: true` (GitHub failed, the
 * last good answer is shown). Never throws.
 */
async function releaseFor(addon, { config, now = Date.now(), force = false } = {}) {
    const token = tokenOf(config);
    if (addon.private && !token) return { state: "token_missing", release: null, stale: false, errorCode: "", fetchedAt: 0 };
    const entry = entryFor(addon.repo, tokenFingerprint(token));
    if (!force && entry.fresh && entry.good && now - entry.good.at < CACHE_MS) return answerOf(entry, { failed: false });
    if (!force && entry.failedAt && now - entry.failedAt < RETRY_MS) return answerOf(entry, { failed: true });
    if (!entry.inflight) {
        entry.inflight = fetchLatestRelease({ repo: addon.repo, token })
            .then((release) => {
                entry.good = { at: now, release };
                entry.fresh = true;
                entry.failedAt = 0;
                entry.errorCode = "";
            })
            .catch((err) => {
                if (err && err.code === "no_release") {
                    entry.good = { at: now, release: null };
                    entry.fresh = true;
                    entry.failedAt = 0;
                    entry.errorCode = "";
                    return;
                }
                entry.failedAt = now;
                entry.errorCode = (err && err.code) || "unreachable";
            })
            .finally(() => { entry.inflight = null; });
    }
    await entry.inflight;
    return answerOf(entry, { failed: !!entry.failedAt });
}

/**
 * The enabled addons of the config, optionally only those for one game version.
 * Addons marked `orgaOnly` are left out unless the caller is `orga` (a full
 * admin or an orga role, permissions.userIsOrga): hidden is the safe default.
 */
function enabledAddons(config, versionId = "", { orga = false } = {}) {
    const list = Array.isArray(config && config.addonDownloads) ? config.addonDownloads : [];
    return list.filter((a) => a && a.enabled !== false && (orga || !a.orgaOnly) && (!versionId || (a.versions || []).includes(versionId)));
}

/** The game versions with at least one enabled addon, in the rule sets' order - for the empty page's hint. */
function addonVersions(config, { orga = false } = {}) {
    return VERSION_IDS.filter((id) => enabledAddons(config, id, { orga }).length > 0);
}

/** "zip" | "exe" | "file" — what the page says about installing a file. */
function kindOf(fileName) {
    const m = /\.([a-z0-9]+)$/i.exec(String(fileName || ""));
    const ext = m ? m[1].toLowerCase() : "";
    return ext === "zip" || ext === "exe" ? ext : "file";
}

/** The server route that streams one file — the only link the browser ever gets. */
function downloadPath(addonId, fileName) {
    return `/api/addons/download?addon=${encodeURIComponent(addonId)}&asset=${encodeURIComponent(fileName)}`;
}

/** The release files the addon offers (its patterns), each with its download link. */
function offeredAssets(addon, release) {
    if (!release) return [];
    return (release.assets || [])
        .filter((a) => assetMatches(addon, a.name))
        .map((a) => ({ name: a.name, size: a.size, sha256: a.sha256, kind: kindOf(a.name), url: downloadPath(addon.id, a.name) }));
}

/**
 * One card of the page. `canManage` (a full admin) also gets the repo, so the
 * hint "Token fehlt" can name it; everybody else never sees where a file
 * comes from.
 */
function addonCard(addon, result, { canManage = false } = {}) {
    const release = result.release;
    return {
        id: addon.id,
        name: addon.name,
        description: addon.description,
        icon: addon.icon,
        versions: addon.versions,
        install: addon.install,
        state: result.state,
        stale: !!result.stale,
        errorCode: result.errorCode || "",
        fetchedAt: result.fetchedAt || 0,
        orgaOnly: !!addon.orgaOnly,
        ...(canManage ? { repo: addon.repo, private: !!addon.private } : {}),
        release: release ? {
            version: release.version,
            tag: release.tag,
            publishedAt: release.publishedAt,
            notes: release.notes,
            assets: offeredAssets(addon, release),
        } : null,
    };
}

/** Every card for a game version, the releases looked up side by side. */
async function addonCards(config, versionId, { canManage = false, orga = false, now } = {}) {
    const addons = enabledAddons(config, versionId, { orga });
    const results = await Promise.all(addons.map((a) => releaseFor(a, { config, now })));
    return addons.map((a, i) => addonCard(a, results[i], { canManage }));
}

/**
 * What a download asks for, checked: the enabled addon, its current release
 * and the one offered file of that name, plus the token to fetch it with.
 * `{ addon, asset, token }` or `{ status, code, message }`.
 */
async function resolveDownload(config, addonId, fileName, { now, orga = false } = {}) {
    const addon = enabledAddons(config, "", { orga: true }).find((a) => a.id === String(addonId || ""));
    if (!addon) return { status: 404, code: "unknown_addon", message: "Dieses Addon gibt es nicht." };
    // before anything is asked of GitHub: an orga-only addon is for the orga
    if (addon.orgaOnly && !orga) return { status: 403, code: "orga_only", message: "Dieses Addon ist nur für die Orga." };
    const result = await releaseFor(addon, { config, now });
    if (result.state === "token_missing") return { status: 503, code: "unavailable", message: "Dieses Addon ist gerade nicht verfügbar." };
    if (!result.release) {
        return result.state === "no_release"
            ? { status: 404, code: "no_release", message: "Für dieses Addon gibt es noch kein Release." }
            : { status: 503, code: "unavailable", message: "GitHub ist gerade nicht erreichbar." };
    }
    const asset = (result.release.assets || []).find((a) => a.name === String(fileName || "") && assetMatches(addon, a.name));
    if (!asset) return { status: 404, code: "unknown_asset", message: "Diese Datei gibt es im aktuellen Release nicht." };
    return { addon, asset, release: result.release, token: tokenOf(config) };
}

/** Tests only: forget every cached answer. */
function resetAddonReleaseCache() {
    cache.clear();
}

module.exports = {
    releaseFor, enabledAddons, addonVersions, addonCard, addonCards, resolveDownload, offeredAssets, kindOf, downloadPath,
    tokenOf, tokenFingerprint, resetAddonReleaseCache, CACHE_MS, RETRY_MS,
};
