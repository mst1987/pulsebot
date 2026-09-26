// A refused evaluation over a raid that is still running reaches the page as a
// question, not a failure: pollJob (api/client.ts) turns the job's "incomplete"
// error into RAID_INCOMPLETE and hands the raids with their bosses along, which
// the "Raid noch nicht abgeschlossen" dialog draws as the boss grid.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollJob, RAID_INCOMPLETE, type IncompleteRaidError, type JobPollStatus } from "./client";
import type { ClaRaid } from "./cla";

const HYJAL: ClaRaid = {
    contentId: "hyjal", label: "Hyjal", killed: 4, total: 5, finalKilled: false, finalBoss: "Archimonde",
    missing: ["Archimonde"], bosses: [{ name: "Azgalor", killed: true }, { name: "Archimonde", killed: false }],
};

/** Runs pollJob over the given answers and returns what it rejected with. */
async function refusalOf(answers: JobPollStatus[]): Promise<IncompleteRaidError> {
    const read = vi.fn<() => Promise<JobPollStatus>>();
    for (const a of answers) read.mockResolvedValueOnce(a);
    const outcome = pollJob(read, "Fehlgeschlagen.").then(
        () => { throw new Error("pollJob did not fail"); },
        (e: IncompleteRaidError) => e,
    );
    await vi.runAllTimersAsync();
    return outcome;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("pollJob", () => {
    it("turns an unfinished raid into RAID_INCOMPLETE with the raids attached", async () => {
        const err = await refusalOf([
            { status: "running" },
            { status: "error", incomplete: true, error: "Archimonde liegt nicht.", raids: [HYJAL] },
        ]);
        expect(err).toEqual({ code: RAID_INCOMPLETE, message: "Archimonde liegt nicht.", raids: [HYJAL] });
    });

    it("reports any other failure as a failed job with the fallback message", async () => {
        const err = await refusalOf([{ status: "error" }]);
        expect(err.code).toBe("job_failed");
        expect(err.message).toBe("Fehlgeschlagen.");
    });

    it("resolves with the finished state", async () => {
        const read = vi.fn<() => Promise<JobPollStatus>>()
            .mockResolvedValueOnce({ status: "running" })
            .mockResolvedValueOnce({ status: "done", url: "/r/abc" });
        const done = pollJob(read, "Fehlgeschlagen.");
        await vi.runAllTimersAsync();
        await expect(done).resolves.toEqual({ status: "done", url: "/r/abc" });
        expect(read).toHaveBeenCalledTimes(2);
    });
});
