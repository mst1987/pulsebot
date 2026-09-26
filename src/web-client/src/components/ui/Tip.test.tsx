// Tooltips instead of the native `title` (design issue #221): one <TipLayer>
// draws a box for every [data-tip] — on hover, on keyboard focus and on a tap —
// as text only, in the top layer above an open modal dialog.
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Tip, { TipLayer } from "./Tip";

function renderLayer() {
    render(
        <>
            <TipLayer />
            <button type="button">Vorher</button>
            <button type="button" data-tip="Speichern" data-tip-sub="Legt den Raid an">Anlegen</button>
            <Tip head="Anwesenheit" sub="letzte 11 Raids"><span>80 %</span></Tip>
            <span data-tip={"<b>fett</b>\nzweite Zeile"}>Markup</span>
        </>,
    );
    return screen.getByRole("tooltip", { hidden: true });
}

const isOpen = (box: HTMLElement) => box.classList.contains("on");

/** A tap: a pointerdown from a finger, which jsdom's user-event does not send. */
function tap(el: Element) {
    const e = new Event("pointerdown", { bubbles: true, cancelable: true });
    Object.defineProperty(e, "pointerType", { value: "touch" });
    el.dispatchEvent(e);
}

describe("TipLayer", () => {
    it("shows head and explanation of the hovered element, and hides again", async () => {
        const box = renderLayer();
        const user = userEvent.setup();
        expect(isOpen(box)).toBe(false);
        await user.hover(screen.getByRole("button", { name: "Anlegen" }));
        expect(isOpen(box)).toBe(true);
        expect(box.querySelector("b")).toHaveTextContent("Speichern");
        expect(box.querySelector("i")).toHaveTextContent("Legt den Raid an");

        // <Tip> is an anchor like any other; a child of it counts as the anchor
        await user.hover(screen.getByText("80 %"));
        expect(box.querySelector("b")).toHaveTextContent("Anwesenheit");
        expect(box.querySelector("i")).toHaveTextContent("letzte 11 Raids");

        await user.keyboard("{Escape}");
        expect(isOpen(box)).toBe(false);
    });

    it("never turns a tooltip string into markup", async () => {
        const box = renderLayer();
        await userEvent.hover(screen.getByText("Markup"));
        expect(box.querySelector("b")).toHaveTextContent("<b>fett</b>");
        expect(box.querySelectorAll("b")).toHaveLength(1);
        expect(box.querySelector("i")).toHaveTextContent("zweite Zeile");
    });

    it("toggles on a tap, and a tap elsewhere closes it", () => {
        const box = renderLayer();
        const anchor = screen.getByRole("button", { name: "Anlegen" });
        tap(anchor);
        expect(isOpen(box)).toBe(true);
        tap(anchor);
        expect(isOpen(box)).toBe(false);
        tap(anchor);
        tap(screen.getByRole("button", { name: "Vorher" }));
        expect(isOpen(box)).toBe(false);
    });

    it("opens a focus tooltip after a navigation key, never for a programmatic focus", async () => {
        const box = renderLayer();
        const user = userEvent.setup();
        const anchor = screen.getByRole("button", { name: "Anlegen" });

        // a dialog or a form putting the focus somewhere is the page's doing
        anchor.focus();
        expect(isOpen(box)).toBe(false);
        anchor.blur();

        // Tab from the button before it: the visitor walks the page
        screen.getByRole("button", { name: "Vorher" }).focus();
        await user.tab();
        expect(anchor).toHaveFocus();
        expect(isOpen(box)).toBe(true);
        anchor.blur();
        expect(isOpen(box)).toBe(false);

        // any other key (Enter that opened something) forgets the navigation
        await user.keyboard("{Enter}");
        anchor.focus();
        expect(isOpen(box)).toBe(false);
        anchor.blur();

        // and so does a click
        fireEvent.keyDown(document, { key: "ArrowDown" });
        fireEvent.pointerDown(document.body);
        anchor.focus();
        expect(isOpen(box)).toBe(false);
    });
});

describe("TipLayer in the top layer", () => {
    const shown: string[] = [];

    beforeEach(() => {
        shown.length = 0;
        // jsdom has no popover API: a stand-in that records what the layer does.
        const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
        proto.showPopover = function showPopover(this: HTMLElement) { shown.push("show"); this.setAttribute("data-popover-open", ""); };
        proto.hidePopover = function hidePopover(this: HTMLElement) { shown.push("hide"); this.removeAttribute("data-popover-open"); };
        const matches = Element.prototype.matches;
        vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, selector: string) {
            return selector === ":popover-open" ? this.hasAttribute("data-popover-open") : matches.call(this, selector);
        });
    });

    afterEach(() => {
        const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
        delete proto.showPopover;
        delete proto.hidePopover;
    });

    it("is a manual popover, shown again on every tip so it lands above a dialog opened since", async () => {
        const box = renderLayer();
        expect(box).toHaveAttribute("popover", "manual");
        const user = userEvent.setup();
        await user.hover(screen.getByRole("button", { name: "Anlegen" }));
        expect(shown).toEqual(["show"]);
        await user.hover(screen.getByText("80 %"));
        expect(shown).toEqual(["show", "hide", "show"]);
    });

    it("still works as a plain fixed box without popover support", async () => {
        const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
        delete proto.showPopover;
        const box = renderLayer();
        await userEvent.hover(screen.getByRole("button", { name: "Anlegen" }));
        expect(isOpen(box)).toBe(true);
        expect(shown).toEqual([]);
    });
});
