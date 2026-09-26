import { useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useDismiss, type DismissOptions } from "../../hooks/useDismiss";
import { nodeOf, type DismissTarget } from "../../lib/dismiss";
import { samePosition, type Placement, type PopoverStyle } from "../../lib/popoverPosition";

/**
 * The base of every floating box that belongs to an element on the page — a
 * menu under its button, a rich tooltip, a hover panel, a right-click menu (#439).
 *
 * - **Portalled** into <body> (or, with `host="dialog"`, into the open modal
 *   dialog the anchor sits in): panels with the redesign's clipped corners cut
 *   off anything positioned inside them, and a modal <dialog> sits in the top
 *   layer above everything outside it.
 * - **Placed** with fixed coordinates from `place` (lib/popoverPosition.ts),
 *   measured after it is drawn and before it is painted, so it never flashes
 *   in the wrong spot and never leaves the viewport.
 * - **Follows** the page: on scroll or resize it closes (`follow="close"`, the
 *   default — a scroll inside the box itself does not count) or moves along
 *   (`follow="reposition"`).
 * - **Dismissed** by a click outside it and its anchor, and by Escape
 *   (hooks/useDismiss), when it has an `onClose`; `dismiss` tunes or (false)
 *   switches that off, e.g. for a tooltip that closes on mouse leave.
 *
 * Render it only while open: `{open && <Popover …/>}`.
 */
export default function Popover({ anchor, place, onClose, dismiss = {}, follow = "close", host = "body", boxRef, style, children, ...rest }: {
    /** What it belongs to: a ref or an element. Counts as inside for the dismiss. */
    anchor: DismissTarget;
    place: Placement;
    onClose?: () => void;
    dismiss?: DismissOptions | false;
    follow?: "close" | "reposition" | "none";
    host?: "body" | "dialog";
    /** The box itself, for a caller that needs it (focus, keyboard). */
    boxRef?: RefObject<HTMLDivElement>;
    children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "children">) {
    const ownRef = useRef<HTMLDivElement>(null);
    const box = boxRef || ownRef;
    const [pos, setPos] = useState<PopoverStyle | null>(null);
    const latest = useRef({ place, anchor, onClose });
    latest.current = { place, anchor, onClose };

    const measure = () => {
        const el = box.current;
        if (!el) return;
        const a = nodeOf(latest.current.anchor) as Element | null;
        const b = el.getBoundingClientRect();
        const next = latest.current.place(a ? a.getBoundingClientRect() : null, { width: b.width, height: b.height }, { width: window.innerWidth, height: window.innerHeight });
        setPos((prev) => (samePosition(prev, next) ? prev : next));
    };

    // every render: the content (and with it the size) may have changed; samePosition ends the loop
    useLayoutEffect(measure);

    useEffect(() => {
        if (follow === "none") return undefined;
        const onScroll = (e: Event) => {
            // the box's own list scrolling is not the page moving
            if (box.current && e.target instanceof Node && box.current.contains(e.target)) return;
            if (follow === "reposition") measure();
            else latest.current.onClose?.();
        };
        const onResize = () => (follow === "reposition" ? measure() : latest.current.onClose?.());
        window.addEventListener("scroll", onScroll, true);
        window.addEventListener("resize", onResize);
        return () => {
            window.removeEventListener("scroll", onScroll, true);
            window.removeEventListener("resize", onResize);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [follow]);

    useDismiss([anchor, box], !!onClose && dismiss !== false, () => latest.current.onClose?.(), dismiss || {});

    const anchorEl = nodeOf(anchor) as Element | null;
    const target = host === "dialog" && anchorEl ? anchorEl.closest("dialog") || document.body : document.body;
    return createPortal(
        <div ref={box} style={{ ...style, ...pos }} {...rest}>{children}</div>,
        target,
    );
}
