// classes/githubReleases.js against a mocked axios: the newest release of a
// public and a private repo (the token only in the Authorization header), the
// failures as short codes (404 = no release, 401, 403 with and without the
// rate limit, 5xx, network), and one release file as a stream.
jest.mock("axios", () => ({ get: jest.fn() }));

const axios = require("axios");
const { fetchLatestRelease, openAssetStream, reduceRelease, sha256Of, GithubError, NOTES_MAX } = require("../../src/classes/githubReleases");

const TOKEN = "github_pat_SECRET123";
const SHA = "a".repeat(64);

const RELEASE = {
    tag_name: "v0.3.0",
    name: "LevelHelper 0.3.0",
    published_at: "2026-10-12T10:00:00Z",
    body: "## Neu\r\n- Duo",
    html_url: "https://github.com/mst1987/levelhelper/releases/tag/v0.3.0",
    assets: [
        { id: 11, name: "LevelHelper-0.3.0.zip", size: 389120, content_type: "application/zip", state: "uploaded", digest: `sha256:${SHA}`, browser_download_url: "https://github.com/x" },
        { id: 12, name: "half.zip", size: 1, state: "starter" },
        { id: 13, name: "notes.txt", size: 10, state: "uploaded" },
    ],
};

/** An axios failure with a response. */
const httpError = (status, headers = {}) => Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, headers },
    config: { headers: { Authorization: `Bearer ${TOKEN}` } },
});

beforeEach(() => jest.clearAllMocks());

describe("reduceRelease", () => {
    it("keeps version, date, notes and the uploaded files with size and SHA-256", () => {
        expect(reduceRelease(RELEASE)).toEqual({
            version: "0.3.0",
            tag: "v0.3.0",
            name: "LevelHelper 0.3.0",
            publishedAt: "2026-10-12T10:00:00Z",
            notes: "## Neu\n- Duo",
            assets: [
                { id: 11, name: "LevelHelper-0.3.0.zip", size: 389120, contentType: "application/zip", sha256: SHA },
                { id: 13, name: "notes.txt", size: 10, contentType: "", sha256: "" },
            ],
        });
    });

    it("never hands out a GitHub url", () => {
        expect(JSON.stringify(reduceRelease(RELEASE))).not.toMatch(/https?:\/\//);
    });

    it("cuts long notes and refuses what is no release", () => {
        const long = reduceRelease({ ...RELEASE, body: "x".repeat(NOTES_MAX + 50) });
        expect(long.notes.length).toBeLessThanOrEqual(NOTES_MAX + 2);
        expect(long.notes.endsWith(" …")).toBe(true);
        expect(reduceRelease(null)).toBeNull();
        expect(reduceRelease({ name: "no tag" })).toBeNull();
    });

    it("reads only a sha256 digest", () => {
        expect(sha256Of(`sha256:${SHA.toUpperCase()}`)).toBe(SHA);
        expect(sha256Of("md5:abc")).toBe("");
        expect(sha256Of(undefined)).toBe("");
    });
});

describe("fetchLatestRelease", () => {
    it("asks a public repo without a token", async () => {
        axios.get.mockResolvedValue({ data: RELEASE });
        const release = await fetchLatestRelease({ repo: "mst1987/eventhelper-addon" });
        expect(release.version).toBe("0.3.0");
        const [url, opts] = axios.get.mock.calls[0];
        expect(url).toBe("https://api.github.com/repos/mst1987/eventhelper-addon/releases/latest");
        expect(opts.headers.Authorization).toBeUndefined();
        expect(opts.headers.Accept).toBe("application/vnd.github+json");
        expect(opts.headers["User-Agent"]).toBeTruthy();
    });

    it("sends the token of a private repo as a bearer header", async () => {
        axios.get.mockResolvedValue({ data: RELEASE });
        await fetchLatestRelease({ repo: "mst1987/levelhelper", token: TOKEN });
        expect(axios.get.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    });

    it.each([
        [httpError(404), "no_release"],
        [httpError(401), "unauthorized"],
        [httpError(403, { "x-ratelimit-remaining": "41" }), "forbidden"],
        [httpError(403, { "x-ratelimit-remaining": "0" }), "rate_limited"],
        [httpError(429), "rate_limited"],
        [httpError(502), "unreachable"],
        [Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" }), "unreachable"],
    ])("turns a failure into a short code (%#)", async (err, code) => {
        axios.get.mockRejectedValue(err);
        const thrown = await fetchLatestRelease({ repo: "mst1987/levelhelper", token: TOKEN }).catch((e) => e);
        expect(thrown).toBeInstanceOf(GithubError);
        expect(thrown.code).toBe(code);
        // the token never travels with the error
        expect(JSON.stringify({ ...thrown, message: thrown.message })).not.toContain(TOKEN);
    });

    it("reads a 200 without a tag as no release", async () => {
        axios.get.mockResolvedValue({ data: {} });
        await expect(fetchLatestRelease({ repo: "a/b" })).rejects.toMatchObject({ code: "no_release" });
    });
});

describe("openAssetStream", () => {
    it("asks the asset api for the bytes, as a stream, following the redirect", async () => {
        const stream = { pipe: jest.fn() };
        axios.get.mockResolvedValue({ data: stream, headers: { "content-length": "389120", "content-type": "application/octet-stream" } });
        const out = await openAssetStream({ repo: "mst1987/levelhelper", assetId: 11, token: TOKEN });
        expect(out).toEqual({ stream, size: 389120, contentType: "application/octet-stream" });
        const [url, opts] = axios.get.mock.calls[0];
        expect(url).toBe("https://api.github.com/repos/mst1987/levelhelper/releases/assets/11");
        expect(opts.headers.Accept).toBe("application/octet-stream");
        expect(opts.headers.Authorization).toBe(`Bearer ${TOKEN}`);
        expect(opts.responseType).toBe("stream");
        expect(opts.maxRedirects).toBeGreaterThan(0);
    });

    it("answers a missing file as not_found", async () => {
        axios.get.mockRejectedValue(httpError(404));
        await expect(openAssetStream({ repo: "a/b", assetId: 1 })).rejects.toMatchObject({ code: "not_found", status: 404 });
    });
});
