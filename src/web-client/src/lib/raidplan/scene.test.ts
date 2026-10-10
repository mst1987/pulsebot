import { describe, expect, it } from "vitest";
import type { RaidplanChange, RaidplanScene } from "../../api";
import { boardAfter, boardAt, clock, ease, frameAt, frameLength, frameRest, lerpAngle, loopPoint, moveHints, pathPoint, playable, positionOf, type SceneBoard } from "./scene";

const look = { opacity: 1, hidden: false };
const board = (): SceneBoard => ({
    tokens: [{ userId: "u1", x: 0.1, y: 0.1, size: 38, ...look }],
    slots: [{ id: "g1", kind: "group", x: 0.2, y: 0.8, size: 40, ...look }, { id: "g2", kind: "group", x: 0.2, y: 0.2, size: 40, ...look }],
    icons: [{ id: "boss", x: 0.5, y: 0.5, size: 48, rotation: 350, ...look }],
    marks: [{ id: "m1", x: 0.6, y: 0.6, size: 34, ...look }],
    zones: [{ id: "z1", x: 0.1, y: 0.1, w: 0.2, h: 0.2, ...look }],
    lines: [{ id: "l1", x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.3, ...look }],
    texts: [{ id: "t1", x: 0.4, y: 0.4, size: 14, ...look }],
    autoPos: {},
    autoStyle: {},
});
const ch = (obj: string, over: Partial<RaidplanChange> = {}): RaidplanChange => ({ obj, delay: 0, dur: 1, ease: "linear", ...over });
const scene = (over: Partial<RaidplanScene> = {}): RaidplanScene => ({ id: "s", title: "S", loop: false, length: 6, stepId: "", frames: [], loops: [], ...over });

// the Bloodboil rotation: group 1 gets the debuff at 2 s, then the groups swap from 3 s on
const bloodboil = scene({
    frames: [
        { id: "f0", at: 0, caption: "Start", changes: [] },
        { id: "f1", at: 2, caption: "Gruppe 1 hat Bloodboil", changes: [ch("slot:g1", { badge: "spell_shadow_bloodboil", pulse: true, dur: 0 })] },
        { id: "f2", at: 3, caption: "Tauschen", changes: [ch("slot:g1", { x: 0.2, y: 0.2, dur: 2 }), ch("slot:g2", { x: 0.2, y: 0.8, dur: 2, delay: 0.5 })] },
    ],
});
const slot = (b: SceneBoard, id: string) => b.slots.find((s) => s.id === id)!;

describe("easing and angles", () => {
    it("runs from 0 to 1 in every kind, slow in and out by default", () => {
        for (const k of ["inout", "linear", "in", "out"] as const) { expect(ease(k, 0)).toBe(0); expect(ease(k, 1)).toBe(1); }
        expect(ease("inout", 0.25)).toBeLessThan(0.25);
        expect(ease("inout", 0.75)).toBeGreaterThan(0.75);
        expect(ease("in", 0.5)).toBe(0.25);
        expect(ease("out", 0.5)).toBe(0.75);
        expect(ease("linear", 2)).toBe(1);
    });
    it("turns the short way round", () => {
        expect(lerpAngle(350, 10, 0.5)).toBe(0);
        expect(lerpAngle(10, 350, 0.5)).toBe(0);
        expect(lerpAngle(0, 90, 0.5)).toBe(45);
    });
});

describe("boardAt", () => {
    it("leaves the board untouched without a scene and before anything starts", () => {
        const b = board();
        expect(boardAt(b, null, 3).board).toBe(b);
        const s = boardAt(b, bloodboil, 1);
        expect(slot(s.board, "g1")).toMatchObject({ x: 0.2, y: 0.8 });
        expect(s.fx).toEqual({});
        expect(s.caption).toBe("Start");
        expect(b.slots[0].y).toBe(0.8);
    });
    it("switches the badge and the pulse when their frame starts and keeps them", () => {
        expect(boardAt(board(), bloodboil, 2).fx).toEqual({ "slot:g1": { badge: "spell_shadow_bloodboil", pulse: true } });
        expect(boardAt(board(), bloodboil, 5.9).fx["slot:g1"].badge).toBe("spell_shadow_bloodboil");
        expect(boardAt(board(), bloodboil, 2).caption).toBe("Gruppe 1 hat Bloodboil");
    });
    it("moves the groups over their time, the second one half a second later", () => {
        const mid = boardAt(board(), bloodboil, 4).board;
        expect(slot(mid, "g1").y).toBeCloseTo(0.5);
        expect(slot(mid, "g2").y).toBeCloseTo(0.35);
        const end = boardAt(board(), bloodboil, 6).board;
        expect(slot(end, "g1").y).toBeCloseTo(0.2);
        expect(slot(end, "g2").y).toBeCloseTo(0.8);
    });
    it("a change that starts while the one before still runs takes over from where the object is", () => {
        const s = scene({ frames: [
            { id: "a", at: 0, caption: "", changes: [ch("token:u1", { x: 0.9, y: 0.1, dur: 2 })] },
            { id: "b", at: 1, caption: "", changes: [ch("token:u1", { x: 0.5, y: 0.9, dur: 1 })] },
        ] });
        const tok = (t: number) => boardAt(board(), s, t).board.tokens[0];
        expect(tok(1)).toMatchObject({ x: 0.5, y: 0.1 });
        expect(tok(1.5).x).toBeCloseTo(0.5);
        expect(tok(1.5).y).toBeCloseTo(0.5);
        expect(tok(3)).toMatchObject({ x: 0.5, y: 0.9 });
    });
    it("turns, fades, sizes and hides every kind of object", () => {
        const s = scene({ frames: [{ id: "a", at: 0, caption: "", changes: [
            ch("icon:boss", { rotation: 30 }), ch("mark:m1", { opacity: 0.5, scale: 2 }), ch("text:t1", { hidden: true }),
            ch("zone:z1", { scale: 2, rotation: 90 }), ch("line:l1", { x: 0.5, y: 0.5 }), ch("slot:g1", { scale: 2 }),
        ] }] });
        const b = boardAt(board(), s, 1).board;
        expect(b.icons[0].rotation).toBe(30);
        expect(b.marks[0]).toMatchObject({ opacity: 0.5, size: 68 });
        expect(b.texts[0].hidden).toBe(true);
        expect(b.zones[0]).toMatchObject({ x: 0, y: 0, w: 0.4, h: 0.4, rotation: 90 });
        expect(b.lines[0]).toMatchObject({ x1: 0.4, y1: 0.4, x2: 0.6, y2: 0.6 });
        expect(slot(b, "g1")).toMatchObject({ size: 80, groupScale: 2 });
        // half way the hidden text is half faded, the icon half turned (through 0)
        const half = boardAt(board(), s, 0.5).board;
        expect(half.texts[0]).toMatchObject({ opacity: 0.5, hidden: false });
        expect(half.icons[0].rotation).toBe(10);
    });
    it("moves an object the tank rows put on the map from where they put it, and turns it off their facing", () => {
        const s = scene({ frames: [{ id: "a", at: 0, caption: "", changes: [ch("auto:t:r1:1", { x: 0.9, y: 0.9, rotation: 90 }), ch("auto:gone", { x: 0.1, y: 0.1 })] }] });
        const b = boardAt(board(), s, 0.5, { "t:r1:1": { x: 0.1, y: 0.1 } }).board;
        expect(b.autoPos!["t:r1:1"]).toEqual({ x: 0.5, y: 0.5 });
        expect(b.autoStyle!["t:r1:1"]).toMatchObject({ rotation: 45, autoFace: false, opacity: 1 });
        expect(b.autoPos!.gone).toBeUndefined();
    });
    it("follows a movement's path through its points", () => {
        const s = scene({ frames: [{ id: "a", at: 0, caption: "", changes: [ch("token:u1", { x: 0.9, y: 0.1, path: [[0.5, 0.9]] })] }] });
        const tok = boardAt(board(), s, 0.5).board.tokens[0];
        expect(tok.x).toBeCloseTo(0.5, 1);
        expect(tok.y).toBeGreaterThan(0.8);
        expect(pathPoint({ x: 0, y: 0 }, [], { x: 1, y: 1 }, 0.25)).toEqual({ x: 0.25, y: 0.25 });
    });
    it("a loop moves its object round its path while it runs and leaves a trail", () => {
        const loop = { id: "k", obj: "icon:boss", path: [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]] as [number, number][], closed: true, period: 8, from: 1, to: 0, trail: true };
        expect(loopPoint(loop, 0.5)).toBeNull();
        expect(loopPoint(loop, 1)).toEqual({ x: 0.2, y: 0.2 });
        const s = scene({ frames: [{ id: "a", at: 0, caption: "", changes: [] }], loops: [loop] });
        const st = boardAt(board(), s, 3);
        expect(st.board.icons[0].x).toBeGreaterThan(0.6);
        expect(st.trails[0].points.length).toBeGreaterThan(5);
        // an open path goes there and back
        const open = { ...loop, closed: false, path: [[0, 0.5], [1, 0.5]] as [number, number][], period: 4, from: 0, to: 5 };
        expect(loopPoint(open, 2)!.x).toBeCloseTo(1);
        expect(loopPoint(open, 6)).toBeNull();
    });
});

describe("a single raider of a split group (member)", () => {
    // group g1 stands at (0.2, 0.8); Heilbert's ring place is 0.05 to its right, Klinge has a stored offset
    const withGroup = (): SceneBoard => {
        const b = board();
        b.slots = [{ id: "g1", kind: "group", x: 0.2, y: 0.8, size: 40, opacity: 1, hidden: false, groupScale: 2, offsets: { klinge: { dx: 0, dy: -0.05, size: 38 } } }];
        return b;
    };
    const ring = { "g1~heil": { x: 0.05, y: 0 } };
    const off = (b: SceneBoard, u: string) => b.slots[0].offsets![u];
    it("knows where a member stands: his stored offset (times the group's spread), else his ring place", () => {
        expect(positionOf(withGroup(), "member:g1~heil", {}, ring)).toEqual({ x: 0.25, y: 0.8 });
        const k = positionOf(withGroup(), "member:g1~klinge", {}, ring)!;
        expect(k.x).toBeCloseTo(0.2);
        expect(k.y).toBeCloseTo(0.7);
        expect(positionOf(withGroup(), "member:g1~nobody", {}, ring)).toBeNull();
        expect(positionOf(withGroup(), "member:gone~heil", {}, ring)).toBeNull();
    });
    it("a member's change moves only him: written as an offset to the marker, the group stays", () => {
        const sc = scene({ frames: [{ id: "a", at: 0, caption: "", changes: [ch("member:g1~heil", { x: 0.6, y: 0.4 })] }] });
        const b = boardAt(withGroup(), sc, 1, {}, ring).board;
        expect(b.slots[0]).toMatchObject({ x: 0.2, y: 0.8 });
        // spread 2: (0.6 - 0.2) / 2, (0.4 - 0.8) / 2
        // `away`: his group's ring does not stretch to him
        expect(off(b, "heil")).toEqual({ dx: 0.2, dy: -0.2, size: 40, away: true });
        expect(off(b, "klinge")).toEqual({ dx: 0, dy: -0.05, size: 38 });
        // half way he is between his ring place and the target
        const half = off(boardAt(withGroup(), sc, 0.5, {}, ring).board, "heil");
        expect(half.dx * 2 + 0.2).toBeCloseTo(0.425);
    });
    it("follows his moving group until his own change starts, then goes from where he is to an absolute place", () => {
        const sc = scene({ frames: [
            { id: "a", at: 0, caption: "", changes: [ch("slot:g1", { x: 0.5, y: 0.5, dur: 2 })] },
            { id: "b", at: 1, caption: "", changes: [ch("member:g1~heil", { x: 0.9, y: 0.9, dur: 1 })] },
        ] });
        // at 0.5 s he has not started: no offset of his own, the ring carries him with the group
        expect(boardAt(withGroup(), sc, 0.5, {}, ring).board.slots[0].offsets!.heil).toBeUndefined();
        // at 1 s he starts from his ring place beside the group, which is half way: (0.35 + 0.05, 0.65)
        const start = boardAt(withGroup(), sc, 1, {}, ring).board.slots[0];
        expect(start.x + start.offsets!.heil.dx * 2).toBeCloseTo(0.4);
        expect(start.y + start.offsets!.heil.dy * 2).toBeCloseTo(0.65);
        // when everything has arrived he stands at his target, the group at its own
        const end = boardAt(withGroup(), sc, 3, {}, ring).board.slots[0];
        expect(end).toMatchObject({ x: 0.5, y: 0.5 });
        expect(end.x + end.offsets!.heil.dx * 2).toBeCloseTo(0.9);
        expect(end.y + end.offsets!.heil.dy * 2).toBeCloseTo(0.9);
    });
    it("a member's loop and his badge work like any object's; boardAfter and the hints know members too", () => {
        const loop = { id: "k", obj: "member:g1~heil", path: [[0.3, 0.3], [0.7, 0.3]] as [number, number][], closed: false, period: 4, from: 0, to: 0, trail: false };
        const sc = scene({ frames: [{ id: "a", at: 0, caption: "", changes: [] }, { id: "b", at: 1, caption: "", changes: [ch("member:g1~heil", { badge: "spell_shadow_bloodboil", x: 0.25, y: 0.2, dur: 0 })] }], loops: [loop] });
        const st = boardAt(withGroup(), sc, 2, {}, ring);
        expect(st.fx["member:g1~heil"]).toEqual({ badge: "spell_shadow_bloodboil" });
        const s0 = st.board.slots[0];
        expect(s0.x + s0.offsets!.heil.dx * 2).toBeCloseTo(0.7);
        expect(off(boardAfter(withGroup(), sc, 1, {}, ring).board, "heil").dy).toBeCloseTo(-0.3);
        expect(moveHints(withGroup(), sc, 1, {}, ring)[0].obj).toBe("member:g1~heil");
    });
});

describe("frames", () => {
    it("knows the frame that is on, when it has arrived, how long it lasts", () => {
        expect(frameAt(bloodboil, 0)).toBe(0);
        expect(frameAt(bloodboil, 2.5)).toBe(1);
        expect(frameAt(bloodboil, 9)).toBe(2);
        expect(frameRest(bloodboil, 2)).toBe(5.5);
        expect(frameRest(bloodboil, 9)).toBe(0);
        expect(frameLength(bloodboil, 0)).toBe(2);
        expect(frameLength(bloodboil, 2)).toBe(3);
        expect(frameLength(bloodboil, 5)).toBe(0);
    });
    it("boardAfter shows a frame with everything up to it arrived and no loops", () => {
        const s = boardAfter(board(), bloodboil, 2);
        expect(slot(s.board, "g1").y).toBeCloseTo(0.2);
        expect(s.caption).toBe("Tauschen");
        expect(slot(boardAfter(board(), bloodboil, 1).board, "g1").y).toBe(0.8);
    });
    it("plays only scenes with something to play; prints the time", () => {
        expect(playable([bloodboil, scene({ frames: [{ id: "a", at: 0, caption: "", changes: [] }] })])).toEqual([bloodboil]);
        expect(playable(undefined)).toEqual([]);
        expect(clock(67.4)).toBe("1:07");
    });
});
