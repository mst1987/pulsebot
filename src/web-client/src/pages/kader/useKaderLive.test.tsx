// The live poll of an open Kader page: every 5 s only while the tab is visible,
// at once when it comes back, when the page opens and when it opens something
// else; the others' presence comes back; a moved revision reaches the page;
// leaving tells the server; no polling at all while disabled.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { KaderLive } from "../../api";
import { LIVE_MS, useKaderLive } from "./useKaderLive";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getKaderLive: vi.fn(),
    leaveKaderLive: vi.fn(),
}));

let visibility: DocumentVisibilityState = "visible";
const becomes = (v: DocumentVisibilityState) => act(() => { visibility = v; document.dispatchEvent(new Event("visibilitychange")); });
const answer = (over: Partial<KaderLive> = {}): KaderLive => ({ rev: 5, sharedRev: 1, changes: [], more: false, presence: [], ...over });
/** Lets the poll's promise settle. */
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
    vi.useFakeTimers();
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    vi.mocked(api.getKaderLive).mockReset().mockResolvedValue(answer());
    vi.mocked(api.leaveKaderLive).mockReset();
});
afterEach(() => { vi.useRealTimers(); });

type Props = { kaderId: string; rev: number; enabled: boolean; playerId: string };
function setup(initial: Partial<Props> = {}, onMoved = vi.fn()) {
    const hook = renderHook((p: Props) => useKaderLive({
        kaderId: p.kaderId, rev: p.rev, sharedRev: 1, enabled: p.enabled, onMoved,
        where: { sub: "vorauswahl", playerId: p.playerId, what: p.playerId ? "interview" : "", edit: true },
    }), { initialProps: { kaderId: "k1", rev: 5, enabled: true, playerId: "", ...initial } });
    return { ...hook, onMoved };
}

describe("useKaderLive", () => {
    it("asks at once when the page opens, then every 5 seconds while the tab is visible", async () => {
        setup();
        await settle();
        expect(api.getKaderLive).toHaveBeenCalledTimes(1);
        expect(api.getKaderLive).toHaveBeenLastCalledWith("k1", 5, expect.objectContaining({ sub: "vorauswahl", tab: expect.any(String) }));
        await act(async () => { vi.advanceTimersByTime(LIVE_MS * 2); });
        expect(api.getKaderLive).toHaveBeenCalledTimes(3);
    });

    it("asks nothing while the tab is hidden, and at once when it comes back", async () => {
        setup();
        await settle();
        becomes("hidden");
        await act(async () => { vi.advanceTimersByTime(LIVE_MS * 4); });
        expect(api.getKaderLive).toHaveBeenCalledTimes(1);
        becomes("visible");
        await settle();
        expect(api.getKaderLive).toHaveBeenCalledTimes(2);
    });

    it("reports a newly opened interview at once", async () => {
        const { rerender } = setup();
        await settle();
        rerender({ kaderId: "k1", rev: 5, enabled: true, playerId: "111" });
        await settle();
        expect(api.getKaderLive).toHaveBeenCalledTimes(2);
        expect(api.getKaderLive).toHaveBeenLastCalledWith("k1", 5, expect.objectContaining({ playerId: "111", what: "interview", edit: true }));
    });

    it("hands back who else is here and tells the page when the revision moved", async () => {
        const presence = [{ userId: "2", name: "Lena", sub: "pool" as const, playerId: "", what: "" as const, edit: false }];
        vi.mocked(api.getKaderLive).mockResolvedValue(answer({ presence }));
        const { result, onMoved } = setup();
        await settle();
        expect(result.current).toEqual(presence);
        expect(onMoved).not.toHaveBeenCalled();
        vi.mocked(api.getKaderLive).mockResolvedValue(answer({ rev: 9, presence }));
        await act(async () => { vi.advanceTimersByTime(LIVE_MS); });
        await settle();
        expect(onMoved).toHaveBeenCalledWith(expect.objectContaining({ rev: 9 }));
    });

    it("polls nothing while disabled and leaves at once when the page goes", async () => {
        const { rerender, unmount } = setup({ enabled: false });
        await act(async () => { vi.advanceTimersByTime(LIVE_MS * 3); });
        expect(api.getKaderLive).not.toHaveBeenCalled();
        rerender({ kaderId: "k1", rev: 5, enabled: true, playerId: "" });
        await settle();
        unmount();
        expect(api.leaveKaderLive).toHaveBeenCalledWith("k1", expect.objectContaining({ tab: expect.any(String) }));
        await act(async () => { vi.advanceTimersByTime(LIVE_MS * 3); });
        expect(api.getKaderLive).toHaveBeenCalledTimes(1);
    });

    it("stays quiet when a poll fails", async () => {
        vi.mocked(api.getKaderLive).mockRejectedValue({ code: "http_502", message: "gateway" });
        const { result, onMoved } = setup();
        await settle();
        expect(result.current).toEqual([]);
        expect(onMoved).not.toHaveBeenCalled();
    });
});
