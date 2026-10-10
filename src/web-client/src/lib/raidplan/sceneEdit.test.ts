import { describe, expect, it } from "vitest";
import type { RaidplanBoard, RaidplanScene } from "../../api";
import { addFrame, addScene, changeOf, frameSummary, moveFrame, moveIn, newScene, patchChange, removeChange, removeFrame, removeScene, sceneRef, setCaption, setFrameLength, withScene, SCENE_LIMITS } from "./sceneEdit";

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
