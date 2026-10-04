// How one visitor lays out the sheet's stage (/p/<token>), remembered in this browser (never in the plan): whether the boss strip
// shows (off, over the map, or beside it) and whether "Alle Einteilungen" stands open. Pure parsing; the hook is hooks/useSheetLayout.ts.

/** Where the extra boss strip stands: not at all, as a row under the bar, or as a column left of the map. */
export type StripMode = "off" | "top" | "left";
export type SheetLayout = { strip: StripMode; allTasks: boolean };

export const DEFAULT_SHEET_LAYOUT: SheetLayout = { strip: "off", allTasks: false };
export const STRIP_MODES: StripMode[] = ["off", "top", "left"];

/** The remembered layout from the stored text: an unknown strip mode or a non-boolean falls back to the default. */
export function parseSheetLayout(raw: string | null): SheetLayout {
    let o: Record<string, unknown> | null = {};
    try { o = raw ? JSON.parse(raw) : {}; } catch { o = {}; }
    const out = { ...DEFAULT_SHEET_LAYOUT };
    if (o && STRIP_MODES.indexOf(o.strip as StripMode) >= 0) out.strip = o.strip as StripMode;
    if (o && typeof o.allTasks === "boolean") out.allTasks = o.allTasks;
    return out;
}
