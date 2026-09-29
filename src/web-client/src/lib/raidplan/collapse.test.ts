import { describe, expect, it } from "vitest";
import { parseCollapseSet, parseCollapsed, toggleCollapseId } from "./collapse";

describe("parseCollapsed", () => {
    it("only \"1\" is folded, everything else (missing, other text, garbage) is open", () => {
        expect(parseCollapsed("1")).toBe(true);
        expect(parseCollapsed("0")).toBe(false);
        expect(parseCollapsed(null)).toBe(false);
        expect(parseCollapsed("")).toBe(false);
        expect(parseCollapsed("true")).toBe(false);
    });
});

describe("parseCollapseSet", () => {
    it("reads a stored array of ids", () => {
        expect(parseCollapseSet('["heal","tank"]')).toEqual(["heal", "tank"]);
        expect(parseCollapseSet(null)).toEqual([]);
        expect(parseCollapseSet("[]")).toEqual([]);
    });
    it("drops anything that is not an array of strings (corrupted storage opens everything)", () => {
        expect(parseCollapseSet("not json")).toEqual([]);
        expect(parseCollapseSet("42")).toEqual([]);
        expect(parseCollapseSet('{"heal":true}')).toEqual([]);
        expect(parseCollapseSet('["heal", 3, null, "tank"]')).toEqual(["heal", "tank"]);
    });
});

describe("toggleCollapseId", () => {
    it("adds an id that is not folded yet, keeping the others", () => {
        expect(toggleCollapseId(["heal"], "tank")).toEqual(["heal", "tank"]);
    });
    it("removes an id that is already folded, keeping the others", () => {
        expect(toggleCollapseId(["heal", "tank"], "heal")).toEqual(["tank"]);
    });
});
