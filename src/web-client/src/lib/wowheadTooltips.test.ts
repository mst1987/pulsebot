import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installWowheadTooltipLift, refreshWowheadLinks, syncWowheadTooltip, WOWHEAD_TOOLTIP_CLASS } from "./wowheadTooltips";

// Wowhead's item tooltip inside a modal (the raider dialog's gear list) sat behind
// the dialog: power.js hangs its box into <body>, a modal <dialog> is in the top layer.

/** The box as power.js draws it: absolute, page coordinates, shown/hidden by inline style. */
function tooltipBox(parent: HTMLElement = document.body): HTMLDivElement {
    const el = document.createElement("div");
    el.className = `${WOWHEAD_TOOLTIP_CLASS} wowhead-tooltip-width-restriction`;
    el.setAttribute("style", "top: 325px; left: 39px; position: absolute; width: 320px;");
    parent.appendChild(el);
    return el;
}
const show = (el: HTMLElement) => { el.style.display = ""; el.style.visibility = "visible"; };
const hide = (el: HTMLElement) => { el.style.display = "none"; el.style.visibility = "hidden"; };
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("Wowhead tooltip in the top layer", () => {
    const calls: string[] = [];

    beforeEach(() => {
        calls.length = 0;
        // jsdom has no popover API: a stand-in that records what the lift does (as in Tip.test.tsx).
        const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
        proto.showPopover = function showPopover(this: HTMLElement) { calls.push("show"); this.setAttribute("data-popover-open", ""); };
        proto.hidePopover = function hidePopover(this: HTMLElement) { calls.push("hide"); this.removeAttribute("data-popover-open"); };
        const matches = Element.prototype.matches;
        vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, selector: string) {
            return selector === ":popover-open" ? this.hasAttribute("data-popover-open") : matches.call(this, selector);
        });
    });

    afterEach(() => {
        const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
        delete proto.showPopover;
        delete proto.hidePopover;
        vi.restoreAllMocks();
        document.body.replaceChildren();
    });

    it("lifts a showing box as a manual popover and lets a hidden one be a plain div again", () => {
        const el = tooltipBox();
        show(el);
        syncWowheadTooltip(el);
        expect(el).toHaveAttribute("popover", "manual");
        expect(calls).toEqual(["show"]);

        hide(el);
        syncWowheadTooltip(el);
        expect(el).not.toHaveAttribute("popover");
        expect(calls).toEqual(["show", "hide"]);
    });

    it("does not re-show while power.js only moves the box with the mouse", () => {
        const el = tooltipBox();
        show(el);
        syncWowheadTooltip(el);
        el.style.left = "60px";
        syncWowheadTooltip(el);
        expect(calls).toEqual(["show"]);
    });

    it("leaves power.js's hidden measuring box alone", () => {
        const el = tooltipBox();
        el.style.visibility = "hidden";
        syncWowheadTooltip(el);
        expect(el).not.toHaveAttribute("popover");
        expect(calls).toEqual([]);
    });

    it("follows boxes power.js creates later, and every new appearance shows afresh", async () => {
        const stop = installWowheadTooltipLift();
        const el = tooltipBox();
        await flush();
        show(el);
        await flush();
        expect(calls).toEqual(["show"]);
        hide(el);
        await flush();
        show(el);
        await flush();
        expect(calls).toEqual(["show", "hide", "show"]);
        stop();
    });

    it("picks up a box that was there before the install and ignores other children", () => {
        const el = tooltipBox();
        show(el);
        const other = document.createElement("div");
        other.style.visibility = "visible";
        document.body.appendChild(other);
        const stop = installWowheadTooltipLift();
        expect(el).toHaveAttribute("popover", "manual");
        expect(other).not.toHaveAttribute("popover");
        stop();
    });

    it("stops watching after the uninstall", async () => {
        const stop = installWowheadTooltipLift();
        const el = tooltipBox();
        await flush();
        stop();
        show(el);
        await flush();
        expect(calls).toEqual([]);
    });

    it("changes nothing without popover support", () => {
        const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
        delete proto.showPopover;
        const el = tooltipBox();
        show(el);
        syncWowheadTooltip(el);
        expect(el).not.toHaveAttribute("popover");
    });
});

describe("refreshWowheadLinks", () => {
    afterEach(() => { delete (window as unknown as Record<string, unknown>).$WowheadPower; });

    it("asks the widget to scan again, and stays quiet while it is missing or throws", () => {
        expect(() => refreshWowheadLinks()).not.toThrow();
        const refreshLinks = vi.fn(() => { throw new Error("offline"); });
        (window as unknown as Record<string, unknown>).$WowheadPower = { refreshLinks };
        expect(() => refreshWowheadLinks()).not.toThrow();
        expect(refreshLinks).toHaveBeenCalledTimes(1);
    });
});
