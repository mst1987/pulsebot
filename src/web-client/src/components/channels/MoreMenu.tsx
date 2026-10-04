import { useRef, useState } from "react";
import { Button, IconButton } from "../ui";
import { ChevronDownIcon } from "../icons";
import { useDismiss } from "../../hooks/useDismiss";

// The "…" of a channel row and the "Mehr" of the bulk bar: a small menu for the actions that
// do not deserve a button of their own. Rendered only while open; Escape and a click outside close it.

export type MoreItem = {
    id: string;
    label: string;
    onSelect: () => void;
    tone?: "danger";
    /** Shown only where the row's own buttons are hidden (touch, narrow screens). */
    touchOnly?: boolean;
};

export default function MoreMenu({ items, label, tip, up }: {
    items: MoreItem[];
    /** With a label the trigger is a "Mehr ▾" button, without it a "…" icon button. */
    label?: string;
    tip: string;
    /** Open upward (the bulk bar sits at the bottom of the screen). */
    up?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLSpanElement>(null);
    useDismiss(ref, open, () => setOpen(false));
    return (
        <span className="kn-more" ref={ref}>
            {label
                ? (
                    <Button size="sm" variant="ghost" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
                        {label}<ChevronDownIcon />
                    </Button>
                )
                : (
                    <IconButton
                        size="sm"
                        icon={<span aria-hidden="true">…</span>}
                        tip={tip}
                        aria-haspopup="menu"
                        aria-expanded={open}
                        onClick={() => setOpen((o) => !o)}
                    />
                )}
            {open && (
                <div className={`split-menu kn-more-menu${up ? " up" : ""}`} role="menu">
                    {items.map((i) => (
                        <button
                            key={i.id}
                            type="button"
                            role="menuitem"
                            className={`${i.tone === "danger" ? "kn-danger " : ""}${i.touchOnly ? "kn-touch-only" : ""}`.trim() || undefined}
                            onClick={() => { setOpen(false); i.onSelect(); }}
                        >
                            {i.label}
                        </button>
                    ))}
                </div>
            )}
        </span>
    );
}
