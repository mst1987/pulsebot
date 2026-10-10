// Editing the animations of a section (docs/raidplan/animation.md), pure: scenes on a board, frames ("Takte") of a scene and the
// changes of an object in a frame. Every function returns new objects. Times stay a TIMELINE: a frame keeps its start time, so
// adding, removing or lengthening a frame moves the frames after it and leaves the others' lengths as they are. The server cleans
// every save again (src/services/raidplan/raidplanScenes.js); these rules keep the editor consistent while the orga works.
import type { RaidplanBoard, RaidplanChange, RaidplanEase, RaidplanFrame, RaidplanScene } from "../../api";
import { frameLength } from "./scene";

export const SCENE_LIMITS = { scenes: 8, frames: 24, changes: 60, title: 60, caption: 120, seconds: 600, step: 60 };
/** How long a new frame lasts, and a new change of a later frame takes (seconds). */
export const NEW_FRAME_S = 2;
export const NEW_CHANGE_S = 1;

const r1 = (n: number) => Math.round(n * 10) / 10;
const uid = () => Math.random().toString(36).slice(2, 7);

/** A new scene: one frame (the starting position, nothing changes yet), two seconds long. */
export function newScene(title: string): RaidplanScene {
    return { id: uid(), title: title.slice(0, SCENE_LIMITS.title), loop: false, length: NEW_FRAME_S, stepId: "", frames: [{ id: uid(), at: 0, caption: "", changes: [] }], loops: [] };
}

/** The board with one scene changed by `fn` (a scene it does not have: unchanged). */
export function withScene(board: RaidplanBoard, id: string, fn: (s: RaidplanScene) => RaidplanScene): RaidplanBoard {
    const scenes = board.scenes || [];
    if (!scenes.some((s) => s.id === id)) return board;
    return { ...board, scenes: scenes.map((s) => (s.id === id ? fn(s) : s)) };
}
/** The board with a scene added at the end (at most SCENE_LIMITS.scenes: then unchanged). */
export function addScene(board: RaidplanBoard, scene: RaidplanScene): RaidplanBoard {
    const scenes = board.scenes || [];
    return scenes.length >= SCENE_LIMITS.scenes ? board : { ...board, scenes: [...scenes, scene] };
}
export function removeScene(board: RaidplanBoard, id: string): RaidplanBoard {
    return { ...board, scenes: (board.scenes || []).filter((s) => s.id !== id) };
}

/** Every frame from index `from` on, and the end of the scene, moved by `by` seconds. */
function shiftFrom(scene: RaidplanScene, from: number, by: number): RaidplanScene {
    return {
        ...scene,
        frames: scene.frames.map((f, i) => (i >= from ? { ...f, at: r1(f.at + by) } : f)),
        length: r1(Math.min(SCENE_LIMITS.seconds, scene.length + by)),
    };
}

/** A new, empty frame after frame k (it starts where the scene stands then); the frames after it move back by its length. */
export function addFrame(scene: RaidplanScene, k: number): RaidplanScene {
    if (scene.frames.length >= SCENE_LIMITS.frames || scene.length + NEW_FRAME_S > SCENE_LIMITS.seconds) return scene;
    const i = Math.max(0, Math.min(scene.frames.length - 1, k));
    const at = r1(scene.frames[i].at + frameLength(scene, i));
    const moved = shiftFrom(scene, i + 1, NEW_FRAME_S);
    const frames = [...moved.frames];
    frames.splice(i + 1, 0, { id: uid(), at, caption: "", changes: [] });
    return { ...moved, frames };
}

/** The scene without frame k; the frames after it move forward by its length (the first one left starts at 0). Never the last frame. */
export function removeFrame(scene: RaidplanScene, k: number): RaidplanScene {
    if (scene.frames.length <= 1 || !scene.frames[k]) return scene;
    const len = frameLength(scene, k);
    const shifted = shiftFrom(scene, k + 1, -len);
    const frames = shifted.frames.filter((_, i) => i !== k);
    // a removed first frame: the next one becomes the start, at 0
    if (k === 0 && frames[0].at !== 0) return shiftFrom({ ...shifted, frames }, 0, -frames[0].at);
    return { ...shifted, frames };
}

/** Frame k and its neighbour (dir -1 / +1) swap what they show (caption and changes); the times stay where they are. */
export function moveFrame(scene: RaidplanScene, k: number, dir: -1 | 1): RaidplanScene {
    const j = k + dir;
    if (!scene.frames[k] || !scene.frames[j]) return scene;
    const frames = scene.frames.map((f) => ({ ...f }));
    const a = { caption: frames[k].caption, changes: frames[k].changes, id: frames[k].id };
    frames[k] = { ...frames[k], caption: frames[j].caption, changes: frames[j].changes, id: frames[j].id };
    frames[j] = { ...frames[j], ...a };
    // the first frame is the starting position: what lands there takes no time
    frames[0] = { ...frames[0], changes: frames[0].changes.map((c) => ({ ...c, delay: 0, dur: 0 })) };
    return { ...scene, frames };
}

/** Frame k lasts `len` seconds (at least a tenth): the frames after it move with it. */
export function setFrameLength(scene: RaidplanScene, k: number, len: number): RaidplanScene {
    if (!scene.frames[k]) return scene;
    const want = r1(Math.max(0.1, len));
    const by = r1(want - frameLength(scene, k));
    if (by === 0 || scene.length + by > SCENE_LIMITS.seconds) return scene;
    return shiftFrom(scene, k + 1, by);
}

export function setCaption(scene: RaidplanScene, k: number, caption: string): RaidplanScene {
    if (!scene.frames[k]) return scene;
    return { ...scene, frames: scene.frames.map((f, i) => (i === k ? { ...f, caption: caption.slice(0, SCENE_LIMITS.caption) } : f)) };
}

/** What a new change of an object in frame k starts as: in the first frame it takes no time, later one second (at most the frame). */
function freshChange(scene: RaidplanScene, k: number, obj: string): RaidplanChange {
    const dur = k === 0 ? 0 : r1(Math.min(NEW_CHANGE_S, Math.max(0.1, frameLength(scene, k))));
    return { obj, delay: 0, dur, ease: "inout" };
}

/** The change of an object in frame k (undefined: it does not change there). */
export function changeOf(scene: RaidplanScene, k: number, obj: string): RaidplanChange | undefined {
    const f = scene.frames[k];
    return f ? f.changes.find((c) => c.obj === obj) : undefined;
}

/**
 * Sets fields of an object's change in frame k, creating the change when there is none (at most SCENE_LIMITS.changes per frame).
 * A field set to undefined is taken off; a change left with nothing to change is removed.
 */
export function patchChange(scene: RaidplanScene, k: number, obj: string, patch: Partial<Omit<RaidplanChange, "obj">>): RaidplanScene {
    const f: RaidplanFrame | undefined = scene.frames[k];
    if (!f) return scene;
    const old = f.changes.find((c) => c.obj === obj);
    if (!old && f.changes.length >= SCENE_LIMITS.changes) return scene;
    const next = { ...(old || freshChange(scene, k, obj)), ...patch } as RaidplanChange;
    for (const key of Object.keys(next) as (keyof RaidplanChange)[]) if (next[key] === undefined) delete next[key];
    if (k === 0) { next.delay = 0; next.dur = 0; }
    const keep = changes(next);
    const list = old ? f.changes.map((c) => (c.obj === obj ? next : c)).filter((c) => c.obj !== obj || keep) : keep ? [...f.changes, next] : f.changes;
    return { ...scene, frames: scene.frames.map((x, i) => (i === k ? { ...x, changes: list } : x)) };
}

/** Whether a change changes anything (a place, a turn, a look, a fade, a badge or a pulse). */
export function changes(c: RaidplanChange): boolean {
    return (c.x !== undefined && c.y !== undefined) || c.rotation !== undefined || c.opacity !== undefined || c.scale !== undefined
        || c.hidden !== undefined || c.badge !== undefined || c.pulse !== undefined;
}

/** The scene without the object's change in frame k. */
export function removeChange(scene: RaidplanScene, k: number, obj: string): RaidplanScene {
    if (!scene.frames[k]) return scene;
    return { ...scene, frames: scene.frames.map((f, i) => (i === k ? { ...f, changes: f.changes.filter((c) => c.obj !== obj) } : f)) };
}

/** The object moves to (x, y) in frame k (its path, if any, stays). */
export function moveIn(scene: RaidplanScene, k: number, obj: string, x: number, y: number): RaidplanScene {
    const c = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 10000) / 10000;
    return patchChange(scene, k, obj, { x: c(x), y: c(y) });
}

/** Debuff and marker icons offered with one click (any WoW icon name can be typed). */
export const BADGE_PRESETS = ["spell_shadow_bloodboil", "spell_fire_felfire", "spell_nature_corrosivebreath", "spell_shadow_shadowbolt", "spell_frost_frostbolt02", "ability_hunter_snipershot"];

/** The easing choices in the order the editor offers them. */
export const EASES: RaidplanEase[] = ["inout", "linear", "in", "out"];

/** The objects a frame changes, for the frame strip ("3 Änderungen"). */
export function frameSummary(f: RaidplanFrame): { moves: number; total: number } {
    return { moves: f.changes.filter((c) => c.x !== undefined).length, total: f.changes.length };
}

/** "<kind>:<id>" of an object the board's selection names (a split group's member stands for its group). */
export function sceneRef(kind: string, id: string): string {
    if (kind === "member") { const at = id.indexOf("~"); return `slot:${at < 0 ? id : id.slice(0, at)}`; }
    return `${kind}:${id}`;
}

/** The value a field of an object's changes has after frame k (the last frame up to k that sets it); undefined: none sets it. */
export function valueAfter<K extends keyof RaidplanChange>(scene: RaidplanScene, k: number, obj: string, field: K): RaidplanChange[K] | undefined {
    let v: RaidplanChange[K] | undefined;
    scene.frames.slice(0, k + 1).forEach((f) => {
        const c = f.changes.find((x) => x.obj === obj);
        if (c && c[field] !== undefined) v = c[field];
    });
    return v;
}
