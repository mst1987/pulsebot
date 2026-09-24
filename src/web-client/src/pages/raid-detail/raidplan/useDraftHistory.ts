import { useCallback, useRef, useState } from "react";
import type { RaidplanBoard } from "../../../api";
import { boardOf, historyInit, historyRecord, historyRedo, historyUndo, withBoard, type History } from "../../../lib/raidplan";

type Bosses = Record<string, Partial<RaidplanBoard>>;

/** Changes that follow each other within this many ms and are all "continuous" (a drag, a slider, typing) are one undo step. */
const COALESCE_MS = 1200;

/**
 * The unsaved plan of an editor with undo and redo: one history over all bosses'
 * boards. `edit(bossKey, fn, coalesce)` changes one board; a `coalesce`d change
 * continues the previous one when that was coalesced too and came right before, so
 * the many small moves of one drag (or the keystrokes of one field) are a single
 * step. `reset` replaces everything (a load, a save, a template applied) and
 * forgets the history.
 */
export function useDraftHistory() {
    const [h, setH] = useState<History<Bosses>>(historyInit({}));
    const lastCoalesced = useRef(0);
    const edit = useCallback((key: string, fn: (b: RaidplanBoard) => RaidplanBoard, coalesce = false) => {
        const now = Date.now();
        const merge = coalesce && lastCoalesced.current > 0 && now - lastCoalesced.current < COALESCE_MS;
        lastCoalesced.current = coalesce ? now : 0;
        setH((prev) => historyRecord(prev, withBoard(prev.present, key, fn(boardOf(prev.present, key))), merge));
    }, []);
    const reset = useCallback((bosses: Bosses) => { lastCoalesced.current = 0; setH(historyInit(bosses)); }, []);
    const undo = useCallback(() => { lastCoalesced.current = 0; setH((prev) => historyUndo(prev)); }, []);
    const redo = useCallback(() => { lastCoalesced.current = 0; setH((prev) => historyRedo(prev)); }, []);
    return { draft: h.present, edit, reset, undo, redo, canUndo: h.past.length > 0, canRedo: h.future.length > 0 };
}
