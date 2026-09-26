// Group colours and raid marks (lib/raidplan/groupStyle.ts).
import { describe, expect, it } from "vitest";
import * as gs from "./groupStyle";

const board = (over = {}) => ({ groupColors: {}, groupMarks: {}, ...over });

describe("group colours", () => {
    it("group n has a fixed default from a palette of eight distinct colours, and the ninth starts over", () => {
        expect(new Set(gs.GROUP_PALETTE).size).toBe(8);
        for (const c of gs.GROUP_PALETTE) expect(c).toMatch(/^#[0-9A-F]{6}$/);
        expect(gs.defaultGroupColor(1)).toBe(gs.GROUP_PALETTE[0]);
        expect(gs.defaultGroupColor(8)).toBe(gs.GROUP_PALETTE[7]);
        expect(gs.defaultGroupColor(9)).toBe(gs.GROUP_PALETTE[0]);
        expect(gs.groupColor(undefined, 3)).toBe(gs.GROUP_PALETTE[2]);
    });
    it("an own colour wins, a broken one is ignored, and resetting goes back to the default", () => {
        expect(gs.groupColor({ 2: "#123456" }, 2)).toBe("#123456");
        expect(gs.groupColor({ 2: "red" }, 2)).toBe(gs.GROUP_PALETTE[1]);
        const b = gs.setGroupColor(board(), 2, "#ABCDEF");
        expect(b.groupColors).toEqual({ 2: "#abcdef" });
        expect(gs.setGroupColor(b, 2, "").groupColors).toEqual({});
    });
    it("the ink on a colour is black on light colours and white on dark ones", () => {
        expect(gs.inkOn("#F0E442")).toBe("#000000");
        expect(gs.inkOn("#E69F00")).toBe("#000000");
        expect(gs.inkOn("#0072B2")).toBe("#ffffff");
        expect(gs.inkOn("#000000")).toBe("#ffffff");
        expect(gs.inkOn("nonsense")).toBe("#000000");
    });
});

describe("group marks", () => {
    it("a mark sits on one group only: giving it to another swaps them", () => {
        let b = gs.setGroupMark(board(), 1, "skull");
        b = gs.setGroupMark(b, 2, "cross");
        expect(b.groupMarks).toEqual({ 1: "skull", 2: "cross" });
        const swapped = gs.setGroupMark(b, 2, "skull");
        expect(swapped.groupMarks).toEqual({ 1: "cross", 2: "skull" });
        const taken = gs.setGroupMark(gs.setGroupMark(board(), 1, "star"), 3, "star");
        expect(taken.groupMarks).toEqual({ 3: "star" });
    });
    it("no mark clears the group; an unknown mark reads as none", () => {
        expect(gs.setGroupMark(gs.setGroupMark(board(), 1, "moon"), 1, "").groupMarks).toEqual({});
        expect(gs.groupMark({ 1: "moon" }, 1)).toBe("moon");
        expect(gs.groupMark({ 1: "banana" }, 1)).toBe("");
        expect(gs.groupMark(undefined, 1)).toBe("");
        expect(gs.GROUP_MARKS).toHaveLength(8);
    });
    it("the board is not changed in place", () => {
        const b = board({ groupMarks: { 1: "skull" } });
        gs.setGroupMark(b, 2, "skull");
        expect(b.groupMarks).toEqual({ 1: "skull" });
    });
});
