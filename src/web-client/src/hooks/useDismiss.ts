import { useEffect, useRef } from "react";
import { isDismissKey, isInside, type DismissTarget } from "../lib/dismiss";

export type DismissOptions = {
    /** The pointer event that counts as a click outside. Default `mousedown`; the pickers close on `click`, the raid plan on `pointerdown`. */
    event?: "mousedown" | "click" | "pointerdown";
    /** Listen in the capture phase, before the page's own handlers (the raid plan's board stops its pointer events). */
    capture?: boolean;
    /** Escape closes as well. Default true; off where the panel handles its keys itself. */
    escape?: boolean;
};

/**
 * Closes an open popover, menu or picker on a click outside it and on Escape.
 * `targets` are the parts that count as inside — the panel and, usually, the
 * button that opened it (so its own click toggles instead of closing and
 * reopening). Listens only while `open`; the latest targets and `onClose` are
 * used, so an inline arrow does not resubscribe on every render.
 */
export function useDismiss(targets: DismissTarget | DismissTarget[], open: boolean, onClose: () => void, options: DismissOptions = {}): void {
    const { event = "mousedown", capture = false, escape = true } = options;
    const latest = useRef({ targets, onClose });
    latest.current = { targets, onClose };

    useEffect(() => {
        if (!open) return undefined;
        const outside = (target: EventTarget | null) => {
            const { targets: current } = latest.current;
            return !isInside(target as Node | null, Array.isArray(current) ? current : [current]);
        };
        // A click goes to the element both the press and the release were in, so
        // selecting text inside and letting go outside "clicks" outside. For the
        // click variant the press must have been outside as well.
        let pressedOutside = true;
        const press = (e: Event) => { pressedOutside = outside(e.target); };
        const away = (e: Event) => {
            const pressed = pressedOutside;
            pressedOutside = true;
            if (event === "click" && !pressed) return;
            if (outside(e.target)) latest.current.onClose();
        };
        const key = (e: KeyboardEvent) => { if (isDismissKey(e.key)) latest.current.onClose(); };
        if (event === "click") document.addEventListener("pointerdown", press, true);
        document.addEventListener(event, away, capture);
        if (escape) document.addEventListener("keydown", key);
        return () => {
            if (event === "click") document.removeEventListener("pointerdown", press, true);
            document.removeEventListener(event, away, capture);
            if (escape) document.removeEventListener("keydown", key);
        };
    }, [open, event, capture, escape]);
}
