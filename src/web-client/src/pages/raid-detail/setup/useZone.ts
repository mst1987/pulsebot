import { useState, type DragEvent } from "react";
import type { SetupTarget } from "../../../lib/setupEditor";
import type { Interaction } from "./Board";

/** A drop zone: a group card, the bench or "Angemeldet". Click/Enter moves the picked raider here. */
export function useZone(target: SetupTarget, ui: Interaction) {
    const [over, setOver] = useState(false);
    return {
        over,
        props: ui.editable ? {
            onDragOver: (e: DragEvent<HTMLElement>) => { e.preventDefault(); setOver(true); },
            onDragLeave: () => setOver(false),
            onDrop: (e: DragEvent<HTMLElement>) => { e.preventDefault(); setOver(false); ui.onDrop(target, e.dataTransfer.getData("text/plain")); },
        } : {},
    };
}
