// The latest addon release lookup: reduced shape, one-hour cache, stale on failure.
//
// The GitHub call is mocked throughout - no test here may touch the network.
jest.mock("axios", () => ({ get: jest.fn() }));

const axios = require("axios");
const { latestRelease, reduceRelease, resetAddonReleaseCache, CACHE_MS, RETRY_MS, RELEASES_URL } = require("../../src/classes/addonRelease");

const RELEASE = {
    tag_name: "v1.14.0",
    html_url: "https://github.com/mst1987/eventhelper-addon/releases/tag/v1.14.0",
    published_at: "2026-10-10T12:00:00Z",
    assets: [
        { name: "EventHelperSync.exe", browser_download_url: "https://github.com/x/EventHelperSync.exe", size: 70000000 },
        { name: "EventHelperSync-1.14.0.zip", browser_download_url: "https://github.com/x/EventHelperSync-1.14.0.zip", size: 90000 },
    ],
};

beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-11T10:00:00Z"));
    resetAddonReleaseCache();
    axios.get.mockReset();
});
afterEach(() => jest.useRealTimers());

describe("reduceRelease", () => {
    it("keeps version, tag, url, date and both assets", () => {
        expect(reduceRelease(RELEASE)).toEqual({
            version: "1.14.0",
            tag: "v1.14.0",
            url: RELEASE.html_url,
            publishedAt: "2026-10-10T12:00:00Z",
            exe: { name: "EventHelperSync.exe", url: "https://github.com/x/EventHelperSync.exe", size: 70000000 },
            zip: { name: "EventHelperSync-1.14.0.zip", url: "https://github.com/x/EventHelperSync-1.14.0.zip", size: 90000 },
        });
    });

    it("leaves a missing asset null and rejects something that is no release", () => {
        expect(reduceRelease({ tag_name: "v2", assets: [] })).toMatchObject({ exe: null, zip: null, url: RELEASES_URL });
        expect(reduceRelease({})).toBeNull();
        expect(reduceRelease(null)).toBeNull();
    });
});

describe("latestRelease", () => {
    it("asks GitHub once with a User-Agent and serves the cache for an hour", async () => {
        axios.get.mockResolvedValue({ data: RELEASE });
        const first = await latestRelease();
        expect(first.version).toBe("1.14.0");
        expect(axios.get.mock.calls[0][0]).toBe("https://api.github.com/repos/mst1987/eventhelper-addon/releases/latest");
        expect(axios.get.mock.calls[0][1].headers["User-Agent"]).toBeTruthy();
        await latestRelease();
        expect(axios.get).toHaveBeenCalledTimes(1);
        jest.setSystemTime(Date.now() + CACHE_MS + 1);
        await latestRelease();
        expect(axios.get).toHaveBeenCalledTimes(2);
    });

    it("shares one request between concurrent callers", async () => {
        axios.get.mockResolvedValue({ data: RELEASE });
        await Promise.all([latestRelease(), latestRelease(), latestRelease()]);
        expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it("is null when GitHub fails and nothing is cached, and retries only after a few minutes", async () => {
        axios.get.mockRejectedValue(new Error("offline"));
        expect(await latestRelease()).toBeNull();
        expect(await latestRelease()).toBeNull();
        expect(axios.get).toHaveBeenCalledTimes(1);
        jest.setSystemTime(Date.now() + RETRY_MS + 1);
        axios.get.mockResolvedValue({ data: RELEASE });
        expect((await latestRelease()).tag).toBe("v1.14.0");
    });

    it("serves the stale release when a refresh fails", async () => {
        axios.get.mockResolvedValueOnce({ data: RELEASE });
        await latestRelease();
        jest.setSystemTime(Date.now() + CACHE_MS + 1);
        axios.get.mockRejectedValue(new Error("rate limited"));
        expect((await latestRelease()).version).toBe("1.14.0");
    });

    it("treats an unusable answer like a failure", async () => {
        axios.get.mockResolvedValue({ data: { message: "Not Found" } });
        expect(await latestRelease()).toBeNull();
    });
});
