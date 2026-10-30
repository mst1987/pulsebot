// /api/addons and /api/addons/download through the real router (#818): the
// cards of the menu's version, who may open them, and the download — streamed
// through the server with the file's name and type, counted per account, with
// the token never in an answer or a log line.
const { PassThrough } = require("stream");

jest.mock("../../../../src/web/http/auth", () => ({ getUser: () => mockUser }));
jest.mock("../../../../src/stores/settings/configStore", () => ({ getConfig: () => mockConfig }));
jest.mock("../../../../src/classes/githubReleases", () => ({ fetchLatestRelease: jest.fn(), openAssetStream: jest.fn() }));

let mockUser = null;
let mockConfig = null;

const { fetchLatestRelease, openAssetStream } = require("../../../../src/classes/githubReleases");
const route = require("../../../../src/web/apiRoutes/system/addons");
const { resetAddonReleaseCache } = require("../../../../src/services/addons/addonReleases");
const { resetDownloadLimit, LIMIT } = require("../../../../src/services/addons/downloadLimit");
const { defaultAddons } = require("../../../../src/services/addons/addonConfig");
const { routerClient, status, body } = require("../../../helpers/http");
const { emptyAccess } = require("../../../../src/config/permissions");

const { get, handle, urlFor } = routerClient(route);

const TOKEN = "github_pat_SECRET_TOKEN";
const ADMIN = { id: "1", name: "Admin", isAdmin: true };
const orga = { id: "8", name: "Orga", isAdmin: false, isOrga: true, access: { ...emptyAccess(), signup: { read: true, write: false } } };
const member = (area = "signup") => ({ id: "7", name: "Bob", isAdmin: false, access: { ...emptyAccess(), [area]: { read: true, write: false } } });
const release = (version, names) => ({
    version, tag: `v${version}`, name: "", publishedAt: "2026-10-12T10:00:00Z", notes: "",
    assets: names.map((name, i) => ({ id: 100 + i, name, size: 1000 * (i + 1), contentType: "", sha256: "" })),
});

function githubWith(map) {
    fetchLatestRelease.mockImplementation(async ({ repo }) => {
        const r = map[repo];
        if (r instanceof Error) throw r;
        if (!r) throw Object.assign(new Error("no"), { code: "no_release" });
        return r;
    });
}

/** A response that a stream can be piped into, collecting what it gets. */
function streamRes() {
    const res = new PassThrough();
    const chunks = [];
    res.on("data", (c) => chunks.push(c));
    res.writeHead = jest.fn();
    res.text = () => Buffer.concat(chunks).toString("utf8");
    return res;
}

async function download(query) {
    const res = streamRes();
    const done = new Promise((resolve) => { res.on("finish", resolve); res.on("close", resolve); });
    await handle("/api/addons/download", { method: "GET" }, res, urlFor("/api/addons/download", query));
    // an error answer ends at once; a stream ends when GitHub's stream does
    await Promise.race([done, new Promise((r) => setTimeout(r, 200))]);
    return res;
}

const statusOf = (res) => res.writeHead.mock.calls[0][0];
const headersOf = (res) => res.writeHead.mock.calls[0][1] || {};

let logs;
beforeEach(() => {
    jest.clearAllMocks();
    resetAddonReleaseCache();
    resetDownloadLimit();
    mockUser = ADMIN;
    mockConfig = { addonDownloads: defaultAddons(), github: { token: TOKEN }, mainVersion: "forever" };
    githubWith({
        "mst1987/levelhelper": release("0.3.0", ["LevelHelper-0.3.0.zip"]),
        "mst1987/eventhelper-addon": release("1.14.0", ["EventHelperSync.exe", "EventHelperSync-1.14.0.zip"]),
    });
    openAssetStream.mockImplementation(async () => {
        const stream = new PassThrough();
        setImmediate(() => stream.end("PK-bytes"));
        return { stream, size: 8, contentType: "application/octet-stream" };
    });
    logs = [];
    for (const m of ["log", "warn", "error", "info"]) jest.spyOn(console, m).mockImplementation((...args) => logs.push(args.join(" ")));
});
afterEach(() => jest.restoreAllMocks());

describe("GET /api/addons", () => {
    it("answers the cards of the asked version, without any GitHub url or the token", async () => {
        const res = await get("/api/addons", { version: "forever" });
        expect(status(res)).toBe(200);
        const data = body(res);
        expect(data.versionId).toBe("forever");
        expect(data.addons.map((a) => [a.id, a.state])).toEqual([["levelhelper", "ok"], ["professionkit", "no_release"],
            ["aurakit", "no_release"], ["macrohelper", "no_release"], ["eventhelper-sync", "ok"]]);
        expect(data.addons[0].release.assets[0].url).toBe("/api/addons/download?addon=levelhelper&asset=LevelHelper-0.3.0.zip");
        expect(data.downloadLimit).toBe(LIMIT);
        const text = JSON.stringify(data);
        expect(text).not.toContain(TOKEN);
        expect(text).not.toMatch(/github\.com/);
    });

    it("shows only the addons of the version", async () => {
        const data = body(await get("/api/addons", { version: "tbc" }));
        expect(data.addons.map((a) => a.id)).toEqual(["eventhelper-sync"]);
    });

    it("answers no cards for Classic, but names the versions that have addons", async () => {
        const data = body(await get("/api/addons", { version: "classic" }));
        expect(data.versionId).toBe("classic");
        expect(data.addons).toEqual([]);
        expect(data.addonVersions.map((v) => v.id)).toEqual(["tbc", "forever"]);
        expect(data.addonVersions.every((v) => v.label && v.label !== v.id)).toBe(true);
    });

    it("falls back to the main version, and to it alone while the others are hidden", async () => {
        expect(body(await get("/api/addons")).versionId).toBe("forever");
        mockConfig = { ...mockConfig, hideOtherVersions: true };
        expect(body(await get("/api/addons", { version: "tbc" })).versionId).toBe("forever");
    });

    it("tells an admin whether the token is set and names the repo; a member gets neither", async () => {
        mockConfig = { ...mockConfig, github: { token: "" } };
        const admin = body(await get("/api/addons", { version: "forever" }));
        expect(admin.tokenSet).toBe(false);
        expect(admin.addons[0]).toMatchObject({ state: "token_missing", repo: "mst1987/levelhelper", private: true });
        mockUser = member();
        const own = body(await get("/api/addons", { version: "forever" }));
        expect(own).not.toHaveProperty("tokenSet");
        expect(own.addons[0]).toMatchObject({ state: "token_missing" });
        expect(own.addons[0]).not.toHaveProperty("repo");
    });

    it("opens for signup or history, nothing else, and never anonymously", async () => {
        mockUser = member("signup");
        expect(status(await get("/api/addons"))).toBe(200);
        mockUser = member("history");
        expect(status(await get("/api/addons"))).toBe(200);
        mockUser = member("raids");
        expect(status(await get("/api/addons"))).toBe(403);
        mockUser = null;
        expect(status(await get("/api/addons"))).toBe(401);
    });
});

describe("GET /api/addons/detail", () => {
    it("answers one addon with its release and the names of its versions, whatever version the menu shows", async () => {
        mockUser = member();
        const res = await get("/api/addons/detail", { addon: "levelhelper" });
        expect(status(res)).toBe(200);
        const data = body(res);
        expect(data.addon).toMatchObject({ id: "levelhelper", name: "LevelHelper", state: "ok" });
        expect(data.addon.release.version).toBe("0.3.0");
        expect(data.addon.release.assets[0].url).toBe("/api/addons/download?addon=levelhelper&asset=LevelHelper-0.3.0.zip");
        expect(data.versions).toEqual([{ id: "forever", label: expect.any(String) }]);
        expect(data.versions[0].label).not.toBe("forever");
        expect(data.downloadLimit).toBe(LIMIT);
        expect(data).not.toHaveProperty("tokenSet");
        expect(data.addon).not.toHaveProperty("repo");
        const text = JSON.stringify(data);
        expect(text).not.toContain(TOKEN);
        expect(text).not.toMatch(/github\.com/);
    });

    it("passes the CurseForge page to every member, empty when the addon has none", async () => {
        mockUser = member();
        const list = body(await get("/api/addons", { version: "forever" }));
        expect(list.addons.map((a) => [a.id, a.curseforge])).toEqual([
            ["levelhelper", ""], ["professionkit", ""],
            ["aurakit", "https://www.curseforge.com/wow/addons/pulse-aurakit"],
            ["macrohelper", "https://www.curseforge.com/wow/addons/pulse-macrohelper"],
        ]);
        const detail = body(await get("/api/addons/detail", { addon: "aurakit" }));
        expect(detail.addon.curseforge).toBe("https://www.curseforge.com/wow/addons/pulse-aurakit");
        // also without a release: the link does not depend on GitHub
        expect(detail.addon.release).toBeNull();
    });

    it("keeps the state of an addon without a release", async () => {
        const data = body(await get("/api/addons/detail", { addon: "professionkit" }));
        expect(data.addon).toMatchObject({ id: "professionkit", state: "no_release", release: null });
    });

    it("tells an admin whether the token is set and names the repo", async () => {
        mockConfig = { ...mockConfig, github: { token: "" } };
        const data = body(await get("/api/addons/detail", { addon: "levelhelper" }));
        expect(data.tokenSet).toBe(false);
        expect(data.addon).toMatchObject({ state: "token_missing", repo: "mst1987/levelhelper" });
    });

    it("answers the same 404 for an unknown, a disabled and (for a raider) an orga-only addon", async () => {
        mockConfig = { ...mockConfig, addonDownloads: defaultAddons().map((a) => (a.id === "aurakit" ? { ...a, enabled: false } : a)) };
        mockUser = member();
        for (const addon of ["nope", "", "aurakit", "eventhelper-sync"]) {
            const res = await get("/api/addons/detail", { addon });
            expect(status(res)).toBe(404);
            expect(body(res)).toMatchObject({ error: { code: "unknown_addon" } });
        }
        mockUser = orga;
        expect(status(await get("/api/addons/detail", { addon: "eventhelper-sync" }))).toBe(200);
    });

    it("opens for signup or history, nothing else, and never anonymously", async () => {
        mockUser = member("history");
        expect(status(await get("/api/addons/detail", { addon: "levelhelper" }))).toBe(200);
        mockUser = member("raids");
        expect(status(await get("/api/addons/detail", { addon: "levelhelper" }))).toBe(403);
        mockUser = null;
        expect(status(await get("/api/addons/detail", { addon: "levelhelper" }))).toBe(401);
    });
});

describe("GET /api/addons/name (no login)", () => {
    it("names an enabled addon to a visitor without a session: id, name and icon only, without asking GitHub", async () => {
        mockUser = null;
        const res = await get("/api/addons/name", { addon: "levelhelper" });
        expect(status(res)).toBe(200);
        expect(body(res)).toEqual({ id: "levelhelper", name: "LevelHelper", icon: expect.any(String) });
        expect(fetchLatestRelease).not.toHaveBeenCalled();
    });

    it("answers the same 404 for an unknown, a disabled and an orga-only addon, even for the orga", async () => {
        mockConfig = { ...mockConfig, addonDownloads: defaultAddons().map((a) => (a.id === "aurakit" ? { ...a, enabled: false } : a)) };
        for (const user of [null, orga, ADMIN]) {
            mockUser = user;
            for (const addon of ["nope", "", "aurakit", "eventhelper-sync"]) {
                const res = await get("/api/addons/name", { addon });
                expect(status(res)).toBe(404);
                expect(body(res)).toMatchObject({ error: { code: "unknown_addon" } });
            }
        }
        expect(fetchLatestRelease).not.toHaveBeenCalled();
    });
});

describe("GET /api/addons/download", () => {
    it("streams the file with its name and type, fetched with the token, and logs who took it", async () => {
        mockUser = member();
        const res = await download({ addon: "levelhelper", asset: "LevelHelper-0.3.0.zip" });
        expect(statusOf(res)).toBe(200);
        expect(headersOf(res)).toMatchObject({
            "Content-Type": "application/zip",
            "Content-Disposition": "attachment; filename=\"LevelHelper-0.3.0.zip\"; filename*=UTF-8''LevelHelper-0.3.0.zip",
            "Content-Length": "8",
            "Cache-Control": "private, no-store",
        });
        expect(res.text()).toBe("PK-bytes");
        expect(openAssetStream).toHaveBeenCalledWith({ repo: "mst1987/levelhelper", assetId: 100, token: TOKEN });
        expect(logs.some((l) => /download levelhelper 0\.3\.0 LevelHelper-0\.3\.0\.zip by Bob \(7\)/.test(l))).toBe(true);
        expect(logs.join("\n")).not.toContain(TOKEN);
    });

    it("sends an exe as an exe", async () => {
        const res = await download({ addon: "eventhelper-sync", asset: "EventHelperSync.exe" });
        expect(headersOf(res)["Content-Type"]).toBe("application/vnd.microsoft.portable-executable");
    });

    it("needs a login and a member area", async () => {
        mockUser = null;
        expect(statusOf(await download({ addon: "levelhelper", asset: "LevelHelper-0.3.0.zip" }))).toBe(401);
        mockUser = member("raids");
        expect(statusOf(await download({ addon: "levelhelper", asset: "LevelHelper-0.3.0.zip" }))).toBe(403);
        expect(openAssetStream).not.toHaveBeenCalled();
    });

    it("refuses a file the addon does not offer, an unknown addon and a missing token", async () => {
        expect(statusOf(await download({ addon: "levelhelper", asset: "../../etc/passwd" }))).toBe(404);
        expect(statusOf(await download({ addon: "nope", asset: "x.zip" }))).toBe(404);
        resetAddonReleaseCache();
        mockConfig = { ...mockConfig, github: { token: "" } };
        expect(statusOf(await download({ addon: "levelhelper", asset: "LevelHelper-0.3.0.zip" }))).toBe(503);
        expect(openAssetStream).not.toHaveBeenCalled();
    });

    it("allows LIMIT downloads per hour, then answers 429 with Retry-After", async () => {
        mockUser = member();
        for (let i = 0; i < LIMIT; i++) {
            expect(statusOf(await download({ addon: "levelhelper", asset: "LevelHelper-0.3.0.zip" }))).toBe(200);
        }
        const res = await download({ addon: "levelhelper", asset: "LevelHelper-0.3.0.zip" });
        expect(statusOf(res)).toBe(429);
        expect(Number(headersOf(res)["Retry-After"])).toBeGreaterThan(0);
        expect(openAssetStream).toHaveBeenCalledTimes(LIMIT);
    });

    it("answers 502 when GitHub refuses the file, without the token in the log", async () => {
        openAssetStream.mockRejectedValue(Object.assign(new Error("boom"), { code: "unreachable", status: 500 }));
        const res = await download({ addon: "levelhelper", asset: "LevelHelper-0.3.0.zip" });
        expect(statusOf(res)).toBe(502);
        expect(logs.join("\n")).not.toContain(TOKEN);
    });
});

describe("helpers", () => {
    it("writes a safe Content-Disposition for any name", () => {
        expect(route.dispositionOf("Ä \"x\".zip")).toBe("attachment; filename=\"_ _x_.zip\"; filename*=UTF-8''%C3%84%20%22x%22.zip");
        expect(route.contentTypeOf("a.bin")).toBe("application/octet-stream");
    });
});

describe("orga-only addons", () => {
    const ids = (data) => data.addons.map((a) => a.id);

    it("show up for an admin and the orga, marked", async () => {
        for (const user of [ADMIN, orga]) {
            mockUser = user;
            const data = body(await get("/api/addons", { version: "tbc" }));
            expect(data.addons).toHaveLength(1);
            expect(data.addons[0]).toMatchObject({ id: "eventhelper-sync", orgaOnly: true });
        }
        mockUser = orga;
        const forever = body(await get("/api/addons", { version: "forever" }));
        expect(forever.addons.find((a) => a.id === "levelhelper").orgaOnly).toBe(false);
    });

    it("are absent for a raider, also from the version hint", async () => {
        mockUser = member();
        const forever = body(await get("/api/addons", { version: "forever" }));
        expect(ids(forever)).toEqual(["levelhelper", "professionkit", "aurakit", "macrohelper"]);
        const tbc = body(await get("/api/addons", { version: "tbc" }));
        expect(tbc.addons).toEqual([]);
        expect(tbc.addonVersions.map((v) => v.id)).toEqual(["forever"]);
        expect(JSON.stringify(tbc)).not.toMatch(/eventhelper-sync|EventHelper Sync/);
    });

    it("follow an explicit false in the settings, for the raider too", async () => {
        mockConfig = { ...mockConfig, addonDownloads: defaultAddons().map((a) => ({ ...a, orgaOnly: false })) };
        mockUser = member();
        expect(ids(body(await get("/api/addons", { version: "tbc" })))).toEqual(["eventhelper-sync"]);
    });

    it("refuse a raider's download with 403 orga_only, before the limit and before GitHub, and log it", async () => {
        mockUser = member();
        const res = await download({ addon: "eventhelper-sync", asset: "EventHelperSync.exe" });
        expect(statusOf(res)).toBe(403);
        expect(res.text()).toContain("orga_only");
        expect(fetchLatestRelease).not.toHaveBeenCalled();
        expect(openAssetStream).not.toHaveBeenCalled();
        expect(logs.join("\n")).toMatch(/download refused \(orga only\): eventhelper-sync\/EventHelperSync.exe by Bob \(7\)/);
        // no download was counted: the whole quota is still there
        mockUser = member();
        for (let i = 0; i < LIMIT; i++) {
            expect(statusOf(await download({ addon: "levelhelper", asset: "LevelHelper-0.3.0.zip" }))).toBe(200);
        }
    });

    it("let the orga and an admin download", async () => {
        for (const user of [orga, ADMIN]) {
            mockUser = user;
            const res = await download({ addon: "eventhelper-sync", asset: "EventHelperSync.exe" });
            expect(statusOf(res)).toBe(200);
            expect(res.text()).toBe("PK-bytes");
        }
    });
});
