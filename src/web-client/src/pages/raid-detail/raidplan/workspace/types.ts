// What the pieces of the working area (BoardWorkspace.tsx and its hooks in this
// folder) share: the drag in flight, the open context menu and where a pointer
// is on the board.
import type { RaidplanBoard } from "../../../../api";
import type { Handle } from "../../../../components/raidplan/PlanBoard";
import type { AutoPlan } from "../../../../lib/raidplan/autoPlace";
import type { SelItem } from "../../../../lib/raidplan/multiSelect";
import type { InsertSpec, ObjectKind, Rect, Selection } from "../../../../lib/raidplan";

/** Nothing the tank rows put on the map (no map, "Allgemein", the Standard). */
export const NO_AUTO: AutoPlan = { mobs: [], tanks: [], users: [] };

export type Drag = {
    kind: ObjectKind | "tray" | "palette";
    id: string;
    spec?: InsertSpec;
    /** a chip of the Besetzung is dragged (a click on it must stay a click; the drop does the work) */
    chip?: boolean;
    handle?: Handle;
    /** pointer, in client px (the ghost of a list chip follows it) */
    x: number;
    y: number;
    /** where the pointer went down (a palette entry that never moved is a click) */
    x0: number;
    y0: number;
    moved: boolean;
    /** grip offset, px: the token does not jump under the pointer */
    ox: number;
    oy: number;
    /** where a zone / line and the pointer were when the drag began */
    rect0?: Rect;
    line0?: { id: string; x1: number; y1: number; x2: number; y2: number };
    p0?: { x: number; y: number };
    /** where a slot stood when it was picked up: it goes back there when it is dropped on the list */
    origin?: { x: number; y: number };
    /** scaling by the grip: the size it had, the object's centre on screen and how far the pointer was from it */
    size0?: number;
    center?: { x: number; y: number };
    d0?: number;
    /** Shift was held: a zone keeps its proportions */
    keepRatio?: boolean;
    /** the whole selection is dragged: the board as it was and who moves */
    multi?: { board0: RaidplanBoard; sel: SelItem[] };
    overTray: boolean;
};

export type Menu = { x: number; y: number; target: Selection | "board"; at: { x: number; y: number } | null };

export const LONG_PRESS_MS = 550;

/** A pointer on the board: relative (0..1), the board's px size, and whether it is on the visible part of the picture. */
export type BoardPoint = { x: number; y: number; w: number; h: number; inside: boolean };

/** Where a client point lies on the board's canvas; null while the board has no size. */
export function toBoardPoint(board: HTMLElement | null, frame: HTMLElement | null, x: number, y: number): BoardPoint | null {
    const rect = board ? board.getBoundingClientRect() : null;
    if (!rect || !rect.width || !rect.height) return null;
    // "inside" = on the visible part of the picture (zoomed in, the canvas reaches beyond its frame)
    const fr = frame ? frame.getBoundingClientRect() : rect;
    return { x: (x - rect.left) / rect.width, y: (y - rect.top) / rect.height, w: rect.width, h: rect.height, inside: x >= Math.max(rect.left, fr.left) && x <= Math.min(rect.right, fr.right) && y >= Math.max(rect.top, fr.top) && y <= Math.min(rect.bottom, fr.bottom) };
}

/** The board's size in px (for the boxes of text and group markers). */
export function boardPxOf(board: HTMLElement | null): { w: number; h: number } {
    const r = board ? board.getBoundingClientRect() : null;
    return { w: r && r.width ? r.width : 1000, h: r && r.height ? r.height : 625 };
}
