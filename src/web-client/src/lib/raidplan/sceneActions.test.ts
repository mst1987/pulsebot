import { describe, expect, it } from "vitest";
import type { RaidplanBoard, RaidplanPlayer, RaidplanScene } from "../../api";
import { emptyBoard, rosterMap } from "./index";
import { actorIndex, actsIn, centroid, direction, frameParts, loopAll, loopsInFrame, moveAllTo, patchAll, removePart, sceneActors, selectionSummary } from "./sceneActions";
import { memberOffsets } from "./members";
import { changeOf } from "./sceneEdit";

const player = (userId: string, character: string, group: number, role = "melee"): RaidplanPlayer => ({ userId, character, classId: "Rogue", className: "Rogue", classColor: "#fff468", spec: "", specLabel: "Combat", role, iconUrl: "", group });
const ROSTER = [player("u1", "Baerchen", 3, "tank"), player("u2", "Scharfsch", 3), player("u3", "Richter", 3), player("u4", "Heilbert", 4, "healer"), player("u5", "Solo", 5)];
const look = { opacity: 1, lock: false, hidden: false };
function board(): RaidplanBoard {
    return {
        ...emptyBoard(),
        slots: [
            { id: "g3", kind: "group", n: 3, label: "", x: 0.5, y: 0.8, userId: "", size: 38, hideMembers: false, split: true, offsets: {}, ...look },
            { id: "g4", kind: "group", n: 4, label: "", x: 0.2, y: 0.7, userId: "", size: 38, hideMembers: false, split: false, offsets: {}, ...look },
            { id: "t1", kind: "tank", n: 1, label: "", x: 0.5, y: 0.3, userId: "u1", size: 38, hideMembers: false, split: false, offsets: {}, ...look },
        ],
        tokens: [{ userId: "u5", x: 0.9, y: 0.9, size: 38, ...look }],
        icons: [{ id: "boss", iconKey: "bosspos", label: "", showLabel: false, x: 0.5, y: 0.1, size: 48, rotation: 0, mobId: "b:bt/gurtogg", autoFace: true, ...look }],
        marks: [{ id: "m1", mark: "skull", x: 0.1, y: 0.1, size: 34, ...look }],
        mobs: [{ id: "b:bt/gurtogg", name: "Gurtogg", icon: "" }],
    } as RaidplanBoard;
}
const scene = (over: Partial<RaidplanScene> = {}): RaidplanScene => ({ id: "s", title: "S", loop: false, length: 6, stepId: "", frames: [{ id: "a", at: 0, caption: "", changes: [] }, { id: "b", at: 2, caption: "", changes: [] }], loops: [], ...over });

describe("the actors of a board", () => {
    const actors = sceneActors(board(), ROSTER, rosterMap(ROSTER), null);
    const index = actorIndex(actors);
    it("lists groups with their raiders, players and places, enemies and marks", () => {
        expect(actors.map((a) => [a.ref, a.section, a.label])).toEqual([
            ["slot:g3", "groups", "Gruppe 3"],
            ["slot:g4", "groups", "Gruppe 4"],
            ["token:u5", "players", "Solo"],
            ["slot:t1", "players", "Baerchen"],
            ["icon:boss", "enemies", "Gurtogg"],
            ["mark:m1", "marks", "Totenkopf"],
        ]);
        // a split group: its raiders one by one, minus the one with a place of his own (Baerchen stands in Tank 1)
        expect(index.get("slot:g3")!.raiders.map((r) => [r.ref, r.label, r.sub])).toEqual([["member:g3~u2", "Scharfsch", "aus Gruppe 3"], ["member:g3~u3", "Richter", "aus Gruppe 3"]]);
        // a group that lists its names below the marker has no raiders to pick, but names them
        expect(index.get("slot:g4")!.raiders).toEqual([]);
        expect(index.get("slot:g4")!.sub).toBe("Heilbert");
        expect(index.get("member:g3~u2")).toMatchObject({ canFade: false, canTurn: false });
        expect(index.get("icon:boss")).toMatchObject({ canFade: true, canTurn: true });
    });
    it("says in a line what is picked", () => {
        expect(selectionSummary(["slot:g3"], index)).toEqual({ title: "Gruppe 3 · 2 Spieler", names: ["Scharfsch", "Richter"] });
        expect(selectionSummary(["member:g3~u3"], index)).toEqual({ title: "Richter", names: ["aus Gruppe 3"] });
        expect(selectionSummary(["slot:g3", "mark:m1"], index)).toEqual({ title: "2 ausgewählt", names: ["Scharfsch", "Richter", "Totenkopf"] });
        expect(selectionSummary([], index)).toEqual({ title: "", names: [] });
    });
    it("puts the raiders of a split group in the ring the board draws", () => {
        const offs = memberOffsets(board(), ROSTER, 16 / 10);
        expect(Object.keys(offs)).toEqual(["g3~u2", "g3~u3"]);
        // two raiders stand opposite each other round the marker
        expect(offs["g3~u2"].x).toBeCloseTo(-offs["g3~u3"].x);
        expect(Math.hypot(offs["g3~u2"].x, offs["g3~u2"].y)).toBeGreaterThan(0.005);
        // one with a stored offset keeps his own place (not listed)
        const b = board();
        b.slots[0].offsets = { u2: { dx: 0.1, dy: 0, size: 38 } };
        expect(Object.keys(memberOffsets(b, ROSTER))).toEqual(["g3~u3"]);
    });
});

describe("a frame as readable parts", () => {
    it("names the way a movement goes and every other part of a change", () => {
        expect(direction({ x: 0.5, y: 0.5 }, { x: 0.2, y: 0.8 })).toBe("downLeft");
        expect(direction({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.1 })).toBe("up");
        expect(direction({ x: 0.5, y: 0.5 }, { x: 0.9, y: 0.52 })).toBe("right");
        expect(direction({ x: 0.5, y: 0.5 }, { x: 0.505, y: 0.5 })).toBe("");
        const s = scene({ frames: [scene().frames[0], { id: "b", at: 2, caption: "", changes: [
            { obj: "slot:g3", x: 0.2, y: 0.9, path: [[0.3, 0.95]], badge: "spell_shadow_bloodboil", pulse: false, delay: 0, dur: 2, ease: "inout" },
            { obj: "icon:boss", rotation: 90, hidden: true, opacity: 0.5, scale: 2, delay: 0.4, dur: 1, ease: "linear" },
        ] }] });
        const parts = frameParts(s, 1, (ref) => (ref === "slot:g3" ? { x: 0.5, y: 0.8 } : null));
        expect(parts.map((p) => [p.obj, p.part, p.dir, p.points, p.value])).toEqual([
            ["slot:g3", "move", "left", 1, undefined],
            ["slot:g3", "badge", "", 0, "spell_shadow_bloodboil"],
            ["slot:g3", "pulse", "", 0, false],
            ["icon:boss", "hidden", "", 0, true],
            ["icon:boss", "rotation", "", 0, 90],
            ["icon:boss", "opacity", "", 0, 0.5],
            ["icon:boss", "scale", "", 0, 2],
        ]);
        expect(frameParts(s, 9, () => null)).toEqual([]);
        // taking a part off leaves the rest; the last part takes the change with it
        const noMove = removePart(s, 1, "slot:g3", "move");
        expect(changeOf(noMove, 1, "slot:g3")).toMatchObject({ badge: "spell_shadow_bloodboil", pulse: false });
        expect(changeOf(noMove, 1, "slot:g3")!.x).toBeUndefined();
        expect(changeOf(removePart(removePart(noMove, 1, "slot:g3", "badge"), 1, "slot:g3", "pulse"), 1, "slot:g3")).toBeUndefined();
    });
    it("lists the loops that start in a frame and knows who acts there", () => {
        const loop = (id: string, from: number) => ({ id, obj: "slot:g3", path: [[0, 0], [1, 1]] as [number, number][], closed: true, period: 10, from, to: 0, trail: false });
        const s = scene({ loops: [loop("a", 0.5), loop("b", 2), loop("c", 5)] });
        expect(loopsInFrame(s, 0).map((l) => l.id)).toEqual(["a"]);
        expect(loopsInFrame(s, 1).map((l) => l.id)).toEqual(["b", "c"]);
        expect(loopsInFrame(s, 7)).toEqual([]);
        expect(actsIn(s, 1, "slot:g3")).toBe(true);
        expect(actsIn(s, 1, "mark:m1")).toBe(false);
    });
});

describe("one action for several actors", () => {
    const pos: Record<string, { x: number; y: number }> = { "slot:g3": { x: 0.4, y: 0.8 }, "member:g3~u2": { x: 0.6, y: 0.8 } };
    const posOf = (r: string) => pos[r] || null;
    it("walks them together: their middle ends at the target, each keeps his place", () => {
        expect(centroid([])).toEqual({ x: 0.5, y: 0.5 });
        const s = moveAllTo(scene(), 1, ["slot:g3", "member:g3~u2", "nobody"], posOf, { x: 0.5, y: 0.3 });
        expect(changeOf(s, 1, "slot:g3")).toMatchObject({ x: 0.4, y: 0.3 });
        expect(changeOf(s, 1, "member:g3~u2")).toMatchObject({ x: 0.6, y: 0.3 });
        expect(changeOf(s, 1, "nobody")).toBeUndefined();
    });
    it("gives all of them the same badge, and each a loop along the way, shifted by his place", () => {
        const s = patchAll(scene(), 1, ["slot:g3", "mark:m1"], { badge: "spell_fire_felfire", pulse: true });
        expect(changeOf(s, 1, "mark:m1")).toMatchObject({ badge: "spell_fire_felfire", pulse: true });
        const r = loopAll(scene(), ["slot:g3", "member:g3~u2"], posOf, [{ x: 0.5, y: 0.2 }, { x: 0.8, y: 0.5 }], 2);
        expect(r.ids).toHaveLength(2);
        const [a, b] = r.scene.loops;
        expect(a).toMatchObject({ obj: "slot:g3", from: 2 });
        expect(a.path.flat().map((v) => Math.round(v * 100) / 100)).toEqual([0.4, 0.8, 0.4, 0.2, 0.7, 0.5]);
        expect(b.path[0]).toEqual([0.6, 0.8]);
        expect(b.path[1][0]).toBeCloseTo(0.6);
    });
});
