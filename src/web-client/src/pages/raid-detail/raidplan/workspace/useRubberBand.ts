import { useEffect, useRef, useState, type MutableRefObject, type PointerEvent } from "react";
import type { RaidplanBoard } from "../../../../api";
import { addItems, bandBox, hitObjects, scaleSelection, type Box, type SelItem } from "../../../../lib/multiSelect";
import type { ObjectKind, Selection } from "../../../../lib/raidplan";
import { LONG_PRESS_MS, type BoardPoint } from "./types";

/**
 * The pointer on the board's empty ground: a rubber band selects what it
 * touches (Ctrl / Shift adds to the selection; a finger needs the selection
 * mode), a plain press lets the selection go, and a long press on touch is the
 * right click — on empty ground it arms the band, released without moving it
 * opens the board's menu.
 */
export function useRubberBand({ canWrite, noMap, selectMode, boardNow, toBoard, boardPx, withAuto, currentSel, chooseItems, openMenu, cancelDrag }: {
    canWrite: boolean;
    noMap: boolean;
    selectMode: boolean;
    boardNow: MutableRefObject<RaidplanBoard>;
    toBoard: (x: number, y: number) => BoardPoint | null;
    boardPx: () => { w: number; h: number };
    withAuto: (b: RaidplanBoard) => RaidplanBoard;
    currentSel: () => SelItem[];
    chooseItems: (items: SelItem[]) => void;
    openMenu: (x: number, y: number, target: Selection | "board") => void;
    /** a long press ends the drag its pointer down began */
    cancelDrag: () => void;
}) {
    const [band, setBand] = useState<Box | null>(null);
    const [banding, setBanding] = useState(false);
    // a long press on empty ground with a finger arms the rubber band; released without moving it opens the menu
    const menuTapRef = useRef<{ x: number; y: number } | null>(null);
    const bandRef = useRef<{ x0: number; y0: number; add: boolean; base: SelItem[]; moved: boolean; cx: number; cy: number }>({ x0: 0, y0: 0, add: false, base: [], moved: false, cx: 0, cy: 0 });
    const pressRef = useRef<{ timer: number; x: number; y: number } | null>(null);

    // the rubber band: Pointer Events on window, the hits are what it touches
    useEffect(() => {
        if (!banding) return undefined;
        const move = (e: globalThis.PointerEvent) => {
            const b = bandRef.current;
            const p = toBoard(e.clientX, e.clientY);
            if (!p) return;
            if (!b.moved && Math.abs(e.clientX - b.cx) + Math.abs(e.clientY - b.cy) < 5) return;
            b.moved = true;
            setBand(bandBox(b.x0, b.y0, Math.max(0, Math.min(1, p.x)), Math.max(0, Math.min(1, p.y))));
        };
        const up = (e: globalThis.PointerEvent) => {
            const b = bandRef.current;
            setBanding(false);
            setBand(null);
            const tap = menuTapRef.current;
            menuTapRef.current = null;
            if (!b.moved) { if (tap) openMenu(tap.x, tap.y, "board"); return; }
            const p = toBoard(e.clientX, e.clientY);
            if (!p) return;
            const box = bandBox(b.x0, b.y0, Math.max(0, Math.min(1, p.x)), Math.max(0, Math.min(1, p.y)));
            const hits = hitObjects(withAuto(boardNow.current), box, boardPx());
            chooseItems(b.add ? addItems(b.base, hits) : hits);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [banding]);

    const boardWrapDown = (e: PointerEvent<HTMLDivElement>) => {
        const el = e.target as HTMLElement;
        const onObject = !!el.closest(".rp-token, .rp-zone, .rp-text, .rp-line-hit, .rp-handle, .rp-multibox");
        const add = e.ctrlKey || e.metaKey || e.shiftKey;
        // a rubber band from empty ground (a finger needs the selection mode; long press stays the context menu)
        if (!onObject && canWrite && e.button === 0 && !noMap && (e.pointerType !== "touch" || selectMode)) {
            const p = toBoard(e.clientX, e.clientY);
            if (p && p.inside) {
                bandRef.current = { x0: p.x, y0: p.y, add, base: add ? currentSel() : [], moved: false, cx: e.clientX, cy: e.clientY };
                setBanding(true);
            }
        }
        if (!onObject && !add) chooseItems([]);
        // long press = right click on touch
        if (e.pointerType === "touch" && canWrite) {
            const x = e.clientX;
            const y = e.clientY;
            const holder = el.closest("[data-obj]");
            const raw = holder ? holder.getAttribute("data-obj") || "" : "";
            const at = raw.indexOf(":");
            const target: Selection = at > 0 ? { kind: raw.slice(0, at) as ObjectKind, id: raw.slice(at + 1) } : null;
            if (pressRef.current) window.clearTimeout(pressRef.current.timer);
            pressRef.current = {
                x, y,
                timer: window.setTimeout(() => {
                    pressRef.current = null;
                    cancelDrag();
                    const p = !target && canWrite && !noMap ? toBoard(x, y) : null;
                    if (p && p.inside) {
                        bandRef.current = { x0: p.x, y0: p.y, add: false, base: [], moved: false, cx: x, cy: y };
                        menuTapRef.current = { x, y };
                        setBanding(true);
                        return;
                    }
                    openMenu(x, y, target || "board");
                }, LONG_PRESS_MS),
            };
        }
    };
    const boardWrapMove = (e: PointerEvent<HTMLDivElement>) => {
        const pr = pressRef.current;
        if (pr && Math.abs(e.clientX - pr.x) + Math.abs(e.clientY - pr.y) > 10) { window.clearTimeout(pr.timer); pressRef.current = null; }
    };
    const boardWrapEnd = () => {
        if (pressRef.current) { window.clearTimeout(pressRef.current.timer); pressRef.current = null; }
    };

    return { band, boardWrapDown, boardWrapMove, boardWrapEnd };
}

/**
 * A corner grip of the shared frame: scales the whole selection around the
 * frame's middle (the pointer's distance from it decides), one undo step.
 */
export function useSelectionScale({ multi, boardEl, boardNow, withAuto, noAuto, centerOf, edit }: {
    multi: SelItem[];
    boardEl: () => HTMLElement | null;
    boardNow: MutableRefObject<RaidplanBoard>;
    withAuto: (b: RaidplanBoard) => RaidplanBoard;
    noAuto: (b: RaidplanBoard) => RaidplanBoard;
    centerOf: (b: RaidplanBoard, sel: SelItem[]) => { x: number; y: number };
    edit: (fn: (b: RaidplanBoard) => RaidplanBoard, coalesce?: boolean) => void;
}) {
    const [scaling, setScaling] = useState(false);
    const scaleRef = useRef<{ board0: RaidplanBoard; sel: SelItem[]; center: { x: number; y: number }; d0: number; cx: number; cy: number }>({ board0: null as unknown as RaidplanBoard, sel: [], center: { x: 0, y: 0 }, d0: 1, cx: 0, cy: 0 });
    const startScale = (e: PointerEvent<HTMLElement>) => {
        if (e.button !== 0 || multi.length < 2) return;
        e.preventDefault();
        const el = boardEl();
        const rect = el ? el.getBoundingClientRect() : null;
        if (!rect) return;
        const c = centerOf(boardNow.current, multi);
        const cx = rect.left + c.x * rect.width;
        const cy = rect.top + c.y * rect.height;
        scaleRef.current = { board0: withAuto(boardNow.current), sel: multi, center: c, d0: Math.max(8, Math.hypot(e.clientX - cx, e.clientY - cy)), cx, cy };
        setScaling(true);
    };
    useEffect(() => {
        if (!scaling) return undefined;
        const move = (e: globalThis.PointerEvent) => {
            const s = scaleRef.current;
            const f = Math.max(0.1, Math.min(8, Math.hypot(e.clientX - s.cx, e.clientY - s.cy) / s.d0));
            edit(() => noAuto(scaleSelection(s.board0, s.sel, f, s.center)), true);
        };
        const up = () => setScaling(false);
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scaling]);
    return { startScale };
}
