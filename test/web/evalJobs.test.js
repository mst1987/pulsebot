const { startJob, getJob, isRunning, reset, KEEP_FINISHED_MS } = require("../../src/web/evalJobs");

/** Let the queued promise callbacks run. */
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
    reset();
    jest.restoreAllMocks();
});

describe("web/evalJobs", () => {
    it("reports a job as running right after it starts", () => {
        const res = startJob("l1", "rpb", () => new Promise(() => {}));
        expect(res).toEqual({ status: "running", alreadyRunning: false });
        expect(getJob("l1", "rpb").status).toBe("running");
        expect(isRunning("l1")).toBe(true);
    });

    it("returns immediately instead of waiting for the runner", async () => {
        let settle;
        const slow = new Promise((r) => { settle = r; });
        startJob("l1", "rpb", () => slow);
        // still running while the runner has not settled
        expect(getJob("l1", "rpb").status).toBe("running");
        settle({ ok: true, url: "/r/abc", id: "abc" });
        await flush();
        expect(getJob("l1", "rpb")).toMatchObject({ status: "done", url: "/r/abc", id: "abc" });
    });

    it("does not start a second job for the same log and section", async () => {
        const runner = jest.fn(() => new Promise(() => {}));
        startJob("l1", "rpb", runner);
        const second = startJob("l1", "rpb", runner);
        expect(second).toEqual({ status: "running", alreadyRunning: true });
        // the runner is invoked a microtask later (so the HTTP response goes out first)
        await flush();
        expect(runner).toHaveBeenCalledTimes(1);
    });

    it("runs the two halves of one log independently", async () => {
        startJob("l1", "cla", async () => ({ ok: true, url: "/r/x" }));
        const rpb = startJob("l1", "rpb", () => new Promise(() => {}));
        expect(rpb.alreadyRunning).toBe(false);
        await flush();
        expect(getJob("l1", "cla").status).toBe("done");
        expect(getJob("l1", "rpb").status).toBe("running");
    });

    it("records a failed evaluation with its message", async () => {
        startJob("l1", "rpb", async () => ({ ok: false, error: "Report ist privat." }));
        await flush();
        expect(getJob("l1", "rpb")).toMatchObject({ status: "error", error: "Report ist privat." });
        // ...and it is not the raid-still-running case, which the client asks about.
        expect(getJob("l1", "rpb").incomplete).toBe(false);
    });

    it("marks a refusal over a still-running raid as such, not as a plain failure", async () => {
        // The client turns this one into "trotzdem auswerten?" rather than a red
        // message, so the flag has to survive the job (see raidProgress.js).
        startJob("l1", "cla", async () => ({
            ok: false, incomplete: true, error: "Der Endboss fehlt noch: Der Schwarze Tempel.",
        }));
        await flush();
        expect(getJob("l1", "cla")).toMatchObject({
            status: "error", incomplete: true, error: "Der Endboss fehlt noch: Der Schwarze Tempel.",
        });
    });

    it("treats an already-evaluated result as done and keeps the url", async () => {
        startJob("l1", "cla", async () => ({ ok: false, already: true, url: "/r/old" }));
        await flush();
        expect(getJob("l1", "cla")).toMatchObject({ status: "done", url: "/r/old", already: true });
    });

    it("catches a throwing runner instead of leaving an unhandled rejection", async () => {
        jest.spyOn(console, "error").mockImplementation(() => {});
        startJob("l1", "rpb", async () => { throw new Error("WCL kaputt"); });
        await flush();
        expect(getJob("l1", "rpb")).toMatchObject({ status: "error", error: "WCL kaputt" });
    });

    it("falls back to a generic message when the failure carries none", async () => {
        startJob("l1", "rpb", async () => ({ ok: false }));
        await flush();
        expect(getJob("l1", "rpb").error).toBe("Auswertung fehlgeschlagen.");
    });

    it("allows a retry once the previous attempt failed", async () => {
        startJob("l1", "rpb", async () => ({ ok: false, error: "kaputt" }));
        await flush();
        const again = startJob("l1", "rpb", async () => ({ ok: true, url: "/r/new" }));
        expect(again.alreadyRunning).toBe(false);
        await flush();
        expect(getJob("l1", "rpb")).toMatchObject({ status: "done", url: "/r/new" });
    });

    it("has no job for something that never started", () => {
        expect(getJob("nope", "rpb")).toBeNull();
        expect(isRunning("nope")).toBe(false);
    });

    it("reports how long a job has been running", async () => {
        const now = jest.spyOn(Date, "now");
        now.mockReturnValue(1000);
        startJob("l1", "rpb", () => new Promise(() => {}));
        now.mockReturnValue(6000);
        expect(getJob("l1", "rpb").runningMs).toBe(5000);
    });

    it("forgets a finished job after the keep window", async () => {
        const now = jest.spyOn(Date, "now");
        now.mockReturnValue(1000);
        startJob("l1", "rpb", async () => ({ ok: true, url: "/r/a" }));
        await flush();
        expect(getJob("l1", "rpb").status).toBe("done");

        now.mockReturnValue(1000 + KEEP_FINISHED_MS + 1);
        expect(getJob("l1", "rpb")).toBeNull();
    });

    it("keeps a still-running job regardless of age", async () => {
        const now = jest.spyOn(Date, "now");
        now.mockReturnValue(1000);
        startJob("l1", "rpb", () => new Promise(() => {}));
        now.mockReturnValue(1000 + KEEP_FINISHED_MS * 5);
        expect(getJob("l1", "rpb").status).toBe("running");
    });
});
