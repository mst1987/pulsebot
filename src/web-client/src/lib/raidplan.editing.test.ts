// Editing a board: inserting, moving, locking, scaling zones, duplicating,
// layers, the context menu and undo/redo.
// The board logic behind the editors (lib/raidplan.ts) runs for real.
import { describe, expect, it } from "vitest";
import * as lib from "./raidplan";
import { inLang } from "../test/i18n";

// Role slots belong to the Besetzung: the palette places a free one. These tests start from a board that has one free.
const slotIns = (b, spec, at) => {
    if (spec.type === "slot" && lib.isRoleKind(spec.kind)) {
        const free = { ...lib.addSlot(lib.emptyBoard(), spec.kind, "").slots[0], n: lib.nextSlotNumber(b, spec.kind), placed: false };
        return lib.insertObject({ ...b, slots: [...b.slots, free] }, spec, at);
    }
    return lib.insertObject(b, spec, at);
};

const player = (userId, role = "dps") => ({ userId, character: userId, classId: "", className: "", classColor: "", spec: "", specLabel: "", role, iconUrl: "", group: 1 });

describe("inserting objects", () => {
    it("puts a slot, mark, zone, line and text where told, centred or anchored, and selects it", () => {
        const at = { x: 0.6, y: 0.4 };
        let r = slotIns(lib.emptyBoard(), { type: "slot", kind: "tank", label: "" }, at);
        expect(r.board.slots[0]).toMatchObject({ kind: "tank", n: 1, x: 0.6, y: 0.4, userId: "", opacity: 1, lock: false, hidden: false });
        expect(r.sel).toEqual({ kind: "slot", id: r.board.slots[0].id });
        r = slotIns(r.board, { type: "mark", mark: "skull" }, at);
        expect(r.board.marks[0]).toMatchObject({ mark: "skull", x: 0.6, y: 0.4, opacity: 1 });
        r = slotIns(r.board, { type: "zone", zoneType: "danger", shape: "ellipse" }, at);
        expect(r.board.zones[0]).toMatchObject({ type: "danger", shape: "ellipse", color: "#ef4444", opacity: 0.3, w: 0.2, h: 0.2 });
        expect(r.board.zones[0].x).toBeCloseTo(0.5);
        expect(r.board.zones[0].y).toBeCloseTo(0.3);
        r = slotIns(r.board, { type: "line", kind: "arrow" }, at);
        expect(r.board.lines[0]).toMatchObject({ kind: "arrow", y1: 0.4, y2: 0.4, width: 4, color: "#f8fafc", opacity: 1 });
        expect(r.board.lines[0].x1).toBeCloseTo(0.5);
        expect(r.board.lines[0].x2).toBeCloseTo(0.7);
        r = slotIns(r.board, { type: "text", text: "Hi" }, at);
        expect(r.board.texts[0]).toMatchObject({ text: "Hi", x: 0.6, y: 0.4, size: 18, opacity: 1 });
        expect(lib.objectCount(r.board)).toBe(5);
    });

    it("keeps an insert near an edge on the board and, without a point, puts it near the middle, each one off the last", () => {
        const edge = slotIns(lib.emptyBoard(), { type: "zone", zoneType: "neutral", shape: "rect" }, { x: 1, y: 1 }).board.zones[0];
        expect(edge.x + edge.w).toBeLessThanOrEqual(1);
        expect(edge.y + edge.h).toBeLessThanOrEqual(1);
        const line = slotIns(lib.emptyBoard(), { type: "line", kind: "line" }, { x: 0, y: 0 }).board.lines[0];
        expect(line.x1).toBe(0);
        let b = lib.emptyBoard();
        b = slotIns(b, { type: "mark", mark: "star" }, null).board;
        b = slotIns(b, { type: "mark", mark: "star" }, null).board;
        expect(b.marks[0].x).toBeGreaterThan(0.3);
        expect(b.marks[1].x).toBeGreaterThan(b.marks[0].x);
    });

    it("numbers slots per kind and keeps the old helpers working", () => {
        let b = lib.addSlot(lib.emptyBoard(), "tank", "");
        b = lib.addSlot(b, "tank", "");
        b = lib.addSlot(b, "healer", "");
        b = lib.addSlot(b, "label", "Boss-Tank");
        expect(b.slots.map((s) => [s.kind, s.n, s.label])).toEqual([["tank", 1, ""], ["tank", 2, ""], ["healer", 1, ""], ["label", 1, "Boss-Tank"]]);
        expect(new Set(b.slots.map((s) => s.id)).size).toBe(4);
        expect(lib.addMark(lib.emptyBoard(), "star").marks).toHaveLength(1);
        expect(lib.addZone(lib.emptyBoard(), "healthy", "rect").zones[0].color).toBe("#22c55e");
        // a role slot belongs to the Besetzung: deleting it takes it off the map, a free label is removed
        const gap = lib.removeObject(b, "slot", b.slots[0].id);
        expect(gap.slots.find((s) => s.id === b.slots[0].id).placed).toBe(false);
        expect(lib.removeObject(b, "slot", b.slots[3].id).slots).toHaveLength(3);
    });

    it("titles a slot in the active language, with its own label winning", async () => {
        const slot = { id: "a", kind: "tank", n: 2, label: "", x: 0, y: 0, userId: "" };
        expect(lib.slotTitle(slot)).toBe("Tank 2");
        expect(lib.slotTitle({ ...slot, kind: "healer" })).toBe("Heiler 2");
        expect(await inLang("en", () => lib.slotTitle({ ...slot, kind: "healer" }))).toBe("Healer 2");
        expect(lib.slotTitle({ ...slot, kind: "group" })).toBe("Gruppe 2");
        expect(lib.slotTitle({ ...slot, label: "MT" })).toBe("MT");
        expect(lib.slotTitle({ ...slot, kind: "label", label: "Boss-Tank" })).toBe("Boss-Tank");
    });
});

describe("moving, locking, opacity", () => {
    const full = () => {
        let b = lib.emptyBoard();
        for (const spec of [{ type: "slot", kind: "dps", label: "" }, { type: "mark", mark: "star" }, { type: "zone", zoneType: "neutral", shape: "rect" }, { type: "line", kind: "line" }, { type: "text", text: "T" }]) b = slotIns(b, spec, { x: 0.5, y: 0.5 }).board;
        return b;
    };

    it("moves a slot, mark or text by its point, a zone by its corner and a line by its middle, all kept on the board", () => {
        let b = full();
        const ids = { slot: b.slots[0].id, mark: b.marks[0].id, zone: b.zones[0].id, line: b.lines[0].id, text: b.texts[0].id };
        b = lib.moveObject(b, "slot", ids.slot, 2, -1);
        b = lib.moveObject(b, "mark", ids.mark, 0.25, 0.75);
        b = lib.moveObject(b, "text", ids.text, 0.1, 0.9);
        b = lib.moveObject(b, "zone", ids.zone, 5, 5);
        b = lib.moveObject(b, "line", ids.line, 0.9, 0.2);
        expect(b.slots[0]).toMatchObject({ x: 1, y: 0 });
        expect(b.marks[0]).toMatchObject({ x: 0.25, y: 0.75 });
        expect(b.texts[0]).toMatchObject({ x: 0.1, y: 0.9 });
        expect(b.zones[0].x).toBeCloseTo(0.8);
        expect(b.zones[0]).toMatchObject({ w: 0.2, h: 0.2 });
        // the line keeps its length and slides until an end meets the edge
        const l = b.lines[0];
        expect(l.x2 - l.x1).toBeCloseTo(0.2);
        expect(Math.max(l.x1, l.x2)).toBeLessThanOrEqual(1);
        expect(l.y1).toBeCloseTo(0.2);
        expect(lib.objectPoint(b, "line", ids.line).y).toBeCloseTo(0.2);
        expect(lib.objectPoint(b, "slot", "nope")).toBeNull();
    });

    it("moves one end of a line", () => {
        let b = slotIns(lib.emptyBoard(), { type: "line", kind: "arrow" }, { x: 0.5, y: 0.5 }).board;
        const id = b.lines[0].id;
        b = lib.moveLineEnd(b, id, 2, 1.5, 0.9);
        expect(b.lines[0]).toMatchObject({ x2: 1, y2: 0.9 });
        expect(b.lines[0].x1).toBeCloseTo(0.4);
        b = lib.moveLineEnd(b, id, 1, 0.1, 0.1);
        expect(b.lines[0]).toMatchObject({ x1: 0.1, y1: 0.1 });
    });

    it("moves a line as a whole without bending it", () => {
        expect(lib.moveLine({ x1: 0.2, y1: 0.2, x2: 0.4, y2: 0.6 }, 0.1, 0.1)).toEqual({ x1: expect.closeTo(0.3), y1: expect.closeTo(0.3), x2: expect.closeTo(0.5), y2: expect.closeTo(0.7) });
        const edge = lib.moveLine({ x1: 0.2, y1: 0.2, x2: 0.4, y2: 0.6 }, 9, -9);
        expect(edge.x2).toBe(1);
        expect(edge.y1).toBe(0);
        expect(edge.x2 - edge.x1).toBeCloseTo(0.2);
        expect(edge.y2 - edge.y1).toBeCloseTo(0.4);
    });

    it("lets a locked object stay where it is, and nothing else", () => {
        let b = full();
        const id = b.marks[0].id;
        b = lib.patchLook(b, "mark", id, { lock: true });
        expect(lib.isLocked(b, "mark", id)).toBe(true);
        expect(lib.moveObject(b, "mark", id, 0.9, 0.9)).toBe(b);
        expect(lib.nudgeObject(b, "mark", id, 0.1, 0.1)).toBe(b);
        expect(lib.moveLineEnd(lib.patchLook(b, "line", b.lines[0].id, { lock: true }), b.lines[0].id, 1, 0, 0).lines[0].x1).toBe(b.lines[0].x1);
        // still deletable, and unlocking frees it
        expect(lib.removeObject(b, "mark", id).marks).toEqual([]);
        expect(lib.moveObject(lib.patchLook(b, "mark", id, { lock: false }), "mark", id, 0.9, 0.9).marks[0].x).toBe(0.9);
    });

    it("sets opacity, lock and hidden on every kind of object", () => {
        let b = lib.placeToken(full(), "u1", 0.5, 0.5);
        const list = [["token", "u1"], ["slot", b.slots[0].id], ["mark", b.marks[0].id], ["zone", b.zones[0].id], ["line", b.lines[0].id], ["text", b.texts[0].id]];
        for (const [kind, id] of list) {
            b = lib.patchLook(b, kind, id, { opacity: 0.5, hidden: true });
            expect(lib.lookOf(b, kind, id)).toEqual({ opacity: 0.5, lock: false, hidden: true });
        }
        expect(lib.lookOf(b, "mark", "nope")).toBeNull();
        expect(lib.lookOf(b, "zone", b.zones[0].id).opacity).toBe(0.5);
    });

    it("dims the map between 0.1 and 1", () => {
        expect(lib.setMapOpacity(lib.emptyBoard(), 0.4).mapOpacity).toBe(0.4);
        expect(lib.setMapOpacity(lib.emptyBoard(), 0).mapOpacity).toBe(0.1);
        expect(lib.setMapOpacity(lib.emptyBoard(), 3).mapOpacity).toBe(1);
        expect(lib.setMapOpacity(lib.emptyBoard(), NaN).mapOpacity).toBe(1);
    });

    it("changes a line's or a text's own fields", () => {
        let b = full();
        b = lib.updateLine(b, b.lines[0].id, { kind: "arrow", color: "#ff0000", width: 8 });
        b = lib.updateText(b, b.texts[0].id, { text: "Boss", size: 30 });
        expect(b.lines[0]).toMatchObject({ kind: "arrow", color: "#ff0000", width: 8 });
        expect(b.texts[0]).toMatchObject({ text: "Boss", size: 30 });
    });
});

describe("zones: scaling", () => {
    const start = { x: 0.2, y: 0.2, w: 0.3, h: 0.2 };

    it("scales from a corner while the opposite corner stays", () => {
        expect(lib.resizeRect(start, "se", 0.1, 0.1)).toEqual({ x: 0.2, y: 0.2, w: expect.closeTo(0.4), h: expect.closeTo(0.3) });
        const nw = lib.resizeRect(start, "nw", -0.1, -0.1);
        expect(nw.x).toBeCloseTo(0.1);
        expect(nw.y).toBeCloseTo(0.1);
        expect(nw.x + nw.w).toBeCloseTo(0.5);
        expect(nw.y + nw.h).toBeCloseTo(0.4);
        const ne = lib.resizeRect(start, "ne", 0.1, -0.1);
        expect([ne.x, ne.y + ne.h]).toEqual([0.2, expect.closeTo(0.4)]);
        const sw = lib.resizeRect(start, "sw", -0.1, 0.1);
        expect([sw.x + sw.w, sw.y]).toEqual([expect.closeTo(0.5), 0.2]);
    });

    it("never drops below the minimum size, flips over or leaves the board", () => {
        const tiny = lib.resizeRect(start, "se", -5, -5);
        expect(tiny.w).toBeCloseTo(lib.MIN_ZONE);
        expect(tiny.h).toBeCloseTo(lib.MIN_ZONE);
        const nw = lib.resizeRect(start, "nw", 5, 5);
        expect(nw.x + nw.w).toBeCloseTo(0.5);
        expect(nw.w).toBeCloseTo(lib.MIN_ZONE);
        const big = lib.resizeRect(start, "se", 5, 5);
        expect([big.x + big.w, big.y + big.h]).toEqual([1, 1]);
        const left = lib.resizeRect(start, "nw", -5, -5);
        expect([left.x, left.y]).toEqual([0, 0]);
    });

    it("moves as a whole and stays on the board", () => {
        expect(lib.moveRect(start, 0.1, 0.05)).toEqual({ x: expect.closeTo(0.3), y: expect.closeTo(0.25), w: 0.3, h: 0.2 });
        expect(lib.moveRect(start, 9, 9)).toEqual({ x: expect.closeTo(0.7), y: expect.closeTo(0.8), w: 0.3, h: 0.2 });
        expect(lib.moveRect(start, -9, -9)).toEqual({ x: 0, y: 0, w: 0.3, h: 0.2 });
    });

    it("changes a zone's fields without touching the others", () => {
        let b = lib.addZone(lib.addZone(lib.emptyBoard(), "danger", "rect"), "healthy", "rect");
        b = lib.updateZone(b, b.zones[0].id, { label: "Feuer", color: "#112233", opacity: 0.5 });
        expect(b.zones[0]).toMatchObject({ label: "Feuer", color: "#112233", opacity: 0.5, type: "danger" });
        expect(b.zones[1]).toMatchObject({ label: "", color: "#22c55e" });
    });
});

describe("duplicating and ordering", () => {
    it("copies an object a little off, unlocked, with a new id; a token cannot be copied; a slot's copy is open", () => {
        let b = lib.emptyBoard();
        b = slotIns(b, { type: "mark", mark: "moon" }, { x: 0.5, y: 0.5 }).board;
        b = slotIns(b, { type: "slot", kind: "tank", label: "" }, { x: 0.3, y: 0.3 }).board;
        b = lib.assignSlot(b, b.slots[0].id, "u1");
        b = lib.patchLook(b, "slot", b.slots[0].id, { lock: true });
        const m = lib.duplicateObject(b, "mark", b.marks[0].id);
        expect(m.board.marks).toHaveLength(2);
        expect(m.board.marks[1].x).toBeCloseTo(0.53);
        expect(m.board.marks[1].id).not.toBe(b.marks[0].id);
        expect(m.sel).toEqual({ kind: "mark", id: m.board.marks[1].id });
        const s = lib.duplicateObject(b, "slot", b.slots[0].id);
        expect(s.board.slots[1]).toMatchObject({ kind: "tank", n: 2, userId: "", lock: false });
        expect(lib.duplicateObject(lib.placeToken(b, "u2", 0.5, 0.5), "token", "u2").board.tokens).toHaveLength(1);
        expect(lib.duplicateObject(b, "mark", "nope").sel).toBeNull();
        const z = lib.duplicateObject(lib.addZone(lib.emptyBoard(), "danger", "rect"), "zone", lib.addZone(lib.emptyBoard(), "danger", "rect").zones[0].id);
        expect(z.board.zones.length).toBeGreaterThanOrEqual(1);
    });

    it("copies zones, lines and texts inside the board", () => {
        let b = slotIns(lib.emptyBoard(), { type: "zone", zoneType: "danger", shape: "rect" }, { x: 0.95, y: 0.95 }).board;
        b = slotIns(b, { type: "line", kind: "arrow" }, { x: 0.5, y: 0.5 }).board;
        b = slotIns(b, { type: "text", text: "T" }, { x: 0.5, y: 0.5 }).board;
        for (const [kind, id] of [["zone", b.zones[0].id], ["line", b.lines[0].id], ["text", b.texts[0].id]]) b = lib.duplicateObject(b, kind, id).board;
        expect([b.zones.length, b.lines.length, b.texts.length]).toEqual([2, 2, 2]);
        expect(b.zones[1].x + b.zones[1].w).toBeLessThanOrEqual(1);
        expect(b.lines[1].x1).toBeGreaterThan(b.lines[0].x1);
    });

    it("moves an object to the front / back of its kind, or one step", () => {
        let b = lib.emptyBoard();
        for (const m of ["star", "moon", "skull"]) b = slotIns(b, { type: "mark", mark: m }, null).board;
        const id = (i) => b.marks[i].id;
        const order = (x) => x.marks.map((m) => m.mark);
        expect(order(lib.reorderObject(b, "mark", id(0), "front"))).toEqual(["moon", "skull", "star"]);
        expect(order(lib.reorderObject(b, "mark", id(2), "back"))).toEqual(["skull", "star", "moon"]);
        expect(order(lib.reorderObject(b, "mark", id(0), "up"))).toEqual(["moon", "star", "skull"]);
        expect(order(lib.reorderObject(b, "mark", id(2), "down"))).toEqual(["star", "skull", "moon"]);
        expect(lib.reorderObject(b, "mark", id(2), "front")).toEqual(b);
        expect(lib.reorderObject(b, "mark", "nope", "front")).toEqual(b);
        for (const kind of ["slot", "zone", "line", "text", "token"]) expect(lib.reorderObject(lib.emptyBoard(), kind, "x", "front")).toEqual(lib.emptyBoard());
    });
});

describe("layers", () => {
    it("lists every object front to back with a name, lock and hidden flag", () => {
        const players = lib.rosterMap([player("u1")]);
        let b = lib.emptyBoard();
        b = slotIns(b, { type: "zone", zoneType: "danger", shape: "rect" }, null).board;
        b = slotIns(b, { type: "line", kind: "arrow" }, null).board;
        b = slotIns(b, { type: "mark", mark: "skull" }, null).board;
        b = slotIns(b, { type: "slot", kind: "healer", label: "" }, null).board;
        b = slotIns(b, { type: "text", text: "Hallo" }, null).board;
        b = lib.placeToken(b, "u1", 0.5, 0.5);
        b = lib.patchLook(b, "mark", b.marks[0].id, { lock: true, hidden: true });
        const rows = lib.layerList(b, players);
        expect(rows.map((r) => r.kind)).toEqual(["token", "text", "slot", "mark", "line", "zone"]);
        expect(rows.map((r) => r.name)).toEqual(["u1", "Hallo", "Heiler 1", "Totenkopf", "Pfeil", "Gefahrenzone"]);
        expect(rows[3]).toMatchObject({ lock: true, hidden: true });
        expect(lib.objectName(b, "zone", b.zones[0].id, players)).toBe("Gefahrenzone");
        expect(lib.objectName(b, "zone", "nope", players)).toBe("");
        // the last added of a kind is in front
        const two = slotIns(slotIns(lib.emptyBoard(), { type: "mark", mark: "star" }, null).board, { type: "mark", mark: "moon" }, null).board;
        expect(lib.layerList(two, players).map((r) => r.name)).toEqual(["Mond", "Stern"]);
    });
});

describe("the context menu", () => {
    const opts = (extra = {}) => ({ locked: false, hasPlayer: false, isEvent: false, kind: "", ...extra });
    const ids = (items) => items.filter((i) => i.id.indexOf("size:") !== 0).map((i) => i.id);

    it("offers the empty board what can be put there and a way to deselect", () => {
        const items = lib.contextMenuItems("board", opts());
        const list = ids(items);
        for (const id of ["insert:slot:tank", "insert:slot:label", "insert:mark:skull", "insert:mark:star", "insert:zone:danger", "insert:zone:custom", "insert:line:arrow", "insert:line:line", "insert:text", "deselect"]) expect(list).toContain(id);
        expect(list.filter((i) => i.startsWith("insert:mark:"))).toHaveLength(8);
        expect(list[list.length - 1]).toBe("deselect");
    });

    it("offers an object properties, duplicate, order, lock and delete", () => {
        expect(ids(lib.contextMenuItems("zone", opts()))).toEqual(["properties", "duplicate", "front", "back", "lock", "delete"]);
        expect(ids(lib.contextMenuItems("mark", opts({ locked: true })))).toContain("unlock");
        expect(ids(lib.contextMenuItems("mark", opts({ locked: true })))).not.toContain("lock");
        expect(lib.contextMenuItems("zone", opts()).find((i) => i.id === "delete").danger).toBe(true);
    });

    it("offers a slot of an event plan the player entries, a token only taking it out, and no duplicate for a token", () => {
        expect(ids(lib.contextMenuItems("slot", opts({ isEvent: true, kind: "tank" })))).toContain("assign");
        expect(ids(lib.contextMenuItems("slot", opts({ isEvent: true, kind: "tank" })))).not.toContain("unassign");
        expect(ids(lib.contextMenuItems("slot", opts({ isEvent: true, kind: "tank", hasPlayer: true })))).toContain("unassign");
        expect(ids(lib.contextMenuItems("slot", opts({ isEvent: false, kind: "tank" })))).not.toContain("assign");
        expect(ids(lib.contextMenuItems("slot", opts({ isEvent: true, kind: "group" })))).not.toContain("assign");
        const token = ids(lib.contextMenuItems("token", opts()));
        expect(token).toContain("unassign");
        expect(token).not.toContain("duplicate");
    });

    it("groups the entries in sections, in a stable order", () => {
        const sections = lib.contextMenuItems("slot", opts({ isEvent: true, kind: "tank", hasPlayer: true })).map((i) => i.section);
        expect(sections).toEqual(["main", "main", "order", "order", "order", "size", "size", "size", "size", "size", "size", "player", "player", "end"]);
    });

    it("reads an insert id back into what it inserts", () => {
        expect(lib.parseInsertId("insert:slot:tank")).toEqual({ type: "slot", kind: "tank", label: "" });
        expect(lib.parseInsertId("insert:slot:label")).toMatchObject({ type: "slot", kind: "label", label: "Label" });
        expect(lib.parseInsertId("insert:mark:moon")).toEqual({ type: "mark", mark: "moon" });
        expect(lib.parseInsertId("insert:zone:healthy")).toEqual({ type: "zone", zoneType: "healthy", shape: "rect" });
        expect(lib.parseInsertId("insert:line:arrow")).toEqual({ type: "line", kind: "arrow" });
        expect(lib.parseInsertId("insert:text")).toMatchObject({ type: "text" });
        expect(lib.parseInsertId("delete")).toBeNull();
    });

    it("carries out the entries that change the board", () => {
        const at = { x: 0.7, y: 0.6 };
        let r = lib.applyMenuAction(lib.emptyBoard(), "insert:mark:star", "", "", at);
        expect(r.board.marks[0]).toMatchObject({ mark: "star", x: 0.7, y: 0.6 });
        expect(r.sel).toEqual({ kind: "mark", id: r.board.marks[0].id });
        const id = r.board.marks[0].id;
        r = lib.applyMenuAction(r.board, "duplicate", "mark", id, null);
        expect(r.board.marks).toHaveLength(2);
        r = lib.applyMenuAction(r.board, "front", "mark", id, null);
        expect(r.board.marks[1].id).toBe(id);
        r = lib.applyMenuAction(r.board, "back", "mark", id, null);
        expect(r.board.marks[0].id).toBe(id);
        r = lib.applyMenuAction(r.board, "lock", "mark", id, null);
        expect(lib.isLocked(r.board, "mark", id)).toBe(true);
        r = lib.applyMenuAction(r.board, "unlock", "mark", id, null);
        expect(lib.isLocked(r.board, "mark", id)).toBe(false);
        r = lib.applyMenuAction(r.board, "delete", "mark", id, null);
        expect(r.board.marks).toHaveLength(1);
        expect(r.sel).toBeNull();
    });

    it("takes a player out of a slot or off the board through the menu", () => {
        let b = lib.assignSlot(lib.addSlot(lib.emptyBoard(), "tank", ""), lib.addSlot(lib.emptyBoard(), "tank", "").slots[0].id, "u1");
        b = lib.addSlot(lib.emptyBoard(), "tank", "");
        b = lib.assignSlot(b, b.slots[0].id, "u1");
        const r = lib.applyMenuAction(b, "unassign", "slot", b.slots[0].id, null);
        expect(r.board.slots[0].userId).toBe("");
        expect(r.sel).toEqual({ kind: "slot", id: b.slots[0].id });
        const t = lib.applyMenuAction(lib.placeToken(lib.emptyBoard(), "u2", 0.5, 0.5), "unassign", "token", "u2", null);
        expect(t.board.tokens).toEqual([]);
        // the entries that are the page's own change nothing
        expect(lib.applyMenuAction(b, "properties", "slot", b.slots[0].id, null).board).toBe(b);
        expect(lib.applyMenuAction(b, "duplicate", "", "", null).board).toBe(b);
    });

    // keeping the menu inside the viewport: lib/popoverPosition.ts clampToViewport, tested in popover.test.js
});

describe("undo and redo", () => {
    it("steps back and forward through recorded states", () => {
        let h = lib.historyInit("a");
        h = lib.historyRecord(h, "b", false);
        h = lib.historyRecord(h, "c", false);
        expect([h.past, h.present, h.future]).toEqual([["a", "b"], "c", []]);
        h = lib.historyUndo(h);
        expect(h.present).toBe("b");
        h = lib.historyUndo(h);
        expect(h.present).toBe("a");
        expect(lib.historyUndo(h)).toBe(h);
        h = lib.historyRedo(h);
        h = lib.historyRedo(h);
        expect(h.present).toBe("c");
        expect(lib.historyRedo(h)).toBe(h);
    });

    it("clears the redo on a new change and merges a continued one into the last step", () => {
        let h = lib.historyInit(0);
        h = lib.historyRecord(h, 1, false);
        h = lib.historyRecord(h, 2, false);
        h = lib.historyUndo(h);
        h = lib.historyRecord(h, 9, false);
        expect(h.future).toEqual([]);
        expect(h.past).toEqual([0, 1]);
        h = lib.historyRecord(h, 10, true);
        h = lib.historyRecord(h, 11, true);
        expect([h.past, h.present]).toEqual([[0, 1], 11]);
        expect(lib.historyUndo(h).present).toBe(1);
    });

    it("forgets what is older than 100 steps", () => {
        let h = lib.historyInit(0);
        for (let i = 1; i <= 130; i++) h = lib.historyRecord(h, i, false);
        expect(h.past).toHaveLength(100);
        expect(h.past[0]).toBe(30);
    });
});
