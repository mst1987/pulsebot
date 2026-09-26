import { useEffect, useRef, type ReactNode } from "react";
import { tipPosition } from "../../lib/popoverPosition";

// Tooltips: the page's own box, never the browser's `title`. The native box
// appears after a second, cannot be styled and does not exist on touch.
//
// Any element carrying `data-tip` (the head) and optionally `data-tip-sub` (the
// explanation) gets it — HTML or SVG, set by hand, by <Tip>, or by a building
// block like IconButton. One <TipLayer> in the shell draws the box for all of
// them, on hover, on keyboard focus and on a tap — also inside an open modal,
// since the box lives in the top layer (raiseTipBox). No module needs a layer
// of its own. The report pages run the same logic as an inline script
// (src/web/render.js), with the same look.

/** Wraps content that explains itself on hover/focus/tap. */
export default function Tip({ head, sub, children, className }: {
    head: string;
    sub?: string;
    children: ReactNode;
    className?: string;
}) {
    return (
        <span className={className ? `tip-anchor ${className}` : "tip-anchor"} data-tip={head} data-tip-sub={sub}>
            {children}
        </span>
    );
}

/**
 * Head and explanation of a tip. A `data-tip` without a sub that is long or has
 * several lines — most of the former `title` texts — is split at its first line
 * break, or shown as plain explanation when it is one long sentence, instead of
 * being set in bold as a whole.
 */
export function tipParts(tip: string, sub: string | null): { head: string; sub: string } {
    if (sub) return { head: tip, sub };
    const nl = tip.indexOf("\n");
    if (nl > 0) return { head: tip.slice(0, nl).trim(), sub: tip.slice(nl + 1).trim() };
    if (tip.length > 60) return { head: "", sub: tip };
    return { head: tip, sub: "" };
}

/**
 * Keys that move the focus on their own. A focus that follows one of them is
 * the visitor walking the page and gets its tooltip; any other focus — a
 * dialog's `showModal()` putting it on the close button, a form focusing its
 * first field, an Enter that opened something — is the page's doing and does
 * not. Otherwise every modal opened with its close button's tooltip showing.
 */
export const NAV_KEYS = new Set(["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);

/** How long after a navigation key a focus still counts as its result (ms). */
export const NAV_FOCUS_WINDOW = 500;

/** Whether a focus at `now` came from the navigation key pressed at `navAt` (0 = none since). */
function focusFromNavigation(navAt: number, now: number): boolean {
    return navAt > 0 && now - navAt <= NAV_FOCUS_WINDOW;
}

/**
 * Lifts the box into the browser's top layer. A modal <dialog> is drawn there,
 * above everything else however high its z-index — so a box in the page would
 * sit behind the dialog and its backdrop. As a manual popover the box is in the
 * top layer too, and showing it again puts it on top of whatever dialog opened
 * since. Without popover support (old browsers) it stays a fixed box.
 */
function raiseTipBox(box: HTMLElement): void {
    if (typeof box.showPopover !== "function") return;
    if (box.matches(":popover-open")) box.hidePopover();
    box.showPopover();
}

export function TipLayer() {
    const boxRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const box = boxRef.current;
        if (!box) return undefined;
        let cur: Element | null = null;
        // performance.now() of the last navigation key, 0 after any other key or a click.
        let navAt = 0;
        box.setAttribute("popover", "manual");

        // The same placement as every other tooltip (lib/popoverPosition.ts, ui/Popover): the one box is
        // driven by the DOM here rather than rendered per anchor, so it only borrows the placement.
        const place = (t: Element) => {
            const b = box.getBoundingClientRect();
            const p = tipPosition(t.getBoundingClientRect(), { width: b.width, height: b.height }, { width: window.innerWidth, height: window.innerHeight });
            box.style.left = `${p.left}px`;
            box.style.top = `${p.top}px`;
        };
        const show = (t: Element) => {
            if (cur === t) return;
            const tip = t.getAttribute("data-tip") || "";
            if (!tip) return;
            cur = t;
            const parts = tipParts(tip, t.getAttribute("data-tip-sub"));
            box.replaceChildren();
            if (parts.head) {
                const b = document.createElement("b");
                b.textContent = parts.head;
                box.appendChild(b);
            }
            if (parts.sub) {
                const i = document.createElement("i");
                i.textContent = parts.sub;
                box.appendChild(i);
            }
            raiseTipBox(box);
            box.classList.add("on");
            place(t);
        };
        const hide = () => {
            cur = null;
            box.classList.remove("on");
        };
        const target = (e: Event) => (e.target instanceof Element ? e.target.closest("[data-tip]") : null);

        const onOver = (e: MouseEvent) => {
            const t = target(e);
            if (t) show(t);
            else if (cur) hide();
        };
        const onOut = (e: MouseEvent) => { if (cur && !e.relatedTarget) hide(); };
        const onFocus = (e: FocusEvent) => {
            if (!focusFromNavigation(navAt, performance.now())) return;
            const t = target(e);
            if (t) show(t);
        };
        // Touch has no hover: a tap toggles the box, a tap elsewhere closes it.
        const onDown = (e: PointerEvent) => {
            navAt = 0;
            if (e.pointerType !== "touch") return;
            const t = target(e);
            if (!t) { hide(); return; }
            if (cur === t) hide(); else show(t);
        };
        const onScroll = () => { if (cur) place(cur); };
        // Captured, so the key is known before a roving-focus handler (Segment's
        // arrow keys) moves the focus in its own keydown.
        const onKey = (e: KeyboardEvent) => {
            navAt = NAV_KEYS.has(e.key) ? performance.now() : 0;
            if (e.key === "Escape") hide();
        };

        document.addEventListener("mouseover", onOver);
        document.addEventListener("mouseout", onOut);
        document.addEventListener("focusin", onFocus);
        document.addEventListener("focusout", hide);
        document.addEventListener("pointerdown", onDown, true);
        document.addEventListener("keydown", onKey, true);
        window.addEventListener("scroll", onScroll, true);
        return () => {
            document.removeEventListener("mouseover", onOver);
            document.removeEventListener("mouseout", onOut);
            document.removeEventListener("focusin", onFocus);
            document.removeEventListener("focusout", hide);
            document.removeEventListener("pointerdown", onDown, true);
            document.removeEventListener("keydown", onKey, true);
            window.removeEventListener("scroll", onScroll, true);
        };
    }, []);

    return <div className="tip" ref={boxRef} role="tooltip" aria-hidden="true" />;
}
