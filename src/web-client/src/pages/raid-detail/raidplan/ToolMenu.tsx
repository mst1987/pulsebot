import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import Popover from "../../../components/ui/Popover";
import { belowEndPlacement, belowStartPlacement } from "../../../lib/popoverPosition";

/** One entry of a tool menu: an action, or (with `on`) a switch that shows its state. */
export type ToolItem = { id: string; label: string; icon?: ReactNode; sub?: string; on?: boolean; disabled?: boolean; onSelect: () => void };

/**
 * A labelled button that opens a short menu ("Zeichnen ▾", "Formen ▾", "Mehr ▾"): the icon buttons that stood in a row
 * moved behind it, each with its name. `role="menu"` with `menuitem` / `menuitemcheckbox`; the first entry gets the focus,
 * the arrow keys (and Home / End) move, Esc and a click outside close it and give the focus back to the button.
 */
export default function ToolMenu({ label, icon, items, tip, tipSub, align = "start", disabled = false, iconOnly = false }: {
    label: string;
    icon?: ReactNode;
    items: ToolItem[];
    tip?: string;
    tipSub?: string;
    /** which edge of the button the menu lines up with */
    align?: "start" | "end";
    disabled?: boolean;
    /** only the icon on the button (the label stays its accessible name and tooltip) */
    iconOnly?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const btn = useRef<HTMLButtonElement>(null);
    const box = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open || !box.current) return;
        const first = box.current.querySelector<HTMLButtonElement>("button:not(:disabled)");
        if (first) first.focus();
    }, [open]);
    const close = (focusBack: boolean) => {
        setOpen(false);
        if (focusBack && btn.current) btn.current.focus();
    };
    const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
        const list = box.current ? Array.from(box.current.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")) : [];
        const at = list.indexOf(document.activeElement as HTMLButtonElement);
        const go = (i: number) => { if (list.length > 0) list[(i + list.length) % list.length].focus(); };
        if (e.key === "ArrowDown") { e.preventDefault(); go(at + 1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); go(at - 1); }
        else if (e.key === "Home") { e.preventDefault(); go(0); }
        else if (e.key === "End") { e.preventDefault(); go(list.length - 1); }
        else if (e.key === "Escape") { e.preventDefault(); close(true); }
        else if (e.key === "Tab") close(false);
    };
    return (
        <>
            <button
                ref={btn} type="button" className={`btn btn-ghost btn-sm rp-toolmenu-btn${open ? " is-open" : ""}${iconOnly ? " is-icon" : ""}`} aria-haspopup="menu" aria-expanded={open}
                aria-label={iconOnly ? label : undefined} data-tip={open ? undefined : tip || (iconOnly ? label : undefined)} data-tip-sub={open ? undefined : tipSub} disabled={disabled}
                onClick={() => setOpen((o) => !o)}
            >
                {icon}
                {!iconOnly && <span>{label}</span>}
                <ChevronDown className="rp-toolmenu-chev" size={14} aria-hidden="true" />
            </button>
            {open && (
                <Popover
                    anchor={btn} place={align === "end" ? belowEndPlacement(6) : belowStartPlacement(6)} follow="reposition" onClose={() => setOpen(false)}
                    className="rp-toolmenu-pop" role="menu" aria-label={label} boxRef={box} onKeyDown={onKey}
                >
                    {items.map((it) => (
                        <button
                            key={it.id} type="button" role={it.on === undefined ? "menuitem" : "menuitemcheckbox"} aria-checked={it.on === undefined ? undefined : it.on}
                            className={`rp-toolmenu-item${it.on ? " is-on" : ""}`} disabled={it.disabled}
                            onClick={() => { close(true); it.onSelect(); }}
                        >
                            <span className="rp-toolmenu-ico" aria-hidden="true">{it.icon}</span>
                            <span className="rp-toolmenu-text">
                                <span className="rp-toolmenu-label">{it.label}</span>
                                {it.sub && <span className="rp-toolmenu-sub">{it.sub}</span>}
                            </span>
                        </button>
                    ))}
                </Popover>
            )}
        </>
    );
}
