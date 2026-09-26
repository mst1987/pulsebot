import { useEffect, useRef, useState, type KeyboardEvent, type CSSProperties } from "react";
import type { MenuItem } from "../../../lib/raidplan";
import { pointPlacement, popoverVars } from "../../../lib/popoverPosition";
import Popover from "../../../components/ui/Popover";
import { MarkIcon } from "../../../components/raidplan/MarkIcon";
import type { RaidplanMarkName } from "../../../api";

/**
 * The board's own right-click (or long-press) menu. It replaces the browser's
 * menu on the board only. Keyboard: Up / Down / Home / End move, Enter or Space
 * picks, Esc closes (focus returns to where it was); a click anywhere else, a scroll
 * or a resize closes it. It opens where the pointer was and is moved back into the
 * viewport when it would not fit. `role="menu"` with `menuitem` entries, a
 * `separator` between the sections.
 */
export default function ContextMenu({ x, y, title, items, labelFor, onPick, onClose }: {
    x: number;
    y: number;
    title: string;
    items: MenuItem[];
    labelFor: (item: MenuItem) => string;
    onPick: (id: string) => void;
    onClose: () => void;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [active, setActive] = useState(0);
    const enabled = items.map((i, n) => (i.disabled ? -1 : n)).filter((n) => n >= 0);

    // Placed by the Popover (drawn at the pointer, measured, moved back into the viewport); a click anywhere
    // else, a scroll or a resize closes it there. Esc is the menu's own key (it keeps the board's handlers
    // from seeing it), so the Popover does not listen for it.
    useEffect(() => {
        const before = document.activeElement as HTMLElement | null;
        const close = () => onClose();
        window.addEventListener("blur", close);
        return () => {
            window.removeEventListener("blur", close);
            if (before && before.focus) before.focus();
        };
    }, [onClose]);

    useEffect(() => {
        const el = ref.current ? ref.current.querySelectorAll<HTMLElement>("[role=menuitem]")[active] : null;
        if (el) el.focus();
    }, [active]);

    const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
        const at = enabled.indexOf(active);
        if (e.key === "ArrowDown") { e.preventDefault(); setActive(enabled[(at + 1) % enabled.length]); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setActive(enabled[(at - 1 + enabled.length) % enabled.length]); }
        else if (e.key === "Home") { e.preventDefault(); setActive(enabled[0]); }
        else if (e.key === "End") { e.preventDefault(); setActive(enabled[enabled.length - 1]); }
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
        else if (e.key === "Tab") { e.preventDefault(); onClose(); }
    };

    let last = "";
    return (
        <Popover
            anchor={null} boxRef={ref} place={pointPlacement(x, y)} onClose={onClose} dismiss={{ event: "pointerdown", capture: true, escape: false }}
            className="rp-menu" role="menu" aria-label={title} style={popoverVars({ left: x, top: y }) as CSSProperties} onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()}
        >
            <div className="rp-menu-title" aria-hidden="true">{title}</div>
            {items.map((item, n) => {
                const sep = last && last !== item.section;
                last = item.section;
                const mark = item.id.startsWith("insert:mark:") ? item.id.slice(12) : "";
                return (
                    <div key={item.id} role="none">
                        {sep && <div className="rp-menu-sep" role="separator" />}
                        <button
                            type="button" role="menuitem" tabIndex={n === active ? 0 : -1} disabled={item.disabled}
                            className={`rp-menu-item${item.danger ? " is-danger" : ""}`}
                            onMouseEnter={() => setActive(n)}
                            onClick={() => { onPick(item.id); onClose(); }}
                        >
                            {mark && <MarkIcon mark={mark as RaidplanMarkName} size={18} />}
                            {labelFor(item)}
                        </button>
                    </div>
                );
            })}
        </Popover>
    );
}
