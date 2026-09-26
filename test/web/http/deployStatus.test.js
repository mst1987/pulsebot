// How far behind main the running process is (#314).
//
// ⚠️ The GitHub call is mocked throughout — no test here may touch the network.
jest.mock("axios", () => ({ get: jest.fn() }));
jest.mock("../../../src/web/http/version", () => ({ versionInfo: jest.fn() }));

const axios = require("axios");
const { versionInfo } = require("../../../src/web/http/version");
const { deployStatus, compare, resetDeployCache, REPO, CACHE_MS } = require("../../../src/web/http/deployStatus");

const sha = (n) => String(n).padStart(40, "0");

/** One GitHub commit entry, newest first in the list the API returns. */
const entry = (n, date = "2026-09-12T10:00:00Z", message = `commit ${n}`) => ({
    sha: sha(n),
    commit: { committer: { date }, author: { date }, message },
});

function running(n) {
    return { commit: sha(n), short: sha(n).slice(0, 7), committedAt: "2026-09-12T10:00:00Z", subject: "subject", startedAt: "2026-09-12T10:05:00Z" };
}

describe("web/http/deployStatus", () => {
    beforeEach(() => {
        resetDeployCache();
        axios.get.mockReset();
        versionInfo.mockReset();
        versionInfo.mockReturnValue(running(1));
    });

    describe("compare (pure)", () => {
        it("says current when the running commit is main's head", () => {
            const r = compare(running(1), [entry(1), entry(2)]);
            expect(r).toMatchObject({ status: "current", behind: 0, behindSince: "" });
            expect(r.latest.short).toBe(sha(1).slice(0, 7));
        });

        it("counts the commits between the running one and main's head", () => {
            const commits = [entry(9), entry(8), entry(7, "2026-09-06T08:00:00Z"), entry(1)];
            const r = compare(running(1), commits);
            expect(r.status).toBe("behind");
            expect(r.behind).toBe(3);
            // The age of the OLDEST missing commit, i.e. the one right above ours.
            expect(r.behindSince).toBe("2026-09-06T08:00:00Z");
            expect(r.latest.commit).toBe(sha(9));
        });

        it("cannot tell when the running commit is not in main's page", () => {
            expect(compare(running(42), [entry(1), entry(2)])).toMatchObject({ status: "unknown", reason: "not_found", behind: 0 });
        });

        it("cannot tell without a running commit", () => {
            expect(compare({ commit: "" }, [entry(1)])).toMatchObject({ status: "unknown", reason: "no_commit" });
        });

        it("cannot tell when GitHub gave nothing back", () => {
            expect(compare(running(1), null)).toMatchObject({ status: "unknown", reason: "unreachable", latest: null });
            expect(compare(running(1), [])).toMatchObject({ status: "unknown", reason: "unreachable" });
        });

        it("keeps only the first line of a commit message", () => {
            const r = compare(running(2), [entry(1, "2026-09-12T10:00:00Z", "Titel\n\nlanger Rumpf"), entry(2)]);
            expect(r.latest.subject).toBe("Titel");
        });
    });

    describe("deployStatus", () => {
        it("asks the public repository without a token and reports the distance", async () => {
            axios.get.mockResolvedValue({ data: [entry(3), entry(2, "2026-09-10T10:00:00Z"), entry(1)] });
            const status = await deployStatus();
            expect(status).toMatchObject({ status: "behind", behind: 2, behindSince: "2026-09-10T10:00:00Z", commit: sha(1) });
            const [url, opts] = axios.get.mock.calls[0];
            expect(url).toBe(`https://api.github.com/repos/${REPO}/commits`);
            expect(opts.params).toMatchObject({ sha: "main" });
            expect(JSON.stringify(opts.headers)).not.toMatch(/token|Authorization/i);
            expect(opts.headers["User-Agent"]).toBeTruthy();
        });

        it("caches the answer for ten minutes", async () => {
            axios.get.mockResolvedValue({ data: [entry(1)] });
            await deployStatus();
            await deployStatus();
            await deployStatus();
            expect(axios.get).toHaveBeenCalledTimes(1);
            expect(CACHE_MS).toBe(10 * 60 * 1000);
        });

        it("asks again when forced", async () => {
            axios.get.mockResolvedValue({ data: [entry(1)] });
            await deployStatus();
            await deployStatus({ force: true });
            expect(axios.get).toHaveBeenCalledTimes(2);
        });

        it("shares one request between concurrent callers", async () => {
            axios.get.mockResolvedValue({ data: [entry(1)] });
            const [a, b] = await Promise.all([deployStatus(), deployStatus()]);
            expect(axios.get).toHaveBeenCalledTimes(1);
            expect(a.status).toBe("current");
            expect(b.status).toBe("current");
        });

        it("answers 'not checkable' when GitHub fails, and never throws", async () => {
            axios.get.mockRejectedValue(new Error("getaddrinfo ENOTFOUND api.github.com"));
            const status = await deployStatus();
            expect(status).toMatchObject({ status: "unknown", reason: "unreachable", commit: sha(1) });
        });

        it("caches a failure too, so an outage is asked about once every ten minutes", async () => {
            axios.get.mockRejectedValue(new Error("rate limited"));
            await deployStatus();
            await deployStatus();
            expect(axios.get).toHaveBeenCalledTimes(1);
        });

        it("does not ask GitHub at all without a running commit", async () => {
            versionInfo.mockReturnValue({ commit: "", short: "", committedAt: "", subject: "", startedAt: "2026-09-12T10:05:00Z" });
            const status = await deployStatus();
            expect(axios.get).not.toHaveBeenCalled();
            expect(status).toMatchObject({ status: "unknown", reason: "no_commit" });
        });

        it("carries the version fields and a check timestamp through", async () => {
            axios.get.mockResolvedValue({ data: [entry(1)] });
            const status = await deployStatus();
            expect(status.short).toBe(sha(1).slice(0, 7));
            expect(status.subject).toBe("subject");
            expect(status.startedAt).toBe("2026-09-12T10:05:00Z");
            expect(new Date(status.checkedAt).getTime()).toBeLessThanOrEqual(Date.now());
        });
    });
});
