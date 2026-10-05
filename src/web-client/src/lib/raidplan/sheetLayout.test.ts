import { describe, expect, it } from "vitest";
import { DEFAULT_SHEET_LAYOUT, dragMinePos, nudgeMinePos, parseSheetLayout } from "./sheetLayout";

describe("parseSheetLayout", () => {
    it("nothing stored: the boss strip on the left, the tables closed, the card in its corner", () => {
        expect(parseSheetLayout(null)).toEqual(DEFAULT_SHEET_LAYOUT);
        expect(DEFAULT_SHEET_LAYOUT).toEqual({ strip: "left", allTasks: false, mine: null });
    });
    it("a visitor who switched the strip off keeps it off", () => {
        expect(parseSheetLayout(JSON.stringify({ strip: "off" })).strip).toBe("off");
    });
    it("takes a known strip mode and the tables' switch", () => {
        expect(parseSheetLayout(JSON.stringify({ strip: "left", allTasks: true }))).toEqual({ strip: "left", allTasks: true, mine: null });
        expect(parseSheetLayout(JSON.stringify({ strip: "top" })).strip).toBe("top");
    });
    it("broken or unknown values fall back to the default", () => {
        expect(parseSheetLayout("{nope")).toEqual(DEFAULT_SHEET_LAYOUT);
        expect(parseSheetLayout(JSON.stringify({ strip: "right", allTasks: "yes" }))).toEqual(DEFAULT_SHEET_LAYOUT);
    });
    it("takes the card's place, clamped to the stage; a broken one is the corner again", () => {
        expect(parseSheetLayout(JSON.stringify({ mine: { x: 0.5, y: 0.25 } })).mine).toEqual({ x: 0.5, y: 0.25 });
        expect(parseSheetLayout(JSON.stringify({ mine: { x: 2, y: -1 } })).mine).toEqual({ x: 1, y: 0 });
        expect(parseSheetLayout(JSON.stringify({ mine: { x: "1", y: 0 } })).mine).toBeNull();
        expect(parseSheetLayout(JSON.stringify({ mine: 3 })).mine).toBeNull();
    });
});

describe("dragMinePos", () => {
    it("turns the pixels of a drag into a share of the free room", () => {
        expect(dragMinePos({ x: 0, y: 1 }, 300, -150, { w: 600, h: 300 })).toEqual({ x: 0.5, y: 0.5 });
    });
    it("never leaves the stage", () => {
        expect(dragMinePos({ x: 0.5, y: 0.5 }, 9999, -9999, { w: 600, h: 300 })).toEqual({ x: 1, y: 0 });
    });
    it("an axis without room stays where it was", () => {
        expect(dragMinePos({ x: 0.2, y: 1 }, 100, 100, { w: 0, h: -20 })).toEqual({ x: 0.2, y: 1 });
    });
});

describe("nudgeMinePos", () => {
    it("an arrow key moves one step, clamped", () => {
        expect(nudgeMinePos({ x: 0, y: 1 }, "ArrowRight")).toEqual({ x: 0.05, y: 1 });
        expect(nudgeMinePos({ x: 0, y: 1 }, "ArrowDown")).toEqual({ x: 0, y: 1 });
        expect(nudgeMinePos({ x: 0.5, y: 0.5 }, "ArrowUp")).toEqual({ x: 0.5, y: 0.45 });
    });
    it("another key does not move it", () => {
        expect(nudgeMinePos({ x: 0, y: 1 }, "Enter")).toBeNull();
    });
});
