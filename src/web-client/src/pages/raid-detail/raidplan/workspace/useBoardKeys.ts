import { useEffect, useRef, type KeyboardEvent, type MutableRefObject, type RefObject } from "react";
import type { RaidplanBoard } from "../../../../api";
import type { AutoPlan } from "../../../../lib/raidplan/autoPlace";
import { hasItem, moveSelection, scaleArrowSelection, scaleSelection, selectableItems, type SelItem, type Snapshot } from "../../../../lib/raidplan/multiSelect";
import { arrowOf, autoStyleOf, canFace, moveObject, nudgeObject, patchAutoStyle, removeObject, scaleArrow, scaleObject, turnIcon, updateZone, type ObjectKind, type Selection } from "../../../../lib/raidplan";

/**
 * The keyboard and the wheel on the board. On a focused object: the arrows
 * move it (Shift = bigger steps), + / - scale it, Alt + / - its facing wedge,
 * Q / E turn it, Delete removes it, Enter jumps to its properties. Anywhere
 * but in a text field: Ctrl+Z / Ctrl+Y, Ctrl+A / D / C / V, Escape, and the
 * arrows move a selection of several. Alt + wheel scales the selected object.
 */
export function useBoardKeys({ canWrite, noMap, boardNow, boardRef, bossKey, selected, setSelected, multi, auto, edit, history, clip, currentSel, chooseItems, withAuto, multiAction, centerOf, boardPx, doDelete, doDuplicate, doCopy, doPaste, focusProperties, onNoDelete }: {
    canWrite: boolean;
    noMap: boolean;
    boardNow: MutableRefObject<RaidplanBoard>;
    boardRef: RefObject<HTMLDivElement>;
    bossKey: string;
    selected: Selection;
    setSelected: (sel: Selection) => void;
    multi: SelItem[];
    auto: AutoPlan;
    edit: (fn: (b: RaidplanBoard) => RaidplanBoard, coalesce?: boolean) => void;
    history: { undo: () => void; redo: () => void };
    clip: MutableRefObject<{ snap: Snapshot; pastes: number } | null>;
    currentSel: () => SelItem[];
    chooseItems: (items: SelItem[]) => void;
    withAuto: (b: RaidplanBoard) => RaidplanBoard;
    multiAction: (fn: (b: RaidplanBoard, sel: SelItem[]) => RaidplanBoard, merge?: boolean) => void;
    centerOf: (b: RaidplanBoard, sel: SelItem[]) => { x: number; y: number };
    boardPx: () => { w: number; h: number };
    doDelete: () => void;
    doDuplicate: () => void;
    doCopy: () => void;
    doPaste: () => void;
    focusProperties: () => void;
    /** Delete on an object of the tank rows: it goes with its row, not on its own */
    onNoDelete: () => void;
}) {
    const onKey = (e: KeyboardEvent<HTMLElement>, kind: ObjectKind, id: string) => {
        if (!canWrite) return;
        const step = e.shiftKey ? 0.05 : 0.01;
        // Alt + "+" / "-": the facing wedge of the icon(s) bigger / smaller (the icon itself keeps its size)
        if (e.altKey && (e.key === "+" || e.key === "=" || e.key === "-")) {
            const f = e.key === "-" ? 1 / 1.15 : 1.15;
            e.preventDefault();
            if (multi.length > 1 && hasItem(multi, { kind, id })) multiAction((b, sel) => scaleArrowSelection(b, sel, f), true);
            else if (arrowOf(boardNow.current, kind, id)) edit((b) => scaleArrow(b, kind, id, f), true);
            return;
        }
        if (kind === "auto") {
            // an object of the tank rows: the arrows move it (its place is kept), it cannot be deleted on its own
            const dirs: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
            const o = auto.tanks.find((x) => x.key === id) || auto.mobs.find((x) => x.key === id);
            if (dirs[e.key] && o) { e.preventDefault(); edit((b) => moveObject(b, "auto", id, o.x + dirs[e.key][0], o.y + dirs[e.key][1]), true); }
            else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); onNoDelete(); }
            else if (e.key === "Enter") { setSelected({ kind, id }); focusProperties(); }
            else if (e.key === "+" || e.key === "=") { e.preventDefault(); edit((b) => scaleObject(b, "auto", id, 1.1), true); }
            else if (e.key === "-") { e.preventDefault(); edit((b) => scaleObject(b, "auto", id, 1 / 1.1), true); }
            else if ((e.key === "q" || e.key === "Q" || e.key === "e" || e.key === "E") && id.indexOf("m:") === 0) {
                // an auto mob turned by hand (Q / E): from where it faces now, its own facing from then on
                e.preventDefault();
                const now = autoStyleOf(boardNow.current, id);
                const dir = e.key === "q" || e.key === "Q" ? -1 : 1;
                edit((b) => patchAutoStyle(b, id, { rotation: (((now.rotation || 0) + dir * (e.shiftKey ? 45 : 15)) % 360 + 360) % 360, autoFace: false }), true);
            }
            return;
        }
        if (multi.length > 1 && hasItem(multi, { kind, id })) {
            const dirs: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
            if (dirs[e.key]) { e.preventDefault(); multiAction((b, sel) => moveSelection(b, sel, dirs[e.key][0], dirs[e.key][1], boardPx()), true); }
            else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); doDelete(); }
            else if (e.key === "+" || e.key === "=") { e.preventDefault(); multiAction((b, sel) => scaleSelection(b, sel, 1.1, centerOf(b, sel)), true); }
            else if (e.key === "-") { e.preventDefault(); multiAction((b, sel) => scaleSelection(b, sel, 1 / 1.1, centerOf(b, sel)), true); }
            return;
        }
        const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        if (moves[e.key]) {
            e.preventDefault();
            edit((b) => nudgeObject(b, kind, id, moves[e.key][0], moves[e.key][1]), true);
        } else if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            edit((b) => removeObject(b, kind, id));
            setSelected(null);
        } else if (e.key === "+" || e.key === "=") {
            e.preventDefault();
            edit((b) => scaleObject(b, kind, id, 1.1), true);
        } else if (e.key === "-") {
            e.preventDefault();
            edit((b) => scaleObject(b, kind, id, 1 / 1.1), true);
        } else if ((e.key === "q" || e.key === "Q" || e.key === "e" || e.key === "E") && kind === "zone") {
            // Q / E turn a role group like an icon
            const z = boardNow.current.zones.find((k) => k.id === id);
            if (z && z.type === "role") {
                e.preventDefault();
                const dir = e.key === "q" || e.key === "Q" ? -1 : 1;
                edit((b) => updateZone(b, id, { rotation: ((((z.rotation || 0) + dir * (e.shiftKey ? 45 : 15)) % 360) + 360) % 360 }), true);
            }
        } else if ((e.key === "q" || e.key === "Q" || e.key === "e" || e.key === "E") && kind === "icon") {
            const ic = boardNow.current.icons.find((k) => k.id === id);
            if (ic && canFace(ic.iconKey)) {
                e.preventDefault();
                const dir = e.key === "q" || e.key === "Q" ? -1 : 1;
                edit((b) => turnIcon(b, id, dir * (e.shiftKey ? 45 : 15)), true);
            }
        } else if (e.key === "Enter") {
            setSelected({ kind, id });
            focusProperties();
        }
    };

    // Ctrl+Z / Ctrl+Y anywhere but in a text field; Delete removes the selection when nothing else has the focus
    useEffect(() => {
        const onWindowKey = (e: globalThis.KeyboardEvent) => {
            const tag = (e.target as HTMLElement).tagName;
            if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target as HTMLElement).isContentEditable) return;
            const mod = e.ctrlKey || e.metaKey;
            if (canWrite && mod && e.key.toLowerCase() === "a" && !e.shiftKey && !noMap) { e.preventDefault(); chooseItems(selectableItems(withAuto(boardNow.current))); }
            else if (canWrite && mod && e.key.toLowerCase() === "d") { e.preventDefault(); doDuplicate(); }
            else if (canWrite && mod && e.key.toLowerCase() === "c") { if (currentSel().length > 0) { e.preventDefault(); doCopy(); } }
            else if (canWrite && mod && e.key.toLowerCase() === "v") { if (clip.current) { e.preventDefault(); doPaste(); } }
            else if (e.key === "Escape" && (multi.length > 0 || selected) && !document.querySelector("dialog[open]")) { chooseItems([]); }
            else if (canWrite && multi.length > 1 && !e.defaultPrevented && !document.querySelector("dialog[open]") && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
                // the whole selection by one step, also when no object has the focus
                const st = e.shiftKey ? 0.05 : 0.01;
                const dirs: Record<string, [number, number]> = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] };
                e.preventDefault();
                multiAction((b, sel) => moveSelection(b, sel, dirs[e.key][0], dirs[e.key][1], boardPx()), true);
            }
            else if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); history.undo(); }
            else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); history.redo(); }
        };
        window.addEventListener("keydown", onWindowKey);
        return () => window.removeEventListener("keydown", onWindowKey);
    });

    // Alt + mouse wheel scales the selected object (a native listener: a wheel handler of React's is passive and could not stop the page from scrolling)
    const selectedNow = useRef<Selection>(null);
    selectedNow.current = selected;
    useEffect(() => {
        const el = boardRef.current;
        if (!el || !canWrite) return undefined;
        const onWheel = (e: WheelEvent) => {
            const sel = selectedNow.current;
            if (!e.altKey || !sel) return;
            e.preventDefault();
            edit((b) => scaleObject(b, sel.kind, sel.id, e.deltaY < 0 ? 1.08 : 1 / 1.08), true);
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, [canWrite, edit, bossKey]); // eslint-disable-line react-hooks/exhaustive-deps

    return { onKey };
}
