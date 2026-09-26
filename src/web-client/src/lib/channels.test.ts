// The pure helpers of the Kanäle page that mirror the server (#216, #259):
// the bot's rights in the pickers, the step-by-step runner with its pause, and
// the purposes the server defines.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    archivedLabel, channelTypeLabel, placeholderHint, purposeHint, purposeLabel, resultMessage, rightsStatus, runInSteps,
    slowmodeLabel, STEP_PAUSE_MS,
} from "./channels";
import { requireBackend } from "../test/backend";
import { inLang } from "../test/i18n";
import type { Channel, ChannelArchiveRow } from "../api";

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

describe("in the page's language", () => {
    const row: ChannelArchiveRow = { id: "c-arch", name: "alt-raid", at: Date.UTC(2026, 8, 3, 10), by: "Nerathil", fromCategory: "Raids", waitingDays: 3, overdue: false };

    it("speaks German by default", () => {
        expect(archivedLabel(row)).toBe("archiviert am 03.09.2026 von Nerathil · aus Raids");
        expect(archivedLabel({ ...row, at: 0 })).toBe("von Hand ins Archiv verschoben");
        expect(slowmodeLabel(0)).toBe("aus");
        expect(resultMessage([{ id: "a", ok: true }, { id: "b", ok: false, error: "429" }], "geändert").message).toBe("1 Kanal geändert, 1 fehlgeschlagen: 429");
    });

    it("speaks English once the page is switched", async () => {
        await inLang("en", () => {
            expect(archivedLabel(row)).toMatch(/^archived on .+ by Nerathil · from Raids$/);
            expect(archivedLabel({ ...row, at: 0 })).toBe("moved to the archive by hand");
            expect(slowmodeLabel(0)).toBe("off");
            expect(slowmodeLabel(300)).toBe("5 min");
            expect(resultMessage([{ id: "a", ok: true }, { id: "b", ok: true }], "changed").message).toBe("2 channels changed");
            expect(rightsStatus(chan({ botCanSend: false }), "send", true)).toEqual({
                tone: "mid", label: "Bot may not post", tip: "The bot role lacks the “Send messages” permission in #anmeldung.",
            });
            expect(channelTypeLabel({ type: 5, typeLabel: "Ankündigung" })).toBe("Announcement");
        });
    });

    it("knows every purpose and placeholder the server defines, with the server's German words", async () => {
        const { PURPOSES } = requireBackend("web/channels/channelPurposes");
        const { PLACEHOLDERS } = requireBackend("utils/channelNames");
        for (const p of PURPOSES) {
            expect({ id: p.id, label: purposeLabel(p), hint: purposeHint(p) }).toEqual({ id: p.id, label: p.label, hint: p.hint });
        }
        for (const p of PLACEHOLDERS) expect({ key: p.key, hint: placeholderHint(p) }).toEqual({ key: p.key, hint: p.hint });
        await inLang("en", () => {
            for (const p of PURPOSES) expect({ id: p.id, same: purposeLabel(p) === p.label }).toEqual({ id: p.id, same: false });
            // an unknown purpose keeps the server's label
            expect(purposeLabel({ id: "new", label: "Neu" })).toBe("Neu");
        });
    });
});
