// services/addons/addonReleases.js with a mocked GitHub client: the cache
// (10 minutes), the stale answer when GitHub fails, the private repo without a
// token, no release yet, the cards per version and what a download resolves to.
jest.mock("../../../src/classes/githubReleases", () => ({ fetchLatestRelease: jest.fn() }));

const { fetchLatestRelease } = require("../../../src/classes/githubReleases");
const {
    releaseFor, addonCards, addonCard, resolveDownload, enabledAddons, addonVersions, kindOf, downloadPath, tokenFingerprint,
    resetAddonReleaseCache, CACHE_MS, RETRY_MS,
} = require("../../../src/services/addons/addonReleases");
const { defaultAddons } = require("../../../src/services/addons/addonConfig");

const TOKEN = "github_pat_SECRET";
const err = (code) => Object.assign(new Error(code), { code });
const release = (version, names = []) => ({
    version, tag: `v${version}`, name: "", publishedAt: "2026-10-12T10:00:00Z", notes: "neu",
    assets: names.map((name, i) => ({ id: i + 1, name, size: 100 * (i + 1), contentType: "", sha256: "" })),
});

const config = (over = {}) => ({ addonDownloads: defaultAddons(), github: { token: TOKEN }, ...over });
const addon = (id) => defaultAddons().find((a) => a.id === id);

beforeEach(() => {
    jest.clearAllMocks();
    resetAddonReleaseCache();
});

describe("releaseFor", () => {
    it("asks a public repo without a token, a private one with it", async () => {
        fetchLatestRelease.mockResolvedValue(release("1.0.0"));
        await releaseFor(addon("eventhelper-sync"), { config: config({ github: { token: "" } }) });
        expect(fetchLatestRelease).toHaveBeenLastCalledWith({ repo: "mst1987/eventhelper-addon", token: "" });
        await releaseFor(addon("levelhelper"), { config: config() });
        expect(fetchLatestRelease).toHaveBeenLastCalledWith({ repo: "mst1987/levelhelper", token: TOKEN });
    });

    it("does not ask GitHub for a private repo without a token", async () => {
        const r = await releaseFor(addon("levelhelper"), { config: config({ github: { token: "" } }) });
        expect(r).toMatchObject({ state: "token_missing", release: null });
        expect(fetchLatestRelease).not.toHaveBeenCalled();
    });

    it("keeps an answer for ten minutes and shares one request", async () => {
        fetchLatestRelease.mockResolvedValue(release("0.3.0"));
        const now = Date.now();
        const [a, b] = await Promise.all([
            releaseFor(addon("levelhelper"), { config: config(), now }),
            releaseFor(addon("levelhelper"), { config: config(), now }),
        ]);
        expect(a).toMatchObject({ state: "ok", stale: false, release: { version: "0.3.0" } });
        expect(b.release.version).toBe("0.3.0");
        await releaseFor(addon("levelhelper"), { config: config(), now: now + CACHE_MS - 1000 });
        expect(fetchLatestRelease).toHaveBeenCalledTimes(1);
        fetchLatestRelease.mockResolvedValue(release("0.4.0"));
        const later = await releaseFor(addon("levelhelper"), { config: config(), now: now + CACHE_MS + 1000 });
        expect(later.release.version).toBe("0.4.0");
        expect(fetchLatestRelease).toHaveBeenCalledTimes(2);
    });

    it("remembers that there is no release yet", async () => {
        fetchLatestRelease.mockRejectedValue(err("no_release"));
        const r = await releaseFor(addon("professionkit"), { config: config() });
        expect(r).toMatchObject({ state: "no_release", release: null, stale: false });
        await releaseFor(addon("professionkit"), { config: config() });
        expect(fetchLatestRelease).toHaveBeenCalledTimes(1);
    });

    it.each(["rate_limited", "unreachable"])("serves the last good release stale when GitHub fails (%s)", async (code) => {
        const now = Date.now();
        fetchLatestRelease.mockResolvedValueOnce(release("0.3.0"));
        await releaseFor(addon("levelhelper"), { config: config(), now });
        fetchLatestRelease.mockRejectedValue(err(code));
        const r = await releaseFor(addon("levelhelper"), { config: config(), now: now + CACHE_MS + 1 });
        expect(r).toMatchObject({ state: "ok", stale: true, errorCode: code, release: { version: "0.3.0" } });
        // the failure is not retried per view
        await releaseFor(addon("levelhelper"), { config: config(), now: now + CACHE_MS + 1 });
        expect(fetchLatestRelease).toHaveBeenCalledTimes(2);
    });

    it("answers an error without anything cached, and retries after RETRY_MS", async () => {
        fetchLatestRelease.mockRejectedValue(err("unauthorized"));
        const r = await releaseFor(addon("levelhelper"), { config: config() });
        expect(r).toMatchObject({ state: "error", errorCode: "unauthorized", release: null });
        fetchLatestRelease.mockResolvedValue(release("0.3.0"));
        const soon = await releaseFor(addon("levelhelper"), { config: config(), now: Date.now() + 1000 });
        expect(soon.state).toBe("error");
        const later = await releaseFor(addon("levelhelper"), { config: config(), now: Date.now() + RETRY_MS + 1000 });
        expect(later).toMatchObject({ state: "ok", release: { version: "0.3.0" } });
    });

    it("starts over when the token changes, keeping the old answer as the fallback", async () => {
        fetchLatestRelease.mockResolvedValue(release("0.3.0"));
        await releaseFor(addon("levelhelper"), { config: config() });
        fetchLatestRelease.mockRejectedValue(err("forbidden"));
        const r = await releaseFor(addon("levelhelper"), { config: config({ github: { token: "other" } }) });
        expect(fetchLatestRelease).toHaveBeenCalledTimes(2);
        expect(r).toMatchObject({ state: "ok", stale: true, errorCode: "forbidden" });
    });

    it("never keeps the token itself, only a fingerprint", () => {
        expect(tokenFingerprint(TOKEN)).toMatch(/^[0-9a-f]{12}$/);
        expect(tokenFingerprint(TOKEN)).not.toContain("SECRET");
        expect(tokenFingerprint("")).toBe("-");
    });
});

describe("cards", () => {
    it("lists the enabled addons of a version", () => {
        const cfg = config();
        cfg.addonDownloads[1].enabled = false;
        expect(enabledAddons(cfg, "forever").map((a) => a.id)).toEqual(["levelhelper", "eventhelper-sync"]);
        expect(enabledAddons(cfg, "tbc").map((a) => a.id)).toEqual(["eventhelper-sync"]);
        expect(enabledAddons(cfg, "classic")).toEqual([]);
        expect(enabledAddons({}, "tbc")).toEqual([]);
    });

    it("names the versions with at least one enabled addon", () => {
        const cfg = config();
        expect(addonVersions(cfg)).toEqual(["tbc", "forever"]);
        cfg.addonDownloads[2].enabled = false;
        expect(addonVersions(cfg)).toEqual(["forever"]);
        expect(addonVersions({})).toEqual([]);
    });

    it("offers only the files of the patterns, each with the server's download link", async () => {
        fetchLatestRelease.mockImplementation(async ({ repo }) => (repo === "mst1987/eventhelper-addon"
            ? release("1.14.0", ["EventHelperSync.exe", "EventHelperSync-1.14.0.zip", "source.tar.gz"])
            : release("0.3.0", ["LevelHelper-0.3.0.zip"])));
        const cards = await addonCards(config(), "tbc");
        expect(cards.map((c) => c.id)).toEqual(["eventhelper-sync"]);
        expect(cards[0].release.assets).toEqual([
            { name: "EventHelperSync.exe", size: 100, sha256: "", kind: "exe", url: "/api/addons/download?addon=eventhelper-sync&asset=EventHelperSync.exe" },
            { name: "EventHelperSync-1.14.0.zip", size: 200, sha256: "", kind: "zip", url: "/api/addons/download?addon=eventhelper-sync&asset=EventHelperSync-1.14.0.zip" },
        ]);
    });

    it("names the repo for an admin only", () => {
        const result = { state: "token_missing", release: null, stale: false, errorCode: "", fetchedAt: 0 };
        expect(addonCard(addon("levelhelper"), result)).not.toHaveProperty("repo");
        expect(addonCard(addon("levelhelper"), result, { canManage: true })).toMatchObject({ repo: "mst1987/levelhelper", private: true });
    });

    it("knows the kinds of files and builds the download path", () => {
        expect([kindOf("a.ZIP"), kindOf("b.exe"), kindOf("c.tar.gz"), kindOf("")]).toEqual(["zip", "exe", "file", "file"]);
        expect(downloadPath("a b", "x&y.zip")).toBe("/api/addons/download?addon=a%20b&asset=x%26y.zip");
    });
});

describe("resolveDownload", () => {
    beforeEach(() => fetchLatestRelease.mockResolvedValue(release("0.3.0", ["LevelHelper-0.3.0.zip", "other.zip"])));

    it("finds the offered file of the current release, with the token to fetch it", async () => {
        const target = await resolveDownload(config(), "levelhelper", "LevelHelper-0.3.0.zip");
        expect(target.addon.id).toBe("levelhelper");
        expect(target.asset).toMatchObject({ id: 1, name: "LevelHelper-0.3.0.zip" });
        expect(target.token).toBe(TOKEN);
    });

    it("refuses an unknown or disabled addon, a file outside the patterns and an unknown file", async () => {
        expect(await resolveDownload(config(), "nope", "x")).toMatchObject({ status: 404, code: "unknown_addon" });
        const off = config();
        off.addonDownloads[0].enabled = false;
        expect(await resolveDownload(off, "levelhelper", "LevelHelper-0.3.0.zip")).toMatchObject({ status: 404, code: "unknown_addon" });
        expect(await resolveDownload(config(), "levelhelper", "other.zip")).toMatchObject({ status: 404, code: "unknown_asset" });
        expect(await resolveDownload(config(), "levelhelper", "LevelHelper-0.2.0.zip")).toMatchObject({ status: 404, code: "unknown_asset" });
    });

    it("says why there is nothing: no token, no release, GitHub down", async () => {
        expect(await resolveDownload(config({ github: { token: "" } }), "levelhelper", "LevelHelper-0.3.0.zip")).toMatchObject({ status: 503, code: "unavailable" });
        resetAddonReleaseCache();
        fetchLatestRelease.mockRejectedValue(err("no_release"));
        expect(await resolveDownload(config(), "levelhelper", "x")).toMatchObject({ status: 404, code: "no_release" });
        resetAddonReleaseCache();
        fetchLatestRelease.mockRejectedValue(err("unreachable"));
        expect(await resolveDownload(config(), "levelhelper", "x")).toMatchObject({ status: 503, code: "unavailable" });
    });
});
