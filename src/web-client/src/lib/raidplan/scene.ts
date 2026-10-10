// The animations of a raid plan section (docs/raidplan/animation.md), pure: where every object of a board stands at a moment of a
// scene. One function, `boardAt`, turns (board, scene, t) into the board as it looks at t; editor, template and sheet hand that to
// the same PlanBoard, so they can never disagree. The server cleans what is stored (src/services/raidplan/raidplanScenes.js).
//
// A scene is a timeline: every change of a frame starts at `frame.at + delay` and ends `dur` seconds later. A change that starts
// while the one before it still runs takes over from where the object is at that moment, so frames ("Takte") and a later free
// timeline read the same data. Positions, turning, opacity, size and fading are blended; a badge and a pulse switch when their
// change starts. A loop of the scene moves an object along its path on its own and wins over the frames while it runs.
//
// A single raider of a split group is an actor of his own: "member:<slotId>~<userId>". Until a change of his starts he stands
// in his group's ring and goes where the group goes; a change sends him to a place of the board (absolute) and he stays there
// even when his group moves on. The board keeps a member's place as an offset to the group marker, so the result is written
// into the slot's `offsets`, relative to where the marker stands at that moment. Where the ring puts a member without an offset
// depends on the drawn board, so the caller hands it in (`memberAt`, lib/raidplan/members.ts).
import type { RaidplanAutoStyle, RaidplanChange, RaidplanEase, RaidplanLoop, RaidplanScene } from "../../api";

type Pt = { x: number; y: number };
/** What `boardAt` reads and writes of a board: its objects and the auto objects' positions / looks (an editor board or a sheet's boss). */
export type SceneBoard = {
    tokens: { userId: string; x: number; y: number; size: number; opacity: number; hidden: boolean }[];
    slots: { id: string; kind: string; x: number; y: number; size: number; opacity: number; hidden: boolean; groupScale?: number; ringSpread?: number; offsets?: Record<string, { dx: number; dy: number; size: number; away?: boolean }> }[];
    icons: { id: string; x: number; y: number; size: number; rotation: number; opacity: number; hidden: boolean }[];
    marks: { id: string; x: number; y: number; size: number; opacity: number; hidden: boolean }[];
    zones: { id: string; x: number; y: number; w: number; h: number; rotation?: number; opacity: number; hidden: boolean }[];
    lines: { id: string; x1: number; y1: number; x2: number; y2: number; opacity: number; hidden: boolean }[];
    texts: { id: string; x: number; y: number; size: number; opacity: number; hidden: boolean }[];
    autoPos?: Record<string, Pt>;
    autoStyle?: Record<string, RaidplanAutoStyle>;
};
/** The effects on one object at a moment: a WoW icon on it, a pulse. */
export type SceneFx = { badge?: string; pulse?: boolean };
/** A loop's trail: where its object was a moment ago (newest last); `hint` = the editor's dotted way of a movement, not a trail. */
export type SceneTrail = { obj: string; points: Pt[]; hint?: boolean };
export type SceneState<B> = { board: B; fx: Record<string, SceneFx>; trails: SceneTrail[]; frame: number; caption: string };
/** Where the objects of the tank rows stand without the scene (their key -> point), so a scene can move them from there. */
export type AutoAt = Record<string, Pt>;
/** Where the ring puts each raider of a split group, relative to its marker ("<slotId>~<userId>" -> offset in board fractions). */
export type MemberAt = Record<string, Pt>;

/** How far a group's members stand from its marker relative to what is stored (its scale times its ring spacing, like the board). */
const spreadOf = (o: { groupScale?: number; ringSpread?: number }) => clamp(o.groupScale === undefined ? 1 : o.groupScale, 0.25, 4) * clamp(o.ringSpread === undefined ? 1 : o.ringSpread, 0.25, 4);
/** "<slotId>~<userId>" of a member reference. */
const memberParts = (id: string) => { const i = id.indexOf("~"); return { slotId: id.slice(0, i), userId: id.slice(i + 1) }; };

/** A raider's place relative to his group marker: the offset the board keeps for him, else his place in the ring. */
function memberOffset(board: SceneBoard, slotId: string, userId: string, memberAt: MemberAt): Pt | null {
    const sl = board.slots.find((o) => o.id === slotId);
    if (!sl) return null;
    const off = sl.offsets ? sl.offsets[userId] : undefined;
    if (off) { const sp = spreadOf(sl); return { x: off.dx * sp, y: off.dy * sp }; }
    const ring = memberAt[`${slotId}~${userId}`];
    return ring ? { x: ring.x, y: ring.y } : null;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

/** How far a change is at a share p (0..1) of its time. */
export function ease(kind: RaidplanEase, p: number): number {
    const q = clamp(p, 0, 1);
    if (kind === "linear") return q;
    if (kind === "in") return q * q;
    if (kind === "out") return 1 - (1 - q) * (1 - q);
    return q < 0.5 ? 4 * q * q * q : 1 - Math.pow(-2 * q + 2, 3) / 2;
}

/** A turn from a to b the short way round (degrees), at a share p. */
export function lerpAngle(a: number, b: number, p: number): number {
    const d = ((((b - a) % 360) + 540) % 360) - 180;
    return (((a + d * p) % 360) + 360) % 360;
}

/** A smooth curve through the points (Catmull-Rom), sampled into a polyline. */
function curve(points: Pt[], closed: boolean): Pt[] {
    if (points.length < 3) return closed && points.length === 2 ? [points[0], points[1], points[0]] : points.slice();
    const n = points.length;
    const at = (i: number) => (closed ? points[(i + n) % n] : points[clamp(i, 0, n - 1)]);
    const out: Pt[] = [];
    const segs = closed ? n : n - 1;
    const steps = 12;
    for (let i = 0; i < segs; i++) {
        const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
        for (let s = 0; s < steps; s++) {
            const t = s / steps, t2 = t * t, t3 = t2 * t;
            const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
            out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
        }
    }
    out.push(closed ? points[0] : points[n - 1]);
    return out;
}

/** The point at a share p (0..1) of a polyline's length. */
function along(line: Pt[], p: number): Pt {
    if (line.length === 0) return { x: 0, y: 0 };
    if (line.length === 1) return line[0];
    const lens = [0];
    for (let i = 1; i < line.length; i++) lens.push(lens[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y));
    const total = lens[lens.length - 1];
    if (total === 0) return line[0];
    const want = clamp(p, 0, 1) * total;
    let i = 1;
    while (i < lens.length - 1 && lens[i] < want) i++;
    const seg = lens[i] - lens[i - 1] || 1;
    const k = (want - lens[i - 1]) / seg;
    return { x: lerp(line[i - 1].x, line[i].x, k), y: lerp(line[i - 1].y, line[i].y, k) };
}

/** The point at a share p of a path from `from` through `via` to `to`: a curve through all of them, by its length. */
export function pathPoint(from: Pt, via: [number, number][], to: Pt, p: number): Pt {
    if (via.length === 0) return { x: lerp(from.x, to.x, p), y: lerp(from.y, to.y, p) };
    return along(curve([from, ...via.map(([x, y]) => ({ x, y })), to], false), p);
}

/** Where a loop's object is at t (null while the loop does not run): closed paths go round, open ones there and back. */
export function loopPoint(loop: RaidplanLoop, t: number): Pt | null {
    if (t < loop.from || (loop.to > 0 && t >= loop.to) || loop.path.length < 2) return null;
    const pts = loop.path.map(([x, y]) => ({ x, y }));
    const share = ((t - loop.from) % loop.period) / loop.period;
    const line = curve(pts, loop.closed);
    return along(line, loop.closed ? share : share < 0.5 ? share * 2 : 2 - share * 2);
}

type Seg = { start: number; end: number; c: RaidplanChange };
type Num = (c: RaidplanChange) => number | undefined;

/** The value of one blended property at t: each change takes over from where the one before it had brought it at its start. */
function blended(segs: Seg[], base: number, pick: Num, t: number, angle = false): number {
    const mine = segs.filter((s) => pick(s.c) !== undefined);
    const at = (s: Seg, from: number, time: number) => {
        const p = s.end > s.start ? ease(s.c.ease, (time - s.start) / (s.end - s.start)) : time >= s.start ? 1 : 0;
        return angle ? lerpAngle(from, pick(s.c)!, p) : lerp(from, pick(s.c)!, p);
    };
    let from = base;
    for (let i = 0; i < mine.length; i++) {
        const next = mine[i + 1];
        if (t < mine[i].start) return from;
        if (!next || t < next.start) return at(mine[i], from, t);
        from = at(mine[i], from, next.start);
    }
    return from;
}

/** The position at t: like `blended`, a movement with a path follows its curve. */
function moved(segs: Seg[], base: Pt | ((t: number) => Pt), t: number): Pt {
    const baseAt = typeof base === "function" ? base : () => base;
    const mine = segs.filter((s) => s.c.x !== undefined && s.c.y !== undefined);
    const at = (s: Seg, from: Pt, time: number) => {
        const p = s.end > s.start ? ease(s.c.ease, (time - s.start) / (s.end - s.start)) : time >= s.start ? 1 : 0;
        return pathPoint(from, s.c.path || [], { x: s.c.x!, y: s.c.y! }, p);
    };
    if (mine.length === 0 || t < mine[0].start) return baseAt(t);
    let from = baseAt(mine[0].start);
    for (let i = 0; i < mine.length; i++) {
        const next = mine[i + 1];
        if (t < mine[i].start) return from;
        if (!next || t < next.start) return at(mine[i], from, t);
        from = at(mine[i], from, next.start);
    }
    return from;
}

/** A switch (badge, pulse) at t: the last change that set it and has started. */
function switched<T>(segs: Seg[], pick: (c: RaidplanChange) => T | undefined, t: number): T | undefined {
    let v: T | undefined;
    for (const s of segs) {
        if (s.start > t) break;
        const x = pick(s.c);
        if (x !== undefined) v = x;
    }
    return v;
}

/** The changes of a scene per object, in time order (equal starts: the later frame wins). */
function segmentsOf(scene: RaidplanScene): Map<string, Seg[]> {
    const out = new Map<string, Seg[]>();
    for (const f of scene.frames) {
        for (const c of f.changes) {
            const start = f.at + (c.delay || 0);
            const list = out.get(c.obj) || [];
            list.push({ start, end: start + Math.max(0, c.dur || 0), c });
            out.set(c.obj, list);
        }
    }
    for (const list of out.values()) list.sort((a, b) => a.start - b.start);
    return out;
}

/** The index of the frame that is on at t (the last one that has started; 0 before the first). */
export function frameAt(scene: RaidplanScene, t: number): number {
    let k = 0;
    scene.frames.forEach((f, i) => { if (f.at <= t) k = i; });
    return k;
}

/** When everything of frame k has arrived (its start, or the end of its longest change). */
export function frameRest(scene: RaidplanScene, k: number): number {
    const f = scene.frames[k];
    if (!f) return 0;
    return f.changes.reduce((m, c) => Math.max(m, f.at + (c.delay || 0) + (c.dur || 0)), f.at);
}

/** How long frame k lasts: up to the next frame, the last one up to the end of the scene. */
export function frameLength(scene: RaidplanScene, k: number): number {
    const f = scene.frames[k];
    if (!f) return 0;
    const next = scene.frames[k + 1];
    return Math.round(((next ? next.at : scene.length) - f.at) * 10) / 10;
}

/** The object's position and look the scene starts from (null: the board has no such object). */
type Look = { pos: Pt; rotation: number; opacity: number; scale: number };
function baseLook(board: SceneBoard, obj: string, autoAt: AutoAt, memberAt: MemberAt = {}): Look | null {
    const i = obj.indexOf(":");
    const kind = obj.slice(0, i);
    const id = obj.slice(i + 1);
    const plain = (o: { x: number; y: number; opacity: number } | undefined, rotation = 0) => (o ? { pos: { x: o.x, y: o.y }, rotation, opacity: o.opacity, scale: 1 } : null);
    if (kind === "token") return plain(board.tokens.find((o) => o.userId === id));
    if (kind === "slot") return plain(board.slots.find((o) => o.id === id));
    if (kind === "mark") return plain(board.marks.find((o) => o.id === id));
    if (kind === "text") return plain(board.texts.find((o) => o.id === id));
    if (kind === "icon") { const o = board.icons.find((x) => x.id === id); return plain(o, o ? o.rotation || 0 : 0); }
    if (kind === "zone") { const o = board.zones.find((x) => x.id === id); return plain(o, o ? o.rotation || 0 : 0); }
    if (kind === "line") {
        const o = board.lines.find((x) => x.id === id);
        return o ? { pos: { x: (o.x1 + o.x2) / 2, y: (o.y1 + o.y2) / 2 }, rotation: 0, opacity: o.opacity, scale: 1 } : null;
    }
    if (kind === "member") {
        const { slotId, userId } = memberParts(id);
        const sl = board.slots.find((o) => o.id === slotId);
        const off = memberOffset(board, slotId, userId, memberAt);
        return sl && off ? { pos: { x: sl.x + off.x, y: sl.y + off.y }, rotation: 0, opacity: sl.opacity, scale: 1 } : null;
    }
    if (kind === "auto") {
        const st = (board.autoStyle || {})[id] || {};
        const at = (board.autoPos || {})[id] || autoAt[id];
        return at ? { pos: { x: at.x, y: at.y }, rotation: st.rotation || 0, opacity: st.opacity === undefined ? 1 : st.opacity, scale: 1 } : null;
    }
    return null;
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** Writes an object's look at t into a copy of the board (only the lists it touches are copied). */
function applyLook<B extends SceneBoard>(board: B, obj: string, look: Look & { vis: number; moved: boolean; turned: boolean; sized: boolean }): B {
    const i = obj.indexOf(":");
    const kind = obj.slice(0, i);
    const id = obj.slice(i + 1);
    const opacity = clamp(look.opacity * look.vis, 0, 1);
    const hidden = look.vis <= 0.01;
    const common = <T extends { opacity: number; hidden: boolean }>(o: T): T => ({ ...o, opacity: Math.max(0.05, opacity), hidden: o.hidden || hidden });
    const pos = look.moved ? { x: r4(look.pos.x), y: r4(look.pos.y) } : {};
    const put = <K extends "tokens" | "slots" | "icons" | "marks" | "zones" | "lines" | "texts">(key: K, match: (o: B[K][number]) => boolean, fn: (o: B[K][number]) => B[K][number]) => {
        board[key] = (board[key] as B[K][number][]).map((o) => (match(o) ? fn(o) : o)) as B[K];
    };
    const size = (s: number) => Math.round(s * look.scale);
    if (kind === "token") put("tokens", (o) => o.userId === id, (o) => ({ ...common(o), ...pos, size: size(o.size) }));
    else if (kind === "slot") put("slots", (o) => o.id === id, (o) => ({ ...common(o), ...pos, size: size(o.size), ...(o.kind === "group" && look.sized ? { groupScale: (o.groupScale || 1) * look.scale } : {}) }));
    else if (kind === "mark") put("marks", (o) => o.id === id, (o) => ({ ...common(o), ...pos, size: size(o.size) }));
    else if (kind === "text") put("texts", (o) => o.id === id, (o) => ({ ...common(o), ...pos, size: size(o.size) }));
    else if (kind === "icon") put("icons", (o) => o.id === id, (o) => ({ ...common(o), ...pos, size: size(o.size), ...(look.turned ? { rotation: Math.round(look.rotation) } : {}) }));
    else if (kind === "zone") {
        put("zones", (o) => o.id === id, (o) => {
            const w = o.w * look.scale;
            const h = o.h * look.scale;
            // a zone's point is its top-left corner; a bigger zone grows round its middle
            const x = (look.moved ? look.pos.x : o.x) - (w - o.w) / 2;
            const y = (look.moved ? look.pos.y : o.y) - (h - o.h) / 2;
            return { ...common(o), x: r4(x), y: r4(y), w: r4(w), h: r4(h), ...(look.turned ? { rotation: Math.round(look.rotation) } : {}) };
        });
    } else if (kind === "line") {
        put("lines", (o) => o.id === id, (o) => {
            const dx = look.moved ? look.pos.x - (o.x1 + o.x2) / 2 : 0;
            const dy = look.moved ? look.pos.y - (o.y1 + o.y2) / 2 : 0;
            return { ...common(o), x1: r4(o.x1 + dx), y1: r4(o.y1 + dy), x2: r4(o.x2 + dx), y2: r4(o.y2 + dy) };
        });
    } else if (kind === "member") {
        const { slotId, userId } = memberParts(id);
        put("slots", (o) => o.id === slotId, (o) => {
            if (!look.moved) return o;
            const sp = spreadOf(o);
            const old = o.offsets ? o.offsets[userId] : undefined;
            // `away`: his group's ring keeps its size instead of stretching to where the animation sent him
            return { ...o, offsets: { ...(o.offsets || {}), [userId]: { dx: r4((look.pos.x - o.x) / sp), dy: r4((look.pos.y - o.y) / sp), size: old ? old.size : o.size, away: true } } };
        });
    } else if (kind === "auto") {
        if (look.moved) board.autoPos = { ...(board.autoPos || {}), [id]: { x: r4(look.pos.x), y: r4(look.pos.y) } };
        const st: RaidplanAutoStyle = { ...((board.autoStyle || {})[id] || {}), opacity: Math.max(0.05, opacity) };
        if (hidden) st.hidden = true;
        if (look.turned) { st.rotation = Math.round(look.rotation); st.autoFace = false; }
        board.autoStyle = { ...(board.autoStyle || {}), [id]: st };
    }
    return board;
}

/** How much of a loop's past is drawn as its trail, as a share of one round. */
const TRAIL_SHARE = 0.35;

/**
 * The board as it looks at t seconds into the scene, with the effects (badges, pulses), the trails of the loops, the frame that is
 * on and its caption. `autoAt` = where the tank rows' objects stand without the scene (lib/raidplan/autoPlace.ts), so they can be
 * moved from there. Objects the scene does not name stay exactly as they are; nothing of the board is changed in place.
 */
export function boardAt<B extends SceneBoard>(board: B, scene: RaidplanScene | null, t: number, autoAt: AutoAt = {}, memberAt: MemberAt = {}): SceneState<B> {
    if (!scene) return { board, fx: {}, trails: [], frame: 0, caption: "" };
    const out = { ...board } as B;
    const fx: Record<string, SceneFx> = {};
    const segs = segmentsOf(scene);
    /** where an object stands at a moment: its loop while that runs, else its changes */
    const posAt = (ref: string, base: Pt | ((tt: number) => Pt), tt: number): Pt => {
        const loop = (scene.loops || []).find((l) => l.obj === ref && loopPoint(l, tt));
        return loop ? loopPoint(loop, tt)! : moved(segs.get(ref) || [], base, tt);
    };
    // the members last: they are written relative to where their group marker stands in the result
    const order = [...segs.keys()].sort((a, b) => Number(a.startsWith("member:")) - Number(b.startsWith("member:")));
    for (const obj of order) {
        const list = segs.get(obj)!;
        const base = baseLook(board, obj, autoAt, memberAt);
        if (!base) continue;
        let where: Pt | ((tt: number) => Pt) = base.pos;
        if (obj.startsWith("member:")) {
            // until his own change starts a raider goes where his group goes
            const { slotId, userId } = memberParts(obj.slice(7));
            const sl = board.slots.find((o) => o.id === slotId)!;
            const off = memberOffset(board, slotId, userId, memberAt)!;
            where = (tt: number) => { const g = posAt(`slot:${slotId}`, { x: sl.x, y: sl.y }, tt); return { x: g.x + off.x, y: g.y + off.y }; };
        }
        const look = {
            pos: moved(list, where, t),
            rotation: blended(list, base.rotation, (c) => c.rotation, t, true),
            opacity: blended(list, base.opacity, (c) => c.opacity, t),
            scale: blended(list, 1, (c) => c.scale, t),
            vis: blended(list, 1, (c) => (c.hidden === undefined ? undefined : c.hidden ? 0 : 1), t),
            moved: list.some((s) => s.c.x !== undefined && s.start <= t),
            turned: list.some((s) => s.c.rotation !== undefined && s.start <= t),
            sized: list.some((s) => s.c.scale !== undefined && s.start <= t),
        };
        applyLook(out, obj, look);
        const badge = switched(list, (c) => c.badge, t);
        const pulse = switched(list, (c) => c.pulse, t);
        if (badge || pulse) fx[obj] = { ...(badge ? { badge } : {}), ...(pulse ? { pulse: true } : {}) };
    }
    const trails: SceneTrail[] = [];
    const loops = [...(scene.loops || [])].sort((a, b) => Number(a.obj.startsWith("member:")) - Number(b.obj.startsWith("member:")));
    for (const loop of loops) {
        const at = loopPoint(loop, t);
        const base = at ? baseLook(out, loop.obj, autoAt, memberAt) : null;
        if (!at || !base) continue;
        applyLook(out, loop.obj, { ...base, pos: at, vis: 1, moved: true, turned: false, sized: false });
        if (loop.trail) {
            const points: Pt[] = [];
            const span = loop.period * TRAIL_SHARE;
            for (let k = 12; k >= 1; k--) {
                const p = loopPoint(loop, Math.max(loop.from, t - (span * k) / 12));
                if (p) points.push(p);
            }
            trails.push({ obj: loop.obj, points });
        }
    }
    const frame = frameAt(scene, t);
    return { board: out, fx, trails, frame, caption: scene.frames[frame] ? scene.frames[frame].caption : "" };
}

/** The board after frame k with everything of frames 0..k arrived and no loops: what the editor shows and edits for that frame. */
export function boardAfter<B extends SceneBoard>(board: B, scene: RaidplanScene, k: number, autoAt: AutoAt = {}, memberAt: MemberAt = {}): SceneState<B> {
    const part = { ...scene, frames: scene.frames.slice(0, k + 1), loops: [] };
    const s = boardAt(board, part, Number.MAX_SAFE_INTEGER, autoAt, memberAt);
    return { ...s, frame: k, caption: scene.frames[k] ? scene.frames[k].caption : "" };
}

/** The scenes of a section that can be played: at least two frames, or a loop. */
export function playable(scenes: RaidplanScene[] | undefined): RaidplanScene[] {
    return (scenes || []).filter((s) => s.frames.length > 1 || (s.loops || []).length > 0);
}

/** The time as the player shows it: "0:07". */
export function clock(t: number): string {
    const s = Math.max(0, Math.floor(t));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Where the tank rows put their objects (lib/raidplan/autoPlace.ts deriveAuto): the start of an animation of them. */
export function autoAtOf(plan: { mobs: { key: string; x: number; y: number; iconId?: string }[]; tanks: { key: string; x: number; y: number; existing?: string | boolean }[] } | undefined): AutoAt {
    const at: AutoAt = {};
    if (!plan) return at;
    for (const m of plan.mobs) if (!m.iconId) at[m.key] = { x: m.x, y: m.y };
    for (const k of plan.tanks) if (!k.existing) at[k.key] = { x: k.x, y: k.y };
    return at;
}

/** Where an object of the board stands (a zone's top-left corner, a line's middle, an auto object where it was put); null: no such object. */
export function positionOf(board: SceneBoard, obj: string, autoAt: AutoAt = {}, memberAt: MemberAt = {}): Pt | null {
    const look = baseLook(board, obj, autoAt, memberAt);
    return look ? look.pos : null;
}

/**
 * The editor's hints for frame k: for every object that moves there, dots along its way from where it stood after the frame before
 * (straight or along its path), so the orga sees what the frame does without playing it.
 */
export function moveHints(board: SceneBoard, scene: RaidplanScene, k: number, autoAt: AutoAt = {}, memberAt: MemberAt = {}): SceneTrail[] {
    const f = scene.frames[k];
    if (!f || k === 0) return [];
    const before = boardAfter(board, scene, k - 1, autoAt, memberAt).board;
    const out: SceneTrail[] = [];
    for (const c of f.changes) {
        if (c.x === undefined || c.y === undefined) continue;
        const from = positionOf(before, c.obj, autoAt, memberAt);
        if (!from) continue;
        const to = { x: c.x, y: c.y };
        if (Math.hypot(to.x - from.x, to.y - from.y) < 0.01) continue;
        const points: Pt[] = [];
        for (let i = 1; i < 14; i++) points.push(pathPoint(from, c.path || [], to, i / 14));
        out.push({ obj: c.obj, points, hint: true });
    }
    return out;
}

/** A loop's path as the editor draws it: dots along its curve (round when closed). */
export function loopHint(loop: RaidplanLoop): SceneTrail {
    const pts = loop.path.map(([x, y]) => ({ x, y }));
    if (pts.length < 2) return { obj: loop.obj, points: pts, hint: true };
    const line = curve(pts, loop.closed);
    const n = Math.max(16, loop.path.length * 8);
    return { obj: loop.obj, points: Array.from({ length: n }, (_, i) => along(line, i / (loop.closed ? n : n - 1))), hint: true };
}
