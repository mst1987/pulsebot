import { useRef, type MouseEvent, type PointerEvent } from "react";

/**
 * The handlers that close a <dialog> on a click on its backdrop — and only on
 * one that also *started* there.
 *
 * The browser sends a click to the nearest element both the press and the
 * release were in. Selecting text in a field and letting go outside the dialog
 * therefore "clicks" the <dialog> element itself, which is what a click on the
 * backdrop looks like too — and the dialog closed under the user's hand. So
 * the press is remembered: the click counts only when the button went down on
 * the backdrop as well.
 *
 * Spread onto the <dialog>: `<dialog {...useBackdropClose(onClose)} …>`.
 */
export function useBackdropClose(onClose: () => void) {
    const pressedOnBackdrop = useRef(false);
    return {
        onPointerDown: (e: PointerEvent<HTMLElement>) => {
            pressedOnBackdrop.current = e.target === e.currentTarget;
        },
        onClick: (e: MouseEvent<HTMLElement>) => {
            const pressed = pressedOnBackdrop.current;
            pressedOnBackdrop.current = false;
            if (pressed && e.target === e.currentTarget) onClose();
        },
    };
}
