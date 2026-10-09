import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { RaidplanBoard } from "../../../../api";
import { copySelection, deleteSelection, duplicateSelection, liveItems, pasteSnapshot, selectionBox, type SelItem, type Snapshot } from "../../../../lib/raidplan/multiSelect";
import type { Selection } from "../../../../lib/raidplan";

/**
 * What is selected on the board: nothing, one object (the inspector shows it)
 * or several (the shared frame). Another boss starts with nothing selected, and
 * whatever an undo or a delete elsewhere took away drops out of the selection.
 */
export function useBoardSelection({ board, bossKey, withAuto, onBossChange }: {
    board: RaidplanBoard;
    bossKey: string;
    /** the board with the transient positions of the tank rows' objects */
    withAuto: (b: RaidplanBoard) => RaidplanBoard;
    /** what else another boss resets (the open menu) */
    onBossChange: () => void;
}) {
    const [selected, setSelected] = useState<Selection>(null);
    const [multi, setMulti] = useState<SelItem[]>([]);
    /** Everything that is selected, whether it is one object or several. */
    const currentSel = (): SelItem[] => (multi.length > 1 ? multi : selected ? [selected as SelItem] : []);
    /** Sets the selection: none, one (the inspector shows it) or several (the shared frame). */
    const chooseItems = (items: SelItem[]) => {
        setMulti(items.length > 1 ? items : []);
        setSelected(items.length === 1 ? items[0] : null);
    };

    // Another boss: nothing is selected any more.
    useEffect(() => { setSelected(null); setMulti([]); onBossChange(); }, [bossKey]); // eslint-disable-line react-hooks/exhaustive-deps

    // what an undo, a delete elsewhere ... took away is no longer selected
    useEffect(() => {
        if (multi.length === 0) return;
        const live = liveItems(withAuto(board), multi);
        if (live.length !== multi.length) chooseItems(live);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [board]);

    return { selected, setSelected, multi, setMulti, currentSel, chooseItems };
}

/**
 * What the selection does as a whole — each one undo step: duplicate, copy,
 * paste (a little offset each time) and delete, and any function over the
 * selected objects (`multiAction`).
 */
export function useSelectionEdits({ edit, boardNow, currentSel, chooseItems, withAuto, noAuto, boardPx, onSkipped }: {
    edit: (fn: (b: RaidplanBoard) => RaidplanBoard, coalesce?: boolean) => void;
    boardNow: MutableRefObject<RaidplanBoard>;
    currentSel: () => SelItem[];
    chooseItems: (items: SelItem[]) => void;
    withAuto: (b: RaidplanBoard) => RaidplanBoard;
    noAuto: (b: RaidplanBoard) => RaidplanBoard;
    boardPx: () => { w: number; h: number };
    /** some of the selection cannot be copied (a raider, a slot of the Besetzung) */
    onSkipped: (n: number) => void;
}) {
    const clip = useRef<{ snap: Snapshot; pastes: number } | null>(null);
    const centerOf = (b: RaidplanBoard, sel: SelItem[]) => {
        const box = selectionBox(withAuto(b), sel, boardPx());
        return box ? { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 } : { x: 0.5, y: 0.5 };
    };
    /** One undo step for whatever the selection does. */
    const multiAction = (fn: (b: RaidplanBoard, sel: SelItem[]) => RaidplanBoard, merge = false) => {
        const sel = currentSel();
        if (sel.length === 0) return;
        edit((b) => noAuto(fn(withAuto(b), sel)), merge);
    };
    const doDuplicate = () => {
        const sel = currentSel();
        if (sel.length === 0) return;
        const r = duplicateSelection(boardNow.current, sel);
        if (r.skipped > 0) onSkipped(r.skipped);
        if (r.sel.length === 0) return;
        edit(() => r.board);
        chooseItems(r.sel);
    };
    const doCopy = () => {
        const sel = currentSel();
        if (sel.length === 0) return;
        const r = copySelection(boardNow.current, sel);
        if (r.skipped > 0) onSkipped(r.skipped);
        clip.current = { snap: r.snap, pastes: 0 };
    };
    const doPaste = () => {
        if (!clip.current) return;
        clip.current.pastes += 1;
        const r = pasteSnapshot(boardNow.current, clip.current.snap, 0.03 * clip.current.pastes);
        if (r.sel.length === 0) return;
        edit(() => r.board);
        chooseItems(r.sel);
    };
    const doDelete = () => {
        const sel = currentSel();
        if (sel.length === 0) return;
        edit((b) => deleteSelection(b, sel));
        chooseItems([]);
    };
    return { clip, centerOf, multiAction, doDuplicate, doCopy, doPaste, doDelete };
}
