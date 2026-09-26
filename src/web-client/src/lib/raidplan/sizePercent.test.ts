// Size in percent for every element and a group as a whole (lib/raidplan.ts, lib/multiSelect.ts): 25 % .. 400 % of the default, in reference units.
import { describe, expect, it } from "vitest";
import * as lib from ".";
import * as ms from "./multiSelect";

const group = (id, n, extra = {}) => ({ id, kind: "group", n, userId: "", x: 0.5, y: 0.5, label: "", size: 38, offsets: {}, placed: true, split: true, opacity: 1, lock: false, hidden: false, ...extra });
const withSlots = (slots) => ({ ...lib.emptyBoard(), slots });

describe("percent of the default", () => {
    it("every kind reaches 25 % .. 400 % of its default", () => {
        for (const kind of ["token", "slot", "mark", "icon", "member", "text", "line"]) {
            const r = lib.SIZE_RANGES[kind];
            expect(r.min).toBeLessThanOrEqual(Math.ceil(r.def * 0.25));
            expect(r.max).toBeGreaterThanOrEqual(Math.floor(r.def * 4));
        }
        expect(lib.sizePct(38, 38)).toBe(100);
        expect(lib.sizePct(19, 38)).toBe(50);
        expect(lib.pctSize(200, 38)).toBe(76);
    });
    it("sets a token to 50 % and 200 %, clamps outside 25..400 and reads it back", () => {
        const b = lib.placeToken(lib.emptyBoard(), "u1", 0.5, 0.5);
        expect(lib.sizeOf(lib.setObjectPercent(b, "token", "u1", 50), "token", "u1")).toBe(19);
        expect(lib.objectPercent(lib.setObjectPercent(b, "token", "u1", 200), "token", "u1")).toBe(200);
        expect(lib.sizeOf(lib.setObjectPercent(b, "token", "u1", 1), "token", "u1")).toBe(10);
        expect(lib.sizeOf(lib.setObjectPercent(b, "token", "u1", 9999), "token", "u1")).toBe(152);
        expect(lib.setObjectPercent(b, "token", "u1", NaN)).toBe(b);
        expect(lib.objectPercent(b, "zone", "x")).toBeNull();
    });
    it("a text and a line use their font and thickness as the size", () => {
        let b = lib.emptyBoard();
        b = lib.insertObject(b, { type: "text", text: "T" }, null).board;
        b = lib.insertObject(b, { type: "line", kind: "arrow" }, null).board;
        expect(lib.objectPercent(b, "text", b.texts[0].id)).toBe(100);
        expect(lib.sizeOf(lib.setObjectPercent(b, "text", b.texts[0].id, 200), "text", b.texts[0].id)).toBe(36);
        expect(lib.sizeOf(lib.setObjectPercent(b, "line", b.lines[0].id, 50), "line", b.lines[0].id)).toBe(2);
    });
});

describe("a group as a whole", () => {
    it("has three scales that default to 100 % and are kept between 25 % and 400 %", () => {
        expect(lib.groupScales({})).toEqual({ gs: 1, sp: 1, ts: 1 });
        expect(lib.groupScales({ groupScale: 9, ringSpread: 0.01, tokenScale: 1.234 })).toEqual({ gs: 4, sp: 0.25, ts: 1.23 });
        expect(lib.groupSpread({ groupScale: 2, ringSpread: 1.5 })).toBe(3);
        expect(lib.clampFactor(NaN)).toBe(1);
    });
    it("the percent of a group is its scale, and the three can be set on their own", () => {
        const b = withSlots([group("g1", 1)]);
        expect(lib.objectPercent(b, "slot", "g1")).toBe(100);
        const s = lib.setObjectPercent(b, "slot", "g1", 60);
        expect(s.slots[0].groupScale).toBe(0.6);
        expect(s.slots[0].size).toBe(38);
        const t = lib.setGroupScale(s, "g1", { ringSpread: 2, tokenScale: 0.5 });
        expect(lib.groupScales(t.slots[0])).toEqual({ gs: 0.6, sp: 2, ts: 0.5 });
        expect(lib.setGroupScale(b, "nope", { groupScale: 2 })).toBe(b);
        expect(lib.setGroupScale(withSlots([group("g1", 1, { lock: true })]), "g1", { groupScale: 2 }).slots[0].groupScale).toBeUndefined();
    });
    it("several groups scale relative to their own, all groups get one value, a locked one stays", () => {
        const b = withSlots([group("g1", 1, { groupScale: 1 }), group("g2", 2, { groupScale: 2 }), group("g3", 3, { lock: true }), { ...group("t1", 1), kind: "tank" }]);
        const r = lib.scaleGroups(b, ["g1", "g2", "g3", "t1"], 1.5);
        expect(r.slots.map((s) => s.groupScale)).toEqual([1.5, 3, undefined, undefined]);
        expect(lib.scaleGroups(b, ["g2"], 4).slots[1].groupScale).toBe(4);
        expect(lib.setAllGroupScale(b, 0.6).slots.map((s) => s.groupScale)).toEqual([0.6, 0.6, undefined, undefined]);
    });
    it("a member stands where the ring spacing puts him, and a drag stores it back in the same units", () => {
        let b = withSlots([group("g1", 1, { groupScale: 2, ringSpread: 1.5, offsets: { u1: { dx: 0.02, dy: 0, size: 38 } } })]);
        const id = "g1|u1";
        const at = lib.objectPoint(b, "member", lib.memberId("g1", "u1"));
        expect(at.x).toBeCloseTo(0.5 + 0.02 * 3, 9);
        b = lib.moveObject(b, "member", lib.memberId("g1", "u1"), 0.5 + 0.09, 0.5);
        expect(b.slots[0].offsets.u1.dx).toBeCloseTo(0.03, 9);
        expect(id).toBe("g1|u1");
    });
});

describe("resizing a selection", () => {
    it("one factor for everything selected, each relative to its own size, one edit", () => {
        let b = lib.placeToken(lib.emptyBoard(), "u1", 0.3, 0.3);
        b = { ...b, slots: [group("g1", 1, { groupScale: 1.5 })], zones: [{ id: "z1", type: "danger", shape: "rect", x: 0.4, y: 0.4, w: 0.2, h: 0.2, color: "#f00", opacity: 0.3, label: "", opacity_: 1, lock: false, hidden: false }] };
        const sel = [{ kind: "token", id: "u1" }, { kind: "slot", id: "g1" }, { kind: "zone", id: "z1" }];
        const r = ms.resizeSelection(b, sel, 2);
        expect(r.tokens[0].size).toBe(76);
        expect(r.slots[0].groupScale).toBe(3);
        expect(r.zones[0].w).toBeGreaterThan(0.2);
        const half = ms.resizeSelection(b, sel.slice(0, 2), 0.5);
        expect(half.tokens[0].size).toBe(19);
        expect(half.slots[0].groupScale).toBe(0.75);
        expect(ms.resizeSelection(b, [], 2)).toBe(b);
    });
});

describe("the context menu", () => {
    const opts = (o = {}) => ({ locked: false, hasPlayer: false, isEvent: false, kind: "tank", ...o });
    it("offers the size steps, not for a locked object, and applies them", () => {
        const ids = (t, o) => lib.contextMenuItems(t, opts(o)).filter((i) => i.id.indexOf("size:") === 0).map((i) => i.id);
        expect(ids("token")).toEqual(["size:50", "size:75", "size:100", "size:125", "size:150", "size:200"]);
        expect(ids("zone")).toHaveLength(6);
        expect(ids("mark", { locked: true })).toEqual([]);
        const b = lib.placeToken(lib.emptyBoard(), "u1", 0.5, 0.5);
        expect(lib.sizeOf(lib.applyMenuAction(b, "size:150", "token", "u1", null).board, "token", "u1")).toBe(57);
        const g = withSlots([group("g1", 1)]);
        expect(lib.applyMenuAction(g, "size:50", "slot", "g1", null).board.slots[0].groupScale).toBe(0.5);
    });
});
