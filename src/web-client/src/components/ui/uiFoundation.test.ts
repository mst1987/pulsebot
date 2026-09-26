// The shared building blocks of the admin menu (design issue #221), run for real.
// Each block's behaviour is tested next to it (Button, Segment, Expand, PageHead,
// Tip, Modal, Badge, WowIcon .test.tsx); the rules that span the whole client
// (no native title, no confirm(), styles in index.css) are in
// test/web-client/conventions/uiFoundation.test.js.
import { describe, expect, it } from "vitest";
import * as ui from "./index";
import { focusFromNavigation, NAV_FOCUS_WINDOW, NAV_KEYS } from "./Tip";

describe("building blocks", () => {
    it("are all reachable from the one index the pages import", () => {
        for (const name of [
            "WowIcon", "Button", "IconButton", "SplitButton", "Segment", "Badge", "IconTile", "Expand", "Bar",
            "PageHead", "PartHead", "SectionHead", "Tip", "TipLayer", "Modal", "ConfirmProvider", "useConfirm", "Popover",
        ]) {
            expect({ name, type: typeof (ui as Record<string, unknown>)[name] }).toEqual({ name, type: "function" });
        }
        expect(ui.buttonClass("ghost")).toBe("btn btn-ghost");
    });
});

describe("tooltips and modal dialogs", () => {
    it("keeps the navigation rule itself right", () => {
        const windowMs = NAV_FOCUS_WINDOW;
        expect(focusFromNavigation(0, 1000)).toBe(false); // no key since the last click/other key
        expect(focusFromNavigation(1000, 1001)).toBe(true); // Tab moved the focus right away
        expect(focusFromNavigation(1000, 1000 + windowMs)).toBe(true);
        expect(focusFromNavigation(1000, 1001 + windowMs)).toBe(false); // a much later focus is the page's
    });

    it("counts the keys that move the focus on their own as navigation, and nothing else", () => {
        for (const key of ["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]) {
            expect(NAV_KEYS.has(key)).toBe(true);
        }
        for (const key of ["Enter", " ", "Escape", "a"]) expect(NAV_KEYS.has(key)).toBe(false);
    });
});
