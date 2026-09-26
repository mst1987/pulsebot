import type { RaidplanBoard, RaidplanAutoStyle } from "../../api";
import { ARROW_COLOR, ARROW_MAX, ARROW_MIN, clampOpacity, type ObjectKind, SIZE_RANGES } from "./model";
import { isLocked } from "./objects";

// ---- objects the tank rows put on the map (lib/raidplan/autoPlace.ts): only what differs is stored, by their key ----

/** The size range of an auto object: a tank is a token, a mob an icon. */
export function autoRange(key: string): { def: number; min: number; max: number } {
    return key.indexOf("t:") === 0 ? SIZE_RANGES.token : SIZE_RANGES.icon;
}

export function autoStyleOf(board: RaidplanBoard, key: string): RaidplanAutoStyle {
    return (board.autoStyle || {})[key] || {};
}

/** Changes the look of one auto object; a value back at its default is dropped, an entry without anything goes. */
export function patchAutoStyle(board: RaidplanBoard, key: string, patch: Partial<RaidplanAutoStyle>): RaidplanBoard {
    const next = { ...autoStyleOf(board, key), ...patch };
    if (next.ring !== false) delete next.ring;
    if (next.showName !== false) delete next.showName;
    if (next.autoFace !== false) delete next.autoFace;
    if (!next.hidden) delete next.hidden;
    if (!next.lock) delete next.lock;
    if (!next.showLabel) delete next.showLabel;
    if (!next.label) delete next.label;
    if (next.opacity === 1 || next.opacity === undefined) delete next.opacity;
    if (next.size === undefined || next.size === autoRange(key).def) delete next.size;
    if (!next.z) delete next.z;
    if (next.rotation === undefined) delete next.rotation;
    if (next.arrowScale === undefined || next.arrowScale === 1) delete next.arrowScale;
    if (!next.arrowHidden) delete next.arrowHidden;
    if (!next.arrowColor || next.arrowColor === ARROW_COLOR) delete next.arrowColor;
    if (next.arrowOpacity === undefined || next.arrowOpacity === 1) delete next.arrowOpacity;
    const all = { ...(board.autoStyle || {}) };
    if (Object.keys(next).length > 0) all[key] = next; else delete all[key];
    return { ...board, autoStyle: all };
}

// ---- the facing wedge of an icon (a boss / mob / enemy, also one the tank rows put on the map) --------------------

export type ArrowLook = { scale: number; hidden: boolean; color: string; opacity: number };

/** The wedge of an icon as it is drawn: its size (1 = the default), hidden, colour, opacity; null for anything without one. */
export function arrowOf(board: RaidplanBoard, kind: ObjectKind, id: string): ArrowLook | null {
    const o = kind === "auto" ? (id.indexOf("m:") === 0 ? autoStyleOf(board, id) : null) : kind === "icon" ? board.icons.find((x) => x.id === id) || null : null;
    if (!o) return null;
    return { scale: o.arrowScale || 1, hidden: !!o.arrowHidden, color: o.arrowColor || ARROW_COLOR, opacity: o.arrowOpacity === undefined ? 1 : o.arrowOpacity };
}

/** Changes an icon's wedge: size (clamped 25 % .. 300 %), hidden, colour, opacity. A locked icon keeps it; anything but an icon is left alone. */
export function patchArrow(board: RaidplanBoard, kind: ObjectKind, id: string, patch: { scale?: number; hidden?: boolean; color?: string; opacity?: number }): RaidplanBoard {
    if (!arrowOf(board, kind, id) || isLocked(board, kind, id)) return board;
    const out: Partial<RaidplanAutoStyle> = {};
    if (patch.scale !== undefined) out["arrowScale"] = Number.isFinite(patch.scale) ? Math.max(ARROW_MIN, Math.min(ARROW_MAX, Math.round(patch.scale * 100) / 100)) : 1;
    if (patch.hidden !== undefined) out["arrowHidden"] = patch.hidden;
    if (patch.color !== undefined) out["arrowColor"] = patch.color;
    if (patch.opacity !== undefined) out["arrowOpacity"] = clampOpacity(patch.opacity, 1);
    if (kind === "auto") return patchAutoStyle(board, id, out);
    return { ...board, icons: board.icons.map((x) => (x.id === id ? { ...x, ...out } : x)) };
}

/** "Pfeil größer / kleiner", Alt + "+" / "-": the wedge by a factor, relative to its own size. */
export function scaleArrow(board: RaidplanBoard, kind: ObjectKind, id: string, factor: number): RaidplanBoard {
    const a = arrowOf(board, kind, id);
    return a ? patchArrow(board, kind, id, { scale: a.scale * factor }) : board;
}

/** "Alles zurücksetzen": the auto object goes back to its own place and its default look. */
export function resetAutoAll(board: RaidplanBoard, key: string): RaidplanBoard {
    const style = { ...(board.autoStyle || {}) };
    delete style[key];
    return { ...resetAutoPos(board, key), autoStyle: style };
}

/** All objects of the tank rows together, 40 % .. 200 %. */
export function setAutoScale(board: RaidplanBoard, value: number): RaidplanBoard {
    return { ...board, autoScale: Number.isFinite(value) ? Math.max(0.4, Math.min(2, Math.round(value * 100) / 100)) : 1 };
}

/** "Position zurücksetzen" of an auto-placed object: it goes back to the place the layout gives it. */
export function resetAutoPos(board: RaidplanBoard, key: string): RaidplanBoard {
    const next = { ...(board.autoPos || {}) };
    delete next[key];
    return { ...board, autoPos: next };
}
