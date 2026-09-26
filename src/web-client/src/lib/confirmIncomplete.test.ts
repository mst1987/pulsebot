// The admin-menu half of the unfinished-raid guard: a refused evaluation turns
// into the "Raid noch nicht abgeschlossen" question, then runs again with force.
import { describe, expect, it, vi } from "vitest";
import { RAID_INCOMPLETE } from "../api";
import { withIncompleteConfirm } from "./confirmIncomplete";
import { t } from "../i18n";

const refusal = { code: RAID_INCOMPLETE, message: "Kael'thas steht noch", raids: [] };

describe("withIncompleteConfirm", () => {
    it("runs without force and asks nothing when the raid is over", async () => {
        const ask = vi.fn();
        const run = vi.fn().mockResolvedValue("report");
        await expect(withIncompleteConfirm(ask, run)).resolves.toBe("report");
        expect(run).toHaveBeenCalledWith(false);
        expect(ask).not.toHaveBeenCalled();
    });

    it("asks through the dialog and runs again with force on yes", async () => {
        const ask = vi.fn().mockResolvedValue(true);
        const run = vi.fn().mockRejectedValueOnce(refusal).mockResolvedValue("report");
        await expect(withIncompleteConfirm(ask, run)).resolves.toBe("report");
        expect(ask).toHaveBeenCalledWith(expect.objectContaining({
            title: t("jobs.incomplete.title"),
            action: t("jobs.incomplete.action"),
            tone: "run",
        }));
        expect(run.mock.calls).toEqual([[false], [true]]);
    });

    it("ends as cancelled on no, without a second run", async () => {
        const ask = vi.fn().mockResolvedValue(false);
        const run = vi.fn().mockRejectedValue(refusal);
        await expect(withIncompleteConfirm(ask, run)).rejects.toEqual({ code: "cancelled", message: t("jobs.incomplete.cancelled") });
        expect(run).toHaveBeenCalledTimes(1);
    });

    it("passes any other error through untouched", async () => {
        const ask = vi.fn();
        const err = { code: "job_failed", message: "WCL down" };
        await expect(withIncompleteConfirm(ask, vi.fn().mockRejectedValue(err))).rejects.toBe(err);
        expect(ask).not.toHaveBeenCalled();
    });
});
