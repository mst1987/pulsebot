// The animated scenes of a raid plan section (src/services/raidplan/raidplanScenes.js): validation, limits, the board's own
// cleaning and copying a template's board under new ids.
const scenes = require("../../../src/services/raidplan/raidplanScenes");
const board = require("../../../src/services/raidplan/raidplanBoard");

const objects = {
    tokens: [{ userId: "u1", x: 0.1, y: 0.1 }],
    slots: [{ id: "g1", kind: "group", n: 1, label: "", x: 0.2, y: 0.8 }, { id: "g2", kind: "group", n: 2, label: "", x: 0.2, y: 0.3 }],
    icons: [{ id: "boss", iconKey: "bosspos", x: 0.5, y: 0.2 }],
    marks: [{ id: "m1", mark: "skull", x: 0.5, y: 0.5 }],
    zones: [{ id: "z1", shape: "rect", type: "danger", x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
    lines: [{ id: "l1", kind: "arrow", x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.3 }],
    texts: [{ id: "t1", text: "Hier", x: 0.4, y: 0.4 }],
};
const clean = (raw, stepIds) => scenes.cleanScenes(raw, objects, stepIds);

describe("cleaning scenes", () => {
    it("keeps a full scene: frames in time order from 0, changes of known objects, timing defaults", () => {
        const r = clean([{
            id: "s1", title: " Bloodboil  Rotation ", loop: true, length: 9,
            frames: [
                { id: "f2", at: 3, caption: "Gruppe 1 hat Bloodboil", changes: [{ obj: "slot:g1", badge: "Ability_Warrior_BloodFrenzy", pulse: true }] },
                { id: "f1", at: 0.4, caption: "Start", changes: [] },
                { id: "f3", at: 4, changes: [{ obj: "slot:g1", x: 0.2, y: 0.3, delay: 0.25, dur: 2, ease: "linear" }, { obj: "slot:g2", x: 2, y: -1, ease: "bounce" }] },
            ],
        }]);
        expect(r.scenes).toEqual([{
            id: "s1", title: "Bloodboil Rotation", loop: true, length: 9, stepId: "",
            frames: [
                { id: "f1", at: 0, caption: "Start", changes: [] },
                { id: "f2", at: 3, caption: "Gruppe 1 hat Bloodboil", changes: [{ obj: "slot:g1", badge: "ability_warrior_bloodfrenzy", pulse: true, delay: 0, dur: 1, ease: "inout" }] },
                { id: "f3", at: 4, caption: "", changes: [
                    { obj: "slot:g1", x: 0.2, y: 0.3, delay: 0.3, dur: 2, ease: "linear" },
                    { obj: "slot:g2", x: 1, y: 0, delay: 0, dur: 1, ease: "inout" },
                ] },
            ],
            loops: [],
        }]);
    });
    it("drops what means no object of the board, what changes nothing and a second change of the same object in a frame", () => {
        const r = clean([{ frames: [{ changes: [
            { obj: "slot:nope", x: 0.5, y: 0.5 }, { obj: "token:stranger", x: 0.5, y: 0.5 }, { obj: "slot:g1" }, { obj: "bogus:g1", x: 0.1, y: 0.1 },
            { obj: "token:u1", x: 0.3, y: 0.3 }, { obj: "token:u1", x: 0.9, y: 0.9 }, { obj: "auto:t:r1:1", rotation: 370 }, { obj: "auto:x", opacity: 0.5 },
            { obj: "icon:boss", x: 0.5 }, { obj: "mark:m1", badge: "not an icon!" },
        ] }] }]);
        expect(r.scenes[0].frames[0].changes).toEqual([
            { obj: "token:u1", x: 0.3, y: 0.3, delay: 0, dur: 1, ease: "inout" },
            { obj: "auto:t:r1:1", rotation: 10, delay: 0, dur: 1, ease: "inout" },
        ]);
    });
    it("clamps values and keeps a movement's path, hidden / shown and an empty badge (taken off)", () => {
        const [s] = clean([{ frames: [{ changes: [
            { obj: "zone:z1", x: 0.5, y: 0.5, path: [[0.1, 0.2], [5, -3], "x", [0.3]], opacity: 0, scale: 9, hidden: true, badge: "", delay: 99, dur: -1 },
            { obj: "text:t1", path: [[0.1, 0.1]], hidden: false },
        ] }] }]).scenes;
        expect(s.frames[0].changes).toEqual([
            { obj: "zone:z1", x: 0.5, y: 0.5, path: [[0.1, 0.2], [1, 0]], opacity: 0.1, scale: 4, hidden: true, badge: "", delay: 60, dur: 0, ease: "inout" },
            { obj: "text:t1", hidden: false, delay: 0, dur: 1, ease: "inout" },
        ]);
    });
    it("spaces frames at the same time a tenth apart, ends the scene after its last frame and names an untitled scene", () => {
        const [s] = clean([{ length: 1, frames: [{ at: 2 }, { at: 2 }, { at: 0 }] }]).scenes;
        expect(s.frames.map((f) => f.at)).toEqual([0, 2, 2.1]);
        expect(s.length).toBe(2.2);
        expect(s.title).toBe("Animation 1");
        expect(clean([{ frames: [{ at: 0 }, { at: 3 }] }]).scenes[0].length).toBe(5);
        expect(clean([{}]).scenes[0]).toMatchObject({ frames: [], length: 2, loop: false });
    });
    it("keeps the step a scene stands at only when the board has it", () => {
        expect(clean([{ stepId: "st1" }], ["st1"]).scenes[0].stepId).toBe("st1");
        expect(clean([{ stepId: "gone" }], ["st1"]).scenes[0].stepId).toBe("");
    });
    it("keeps loops with a path of two points or more on known objects", () => {
        const [s] = clean([{ loops: [
            { id: "k1", obj: "icon:boss", path: [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9]], period: 0, from: 5, to: 2, trail: true },
            { obj: "icon:boss", path: [[0.1, 0.1]] }, { obj: "icon:gone", path: [[0, 0], [1, 1]] },
            { obj: "slot:g1", path: [[0, 0], [1, 1]], closed: false, period: 12, from: 1, to: 8 },
        ] }]).scenes;
        expect(s.loops).toEqual([
            { id: "k1", obj: "icon:boss", path: [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9]], closed: true, period: 1, from: 5, to: 0, trail: true },
            { id: expect.any(String), obj: "slot:g1", path: [[0, 0], [1, 1]], closed: false, period: 12, from: 1, to: 8, trail: false },
        ]);
    });
    it("limits scenes, frames and changes; ids are unique", () => {
        expect(clean(Array.from({ length: 9 }, () => ({}))).code).toBe("invalid");
        const [s] = clean([{ frames: Array.from({ length: 30 }, (_, i) => ({ id: "same", at: i })) }]).scenes;
        expect(s.frames).toHaveLength(scenes.LIMITS.frames);
        expect(new Set(s.frames.map((f) => f.id)).size).toBe(scenes.LIMITS.frames);
        const many = Array.from({ length: 70 }, (_, i) => ({ obj: `auto:t:r${i}:1`, opacity: 0.5 }));
        expect(clean([{ frames: [{ changes: many }] }]).scenes[0].frames[0].changes).toHaveLength(scenes.LIMITS.changes);
        expect(clean("nope").scenes).toEqual([]);
    });
});

describe("scenes on a board", () => {
    const raw = {
        ...objects,
        steps: [{ id: "st1", action: "kite", participants: ["slot:tank:1"], sentence: "kitet", targets: [], timing: {} }],
        scenes: [{ id: "s1", stepId: "st1", frames: [{ changes: [{ obj: "slot:g1", x: 0.2, y: 0.3 }, { obj: "token:u1", x: 0.5, y: 0.5 }, { obj: "auto:t:r1:1", x: 0.5, y: 0.5 }] }], loops: [{ obj: "icon:boss", path: [[0, 0], [1, 1]] }] }],
    };
    it("cleanBoard keeps them against the board's own objects and players", () => {
        const r = board.cleanBoard(raw, { allowedUserIds: ["u1"] });
        expect(r.board.scenes[0].stepId).toBe("st1");
        expect(r.board.scenes[0].frames[0].changes.map((c) => c.obj)).toEqual(["slot:g1", "token:u1", "auto:t:r1:1"]);
        expect(board.boardHasContent(board.cleanBoard({ scenes: [{}] }).board)).toBe(true);
        // a player outside the lineup has no token, so nothing of his stays in the scene either
        expect(board.cleanBoard(raw, { allowedUserIds: [] }).board.scenes[0].frames[0].changes.map((c) => c.obj)).toEqual(["slot:g1", "auto:t:r1:1"]);
        expect(board.cleanBoard({ scenes: Array.from({ length: 9 }, () => ({})) }).code).toBe("invalid");
    });
    it("reidBoard renames scenes, frames, objects and the step; a token reference is not copied", () => {
        const b = board.cleanBoard(raw, { allowedUserIds: ["u1"] }).board;
        const copy = board.reidBoard(b);
        const [s] = copy.scenes;
        expect(s.id).not.toBe("s1");
        expect(s.stepId).toBe(copy.steps[0].id);
        expect(s.stepId).not.toBe("st1");
        const g1 = copy.slots.find((x) => x.n === 1).id;
        expect(s.frames[0].changes.map((c) => c.obj)).toEqual([`slot:${g1}`, "auto:t:r1:1"]);
        expect(s.loops[0].obj).toBe(`icon:${copy.icons[0].id}`);
        // and the copy survives its own cleaning
        expect(board.cleanBoard(copy).board.scenes[0].frames[0].changes).toHaveLength(2);
    });
    it("renameRefs drops what the rename returns nothing for", () => {
        const r = scenes.renameRefs([{ frames: [{ changes: [{ obj: "a" }, { obj: "b" }] }], loops: [{ obj: "a" }] }], (ref) => (ref === "a" ? "x" : ""));
        expect(r[0].frames[0].changes).toEqual([{ obj: "x" }]);
        expect(r[0].loops).toEqual([{ obj: "x" }]);
        expect(scenes.reidScenes(undefined)).toEqual([]);
    });
});
