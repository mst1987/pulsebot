import { useRef, useState, type ReactNode, type CSSProperties } from "react";
import { Popover } from "../../components/ui";
import { tipPlacement } from "../../lib/popoverPosition";

/**
 * A tooltip with more than a head and a sentence — the need bar's three parts,
 * the last items behind a loot count. Same box as the shared tooltip (`.tip`),
 * drawn by the anchor itself because the shared layer only carries text.
 *
 * Portalled into the open dialog when there is one: a modal <dialog> sits in
 * the browser's top layer, and anything outside it — however high its z-index —
 * stays behind the backdrop.
 */
export function RichTip({ trigger, children, width = 300, label }: {
    trigger: ReactNode;
    children: ReactNode;
    width?: number;
    /** What a screen reader hears on the anchor. */
    label?: string;
}) {
    const anchor = useRef<HTMLSpanElement>(null);
    const [open, setOpen] = useState(false);

    // Fixed coordinates go stale the moment the page scrolls under them: the
    // Popover closes it then (follow="close"); mouse leave and blur close it too.
    return (
        <>
            <span
                ref={anchor}
                className="lc-rtip-anchor"
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
                <Popover anchor={anchor} place={tipPlacement()} host="dialog" onClose={() => setOpen(false)} dismiss={false} className="tip on lc-rtip" role="tooltip" style={{ "--lc-rtip-w": `${width}px` } as CSSProperties}>
                    {children}
                </Popover>
            )}
        </>
    );
}
