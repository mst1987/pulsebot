// #555: the read view asks again only while the tab is visible, at once when it becomes visible, never on mount.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVisiblePoll } from "./useVisiblePoll";

let visibility: DocumentVisibilityState = "visible";
beforeEach(() => {
    vi.useFakeTimers();
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
});
afterEach(() => { vi.useRealTimers(); });

const becomes = (v: DocumentVisibilityState) => act(() => { visibility = v; document.dispatchEvent(new Event("visibilitychange")); });

describe("useVisiblePoll", () => {
    it("ticks every interval while visible, not on mount", () => {
        const tick = vi.fn();
        renderHook(() => useVisiblePoll(tick, 1000));
        expect(tick).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(3000); });
        expect(tick).toHaveBeenCalledTimes(3);
    });

    it("stays quiet while hidden and ticks at once when the tab comes back", () => {
        const tick = vi.fn();
        renderHook(() => useVisiblePoll(tick, 1000));
        becomes("hidden");
        act(() => { vi.advanceTimersByTime(5000); });
        expect(tick).not.toHaveBeenCalled();
        becomes("visible");
        expect(tick).toHaveBeenCalledTimes(1);
    });

    it("calls the newest tick, stops when disabled and on unmount", () => {
        const first = vi.fn();
        const second = vi.fn();
        const { rerender, unmount } = renderHook(({ fn, on }) => useVisiblePoll(fn, 1000, on), { initialProps: { fn: first, on: true } });
        rerender({ fn: second, on: true });
        act(() => { vi.advanceTimersByTime(1000); });
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
        rerender({ fn: second, on: false });
        act(() => { vi.advanceTimersByTime(3000); });
        expect(second).toHaveBeenCalledTimes(1);
        rerender({ fn: second, on: true });
        unmount();
        act(() => { vi.advanceTimersByTime(3000); });
        becomes("visible");
        expect(second).toHaveBeenCalledTimes(1);
    });
});
