// The pure helpers of the Kanäle page that mirror the server (#216, #259):
// the bot's rights in the pickers, the step-by-step runner with its pause, and
// the purposes the server defines.
import { afterEach, describe, expect, it, vi } from "vitest";
import { rightsStatus, runInSteps, STEP_PAUSE_MS } from "./channels";
import { requireBackend } from "../test/backend";
import type { Channel } from "../api";

const chan = (over: Partial<Channel> = {}): Channel => ({
    id: "c1", name: "anmeldung", type: 0, typeLabel: "Text", category: "", parentId: "", isThread: false, botCanView: true, botCanSend: true, ...over,
});

afterEach(() => {
    vi.useRealTimers();
});

describe("rightsStatus", () => {
    it("judges the bot's rights with the server's words and tones", () => {
        const { channelStatus } = requireBackend("web/channels/channelPurposes");
        const cases: [Partial<Channel>, "send" | "read"][] = [
            [{ botCanView: false }, "send"],
            [{ botCanSend: false }, "send"],
            [{}, "read"],
            [{}, "send"],
        ];
        const labels = cases.map(([over, need]) => {
            const client = rightsStatus(chan(over), need, true)!;
            const server = channelStatus(chan(over), need, true);
            expect({ tone: client.tone, label: client.label }).toEqual({ tone: server.tone, label: server.label });
            return client.label;
        });
        expect(labels).toEqual(["Bot sieht den Kanal nicht", "Bot darf nicht schreiben", "Bot liest mit", "Bot schreibt"]);
    });

    it("says nothing while the bot is offline", () => {
        expect(rightsStatus(chan({ botCanSend: false }), "send", false)).toBeNull();
    });
});

describe("runInSteps", () => {
    it("sends one channel at a time with a pause between, reporting progress", async () => {
        vi.useFakeTimers();
        const step = vi.fn(async (id: string) => [{ id, ok: true }]);
        const progress = vi.fn();
        const done = runInSteps(["a", "b"], step, { onProgress: progress });
        await vi.advanceTimersByTimeAsync(0);
        expect(step).toHaveBeenCalledTimes(1);
        expect(progress).toHaveBeenLastCalledWith(1, 2);
        await vi.advanceTimersByTimeAsync(STEP_PAUSE_MS - 1);
        expect(step).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(step).toHaveBeenCalledTimes(2);
        expect(await done).toEqual([{ id: "a", ok: true }, { id: "b", ok: true }]);
        expect(progress).toHaveBeenLastCalledWith(2, 2);
    });

    it("turns a failed request into a failed result instead of stopping", async () => {
        const step = vi.fn(async (id: string) => {
            if (id === "a") throw new Error("429");
            return [{ id, ok: true }];
        });
        expect(await runInSteps(["a", "b"], step, { pauseMs: 0 })).toEqual([{ id: "a", ok: false, error: "429" }, { id: "b", ok: true }]);
    });
});

describe("the purposes the server defines", () => {
    it("carry WoW icons, not line icons", () => {
        const { PURPOSES } = requireBackend("web/channels/channelPurposes");
        expect(PURPOSES.map((p: { icon: string }) => p.icon)).toEqual([
            "inv_misc_note_02", "inv_misc_pocketwatch_01", "inv_misc_grouplooking", "achievement_boss_illidan",
        ]);
    });
});
