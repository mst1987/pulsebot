// Selecting several objects and acting on them together (lib/raidplan/multiSelect.ts): every action is one board in, one board out.
import { describe, expect, it } from "vitest";
import * as raidplan from ".";
import * as ms from "./multiSelect";

const look = { opacity: 1, lock: false, hidden: false };
const mark = (id, x, y, extra = {}) => ({ id, mark: "skull", x, y, size: 34, ...look, ...extra });
const icon = (id, x, y, extra = {}) => ({ id, iconKey: "enemy", label: "", showLabel: false, x, y, size: 48, rotation: 0, mobId: "", autoFace: true, ...look, ...extra });
const zone = (id, x, y, w, h, extra = {}) => ({ id, shape: "rect", type: "neutral", label: "", color: "#fff", x, y, w, h, ...look, ...extra });
const line = (id, x1, y1, x2, y2, extra = {}) => ({ id, kind: "line", x1, y1, x2, y2, color: "#fff", width: 4, ...look, ...extra });
const text = (id, x, y, extra = {}) => ({ id, text: "Fear", x, y, color: "#fff", size: 18, ...look, ...extra });
const slot = (id, kind, n, x, y, extra = {}) => ({ id, kind, n, userId: "", x, y, label: "", size: 38, offsets: {}, placed: true, ...look, ...extra });
const token = (userId, x, y, extra = {}) => ({ userId, x, y, size: 38, ...look, ...extra });
const board = (over = {}) => ({ tokens: [], slots: [], marks: [], icons: [], zones: [], lines: [], texts: [], targets: [], assignments: [], notes: "", counts: null, roles: {}, mobs: [], hiddenCards: [], ...over });
const px = { w: 1000, h: 600 };
const item = (kind, id) => ({ kind, id });

describe("the selection list", () => {
    it("toggles an item in and out, adds without doubles, and normalises a band whichever way it is dragged", () => {
        const a = item("mark", "a");
        const b = item("icon", "b");
        expect(ms.toggleItem([a], b)).toEqual([a, b]);
        expect(ms.toggleItem([a, b], a)).toEqual([b]);
        expect(ms.addItems([a], [a, b])).toEqual([a, b]);
        expect(ms.bandBox(0.6, 0.7, 0.2, 0.1)).toEqual({ x0: 0.2, y0: 0.1, x1: 0.6, y1: 0.7 });
    });
});

describe("what a rubber band touches", () => {
    const b = board({
        marks: [mark("m1", 0.2, 0.2), mark("m2", 0.9, 0.9), mark("locked", 0.25, 0.25, { lock: true }), mark("gone", 0.22, 0.22, { hidden: true })],
        zones: [zone("z1", 0.1, 0.1, 0.2, 0.2)],
        lines: [line("l1", 0.4, 0.4, 0.6, 0.4)],
        slots: [slot("s1", "tank", 1, 0.3, 0.3), slot("s2", "healer", 1, 0.3, 0.32, { placed: false }), slot("g1", "group", 1, 0.5, 0.5)],
        tokens: [token("u1", 0.35, 0.3)],
        texts: [text("t1", 0.7, 0.2)],
    });
    it("takes what it touches, not what lies wholly outside", () => {
        const hit = ms.hitObjects(b, { x0: 0.15, y0: 0.15, x1: 0.36, y1: 0.36 }, px).map(ms.itemKey);
        expect(hit).toEqual(expect.arrayContaining(["mark:m1", "zone:z1", "slot:s1", "token:u1"]));
        expect(hit).not.toContain("mark:m2");
        expect(hit).not.toContain("text:t1");
    });
    it("never takes a locked, a hidden or an unplaced object", () => {
        const hit = ms.hitObjects(b, { x0: 0, y0: 0, x1: 1, y1: 1 }, px).map(ms.itemKey);
        expect(hit).not.toContain("mark:locked");
        expect(hit).not.toContain("mark:gone");
        expect(hit).not.toContain("slot:s2");
        expect(hit).toContain("slot:g1");
    });
    it("Ctrl+A is the same as a band over everything", () => {
        expect(ms.selectableItems(b).map(ms.itemKey).sort()).toEqual(ms.hitObjects(b, { x0: 0, y0: 0, x1: 1, y1: 1 }, px).map(ms.itemKey).sort());
    });
    it("a line is hit along its length, and the frame round a selection covers every object", () => {
        expect(ms.hitObjects(b, { x0: 0.5, y0: 0.38, x1: 0.52, y1: 0.42 }, px).map(ms.itemKey)).toContain("line:l1");
        const box = ms.selectionBox(b, [item("mark", "m1"), item("mark", "m2")], px);
        expect(box.x0).toBeLessThan(0.2);
        expect(box.x1).toBeGreaterThan(0.9);
        expect(box.y0).toBeLessThan(0.2);
        expect(box.y1).toBeGreaterThan(0.9);
        expect(ms.selectionBox(b, [], px)).toBe(null);
    });
});

describe("moving the selection", () => {
    const b = board({ marks: [mark("m1", 0.2, 0.2), mark("m2", 0.5, 0.4)], zones: [zone("z1", 0.6, 0.6, 0.2, 0.2)] });
    const sel = [item("mark", "m1"), item("mark", "m2"), item("zone", "z1")];
    it("moves everything by the same step", () => {
        const r = ms.moveSelection(b, sel, 0.1, 0.05, px);
        expect(r.marks[0].x).toBeCloseTo(0.3);
        expect(r.marks[0].y).toBeCloseTo(0.25);
        expect(r.marks[1].x).toBeCloseTo(0.6);
        expect(r.zones[0].x).toBeCloseTo(0.7);
        expect(r.zones[0].y).toBeCloseTo(0.65);
    });
    it("stops as one piece at the edge instead of bending", () => {
        const r = ms.moveSelection(b, sel, 0.9, 0, px);
        const gap = r.marks[1].x - r.marks[0].x;
        expect(gap).toBeCloseTo(0.3);
        expect(r.zones[0].x + r.zones[0].w).toBeLessThanOrEqual(1.0001);
    });
    it("leaves a locked object where it is", () => {
        const c = { ...b, marks: [mark("m1", 0.2, 0.2, { lock: true }), mark("m2", 0.5, 0.4)] };
        const r = ms.moveSelection(c, [item("mark", "m1"), item("mark", "m2")], 0.1, 0, px);
        expect(r.marks[0].x).toBe(0.2);
        expect(r.marks[1].x).toBeCloseTo(0.6);
    });
});

describe("moving everything together (Ctrl+A, then drag or arrow keys)", () => {
    const b = board({
        slots: [slot("s1", "tank", 1, 0.2, 0.3), slot("g1", "group", 1, 0.5, 0.5, { split: true, offsets: { u1: { dx: 0.05, dy: -0.04, size: 30 } } })],
        tokens: [token("u2", 0.4, 0.2)],
        marks: [mark("m1", 0.6, 0.3)],
        icons: [icon("i1", 0.3, 0.6)],
        zones: [zone("z1", 0.5, 0.65, 0.2, 0.15, { shape: "ellipse" })],
        lines: [line("l1", 0.1, 0.8, 0.3, 0.85)],
        texts: [text("t1", 0.7, 0.4)],
    });
    const all = ms.selectableItems(b);
    const anchor = (bd, it) => raidplan.objectPoint(bd, it.kind, it.id);
    it("every kind moves by exactly the same offset, so the distances between them do not change", () => {
        const r = ms.moveSelection(b, all, 0.07, 0.05, px);
        for (const it of all) {
            const before = anchor(b, it);
            const after = anchor(r, it);
            expect(after.x - before.x).toBeCloseTo(0.07, 6);
            expect(after.y - before.y).toBeCloseTo(0.05, 6);
        }
        // both ends of the line and the whole rectangle of the zone moved, nothing was squeezed
        expect(r.lines[0].x2 - r.lines[0].x1).toBeCloseTo(0.2, 6);
        expect(r.zones[0].w).toBeCloseTo(0.2, 6);
    });
    it("a split group's raiders keep their place round the marker (their offsets are not moved twice)", () => {
        const r = ms.moveSelection(b, all, 0.07, 0.05, px);
        expect(r.slots[1].offsets).toEqual(b.slots[1].offsets);
        expect(r.slots[1].x).toBeCloseTo(0.57, 6);
    });
    it("the whole selection stops at the edge: the box stays inside 0..1 and no object is squeezed against it alone", () => {
        const r = ms.moveSelection(b, all, 5, 5, px);
        const box = ms.selectionBox(r, all, px);
        expect(box.x1).toBeLessThanOrEqual(1.0001);
        expect(box.y1).toBeLessThanOrEqual(1.0001);
        const b0 = ms.selectionBox(b, all, px);
        expect(box.x1 - box.x0).toBeCloseTo(b0.x1 - b0.x0, 6);
        expect(box.y1 - box.y0).toBeCloseTo(b0.y1 - b0.y0, 6);
        const dx = anchor(r, all[0]).x - anchor(b, all[0]).x;
        for (const it of all) expect(anchor(r, it).x - anchor(b, it).x).toBeCloseTo(dx, 6);
        const back = ms.moveSelection(b, all, -5, -5, px);
        expect(ms.selectionBox(back, all, px).x0).toBeGreaterThanOrEqual(-0.0001);
    });
    it("a locked object does not come along, the rest still moves by the same offset", () => {
        const c = { ...b, marks: [mark("m1", 0.6, 0.3, { lock: true })] };
        const r = ms.moveSelection(c, [item("mark", "m1"), item("icon", "i1"), item("text", "t1")], 0.1, 0, px);
        expect(r.marks[0].x).toBe(0.6);
        expect(r.icons[0].x).toBeCloseTo(0.4, 6);
        expect(r.texts[0].x).toBeCloseTo(0.8, 6);
    });
    it("moves in steps by the arrow keys the same way, and a step of zero changes nothing", () => {
        const r = ms.moveSelection(b, all, 0.01, 0, px);
        expect(r.icons[0].x).toBeCloseTo(0.31, 6);
        expect(ms.moveSelection(b, all, 0, 0, px).icons[0]).toEqual(b.icons[0]);
    });
});

describe("scaling the selection around its centre", () => {
    const b = board({ icons: [icon("i1", 0.4, 0.5)], marks: [mark("m1", 0.6, 0.5)], zones: [zone("z1", 0.4, 0.3, 0.2, 0.1)], lines: [line("l1", 0.4, 0.7, 0.6, 0.7)], texts: [text("t1", 0.5, 0.2)] });
    const sel = [item("icon", "i1"), item("mark", "m1"), item("zone", "z1"), item("line", "l1"), item("text", "t1")];
    const c = { x: 0.5, y: 0.5 };
    it("scales positions and sizes together", () => {
        const r = ms.scaleSelection(b, sel, 2, c);
        expect(r.icons[0]).toMatchObject({ size: 96 });
        expect(r.icons[0].x).toBeCloseTo(0.3);
        expect(r.marks[0]).toMatchObject({ size: 68 });
        expect(r.marks[0].x).toBeCloseTo(0.7);
        expect(r.zones[0].w).toBeCloseTo(0.4);
        expect(r.zones[0].h).toBeCloseTo(0.2);
        expect(r.zones[0].x).toBeCloseTo(0.3);
        expect(r.lines[0].x1).toBeCloseTo(0.3);
        expect(r.lines[0].x2).toBeCloseTo(0.7);
        expect(r.lines[0].width).toBe(8);
        expect(r.texts[0].size).toBe(36);
    });
    it("keeps every size inside the range of its kind", () => {
        const big = ms.scaleSelection(b, sel, 50, c);
        expect(big.icons[0].size).toBe(raidplan.SIZE_RANGES.icon.max);
        expect(big.texts[0].size).toBe(raidplan.SIZE_RANGES.text.max);
        expect(big.lines[0].width).toBe(raidplan.SIZE_RANGES.line.max);
        const small = ms.scaleSelection(b, sel, 0.01, c);
        expect(small.icons[0].size).toBe(raidplan.SIZE_RANGES.icon.min);
        expect(small.zones[0].w).toBeGreaterThanOrEqual(raidplan.MIN_ZONE);
    });
    it("factor 1 changes nothing and nonsense is refused", () => {
        expect(ms.scaleSelection(b, sel, 1, c).icons[0]).toMatchObject({ size: 48, x: 0.4 });
        expect(ms.scaleSelection(b, sel, NaN, c)).toBe(b);
        expect(ms.scaleSelection(b, sel, -1, c)).toBe(b);
    });
});

describe("deleting the selection", () => {
    it("removes free objects, takes a role slot and a group marker only off the map, sends a token back", () => {
        const b = board({ marks: [mark("m1", 0.2, 0.2)], slots: [slot("s1", "tank", 1, 0.3, 0.3, { userId: "u1" }), slot("g1", "group", 2, 0.5, 0.5), slot("lab", "label", 1, 0.6, 0.6, { label: "x" })], tokens: [token("u2", 0.4, 0.4)] });
        const r = ms.deleteSelection(b, [item("mark", "m1"), item("slot", "s1"), item("slot", "g1"), item("slot", "lab"), item("token", "u2")]);
        expect(r.marks).toEqual([]);
        expect(r.slots.map((s) => s.id)).toEqual(["s1", "g1"]);
        expect(r.slots.every((s) => s.placed === false)).toBe(true);
        expect(r.slots[0].userId).toBe("u1");
        expect(r.tokens).toEqual([]);
    });
    it("leaves locked objects alone, and the Besetzung does not shrink", () => {
        const b = board({ marks: [mark("m1", 0.2, 0.2, { lock: true })], slots: [slot("s1", "tank", 1, 0.3, 0.3), slot("s2", "tank", 2, 0.4, 0.3)] });
        const r = ms.deleteSelection(b, [item("mark", "m1"), item("slot", "s1"), item("slot", "s2")]);
        expect(r.marks).toHaveLength(1);
        expect(r.slots).toHaveLength(2);
    });
});

describe("duplicating and copying", () => {
    const b = board({ marks: [mark("m1", 0.2, 0.2)], zones: [zone("z1", 0.5, 0.5, 0.2, 0.2)], slots: [slot("s1", "tank", 1, 0.3, 0.3), slot("lab", "label", 1, 0.6, 0.6, { label: "x" })], tokens: [token("u1", 0.1, 0.1)] });
    const sel = [item("mark", "m1"), item("zone", "z1"), item("slot", "s1"), item("slot", "lab"), item("token", "u1")];
    it("duplicates free objects with new ids and skips slots of the Besetzung and players, saying how many", () => {
        const r = ms.duplicateSelection(b, sel);
        expect(r.skipped).toBe(2);
        expect(r.board.marks).toHaveLength(2);
        expect(r.board.zones).toHaveLength(2);
        expect(r.board.slots.filter((s) => s.kind === "tank")).toHaveLength(1);
        expect(r.board.slots.filter((s) => s.kind === "label")).toHaveLength(2);
        expect(r.board.tokens).toHaveLength(1);
        expect(r.sel).toHaveLength(3);
        expect(new Set(r.board.marks.map((m) => m.id)).size).toBe(2);
    });
    it("copy and paste keep the same rule, paste again and again puts more copies, each with new ids and unlocked", () => {
        const c = ms.copySelection(b, sel);
        expect(c.skipped).toBe(2);
        const once = ms.pasteSnapshot(b, c.snap, 0.03);
        const twice = ms.pasteSnapshot(once.board, c.snap, 0.06);
        expect(twice.board.marks).toHaveLength(3);
        expect(twice.board.slots.filter((s) => s.kind === "tank")).toHaveLength(1);
        expect(once.sel).toHaveLength(3);
        expect(new Set(twice.board.marks.map((m) => m.id)).size).toBe(3);
        expect(once.board.marks[1].x).toBeCloseTo(0.23);
        const locked = ms.pasteSnapshot(b, ms.copySelection({ ...b, marks: [mark("m1", 0.2, 0.2, { lock: true })] }, [item("mark", "m1")]).snap, 0.03);
        expect(locked.board.marks[1].lock).toBe(false);
    });
});

describe("aligning", () => {
    const b = board({ marks: [mark("a", 0.2, 0.3), mark("b", 0.5, 0.5), mark("c", 0.9, 0.8)] });
    const sel = [item("mark", "a"), item("mark", "b"), item("mark", "c")];
    it("lines up on an edge or the middle", () => {
        const left = ms.alignSelection(b, sel, "left", px);
        expect(new Set(left.marks.map((m) => m.x.toFixed(4))).size).toBe(1);
        const top = ms.alignSelection(b, sel, "top", px);
        expect(new Set(top.marks.map((m) => m.y.toFixed(4))).size).toBe(1);
        const mid = ms.alignSelection(b, sel, "centerH", px);
        expect(new Set(mid.marks.map((m) => m.x.toFixed(4))).size).toBe(1);
    });
    it("spreads three or more evenly, and does nothing for fewer", () => {
        const r = ms.alignSelection(b, sel, "distH", px);
        expect(r.marks[1].x - r.marks[0].x).toBeCloseTo(r.marks[2].x - r.marks[1].x, 4);
        expect(ms.alignSelection(b, sel.slice(0, 1), "left", px)).toBe(b);
        expect(ms.alignSelection(b, sel.slice(0, 2), "distH", px).marks[0].x).toBe(0.2);
    });
});

describe("look, order, summary", () => {
    const b = board({ marks: [mark("a", 0.2, 0.3, { opacity: 0.5 }), mark("b", 0.5, 0.5), mark("c", 0.9, 0.8)] });
    const sel = [item("mark", "a"), item("mark", "b")];
    it("sets opacity, lock and hidden of all of them", () => {
        const r = ms.setLookSelection(b, sel, { opacity: 0.7, lock: true });
        expect(r.marks.map((m) => [m.opacity, m.lock])).toEqual([[0.7, true], [0.7, true], [1, false]]);
    });
    it("shows a value where all agree and null (mixed) where they differ", () => {
        expect(ms.lookSummary(b, sel)).toEqual({ opacity: null, lock: false, hidden: false });
        expect(ms.lookSummary(b, [item("mark", "b"), item("mark", "c")])).toEqual({ opacity: 1, lock: false, hidden: false });
        expect(ms.lookSummary(b, [])).toEqual({ opacity: null, lock: null, hidden: null });
    });
    it("brings them to the front in their own order, or sends them behind", () => {
        expect(ms.reorderSelection(b, sel, "front").marks.map((m) => m.id)).toEqual(["c", "a", "b"]);
        expect(ms.reorderSelection(b, [item("mark", "b"), item("mark", "c")], "back").marks.map((m) => m.id)).toEqual(["b", "c", "a"]);
    });
    it("items that are gone are dropped from a selection", () => {
        expect(ms.liveItems(b, [item("mark", "a"), item("mark", "zzz")])).toEqual([item("mark", "a")]);
    });
});
