import { useCallback, useEffect, useRef, useState } from "react";
import { FIT, MAX_Z, centerOn, centerOf, panBy, pinchView, stepZoom, wheelZoom, zoomAt, type BoardView } from "./boardView";
import { REF_W } from "./boardScale";

/** What counts as an object of the board: a press on one of these never pans. */
const OBJECTS = ".rp-token, .rp-zone, .rp-text, .rp-line-hit, .rp-handle, .rp-multibox, .rp-multi-edge";

/**
 * Zoom and pan of a board, as a view setting. Bind `frame` to the board's frame element (PlanBoard's `frameRef`).
 * Zoom: Ctrl / Cmd + wheel (also a trackpad pinch) towards the pointer, the buttons, two fingers.
 * Pan (when zoomed in): drag on empty ground (Shift + drag keeps the rubber band), Space + drag, the middle mouse button, the hand tool, a plain wheel or a
 * trackpad two-finger scroll while the picture can still move that way (at the edge the page gets the wheel again), the arrow keys when `arrows`,
 * one finger on empty ground when `touchPan`. The listeners are native, in the capture phase: a pan never starts a drag of an object underneath.
 * The maths is lib/boardView.ts (tested).
 */
export function useBoardView(opts: { touchPan?: boolean; arrows?: boolean; onEmptyClick?: () => void } = {}): {
    view: BoardView;
    zoomIn: () => void;
    zoomOut: () => void;
    fit: () => void;
    actual: () => void;
    set: (v: BoardView) => void;
    centerAt: (cx: number, cy: number) => void;
    hand: boolean;
    setHand: (on: boolean) => void;
    panning: boolean;
    frame: (el: HTMLDivElement | null) => void;
} {
    const [view, setView] = useState<BoardView>(FIT);
    const [hand, setHand] = useState(false);
    const [panning, setPanning] = useState(false);
    const [el, setEl] = useState<HTMLDivElement | null>(null);
    const viewRef = useRef(view);
    viewRef.current = view;
    const handRef = useRef(hand);
    handRef.current = hand;
    const optsRef = useRef(opts);
    optsRef.current = opts;
    const space = useRef(false);

    const frame = useCallback((node: HTMLDivElement | null) => setEl(node), []);
    const fit = useCallback(() => setView(FIT), []);
    const set = useCallback((v: BoardView) => setView(v), []);
    const zoomIn = useCallback(() => setView((v) => zoomAt(v, stepZoom(v.z, 1), 0.5, 0.5)), []);
    const zoomOut = useCallback(() => setView((v) => zoomAt(v, stepZoom(v.z, -1), 0.5, 0.5)), []);
    // "100 %": one board unit = one screen pixel (the picture at its reference size), about the middle of what is shown
    const actual = useCallback(() => {
        if (!el) return;
        const z = Math.min(MAX_Z, Math.max(0.5, REF_W / Math.max(1, el.clientWidth)));
        setView((v) => { const c = centerOf(v); return centerOn(z, c.cx, c.cy); });
    }, [el]);
    const centerAt = useCallback((cx: number, cy: number) => setView((v) => centerOn(v.z, cx, cy)), []);

    // space = the hand while it is held; the arrow keys move a zoomed picture (only over the board, only when nothing is selected)
    useEffect(() => {
        const typing = (t: EventTarget | null) => { const x = t as HTMLElement | null; return !!x && (x.tagName === "INPUT" || x.tagName === "TEXTAREA" || x.tagName === "SELECT" || x.isContentEditable); };
        const down = (e: KeyboardEvent) => {
            if (typing(e.target) || !el || !el.matches(":hover")) return;
            if (e.code === "Space") { space.current = true; e.preventDefault(); return; }
            const step = e.shiftKey ? 0.25 : 0.08;
            const d = e.key === "ArrowLeft" ? [step, 0] : e.key === "ArrowRight" ? [-step, 0] : e.key === "ArrowUp" ? [0, step] : e.key === "ArrowDown" ? [0, -step] : null;
            if (d && optsRef.current.arrows && viewRef.current.z > 1 && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                setView((v) => panBy(v, d[0], d[1]));
            }
        };
        const up = (e: KeyboardEvent) => { if (e.code === "Space") space.current = false; };
        window.addEventListener("keydown", down);
        window.addEventListener("keyup", up);
        return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
    }, [el]);

    useEffect(() => {
        if (!el) return undefined;
        const rect = () => el.getBoundingClientRect();
        const onWheel = (e: WheelEvent) => {
            const r = rect();
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                setView((v) => zoomAt(v, wheelZoom(v.z, e.deltaY), (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height));
                return;
            }
            // zoomed in, a plain wheel / a two-finger scroll moves the picture while it can still move that way; at the edge the page scrolls again
            const v = viewRef.current;
            if (v.z <= 1) return;
            const scale = e.deltaMode === 1 ? 16 : 1;
            const next = panBy(v, (-e.deltaX * scale) / r.width, (-e.deltaY * scale) / r.height);
            if (next.ox !== v.ox || next.oy !== v.oy) {
                e.preventDefault();
                setView(next);
            }
        };
        const touches = new Map<number, { x: number; y: number }>();
        let drag: { x: number; y: number } | null = null;
        let emptyGrab = false;
        let travel = 0;
        let pinch: { d: number; cx: number; cy: number } | null = null;
        const centre = () => {
            const p = Array.from(touches.values());
            const r = rect();
            return { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) / r.width, cx: ((p[0].x + p[1].x) / 2 - r.left) / r.width, cy: ((p[0].y + p[1].y) / 2 - r.top) / r.height };
        };
        const move = (e: PointerEvent) => {
            if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pinch && touches.size >= 2) {
                const now = centre();
                const from = pinch;
                pinch = now;
                setView((v) => pinchView(v, from.d, from.cx, from.cy, now.d, now.cx, now.cy));
            } else if (drag && !pinch) {
                const r = rect();
                const dx = (e.clientX - drag.x) / r.width;
                const dy = (e.clientY - drag.y) / r.height;
                travel += Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y);
                drag = { x: e.clientX, y: e.clientY };
                setView((v) => panBy(v, dx, dy));
            }
        };
        const end = (e: PointerEvent) => {
            touches.delete(e.pointerId);
            if (touches.size < 2) pinch = null;
            if (touches.size === 0 && drag) {
                drag = null;
                setPanning(false);
                // a press on empty ground that did not move is a click there: it clears the selection like it does at 100 %
                if (emptyGrab && travel < 4 && optsRef.current.onEmptyClick) optsRef.current.onEmptyClick();
            }
            if (touches.size === 0) { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end); }
        };
        const track = () => { window.addEventListener("pointermove", move); window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end); };
        const onDown = (e: PointerEvent) => {
            const onObject = !!(e.target as HTMLElement).closest(OBJECTS);
            const zoomed = viewRef.current.z > 1;
            if (e.pointerType === "touch") {
                touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
                track();
                if (touches.size === 2) { e.stopPropagation(); e.preventDefault(); pinch = centre(); drag = null; setPanning(false); }
                else if (touches.size === 1 && zoomed && !onObject && optsRef.current.touchPan) { drag = { x: e.clientX, y: e.clientY }; setPanning(true); }
                return;
            }
            // the hand, Space and the middle button always pan; zoomed in, so does a plain drag on empty ground (Shift keeps the rubber band)
            const grab = e.button === 1 || (e.button === 0 && (space.current || handRef.current || (zoomed && !onObject && !e.shiftKey)));
            if (!grab) return;
            e.stopPropagation();
            e.preventDefault();
            drag = { x: e.clientX, y: e.clientY };
            emptyGrab = e.button === 0 && !space.current && !handRef.current;
            travel = 0;
            touches.clear();
            setPanning(true);
            track();
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        el.addEventListener("pointerdown", onDown, true);
        return () => {
            el.removeEventListener("wheel", onWheel);
            el.removeEventListener("pointerdown", onDown, true);
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
        };
    }, [el]);

    return { view, zoomIn, zoomOut, fit, actual, set, centerAt, hand, setHand, panning, frame };
}
