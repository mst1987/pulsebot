import { describe, expect, it } from "vitest";
import type { RaidplanPlayer } from "../../api";
import { myPlayer, neighbours, sectionGroups, sectionPlace } from "./stage";

const s = (key: string, instanceName: string, extra: { trash?: boolean; general?: boolean } = {}) => ({ key, instanceName, trash: !!extra.trash, general: !!extra.general });
const plan = [
    s("general", "", { general: true }),
    s("bt/najentus", "Black Temple"), s("bt/supremus", "Black Temple"), s("bt/trash", "Black Temple", { trash: true }),
    s("hyjal/rage", "Hyjal"), s("hyjal/anetheron", "Hyjal"),
];

describe("sectionPlace", () => {
    it("numbers a boss among the bosses of its instance, trash and Allgemein not counted", () => {
        expect(sectionPlace(plan, "hyjal/anetheron")).toEqual({ instance: "Hyjal", index: 2, count: 2 });
        expect(sectionPlace(plan, "bt/supremus")).toEqual({ instance: "Black Temple", index: 2, count: 2 });
    });
    it("trash keeps its instance without a number, Allgemein and unknown keys are empty", () => {
        expect(sectionPlace(plan, "bt/trash")).toEqual({ instance: "Black Temple", index: 0, count: 0 });
        expect(sectionPlace(plan, "general")).toEqual({ instance: "", index: 0, count: 0 });
        expect(sectionPlace(plan, "nope")).toEqual({ instance: "", index: 0, count: 0 });
    });
});

describe("neighbours", () => {
    it("finds the sections around a key and null at the ends", () => {
        expect(neighbours(plan, "bt/najentus")).toEqual({ prev: plan[0], next: plan[2] });
        expect(neighbours(plan, "general").prev).toBeNull();
        expect(neighbours(plan, "hyjal/anetheron").next).toBeNull();
        expect(neighbours(plan, "nope")).toEqual({ prev: null, next: null });
    });
});

describe("sectionGroups", () => {
    it("groups runs of one instance in plan order, Allgemein on its own", () => {
        const runs = sectionGroups(plan);
        expect(runs.map((r) => [r.instance, r.items.length])).toEqual([["", 1], ["Black Temple", 3], ["Hyjal", 2]]);
    });
    it("a plan that returns to an instance gets a second run", () => {
        const runs = sectionGroups([s("a/1", "A"), s("b/1", "B"), s("a/2", "A")]);
        expect(runs.map((r) => r.instance)).toEqual(["A", "B", "A"]);
    });
});

describe("myPlayer", () => {
    const p = (userId: string, group: number, outOfPlan = false) => ({ userId, character: userId, group, outOfPlan }) as unknown as RaidplanPlayer;
    it("takes the first of the visitor's characters that stands in the plan", () => {
        const roster = [p("x", 2, true), p("a", 3), p("b", 1)];
        expect(myPlayer(roster, ["x", "b", "a"])).toEqual({ player: roster[2], group: 1 });
    });
    it("no character in the plan: nobody, group 0", () => {
        expect(myPlayer([p("a", 3)], ["z"])).toEqual({ player: null, group: 0 });
        expect(myPlayer([p("a", 0)], ["a"]).group).toBe(0);
    });
});
