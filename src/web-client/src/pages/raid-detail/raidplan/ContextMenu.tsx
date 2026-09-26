import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { clampMenuPosition, type MenuItem } from "../../../lib/raidplan";
import { MarkIcon } from "../../../components/raidplan/MarkIcon";
import type { RaidplanMarkName } from "../../../api";
import { useDismiss } from "../../../hooks/useDismiss";

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
    const [pos, setPos] = useState({ x, y });
    const [active, setActive] = useState(0);
    const enabled = items.map((i, n) => (i.disabled ? -1 : n)).filter((n) => n >= 0);

    // measured once it is drawn: back into the viewport
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        setPos(clampMenuPosition(x, y, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight));
    }, [x, y, items.length]);

    // Esc is the menu's own key (it keeps the board's handlers from seeing it).
    useDismiss(ref, true, onClose, { event: "pointerdown", capture: true, escape: false });

    useEffect(() => {
        const before = document.activeElement as HTMLElement | null;
        const close = () => onClose();
        window.addEventListener("resize", close);
        window.addEventListener("scroll", close, true);
        window.addEventListener("blur", close);
        return () => {
            window.removeEventListener("resize", close);
            window.removeEventListener("scroll", close, true);
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
    return createPortal(
        <div ref={ref} className="rp-menu" role="menu" aria-label={title} style={{ left: pos.x, top: pos.y }} onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()}>
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
        </div>,
        document.body,
    );
}
