import { useRef, useState, type ReactNode, type CSSProperties } from "react";
import Popover from "./Popover";
import { tipPlacement } from "../../lib/ui/popoverPosition";

/**
 * A tooltip with more than a head and a sentence — the loot council's need bar and loot list, the roster's attendance
 * (raids grouped by why someone was there or not). Same box as the shared tooltip (`.tip`, ui.css), drawn by the anchor
 * itself because the shared layer (<TipLayer>) only carries text. `className` adds a module's own class for what is
 * inside (`lc-rtip`, `ros-atip`).
 *
 * Portalled into the open dialog when there is one: a modal <dialog> sits in
 * the browser's top layer, and anything outside it — however high its z-index —
 * stays behind the backdrop.
 */
export default function RichTip({ trigger, children, width = 300, label, className = "" }: {
    trigger: ReactNode;
    children: ReactNode;
    width?: number;
    /** What a screen reader hears on the anchor. */
    label?: string;
    className?: string;
}) {
    const anchor = useRef<HTMLSpanElement>(null);
    const [open, setOpen] = useState(false);

    // Fixed coordinates go stale the moment the page scrolls under them: the
    // Popover closes it then (follow="close"); mouse leave and blur close it too.
    return (
        <>
            <span
                ref={anchor}
                className="rtip-anchor"
                tabIndex={0}
                aria-label={label}
                onMouseEnter={() => setOpen(true)}
                onMouseLeave={() => setOpen(false)}
                onFocus={() => setOpen(true)}
                onBlur={() => setOpen(false)}
            >
                {trigger}
            </span>
            {open && (
                <Popover anchor={anchor} place={tipPlacement()} host="dialog" onClose={() => setOpen(false)} dismiss={false} className={`tip on rtip${className ? ` ${className}` : ""}`} role="tooltip" style={{ "--rtip-w": `${width}px` } as CSSProperties}>
                    {children}
                </Popover>
            )}
        </>
    );
}
