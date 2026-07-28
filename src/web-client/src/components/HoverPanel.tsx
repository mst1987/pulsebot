// A hover/focus panel anchored to a small inline trigger — the "5 Items" cell
// in the Charaktere tab, the gear-issue count in the roster, and anything else
// that wants a peek without a page change.
//
// Extracted from HistoryPage's Items column; every quirk below was a bug once,
// so the comments stay with the behaviour they explain.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const POP_WIDTH = 340;
const POP_MAX_HEIGHT = 340;

// Where the panel goes for a given trigger. Fixed coordinates, because the
// panel is portalled to <body> — .dash-card carries the redesign's notched
// clip-path, and a clip-path cuts off positioned descendants no matter what
// their overflow/z-index says, so an in-card panel would be sliced at the card
// edge. Anchored to the trigger's right (the columns that use it sit near the
// right of a wide card), flipped above it when there is more room up there.
export function popoverStyle(rect: DOMRect, width = POP_WIDTH): React.CSSProperties {
    const w = Math.min(width, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.right - w, window.innerWidth - w - 8));
    const below = window.innerHeight - rect.bottom - 14;
    const above = rect.top - 14;
    return above > below && below < POP_MAX_HEIGHT
        ? { left, width: w, bottom: window.innerHeight - rect.top + 6, maxHeight: Math.min(POP_MAX_HEIGHT, above) }
        : { left, width: w, top: rect.bottom + 6, maxHeight: Math.min(POP_MAX_HEIGHT, below) };
}

export function HoverPanel({ trigger, head, width, className, children }: {
    /** What is rendered inline and opens the panel on hover/focus. */
    trigger: ReactNode;
    /** Panel headline (small caps line above the list). */
    head?: ReactNode;
    width?: number;
    /** Extra class on the trigger chip, e.g. to colour it by severity. */
    className?: string;
    children: ReactNode;
}) {
    const ref = useRef<HTMLSpanElement>(null);
    const popRef = useRef<HTMLDivElement>(null);
    const [rect, setRect] = useState<DOMRect | null>(null);
    // Moving the pointer from the trigger into the panel briefly leaves both
    // (they are separate DOM subtrees) — a short grace period keeps a long,
    // scrollable list reachable instead of snapping shut in the gap.
    const closeTimer = useRef<number | undefined>(undefined);
    // Whether the pointer currently sits on the trigger or inside the panel.
    // Clicking the panel's scrollbar blurs the trigger, and blur must not close
    // a panel the pointer is still in — otherwise the list cannot be scrolled
    // by dragging its scrollbar at all.
    const pointerInside = useRef(false);
    const open = () => {
        window.clearTimeout(closeTimer.current);
        if (ref.current) setRect(ref.current.getBoundingClientRect());
    };
    const close = () => {
        window.clearTimeout(closeTimer.current);
        closeTimer.current = window.setTimeout(() => setRect(null), 140);
    };
    const enter = () => {
        pointerInside.current = true;
        open();
    };
    const leave = (e: React.MouseEvent) => {
        // A scrollbar drag that wanders past the panel edge keeps the button
        // held down — the pointer is still operating the panel, so keep it up
        // and let the mouseup handler below decide.
        if (e.buttons !== 0) return;
        pointerInside.current = false;
        close();
    };
    const blur = () => {
        if (pointerInside.current) return;
        close();
    };

    // Fixed coordinates go stale the moment the page moves under them — but the
    // panel's own list scrolls too, and that must not count as the page moving.
    useEffect(() => {
        if (!rect) return;
        const hide = (e: Event) => {
            const target = e.target;
            if (popRef.current && target instanceof Node && popRef.current.contains(target)) return;
            setRect(null);
        };
        const onResize = () => setRect(null);
        // Ends a scrollbar drag: if the pointer left the panel meanwhile, the
        // deferred close from leave() never ran — do it now.
        const onMouseUp = () => {
            if (popRef.current?.matches(":hover") || ref.current?.matches(":hover")) return;
            pointerInside.current = false;
            close();
        };
        window.addEventListener("scroll", hide, true);
        window.addEventListener("resize", onResize);
        window.addEventListener("mouseup", onMouseUp);
        return () => {
            window.removeEventListener("scroll", hide, true);
            window.removeEventListener("resize", onResize);
            window.removeEventListener("mouseup", onMouseUp);
        };
    }, [rect]);

    useEffect(() => () => window.clearTimeout(closeTimer.current), []);

    return (
        <>
            <span
                ref={ref}
                className="loot-pop-wrap"
                tabIndex={0}
                onMouseEnter={enter}
                onMouseLeave={leave}
                onFocus={open}
                onBlur={blur}
            >
                <span className={`loot-pop-trigger${className ? ` ${className}` : ""}`}>{trigger}</span>
            </span>
            {rect && createPortal(
                <div
                    ref={popRef}
                    className="loot-pop"
                    role="tooltip"
                    style={popoverStyle(rect, width)}
                    onMouseEnter={enter}
                    onMouseLeave={leave}
                >
                    {head && <div className="loot-pop-head">{head}</div>}
                    <div className="loot-pop-list">{children}</div>
                </div>,
                document.body,
            )}
        </>
    );
}
