import type { RaidplanBoard } from "../../api";
import { updateIcon } from "./objects";

// ---- the right-click menu ----------------------------------------------------------------

/** Which source an icon key names: a boss icon of the encounter list, a spell / ability icon of the icon CDN, or one of the two built in symbols. */
// ---- facing (boss / enemy icons): 0 = up / north, clockwise -----------------------------

export const COMPASS = [0, 45, 90, 135, 180, 225, 270, 315];

export const COMPASS_NAMES = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** An angle as whole degrees 0..359; anything that is not a number is 0. */
export function normAngle(deg: number): number {
    const n = Math.round(Number(deg));
    return Number.isFinite(n) ? ((n % 360) + 360) % 360 : 0;
}

/** The angle of the pointer (px, py) around the centre (cx, cy): 0 = straight up, clockwise. */
export function angleTo(cx: number, cy: number, px: number, py: number): number {
    return normAngle((Math.atan2(px - cx, cy - py) * 180) / Math.PI);
}

/** The angle rounded to a step (Shift while turning: 15). */
export function snapAngle(deg: number, step: number): number {
    return normAngle(Math.round(deg / step) * step);
}

/** The compass point (N, NE, ...) an angle is closest to. */
export function compassName(deg: number): string {
    return COMPASS_NAMES[Math.round(normAngle(deg) / 45) % 8];
}

/** Whether an icon shows which way it faces: bosses, enemies and positions do, spell icons do not. */
export function canFace(key: string): boolean {
    return key.slice(0, 4) !== "wow:";
}

/** Turns an icon by delta degrees. */
export function turnIcon(board: RaidplanBoard, id: string, delta: number): RaidplanBoard {
    const i = board.icons.find((k) => k.id === id);
    return i ? updateIcon(board, id, { rotation: normAngle(i.rotation + delta) }) : board;
}

export function iconKeyType(key: string): string {
    if (key.startsWith("boss:") || key.startsWith("mob:")) return "boss";
    if (key.startsWith("wow:")) return "wow";
    if (key === "enemy" || key === "bosspos") return key;
    return "";
}

/** The picture of a `boss:<encounter id>` (public/bosses/<id>.jpg) or `mob:<NPC id>` (public/mobs/<id>.png) icon key, "" for any other. */
export function portraitUrl(key: string): string {
    const m = key.match(/^(boss|mob):(\d{1,6})$/);
    return !m ? "" : m[1] === "boss" ? `/bosses/${m[2]}.jpg` : `/mobs/${m[2]}.png`;
}

/** The icon key a boss list entry stands for: its WCL encounter icon, else the icon of its instance. */
export function iconKeyForBoss(iconUrl: string): string {
    const m = iconUrl.match(/\/bosses\/(\d+)\.jpg$/);
    if (m) return `boss:${m[1]}`;
    const w = iconUrl.match(/\/icons\/(?:large|medium)\/([^/]+)\.jpg$/);
    return w ? `wow:${decodeURIComponent(w[1])}` : "enemy";
}

/** The dark-on-light image of a raid mark (public/raidmarks/<mark>.png). */
export function markUrl(mark: string): string {
    return `/raidmarks/${mark}.png`;
}
