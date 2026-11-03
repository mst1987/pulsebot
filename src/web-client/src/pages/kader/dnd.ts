// Drag and drop of the Kaderplaner: native HTML5, and what is dragged is always
// an account (its Discord id). Every drop has a click/keyboard twin (the "+"
// buttons, the slot picker, pick-then-place in the setup), so nothing needs a
// mouse.
import { useEffect, useState, type DragEvent } from "react";

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

/**
 * The account being dragged anywhere on the page, or null: from the start of the drag
 * until it ends, however it ends (a drop, Escape, let go outside). The drop zones above
 * only know about a card once it hovers over them; this is for showing where it can go
 * from the first moment on.
 */
export function useDraggedCard(enabled = true): string | null {
    const [dragged, setDragged] = useState<string | null>(null);
    useEffect(() => {
        if (!enabled) return undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const end = () => {
            clearTimeout(timer);
            setDragged(null);
        };
        const start = (e: globalThis.DragEvent) => {
            const id = e.dataTransfer?.getData(DRAG_TYPE);
            if (!id) return;
            // Chrome can cancel a drag when the page changes during dragstart
            timer = setTimeout(() => setDragged(id), 0);
            // a card that left the page meanwhile (live poll) ends its drag where nothing bubbles up
            e.target?.addEventListener("dragend", end, { once: true });
        };
        document.addEventListener("dragstart", start);
        document.addEventListener("dragend", end);
        document.addEventListener("drop", end);
        return () => {
            clearTimeout(timer);
            setDragged(null);
            document.removeEventListener("dragstart", start);
            document.removeEventListener("dragend", end);
            document.removeEventListener("drop", end);
        };
    }, [enabled]);
    return dragged;
}
