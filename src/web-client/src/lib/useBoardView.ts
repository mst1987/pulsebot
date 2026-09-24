import { useCallback, useEffect, useRef, useState } from "react";
import { FIT, panBy, pinchView, stepZoom, wheelZoom, zoomAt, type BoardView } from "./boardView";

/**
 * Zoom and pan of a board, as a view setting. Bind `frame` to the board's frame element (PlanBoard's `frameRef`). Ctrl / Cmd + wheel (which is also
 * what a trackpad pinch sends) zooms towards the pointer, a plain wheel keeps scrolling the page; the picture is moved with the middle mouse button,
 * with space held down and dragging, with the hand tool (`hand`), or with two fingers; two fingers also pinch. The listeners are native and in the
 * capture phase, so a pan or a pinch never starts a drag of an object underneath. The maths is lib/boardView.ts (tested).
 */
export function useBoardView(): {
    view: BoardView;
    zoomIn: () => void;
    zoomOut: () => void;
    fit: () => void;
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
    const space = useRef(false);

    const frame = useCallback((node: HTMLDivElement | null) => setEl(node), []);
    const fit = useCallback(() => setView(FIT), []);
    const zoomIn = useCallback(() => setView((v) => zoomAt(v, stepZoom(v.z, 1), 0.5, 0.5)), []);
    const zoomOut = useCallback(() => setView((v) => zoomAt(v, stepZoom(v.z, -1), 0.5, 0.5)), []);

    // space = the hand while it is held (not while typing)
    useEffect(() => {
        const typing = (t: EventTarget | null) => { const x = t as HTMLElement | null; return !!x && (x.tagName === "INPUT" || x.tagName === "TEXTAREA" || x.tagName === "SELECT" || x.isContentEditable); };
        const down = (e: KeyboardEvent) => { if (e.code === "Space" && !typing(e.target) && el && el.matches(":hover")) { space.current = true; e.preventDefault(); } };
        const up = (e: KeyboardEvent) => { if (e.code === "Space") space.current = false; };
        window.addEventListener("keydown", down);
        window.addEventListener("keyup", up);
        return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
    }, [el]);

    useEffect(() => {
        if (!el) return undefined;
        const rect = () => el.getBoundingClientRect();
        const onWheel = (e: WheelEvent) => {
            if (!(e.ctrlKey || e.metaKey)) return;
            e.preventDefault();
            const r = rect();
            setView((v) => zoomAt(v, wheelZoom(v.z, e.deltaY), (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height));
        };
        const touches = new Map<number, { x: number; y: number }>();
        let drag: { x: number; y: number } | null = null;
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
                drag = { x: e.clientX, y: e.clientY };
                setView((v) => panBy(v, dx, dy));
            }
        };
        const end = (e: PointerEvent) => {
            touches.delete(e.pointerId);
            if (touches.size < 2) pinch = null;
            if (touches.size === 0 && drag) { drag = null; setPanning(false); }
            if (touches.size === 0) { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end); }
        };
        const track = () => { window.addEventListener("pointermove", move); window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end); };
        const onDown = (e: PointerEvent) => {
            if (e.pointerType === "touch") {
                touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
                track();
                if (touches.size === 2) { e.stopPropagation(); e.preventDefault(); pinch = centre(); drag = null; }
                return;
            }
            const grab = e.button === 1 || (e.button === 0 && (space.current || handRef.current));
            if (!grab) return;
            e.stopPropagation();
            e.preventDefault();
            drag = { x: e.clientX, y: e.clientY };
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

    return { view, zoomIn, zoomOut, fit, hand, setHand, panning, frame };
}
