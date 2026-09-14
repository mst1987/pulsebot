import { useEffect, useRef, type ReactNode } from "react";

// Tooltips: the page's own box, never the browser's `title`. The native box
// appears after a second, cannot be styled and does not exist on touch.
//
// Any element carrying `data-tip` (the head) and optionally `data-tip-sub` (the
// explanation) gets it — HTML or SVG, set by hand, by <Tip>, or by a building
// block like IconButton. One <TipLayer> in the shell draws the box for all of
// them, on hover, on keyboard focus and on a tap. The report pages run the same
// logic as an inline script (src/web/render.js), with the same look.

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

export function TipLayer() {
    const boxRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const box = boxRef.current;
        if (!box) return undefined;
        let cur: Element | null = null;

        const place = (t: Element) => {
            const r = t.getBoundingClientRect();
            const b = box.getBoundingClientRect();
            const x = r.left + r.width / 2 - b.width / 2;
            let y = r.top - b.height - 9;
            if (y < 8) y = r.bottom + 9;
            box.style.left = `${Math.max(8, Math.min(x, window.innerWidth - b.width - 8))}px`;
            box.style.top = `${y}px`;
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
        const onFocus = (e: FocusEvent) => { const t = target(e); if (t) show(t); };
        // Touch has no hover: a tap toggles the box, a tap elsewhere closes it.
        const onDown = (e: PointerEvent) => {
            if (e.pointerType !== "touch") return;
            const t = target(e);
            if (!t) { hide(); return; }
            if (cur === t) hide(); else show(t);
        };
        const onScroll = () => { if (cur) place(cur); };
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") hide(); };

        document.addEventListener("mouseover", onOver);
        document.addEventListener("mouseout", onOut);
        document.addEventListener("focusin", onFocus);
        document.addEventListener("focusout", hide);
        document.addEventListener("pointerdown", onDown);
        document.addEventListener("keydown", onKey);
        window.addEventListener("scroll", onScroll, true);
        return () => {
            document.removeEventListener("mouseover", onOver);
            document.removeEventListener("mouseout", onOut);
            document.removeEventListener("focusin", onFocus);
            document.removeEventListener("focusout", hide);
            document.removeEventListener("pointerdown", onDown);
            document.removeEventListener("keydown", onKey);
            window.removeEventListener("scroll", onScroll, true);
        };
    }, []);

    return <div className="tip" ref={boxRef} role="tooltip" aria-hidden="true" />;
}
