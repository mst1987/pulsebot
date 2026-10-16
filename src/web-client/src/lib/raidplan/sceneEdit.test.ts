import { describe, expect, it } from "vitest";
import type { RaidplanBoard, RaidplanScene } from "../../api";
import { PATH_LIMITS, addFrame, addLoop, addScene, changeOf, frameSummary, insertIndex, insertPoint, loopInsertIndex, loopsOf, moveFrame, moveIn, movePoint, newLoopId, newScene, patchChange, pathOf, removeChange, removeFrame, removeLoop, removePoint, removeScene, sceneRef, setCaption, setFrameLength, setPath, updateLoop, withScene, SCENE_LIMITS } from "./sceneEdit";

const scene = (): RaidplanScene => ({
    id: "s", title: "S", loop: false, length: 6, stepId: "", loops: [],
    frames: [
        { id: "a", at: 0, caption: "Start", changes: [] },
        { id: "b", at: 2, caption: "Debuff", changes: [{ obj: "slot:g1", badge: "x", delay: 0, dur: 0, ease: "inout" }] },
        { id: "c", at: 3, caption: "Tauschen", changes: [{ obj: "slot:g1", x: 0.2, y: 0.2, delay: 0, dur: 2, ease: "inout" }] },
    ],
});
const ats = (s: RaidplanScene) => s.frames.map((f) => f.at);

describe("scenes on a board", () => {
    it("adds, changes and removes scenes, at most eight", () => {
        let b = { scenes: [] } as unknown as RaidplanBoard;
        const s = newScene("Bloodboil-Rotation");
        expect(s).toMatchObject({ title: "Bloodboil-Rotation", length: 2, loop: false, frames: [{ at: 0, changes: [] }] });
        b = addScene(b, s);
        b = withScene(b, s.id, (x) => ({ ...x, loop: true }));
        expect(b.scenes![0].loop).toBe(true);
        expect(withScene(b, "nope", (x) => x)).toBe(b);
        expect(removeScene(b, s.id).scenes).toEqual([]);
        let full = { scenes: [] } as unknown as RaidplanBoard;
        for (let i = 0; i < 9; i++) full = addScene(full, newScene(`S${i}`));
        expect(full.scenes).toHaveLength(SCENE_LIMITS.scenes);
    });
});

describe("frames keep a timeline", () => {
    it("a new frame starts where the scene stands after frame k, the later ones move back", () => {
        expect(ats(addFrame(scene(), 0))).toEqual([0, 2, 4, 5]);
        const end = addFrame(scene(), 2);
        expect(ats(end)).toEqual([0, 2, 3, 6]);
        expect(end.length).toBe(8);
        expect(end.frames[3]).toMatchObject({ caption: "", changes: [] });
    });
    it("removing a frame moves the later ones forward; the first left starts at 0; never the last frame", () => {
        expect(ats(removeFrame(scene(), 1))).toEqual([0, 2]);
        expect(removeFrame(scene(), 1).length).toBe(5);
        const first = removeFrame(scene(), 0);
        expect(ats(first)).toEqual([0, 1]);
        expect(first.length).toBe(4);
        const one = newScene("x");
        expect(removeFrame(one, 0)).toBe(one);
    });
    it("lengthening a frame moves the frames after it, a too short one is a tenth", () => {
        expect(ats(setFrameLength(scene(), 1, 3))).toEqual([0, 2, 5]);
        expect(setFrameLength(scene(), 2, 1).length).toBe(4);
        expect(ats(setFrameLength(scene(), 0, 0))).toEqual([0, 0.1, 1.1]);
        expect(setFrameLength(scene(), 9, 3).frames).toHaveLength(3);
    });
    it("moving a frame swaps what two frames show, the times stay; what lands first takes no time", () => {
        const m = moveFrame(scene(), 2, -1);
        expect(m.frames.map((f) => f.caption)).toEqual(["Start", "Tauschen", "Debuff"]);
        expect(ats(m)).toEqual([0, 2, 3]);
        const toFirst = moveFrame(scene(), 1, -1);
        expect(toFirst.frames[0].changes[0]).toMatchObject({ delay: 0, dur: 0 });
        expect(moveFrame(scene(), 0, -1).frames[0].caption).toBe("Start");
    });
    it("sets a caption (cut to 120 characters)", () => {
        expect(setCaption(scene(), 1, "y".repeat(200)).frames[1].caption).toHaveLength(SCENE_LIMITS.caption);
    });
});

describe("changes of an object in a frame", () => {
    it("creates a change with a second (no time in the first frame), merges fields, takes one off with undefined", () => {
        let s = moveIn(scene(), 1, "token:u1", 1.4, 0.5);
        expect(changeOf(s, 1, "token:u1")).toEqual({ obj: "token:u1", x: 1, y: 0.5, delay: 0, dur: 1, ease: "inout" });
        s = patchChange(s, 1, "token:u1", { rotation: 90, ease: "linear" });
        expect(changeOf(s, 1, "token:u1")).toMatchObject({ x: 1, rotation: 90, ease: "linear" });
        s = patchChange(s, 1, "token:u1", { rotation: undefined });
        expect(changeOf(s, 1, "token:u1")!.rotation).toBeUndefined();
        expect(changeOf(moveIn(scene(), 0, "token:u1", 0.5, 0.5), 0, "token:u1")).toMatchObject({ dur: 0, delay: 0 });
        expect(changeOf(patchChange(scene(), 0, "token:u1", { dur: 3, opacity: 0.5 }), 0, "token:u1")!.dur).toBe(0);
    });
    it("a change left with nothing to change goes; removeChange takes it off", () => {
        let s = patchChange(scene(), 1, "slot:g1", { badge: undefined });
        expect(changeOf(s, 1, "slot:g1")).toBeUndefined();
        s = removeChange(scene(), 2, "slot:g1");
        expect(s.frames[2].changes).toEqual([]);
        expect(patchChange(scene(), 1, "mark:m", { delay: 2 }).frames[1].changes).toHaveLength(1);
    });
    it("a new change in a short frame takes at most the frame", () => {
        const s = setFrameLength(scene(), 1, 0.5);
        expect(changeOf(moveIn(s, 1, "mark:m", 0.1, 0.1), 1, "mark:m")!.dur).toBe(0.5);
    });
    it("summarises a frame and names the object of a selection", () => {
        expect(frameSummary(scene().frames[2])).toEqual({ moves: 1, total: 1 });
        expect(sceneRef("member", "g1~u7")).toBe("slot:g1");
        expect(sceneRef("member", "g1")).toBe("slot:g1");
        expect(sceneRef("auto", "t:r1:1")).toBe("auto:t:r1:1");
    });
});

describe("ways and loops (#712)", () => {
    it("gives a movement a way through points, only where the object moves; [] makes it straight again", () => {
        let s = setPath(scene(), 2, "slot:g1", [[0.5, 1.4], [0.3, 0.3]]);
        expect(pathOf(s, 2, "slot:g1")).toEqual([[0.5, 1], [0.3, 0.3]]);
        s = setPath(s, 2, "slot:g1", []);
        expect(changeOf(s, 2, "slot:g1")!.path).toBeUndefined();
        expect(setPath(scene(), 1, "slot:g1", [[0.1, 0.1]])).toEqual(scene());
        expect(pathOf(scene(), 1, "nope")).toEqual([]);
    });
    it("puts a clicked point between the neighbours it is closest to", () => {
        const from = { x: 0, y: 0 }, to = { x: 1, y: 0 };
        expect(insertIndex([], 0.5, 0.1, from, to)).toBe(-1);
        expect(insertIndex([[0.5, 0.5]], 0.2, 0.2, from, to)).toBe(-1);
        expect(insertIndex([[0.5, 0.5]], 0.8, 0.2, from, to)).toBe(0);
        expect(insertPoint([[0.5, 0.5]], -1, 0.2, 0.2)).toEqual([[0.2, 0.2], [0.5, 0.5]]);
        expect(movePoint([[0.5, 0.5], [0.1, 0.1]], 1, 0.3, 2)).toEqual([[0.5, 0.5], [0.3, 1]]);
        expect(removePoint([[0.5, 0.5], [0.1, 0.1]], 0)).toEqual([[0.1, 0.1]]);
    });
    it("a loop's path grows at its end first, then into the closest segment (the closing one too)", () => {
        expect(loopInsertIndex([[0, 0]], 1, 1, true)).toBe(0);
        expect(loopInsertIndex([[0, 0], [1, 0]], 0.5, 0.1, true)).toBe(0);
        // a square's closing side (last point back to the first)
        expect(loopInsertIndex([[0, 0], [1, 0], [1, 1], [0, 1]], 0.05, 0.5, true)).toBe(3);
        // an open path clicked beyond its end grows there
        expect(loopInsertIndex([[0, 0], [0.5, 0]], 0.9, 0, false)).toBe(1);
    });
    it("adds, changes and removes loops; their numbers stay in range", () => {
        const r = addLoop(scene(), "icon:boss", { x: 0.2, y: 0.3 }, 3, "k1");
        expect(r.id).toBe("k1");
        expect(r.scene.loops).toEqual([{ id: "k1", obj: "icon:boss", path: [[0.2, 0.3]], closed: true, period: 10, from: 3, to: 0, trail: false }]);
        let s = updateLoop(r.scene, "k1", { period: 0, to: 2, path: [[0.2, 0.3], [2, 0.5]], trail: true });
        expect(s.loops[0]).toMatchObject({ period: 1, to: 0, path: [[0.2, 0.3], [1, 0.5]], trail: true });
        s = updateLoop(s, "k1", { to: 9 });
        expect(s.loops[0].to).toBe(9);
        expect(loopsOf(s, "icon:boss")).toHaveLength(1);
        expect(loopsOf(s, "mark:m")).toEqual([]);
        expect(removeLoop(s, "k1").loops).toEqual([]);
        expect(typeof newLoopId()).toBe("string");
        let full = scene();
        for (let i = 0; i < 13; i++) full = addLoop(full, "icon:boss", { x: 0, y: 0 }, 0).scene;
        expect(full.loops).toHaveLength(PATH_LIMITS.loops);
        expect(addLoop(full, "icon:boss", { x: 0, y: 0 }, 0).id).toBe("");
    });
});
