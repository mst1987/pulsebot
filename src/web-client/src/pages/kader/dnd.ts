// Drag and drop of the Kaderplaner: native HTML5, and what is dragged is always
// an account (its Discord id). Every drop has a click/keyboard twin (the "+"
// buttons, the slot picker, pick-then-place in the setup), so nothing needs a
// mouse.
import { useState, type DragEvent } from "react";

export const DRAG_TYPE = "application/x-eventhelper-kader";

export function dragProps(userId: string, enabled = true) {
    if (!enabled) return {};
    return {
        draggable: true,
        onDragStart: (e: DragEvent) => {
            e.dataTransfer.setData(DRAG_TYPE, userId);
            e.dataTransfer.setData("text/plain", userId);
            e.dataTransfer.effectAllowed = "move";
        },
    };
}

/** Props for a drop target, plus whether something is dragged over it right now. */
export function useDropZone(onDrop: (userId: string) => void, enabled = true) {
    const [over, setOver] = useState(false);
    if (!enabled) return { over: false, props: {} };
    return {
        over,
        props: {
            onDragOver: (e: DragEvent) => {
                if (!Array.from(e.dataTransfer.types).includes(DRAG_TYPE)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (!over) setOver(true);
            },
            onDragLeave: (e: DragEvent) => {
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                setOver(false);
            },
            onDrop: (e: DragEvent) => {
                e.preventDefault();
                setOver(false);
                const id = e.dataTransfer.getData(DRAG_TYPE);
                if (id) onDrop(id);
            },
        },
    };
}
