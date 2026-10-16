// The editor's two views (Oct 2026): "Aufgaben" or "Karte", remembered in this browser and - in the event editor - in the address
// next to the section (`#boss=bt/supremus&view=map`).
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashWithView, parseView, startView, usePlanView, viewFromHash, VIEW_KEY } from "./planView";

beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/raids/own1?tab=plan");
});
afterEach(() => { window.history.replaceState(null, "", "/"); });

describe("the view's text forms", () => {
    it("reads only 'map' and 'anim' as those views; everything else is the task list", () => {
        expect(parseView("map")).toBe("map");
        expect(parseView("anim")).toBe("anim");
        for (const raw of ["tasks", "", null, undefined, "MAP", "karte", "animation"]) expect(parseView(raw)).toBe("tasks");
    });

    it("finds the view in a hash beside the section and leaves the default out of it", () => {
        expect(viewFromHash("#boss=bt/supremus&view=map")).toBe("map");
        expect(viewFromHash("#view=tasks")).toBe("tasks");
        expect(viewFromHash("#boss=bt/supremus")).toBe("");
        expect(viewFromHash("")).toBe("");
        expect(hashWithView("#boss=bt/supremus", "map")).toBe("#boss=bt/supremus&view=map");
        expect(hashWithView("#boss=bt/supremus&view=map", "tasks")).toBe("#boss=bt/supremus");
        expect(hashWithView("", "tasks")).toBe("");
        // the animation view (docs/raidplan/animation.md) stands in the address like the map
        expect(viewFromHash("#boss=bt/gurtogg&view=anim")).toBe("anim");
        expect(hashWithView("#boss=bt/gurtogg", "anim")).toBe("#boss=bt/gurtogg&view=anim");
    });
});

describe("the view the editor opens with", () => {
    it("is the task list the first time", () => {
        expect(startView(true)).toBe("tasks");
        expect(startView(false)).toBe("tasks");
    });

    it("takes this browser's choice, and the address before it where the address counts", () => {
        window.localStorage.setItem(VIEW_KEY, "map");
        expect(startView(false)).toBe("map");
        window.history.replaceState(null, "", "/raids/own1?tab=plan#boss=bt/supremus&view=tasks");
        expect(startView(true)).toBe("tasks");
        // the template editor has no section in its address: only the browser's choice
        expect(startView(false)).toBe("map");
    });
});

describe("usePlanView", () => {
    it("remembers the choice and writes it into the address beside the section", () => {
        window.history.replaceState(null, "", "/raids/own1?tab=plan#boss=bt/supremus");
        const { result } = renderHook(() => usePlanView(true));
        expect(result.current[0]).toBe("tasks");
        act(() => result.current[1]("map"));
        expect(result.current[0]).toBe("map");
        expect(window.localStorage.getItem(VIEW_KEY)).toBe("map");
        expect(window.location.hash).toBe("#boss=bt/supremus&view=map");
        expect(window.location.search).toBe("?tab=plan");
        act(() => result.current[1]("tasks"));
        expect(window.location.hash).toBe("#boss=bt/supremus");
    });

    it("leaves the address alone where it does not carry the view (the template editor)", () => {
        const { result } = renderHook(() => usePlanView(false));
        act(() => result.current[1]("map"));
        expect(window.location.hash).toBe("");
        expect(window.localStorage.getItem(VIEW_KEY)).toBe("map");
    });
});
