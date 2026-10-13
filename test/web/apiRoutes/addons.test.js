// /api/addons and /api/addons/download through the real router (#818): the
// cards of the menu's version, who may open them, and the download — streamed
// through the server with the file's name and type, counted per account, with
// the token never in an answer or a log line.
const { PassThrough } = require("stream");

jest.mock("../../../src/web/http/auth", () => ({ getUser: () => mockUser }));
jest.mock("../../../src/stores/configStore", () => ({ getConfig: () => mockConfig }));
jest.mock("../../../src/classes/githubReleases", () => ({ fetchLatestRelease: jest.fn(), openAssetStream: jest.fn() }));

let mockUser = null;
let mockConfig = null;

const { fetchLatestRelease, openAssetStream } = require("../../../src/classes/githubReleases");
const route = require("../../../src/web/apiRoutes/addons");
const { resetAddonReleaseCache } = require("../../../src/services/addons/addonReleases");
const { resetDownloadLimit, LIMIT } = require("../../../src/services/addons/downloadLimit");
const { defaultAddons } = require("../../../src/services/addons/addonConfig");
const { routerClient, status, body } = require("../../helpers/http");
const { emptyAccess } = require("../../../src/config/permissions");

const { get, handle, urlFor } = routerClient(route);

const TOKEN = "github_pat_SECRET_TOKEN";
const ADMIN = { id: "1", name: "Admin", isAdmin: true };
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
        expect(data.addons.map((a) => [a.id, a.state])).toEqual([["levelhelper", "ok"], ["professionkit", "no_release"], ["eventhelper-sync", "ok"]]);
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
