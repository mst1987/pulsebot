// The peek (#setup-bar): a raider's info beside their line while the mouse rests
// on it or the keyboard focus is there — the same SlotTip the drawer shows, read
// only. The editor (SetupEditor.tsx) holds which line it is and shows it after
// PEEK_DELAY_MS; a click still pins the drawer with the actions.
import type { FocusEvent, PointerEvent } from "react";
import type { Interaction } from "./Board";

/** How long the pointer rests on a line before its info shows (ms) — passing over does not flash a box. */
export const PEEK_DELAY_MS = 250;

/**
 * The handlers a raider's line gets: a mouse that enters it or a focus on the line
 * itself starts the peek, leaving or blurring ends it. A touch never peeks — a tap
 * picks, and the drawer opens.
 */
export function peekHandlers(ui: Interaction, userId: string, character?: string) {
    return {
        onPointerEnter: (e: PointerEvent<HTMLElement>) => {
            if (e.pointerType !== "touch") ui.onInspect(userId, e.currentTarget, character);
        },
        onPointerLeave: () => ui.onLeave?.(),
        onFocus: (e: FocusEvent<HTMLElement>) => {
            if (e.target === e.currentTarget) ui.onInspect(userId, e.currentTarget, character);
        },
        onBlur: () => ui.onLeave?.(),
    };
}
