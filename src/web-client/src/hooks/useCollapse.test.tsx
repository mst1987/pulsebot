// Whether a raid plan editor block (Roster slots, Taktik, the mobs bar, an assignment card …) is folded away, remembered
// in this browser: pure parsing is tested directly in lib/raidplan/collapse.test.ts, this covers the localStorage round
// trip and, for the assignment cards, that several ids under one storage key never clobber each other.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useCollapse, useCollapseSet } from "./useCollapse";

beforeEach(() => { window.localStorage.clear(); });

describe("useCollapse", () => {
    it("opens by default and remembers a fold across a remount", () => {
        const first = renderHook(() => useCollapse("eh.raidplan.collapse.bes"));
        expect(first.result.current[0]).toBe(false);
        act(() => first.result.current[1]());
        expect(first.result.current[0]).toBe(true);
        expect(window.localStorage.getItem("eh.raidplan.collapse.bes")).toBe("1");

        // a fresh mount (a reload) reads the same storage key and opens folded
        const again = renderHook(() => useCollapse("eh.raidplan.collapse.bes"));
        expect(again.result.current[0]).toBe(true);
        act(() => again.result.current[1]());
        expect(again.result.current[0]).toBe(false);
        expect(window.localStorage.getItem("eh.raidplan.collapse.bes")).toBe("0");
    });

    it("two blocks under different keys do not affect each other", () => {
        const bes = renderHook(() => useCollapse("eh.raidplan.collapse.bes"));
        const steps = renderHook(() => useCollapse("eh.raidplan.collapse.steps"));
        act(() => bes.result.current[1]());
        expect(bes.result.current[0]).toBe(true);
        expect(steps.result.current[0]).toBe(false);
    });

    it("survives a blocked localStorage (a private window) without throwing", () => {
        const real = window.localStorage.setItem;
        window.localStorage.setItem = () => { throw new Error("blocked"); };
        const hook = renderHook(() => useCollapse("eh.raidplan.collapse.bes"));
        expect(() => act(() => hook.result.current[1]())).not.toThrow();
        expect(hook.result.current[0]).toBe(true);
        window.localStorage.setItem = real;
    });
});

describe("useCollapseSet", () => {
    it("folds one card's type without touching the others, remembered across a remount", () => {
        const first = renderHook(() => useCollapseSet("eh.raidplan.collapse.assign"));
        const [isCollapsed, toggle] = first.result.current;
        expect(isCollapsed("heal")).toBe(false);
        act(() => toggle("heal"));
        expect(first.result.current[0]("heal")).toBe(true);
        expect(first.result.current[0]("tank")).toBe(false);

        act(() => first.result.current[1]("tank"));
        expect(first.result.current[0]("heal")).toBe(true);
        expect(first.result.current[0]("tank")).toBe(true);

        act(() => first.result.current[1]("heal"));
        expect(first.result.current[0]("heal")).toBe(false);
        expect(first.result.current[0]("tank")).toBe(true);

        const again = renderHook(() => useCollapseSet("eh.raidplan.collapse.assign"));
        expect(again.result.current[0]("heal")).toBe(false);
        expect(again.result.current[0]("tank")).toBe(true);
    });
});
