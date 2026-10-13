// The page "Addons" (#818): the guild's own addons with their newest release,
// and the download of one release file through the server.
//
//   GET /api/addons?version=<id>                      the cards of one game version
//   GET /api/addons/download?addon=<id>&asset=<file>  streams the file
//
// The browser never sees a GitHub url or the token: the cards link only to the
// download route, which looks the file up in the cached release
// (services/addons/addonReleases.js) and pipes GitHub's answer through. Who may:
// the member areas — "signup" (every raider's own profile and signup, the base
// access) or "history" (the loot importers, who had the sync tool page before).
// An addon marked "orgaOnly" (Einstellungen -> Module -> Addons) is for the orga
// only (permissions.userIsOrga): absent from the list for anyone else, 403
// orga_only on its download, before the limit and before GitHub is asked.
// Every download is counted per account (30 per hour, downloadLimit.js) and
// logged with who, what and when.
const { ok, error } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { q } = require("../http/apiParams");
const { getConfig } = require("../../stores/configStore");
const { resolveVersionQuery } = require("../../services/events/mainVersion");
const { VERSIONS } = require("../../config/gameVersions");
const { addonCards, addonVersions, resolveDownload, tokenOf } = require("../../services/addons/addonReleases");
const { openAssetStream } = require("../../classes/githubReleases");
const { takeDownload, LIMIT } = require("../../services/addons/downloadLimit");
const { userIsOrga } = require("../../config/permissions");
const log = require("../../logger").child("addons");

const AREAS = ["signup", "history"];

/** The Content-Type of a release file by its extension. */
function contentTypeOf(fileName) {
    const name = String(fileName || "").toLowerCase();
    if (name.endsWith(".zip")) return "application/zip";
    if (name.endsWith(".exe")) return "application/vnd.microsoft.portable-executable";
    return "application/octet-stream";
}

/** `attachment` with the file name, plain for old browsers and RFC 5987 for the rest. */
function dispositionOf(fileName) {
    const name = String(fileName || "download");
    const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Who downloaded, for the log line: name and id, nothing else. */
const whoOf = (user) => `${String((user && user.name) || "?")} (${String((user && user.id) || "?")})`;

/** GET /api/addons — the cards of the page's game version. */
const getAddons = withUser({}, async ({ user, query, res }) => {
    const config = getConfig();
    const { versionId, mainVersion } = resolveVersionQuery(q.str(query, "version"), { config });
    const canManage = !!user.isAdmin;
    const orga = userIsOrga(user);
    const addons = await addonCards(config, versionId, { canManage, orga });
    ok(res, {
        versionId,
        mainVersion,
        canManage,
        // only whether one is set, never the token (and only for whoever may set it)
        ...(canManage ? { tokenSet: !!tokenOf(config) } : {}),
        downloadLimit: LIMIT,
        addons,
        // the versions that do have addons, for the hint on an empty page (e.g. Classic)
        addonVersions: addonVersions(config, { orga }).map((id) => ({ id, label: (VERSIONS.find((v) => v.id === id) || { label: id }).label })),
    });
});

/** GET /api/addons/download — streams one release file of an addon. */
const downloadAddon = withUser({}, async ({ user, query, res }) => {
    const config = getConfig();
    const addonId = q.str(query, "addon", { max: 60 });
    const fileName = q.str(query, "asset", { max: 200 });
    const target = await resolveDownload(config, addonId, fileName, { orga: userIsOrga(user) });
    if (target.code === "orga_only") log.warn(`download refused (orga only): ${addonId}/${fileName} by ${whoOf(user)}`);
    if (target.status) return error(res, target.status, target.code, target.message);

    const quota = takeDownload(user.id);
    if (!quota.ok) {
        log.warn(`download refused (limit): ${addonId}/${fileName} by ${whoOf(user)}`);
        return error(res, 429, "rate_limited", `Höchstens ${LIMIT} Downloads pro Stunde. Bitte später erneut versuchen.`, { "Retry-After": String(quota.retryAfterSec) });
    }

    let upstream;
    try {
        upstream = await openAssetStream({ repo: target.addon.repo, assetId: target.asset.id, token: target.token });
    } catch (err) {
        // the code and status only: an axios error would carry the request headers, the token among them
        log.warn(`download failed: ${addonId}/${fileName} for ${whoOf(user)}: ${(err && err.code) || "error"} ${(err && err.status) || ""}`.trim());
        const status = err && err.code === "not_found" ? 404 : 502;
        return error(res, status, "download_failed", "Die Datei konnte gerade nicht von GitHub geladen werden.");
    }

    log.info(`download ${target.addon.id} ${target.release.version} ${target.asset.name} by ${whoOf(user)}`);
    const size = upstream.size || target.asset.size;
    res.writeHead(200, {
        "Content-Type": contentTypeOf(target.asset.name),
        "Content-Disposition": dispositionOf(target.asset.name),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        ...(size ? { "Content-Length": String(size) } : {}),
    });
    const stream = upstream.stream;
    // The visitor went away before the end: stop pulling from GitHub. (The
    // response's "close", not the request's: that one fires once a GET is read.)
    res.on("close", () => { if (!res.writableFinished && typeof stream.destroy === "function") stream.destroy(); });
    stream.on("error", (e) => {
        log.warn(`download aborted: ${target.addon.id}/${target.asset.name}: ${(e && e.message) || e}`);
        res.destroy();
    });
    stream.pipe(res);
    return undefined;
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/addons", handler: getAddons, area: AREAS },
    { method: "GET", path: "/api/addons/download", handler: downloadAddon, area: AREAS },
];

module.exports = { getAddons, downloadAddon, contentTypeOf, dispositionOf, routes };
