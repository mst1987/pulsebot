// How one visitor lays out the sheet's stage (/p/<token>), remembered in this browser (never in the plan): whether the boss strip
// shows (off, over the map, or beside it), whether "Alle Einteilungen" stands open, and where "Deine Aufgaben" floats over the map.
// Pure parsing and the card's drag math; the hook is hooks/useSheetLayout.ts.

/** Where the extra boss strip stands: not at all, as a row under the bar, or as a column left of the map. */
export type StripMode = "off" | "top" | "left";
/**
 * Where "Deine Aufgaben" floats: its share of the free room left/right and top/bottom (0 = left/top edge, 1 = right/bottom edge).
 * A share, not pixels, so the card stays inside the map when the window or the card itself changes size (folding keeps a card at
 * the bottom at the bottom). null = the default corner, bottom left.
 */
export type MinePos = { x: number; y: number };
export type SheetLayout = { strip: StripMode; allTasks: boolean; mine: MinePos | null };

export const DEFAULT_SHEET_LAYOUT: SheetLayout = { strip: "off", allTasks: false, mine: null };
export const STRIP_MODES: StripMode[] = ["off", "top", "left"];
/** the card's default corner: bottom left */
export const MINE_HOME: MinePos = { x: 0, y: 1 };
/** one arrow key press moves the card by this share of the free room */
export const MINE_STEP = 0.05;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** The remembered layout from the stored text: an unknown strip mode, a non-boolean or a broken position falls back to the default. */
export function parseSheetLayout(raw: string | null): SheetLayout {
    let o: Record<string, unknown> | null = {};
    try { o = raw ? JSON.parse(raw) : {}; } catch { o = {}; }
    const out = { ...DEFAULT_SHEET_LAYOUT };
    if (o && STRIP_MODES.indexOf(o.strip as StripMode) >= 0) out.strip = o.strip as StripMode;
    if (o && typeof o.allTasks === "boolean") out.allTasks = o.allTasks;
    const m = o ? (o.mine as Record<string, unknown> | null) : null;
    if (m && typeof m === "object" && isNum(m.x) && isNum(m.y)) out.mine = { x: clamp01(m.x), y: clamp01(m.y) };
    return out;
}

/**
 * The card's place after a drag of dx/dy pixels from `start`, with `free` the pixels it can travel (the stage less the card and its
 * margins). No room on an axis keeps that axis where it was; the result never leaves the stage.
 */
export function dragMinePos(start: MinePos, dx: number, dy: number, free: { w: number; h: number }): MinePos {
    return {
        x: free.w > 0 ? clamp01(start.x + dx / free.w) : start.x,
        y: free.h > 0 ? clamp01(start.y + dy / free.h) : start.y,
    };
}

/** The card's place after an arrow key, or null for a key that does not move it. */
export function nudgeMinePos(pos: MinePos, key: string): MinePos | null {
    const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = step[key];
    return d ? { x: clamp01(pos.x + d[0] * MINE_STEP), y: clamp01(pos.y + d[1] * MINE_STEP) } : null;
}
