import { useEffect, useRef, useState, type MutableRefObject, type PointerEvent } from "react";
import type { RaidplanBoard } from "../../../../api";
import type { Handle } from "../../../../components/raidplan/PlanBoard";
import { hasItem, moveSelection, toggleItem, type SelItem } from "../../../../lib/multiSelect";
import {
    angleTo, assignSlot, dropChip, isLocked, moveLine, moveLineEnd, moveObject, moveRect, patchAutoStyle, placeToken, removeToken, resizeRect, resizeTurned, setObjectSize,
    sizeOf, snapAngle, updateIcon, updateLine, updateZone, type InsertSpec, type ObjectKind, type Rect, type Selection, type ZoneGrip,
} from "../../../../lib/raidplan";
import type { BoardPoint, Drag } from "./types";

/**
 * Dragging with Pointer Events on window (no HTML5 drag and drop, so a finger
 * works like a mouse): palette entries and listed players onto the board or a
 * slot, objects around the board, a zone's corners and a line's ends to scale
 * them, and the whole selection by one of its objects or the shared frame.
 * Every step of one drag is the same undo step.
 */
export function useBoardDrag({ board, boardNow, edit, canWrite, multi, selectMode, currentSel, chooseItems, setSelected, setMulti, toBoard, boardPx, withAuto, noAuto, insert }: {
    board: RaidplanBoard;
    boardNow: MutableRefObject<RaidplanBoard>;
    edit: (fn: (b: RaidplanBoard) => RaidplanBoard, coalesce?: boolean) => void;
    canWrite: boolean;
    multi: SelItem[];
    selectMode: boolean;
    currentSel: () => SelItem[];
    chooseItems: (items: SelItem[]) => void;
    setSelected: (sel: Selection) => void;
    setMulti: (items: SelItem[]) => void;
    toBoard: (x: number, y: number) => BoardPoint | null;
    boardPx: () => { w: number; h: number };
    withAuto: (b: RaidplanBoard) => RaidplanBoard;
    noAuto: (b: RaidplanBoard) => RaidplanBoard;
    /** puts a palette entry on the board (at a point, or where it goes by itself) */
    insert: (spec: InsertSpec, at: { x: number; y: number } | null) => void;
}) {
    const [drag, setDrag] = useState<Drag | null>(null);
    const dragRef = useRef<Drag | null>(null);

    const dragging = drag !== null;
    useEffect(() => {
        if (!dragging) return undefined;
        const move = (e: globalThis.PointerEvent) => {
            const d = dragRef.current;
            if (!d) return;
            const el = document.elementFromPoint(e.clientX, e.clientY);
            const moved = d.moved || Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) > 5;
            const next = { ...d, x: e.clientX, y: e.clientY, moved, overTray: !!(el && el.closest("[data-rp-tray]")) };
            dragRef.current = next;
            setDrag(next);
            if (d.kind === "tray" || d.kind === "palette" || !moved) return;
            const p = toBoard(e.clientX, e.clientY);
            if (!p) return;
            if (d.multi && d.p0) {
                const m = d.multi;
                edit(() => noAuto(moveSelection(m.board0, m.sel, p.x - d.p0!.x, p.y - d.p0!.y, boardPx())), true);
            } else if (d.handle === "rot" && d.center && d.kind === "zone") {
                // a role group turned by its grip (Shift = 15 degree steps)
                const a = angleTo(d.center.x, d.center.y, e.clientX, e.clientY);
                edit((b) => updateZone(b, d.id, { rotation: e.shiftKey ? snapAngle(a, 15) : a }), true);
            } else if (d.handle === "rot" && d.center && d.kind === "auto") {
                // an auto mob turned by hand: its facing is its own from now on
                const a = angleTo(d.center.x, d.center.y, e.clientX, e.clientY);
                edit((b) => patchAutoStyle(b, d.id, { rotation: e.shiftKey ? snapAngle(a, 15) : a, autoFace: false }), true);
            } else if (d.handle === "rot" && d.center) {
                const a = angleTo(d.center.x, d.center.y, e.clientX, e.clientY);
                edit((b) => updateIcon(b, d.id, { rotation: e.shiftKey ? snapAngle(a, 15) : a, autoFace: false }), true);
            } else if (d.handle === "size" && d.size0 && d.center && d.d0) {
                const dist = Math.hypot(e.clientX - d.center.x, e.clientY - d.center.y);
                const next2 = d.size0 * (dist / d.d0);
                edit((b) => setObjectSize(b, d.kind as ObjectKind, d.id, next2), true);
            } else if (d.kind === "zone" && d.rect0 && d.p0) {
                const dx = p.x - d.p0.x;
                let dy = p.y - d.p0.y;
                if (d.keepRatio && d.handle && d.handle.length === 2) {
                    // proportions kept: the height follows the width
                    const ratio = d.rect0.h / d.rect0.w;
                    dy = (d.handle === "nw" || d.handle === "se" ? 1 : -1) * dx * ratio;
                }
                // a turned role group: its grips work along its own axes, the opposite side stays where it is (lib/raidplan.ts resizeTurned)
                const turned = d.handle ? (board.zones.find((z) => z.id === d.id) || { rotation: 0 }).rotation || 0 : 0;
                const bp = boardPx();
                const r = d.handle ? (turned ? resizeTurned(d.rect0, d.handle as ZoneGrip, dx * bp.w, dy * bp.h, turned, bp.w, bp.h) : resizeRect(d.rect0, d.handle as ZoneGrip, dx, dy)) : moveRect(d.rect0, dx, dy);
                edit((b) => updateZone(b, d.id, r), true);
            } else if (d.kind === "line" && d.line0 && d.p0) {
                if (d.handle === "end1" || d.handle === "end2") edit((b) => moveLineEnd(b, d.id, d.handle === "end1" ? 1 : 2, p.x, p.y), true);
                else edit((b) => updateLine(b, d.id, moveLine(d.line0!, p.x - d.p0!.x, p.y - d.p0!.y)), true);
            } else {
                // the object follows the pointer live, keeping the grip it was taken with
                const bx = p.x + d.ox / p.w;
                const by = p.y + d.oy / p.h;
                edit((b) => moveObject(b, d.kind as ObjectKind, d.id, bx, by), true);
            }
        };
        const up = (e: globalThis.PointerEvent) => {
            const d = dragRef.current;
            dragRef.current = null;
            setDrag(null);
            if (!d) return;
            const el = document.elementFromPoint(e.clientX, e.clientY);
            const overTray = !!(el && el.closest("[data-rp-tray]"));
            const slotEl = el ? el.closest("[data-slot]") : null;
            const slotId = slotEl ? slotEl.getAttribute("data-slot") || "" : "";
            const p = toBoard(e.clientX, e.clientY);
            const slotOk = (b: RaidplanBoard) => b.slots.some((s) => s.id === slotId && s.kind !== "group");
            if (d.kind === "palette" && d.spec && d.spec.type === "place" && d.chip) {
                // a chip of the Besetzung: no move = a click (it opens its picker), else the drop decides
                if (!d.moved) return;
                const target = p && p.inside ? "map" : el && el.closest("[data-rp-bes]") ? "bar" : "none";
                const sid = d.spec.slotId;
                if (target !== "none") edit((b) => dropChip(b, sid, target, p && p.inside ? { x: p.x, y: p.y } : null));
                if (target === "map") setSelected({ kind: "slot", id: sid });
            } else if (d.kind === "palette" && d.spec) {
                if (!d.moved) insert(d.spec, null);
                else if (p && p.inside) insert(d.spec, { x: p.x, y: p.y });
            } else if (d.kind === "tray") {
                if (slotId) edit((b) => (slotOk(b) ? assignSlot(b, slotId, d.id) : (p && p.inside ? placeToken(b, d.id, p.x, p.y) : b)));
                else if (p && p.inside) edit((b) => placeToken(b, d.id, p.x, p.y));
            } else if (d.kind === "token") {
                if (overTray) edit((b) => removeToken(b, d.id));
                else if (slotId) edit((b) => (slotOk(b) ? assignSlot(b, slotId, d.id) : b));
            } else if (d.kind === "slot" && overTray) {
                // a slot dragged onto the list gives up its player; the slot itself goes back where it was
                edit((b) => assignSlot(d.origin ? moveObject(b, "slot", d.id, d.origin.x, d.origin.y) : b, d.id, ""));
            }
        };
        // Esc gives up a drag of the palette, a chip or a listed player: nothing happens
        const esc = (e: globalThis.KeyboardEvent) => {
            const d = dragRef.current;
            if (e.key !== "Escape" || !d || (d.kind !== "palette" && d.kind !== "tray")) return;
            e.preventDefault();
            dragRef.current = null;
            setDrag(null);
        };
        window.addEventListener("keydown", esc);
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
        return () => {
            window.removeEventListener("keydown", esc);
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", up);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dragging, edit]);

    const startDrag = (e: PointerEvent<HTMLElement | SVGElement>, kind: ObjectKind | "tray", id: string, handle?: Handle) => {
        if (!canWrite || e.button !== 0) return;
        e.preventDefault();
        const target = e.currentTarget as HTMLElement;
        const startsMulti = kind !== "tray" && kind !== "member" && !handle && multi.length > 1 && hasItem(multi, { kind, id });
        // Ctrl / Cmd / Shift + click (or the selection mode) adds the object to the selection or takes it out again: no drag
        if (kind !== "tray" && kind !== "member" && !handle && (e.ctrlKey || e.metaKey || e.shiftKey || selectMode)) {
            chooseItems(toggleItem(currentSel(), { kind, id }));
            if (target.focus) target.focus();
            return;
        }
        // preventDefault keeps the browser from focusing the button: do it by hand, or Delete / arrows would go nowhere
        if (kind !== "tray" && !startsMulti) { setMulti([]); setSelected({ kind, id }); if (target.focus) target.focus(); }
        if (startsMulti && target.focus) target.focus();
        // a locked object is selected but does not move
        if (kind !== "tray" && isLocked(board, kind, id)) return;
        let ox = 0;
        let oy = 0;
        let rect0: Rect | undefined;
        let line0: Drag["line0"];
        let p0: { x: number; y: number } | undefined;
        const p = toBoard(e.clientX, e.clientY);
        if (p) p0 = { x: p.x, y: p.y };
        if (kind === "zone") {
            const z = board.zones.find((k) => k.id === id);
            if (z) rect0 = { x: z.x, y: z.y, w: z.w, h: z.h };
        } else if (kind === "line") {
            const l = board.lines.find((k) => k.id === id);
            if (l) line0 = { id, x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 };
        } else if (kind !== "tray") {
            const r = target.getBoundingClientRect();
            ox = r.left + r.width / 2 - e.clientX;
            oy = r.top + r.height / 2 - e.clientY;
        }
        let size0: number | undefined;
        let center: { x: number; y: number } | undefined;
        let d0: number | undefined;
        if (handle === "size" || handle === "rot") {
            const wrap = target.closest(".rp-token, .rp-text, .rp-zone");
            const cr = wrap ? wrap.getBoundingClientRect() : null;
            const cur = sizeOf(board, kind as ObjectKind, id);
            // turning needs only the middle: a zone has no size of its own (sizeOf is null), and without a middle the grip MOVED the
            // role group instead of turning it (#raidplan-16)
            if (cr && (cur || handle === "rot")) {
                size0 = cur || undefined;
                center = { x: cr.left + cr.width / 2, y: cr.top + cr.height / 2 };
                d0 = Math.max(8, Math.hypot(e.clientX - center.x, e.clientY - center.y));
            }
        }
        const origin = kind === "slot" ? { x: (board.slots.find((s) => s.id === id) || { x: 0 }).x, y: (board.slots.find((s) => s.id === id) || { y: 0 }).y } : undefined;
        const d: Drag = { kind, id, handle, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false, ox, oy, rect0, line0, p0, origin, size0, center, d0, keepRatio: e.shiftKey, overTray: false, multi: startsMulti ? { board0: withAuto(boardNow.current), sel: multi } : undefined };
        dragRef.current = d;
        setDrag(d);
    };

    const startPalette = (e: PointerEvent<HTMLElement>, spec: InsertSpec, chip = false) => {
        if (!canWrite || e.button !== 0) return;
        e.preventDefault();
        const d: Drag = { kind: "palette", id: "", spec, chip, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false, ox: 0, oy: 0, overTray: false };
        dragRef.current = d;
        setDrag(d);
    };

    /** The edge of the shared frame: drags the whole selection like any object of it. */
    const startFrameDrag = (e: PointerEvent<HTMLElement>) => {
        if (e.button !== 0 || multi.length < 2 || !canWrite) return;
        e.preventDefault();
        const p = toBoard(e.clientX, e.clientY);
        if (!p) return;
        const d: Drag = { kind: "zone", id: "", x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false, ox: 0, oy: 0, p0: { x: p.x, y: p.y }, overTray: false, multi: { board0: withAuto(boardNow.current), sel: multi } };
        dragRef.current = d;
        setDrag(d);
    };

    /** A long press took over: the drag it began is no drag. */
    const cancelDrag = () => {
        dragRef.current = null;
        setDrag(null);
    };

    return { drag, startDrag, startPalette, startFrameDrag, cancelDrag };
}
