// #534: the plan follows the raid (hooks/useRaidProgress.ts) - polling only while visible and in the raid window, turning to the
// boss being pulled / the next one, a manual pick pauses, the switch resumes. The request is mocked; fake timers drive the minute.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RaidplanProgress } from "../api";

const mockProgress = vi.fn<(by: unknown) => Promise<RaidplanProgress>>();
vi.mock("../api", async (orig) => ({ ...(await orig<typeof import("../api")>()), getRaidplanProgress: (by: unknown) => mockProgress(by) }));

import { useRaidProgress } from "./useRaidProgress";

const NOW = Date.UTC(2026, 8, 29, 19, 0, 0);
const START = NOW / 1000 + 10 * 60; // the raid starts in ten minutes: inside the window
const KEYS = ["general", "bt/high-warlord-najentus", "bt/supremus", "bt/shade-of-akama"];
const answer = (over: Partial<RaidplanProgress> = {}): RaidplanProgress => ({ live: true, killed: ["bt/high-warlord-najentus"], current: null, next: "bt/supremus", updatedAt: NOW, ...over });

let visibility: DocumentVisibilityState = "visible";
beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    mockProgress.mockReset();
    mockProgress.mockResolvedValue(answer());
});
afterEach(() => { vi.useRealTimers(); });

/** Lets the resolved request land (promise + state update). */
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

function mount(over: Partial<Parameters<typeof useRaidProgress>[0]> = {}) {
    const select = vi.fn();
    const r = renderHook((p: Parameters<typeof useRaidProgress>[0]) => useRaidProgress(p), {
        initialProps: { source: { token: "tok" }, startTime: START, keys: KEYS, select, ...over },
    });
    return { ...r, select };
}

describe("useRaidProgress", () => {
    it("asks at once and every minute, and turns to the next boss standing", async () => {
        const { result, select } = mount();
        await settle();
        expect(mockProgress).toHaveBeenCalledWith({ token: "tok" });
        expect(select).toHaveBeenLastCalledWith("bt/supremus");
        expect(result.current.live).toBe(true);
        expect([...result.current.killed]).toEqual(["bt/high-warlord-najentus"]);

        mockProgress.mockResolvedValue(answer({ current: "bt/shade-of-akama" }));
        await act(async () => { vi.advanceTimersByTime(60_000); });
        await settle();
        expect(mockProgress).toHaveBeenCalledTimes(2);
        // a running fight beats "next"
        expect(select).toHaveBeenLastCalledWith("bt/shade-of-akama");
    });

    it("pauses after a manual pick and follows again when switched on", async () => {
        const { result, select } = mount();
        await settle();
        act(() => result.current.choose("general"));
        expect(select).toHaveBeenLastCalledWith("general");
        expect(result.current.follow).toBe(false);

        mockProgress.mockResolvedValue(answer({ next: "bt/shade-of-akama" }));
        await act(async () => { vi.advanceTimersByTime(60_000); });
        await settle();
        // the log moved on, the page stays where the user put it
        expect(select).toHaveBeenLastCalledWith("general");

        act(() => result.current.setFollow(true));
        expect(select).toHaveBeenLastCalledWith("bt/shade-of-akama");
    });

    it("does not poll while the tab is hidden, and asks again when it becomes visible", async () => {
        visibility = "hidden";
        mount();
        await act(async () => { vi.advanceTimersByTime(180_000); });
        expect(mockProgress).not.toHaveBeenCalled();
        visibility = "visible";
        await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
        expect(mockProgress).toHaveBeenCalledTimes(1);
    });

    it("asks nothing outside the raid window or without a source", async () => {
        mount({ startTime: NOW / 1000 + 2 * 3600 });
        mount({ source: null });
        await act(async () => { vi.advanceTimersByTime(120_000); });
        expect(mockProgress).not.toHaveBeenCalled();
    });

    it("keeps a deep link: no jump until switched on, and nothing without a live log", async () => {
        const deep = mount({ initialFollow: false });
        await settle();
        expect(deep.select).not.toHaveBeenCalled();
        expect(deep.result.current.follow).toBe(false);

        mockProgress.mockResolvedValue({ live: false, killed: [], current: null, next: null, updatedAt: null });
        const none = mount();
        await settle();
        expect(none.select).not.toHaveBeenCalled();
        expect(none.result.current.live).toBe(false);
        // a pick without a live log does not pause following
        act(() => none.result.current.choose("general"));
        expect(none.result.current.follow).toBe(true);
    });

    it("hands the section bar its chip: a switch while live, a waiting chip without a readable log, none before any answer", async () => {
        mockProgress.mockResolvedValue({ live: false, waiting: "no_log", killed: [], current: null, next: null, updatedAt: null });
        const waiting = mount();
        expect(waiting.result.current.chip).toBeUndefined();
        await settle();
        expect(waiting.result.current.chip).toMatchObject({ on: false, waiting: "no_log" });
        expect(waiting.select).not.toHaveBeenCalled();

        mockProgress.mockResolvedValue(answer());
        const live = mount();
        await settle();
        expect(live.result.current.chip).toMatchObject({ on: true });
        expect(live.result.current.chip?.waiting).toBeUndefined();
        act(() => live.result.current.chip?.onToggle());
        expect(live.result.current.follow).toBe(false);
        expect(live.result.current.chip).toMatchObject({ on: false });

        // outside the window (no reason) there is no chip at all
        mockProgress.mockResolvedValue({ live: false, waiting: null, killed: [], current: null, next: null, updatedAt: null });
        const outside = mount();
        await settle();
        expect(outside.result.current.chip).toBeUndefined();
    });

    it("stops polling when unmounted", async () => {
        const { unmount } = mount();
        await settle();
        unmount();
        await act(async () => { vi.advanceTimersByTime(300_000); });
        expect(mockProgress).toHaveBeenCalledTimes(1);
    });
});
