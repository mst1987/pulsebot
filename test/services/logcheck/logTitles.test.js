// The log lists' titles and raids from WCL (services/logcheck/logTitles.js):
// a few per page view, a failed report left alone for a while, the rest by
// logAutoLink's background sweep.
jest.mock("../../../src/stores/logStore.js");
const mockGetFights = jest.fn();
jest.mock("../../../src/classes/warcraftlogs.js", () =>
    jest.fn().mockImplementation(() => ({ getFights: mockGetFights })));

const WarcraftLogs = require("../../../src/classes/warcraftlogs.js");
const logStore = require("../../../src/stores/logStore.js");
const {
    backfillLogTitles, backfillAllLogTitles, BACKFILL_PAGE_LIMIT, BACKFILL_RETRY_MS, _resetBackfillForTests,
} = require("../../../src/services/logcheck/logTitles.js");

beforeEach(() => {
    logStore.evaluatedSections.mockImplementation((log) => (Array.isArray(log.sections) ? log.sections : []));
});

describe("services/logcheck/logTitles — backfillLogTitles", () => {
    const OLD_KEY = process.env.WARCRAFTLOGS_API_KEY;
    beforeEach(() => {
        process.env.WARCRAFTLOGS_API_KEY = "wcl-key";
        mockGetFights.mockReset();
        WarcraftLogs.mockImplementation(() => ({ getFights: mockGetFights }));
        _resetBackfillForTests();
    });
    afterEach(() => {
        if (OLD_KEY === undefined) delete process.env.WARCRAFTLOGS_API_KEY;
        else process.env.WARCRAFTLOGS_API_KEY = OLD_KEY;
    });

    it("fills the WCL report name into logs missing a title and persists it", async () => {
        mockGetFights.mockResolvedValue({ title: "  Karazhan 24/07 ", zoneName: "Karazhan" });
        const logs = [
            { id: "l1", reportId: "AAA" },
            { id: "l2", reportId: "BBB", title: "Kept", raids: [] }, // title and raids known → skipped
        ];
        const filled = await backfillLogTitles(logs);
        expect(filled).toBe(1);
        expect(logs[0].title).toBe("Karazhan 24/07");           // mutated in place
        expect(logStore.setLogTitle).toHaveBeenCalledWith("l1", "Karazhan 24/07");
        expect(mockGetFights).toHaveBeenCalledTimes(1);          // only the untitled one
        expect(logs[1].title).toBe("Kept");
    });

    it("is a no-op when every log has its title and its raids", async () => {
        expect(await backfillLogTitles([{ id: "x", reportId: "Y", title: "T", raids: [] }])).toBe(0);
        expect(mockGetFights).not.toHaveBeenCalled();
    });

    it("reads the raids and their boss count from the same request, and stores them", async () => {
        mockGetFights.mockResolvedValue({
            title: "Hyjal",
            zoneName: "Hyjal Summit",
            fights: [
                { id: 1, boss: 1, name: "Rage Winterchill", kill: true },
                { id: 2, boss: 2, name: "Anetheron", kill: true },
                { id: 3, boss: 3, name: "Kaz'rogal", kill: true },
                { id: 4, boss: 4, name: "Azgalor", kill: false },
            ],
        });
        const logs = [{ id: "l1", reportId: "AAA", title: "Hyjal" }];
        await backfillLogTitles(logs, 1_000_000);
        expect(logStore.setLogTitle).not.toHaveBeenCalled();
        expect(logStore.setLogRaids).toHaveBeenCalledWith("l1", [expect.objectContaining({
            contentId: "hyjal", label: "Hyjal", killed: 3, total: 5, finalKilled: false, missing: ["Azgalor", "Archimonde"],
        })]);
        expect(logs[0].raids[0].killed).toBe(3);
    });

    it("re-reads an unfinished raid of a fresh post, but not a finished, evaluated or old one", async () => {
        const now = 100 * 60 * 60 * 1000;
        const unfinished = [{ contentId: "hyjal", finalKilled: false }];
        mockGetFights.mockResolvedValue({ title: "x", fights: [] });
        await backfillLogTitles([
            { id: "fresh", reportId: "A", title: "t", raids: unfinished, postedAt: now - 60 * 60 * 1000, raidsAt: now - 30 * 60 * 1000 },
            { id: "justRead", reportId: "B", title: "t", raids: unfinished, postedAt: now - 60 * 60 * 1000, raidsAt: now - 60 * 1000 },
            { id: "old", reportId: "C", title: "t", raids: unfinished, postedAt: now - 48 * 60 * 60 * 1000, raidsAt: 0 },
            { id: "evaluated", reportId: "D", title: "t", raids: unfinished, sections: ["cla"], postedAt: now, raidsAt: 0 },
            { id: "done", reportId: "E", title: "t", raids: [{ contentId: "bt", finalKilled: true }], postedAt: now, raidsAt: 0 },
        ], now);
        expect(mockGetFights.mock.calls.map((c) => c[0])).toEqual(["A"]);
    });

    it("skips silently when the WCL API key is missing", async () => {
        delete process.env.WARCRAFTLOGS_API_KEY;
        WarcraftLogs.mockImplementationOnce(() => { throw new Error("WARCRAFTLOGS_API_KEY is not set"); });
        expect(await backfillLogTitles([{ id: "l1", reportId: "AAA" }])).toBe(0);
        expect(logStore.setLogTitle).not.toHaveBeenCalled();
    });

    it("tolerates a failed/empty WCL response (keeps the code, no crash)", async () => {
        mockGetFights.mockRejectedValueOnce(new Error("404"));
        mockGetFights.mockResolvedValueOnce({ title: "" });
        const logs = [{ id: "l1", reportId: "AAA" }, { id: "l2", reportId: "BBB" }];
        expect(await backfillLogTitles(logs)).toBe(0);
        expect(logStore.setLogTitle).not.toHaveBeenCalled();
        expect(logs[0].title).toBeUndefined();
    });

    it("asks WCL for at most a few logs per page view, in the given order", async () => {
        mockGetFights.mockImplementation(async (code) => ({ title: `T ${code}`, fights: [] }));
        const logs = ["A", "B", "C", "D", "E"].map((code) => ({ id: code, reportId: code }));
        expect(await backfillLogTitles(logs)).toBe(BACKFILL_PAGE_LIMIT);
        expect(mockGetFights.mock.calls.map((c) => c[0])).toEqual(["A", "B", "C"]);
        // the next view goes on where this one stopped
        mockGetFights.mockClear();
        await backfillLogTitles(logs);
        expect(mockGetFights.mock.calls.map((c) => c[0])).toEqual(["D", "E"]);
        expect(await backfillLogTitles(logs, Date.now(), { limit: 0 })).toBe(0);
    });

    it("leaves a failed report alone for half an hour, then tries it again", async () => {
        const now = 5_000_000;
        mockGetFights.mockRejectedValue(new Error("429"));
        const logs = [{ id: "l1", reportId: "AAA" }, { id: "l2", reportId: "BBB" }];
        await backfillLogTitles(logs, now);
        expect(mockGetFights).toHaveBeenCalledTimes(2);
        await backfillLogTitles(logs, now + BACKFILL_RETRY_MS - 1);
        expect(mockGetFights).toHaveBeenCalledTimes(2);
        mockGetFights.mockResolvedValue({ title: "Kara" });
        expect(await backfillLogTitles(logs, now + BACKFILL_RETRY_MS)).toBe(2);
        expect(mockGetFights).toHaveBeenCalledTimes(4);
    });

    it("also leaves alone a report that answered without a title, and the failed ones do not use up the limit", async () => {
        const now = 5_000_000;
        mockGetFights.mockResolvedValueOnce({ title: "" });
        await backfillLogTitles([{ id: "l1", reportId: "AAA" }], now);
        mockGetFights.mockResolvedValue({ title: "x" });
        const logs = ["AAA", "B", "C", "D"].map((code) => ({ id: code, reportId: code }));
        await backfillLogTitles(logs, now + 1000);
        expect(mockGetFights.mock.calls.slice(1).map((c) => c[0])).toEqual(["B", "C", "D"]);
    });

    it("the background sweep reads every stored log, newest first, with its own limit", async () => {
        mockGetFights.mockImplementation(async (code) => ({ title: `T ${code}`, fights: [] }));
        logStore.listLogs.mockReturnValue([
            { id: "old", reportId: "OLD", postedAt: 1 },
            { id: "new", reportId: "NEW", postedAt: 3 },
            { id: "mid", reportId: "MID", detectedAt: 2 },
            { id: "done", reportId: "DONE", title: "Kara", raids: [], postedAt: 4 },
        ]);
        expect(await backfillAllLogTitles({ limit: 2 })).toBe(2);
        expect(mockGetFights.mock.calls.map((c) => c[0])).toEqual(["NEW", "MID"]);
        expect(await backfillAllLogTitles()).toBe(1);
    });

    it("the background sweep never throws", async () => {
        const error = jest.spyOn(console, "error").mockImplementation(() => {});
        logStore.listLogs.mockImplementation(() => { throw new Error("disk"); });
        expect(await backfillAllLogTitles()).toBe(0);
        expect(error).toHaveBeenCalledWith("[logTitles] title backfill failed:", "disk");
        error.mockRestore();
        logStore.listLogs.mockReset();
    });
});
