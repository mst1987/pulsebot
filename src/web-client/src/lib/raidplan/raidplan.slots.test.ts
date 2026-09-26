// Role slots and the Besetzung: players in slots, melee/ranged, the palette,
// mending slots, a board's numbers in an event and the sheet's sections.
// The board logic behind the editors (lib/raidplan.ts) runs for real.
import { describe, expect, it } from "vitest";
import * as lib from ".";
import { inLang } from "../../test/i18n";

const player = (userId, role = "dps") => ({ userId, character: userId, classId: "", className: "", classColor: "", spec: "", specLabel: "", role, iconUrl: "", group: 1 });

describe("slots and players", () => {
    const mk = () => lib.addSlot(lib.addSlot(lib.emptyBoard(), "tank", ""), "healer", "");

    it("puts a player into a slot, taking them off their token and any other slot", () => {
        let b = mk();
        b = lib.placeToken(b, "u1", 0.5, 0.5);
        b = lib.assignSlot(b, b.slots[0].id, "u1");
        expect(b.tokens).toEqual([]);
        expect(b.slots.map((s) => s.userId)).toEqual(["u1", ""]);
        b = lib.assignSlot(b, b.slots[1].id, "u1");
        expect(b.slots.map((s) => s.userId)).toEqual(["", "u1"]);
        b = lib.assignSlot(b, b.slots[1].id, "");
        expect(b.slots.map((s) => s.userId)).toEqual(["", ""]);
    });

    it("takes a player out of a slot when they become a free token, and never lists a slotted player as unplaced", () => {
        let c = mk();
        c = lib.assignSlot(c, c.slots[0].id, "u1");
        expect(lib.unplaced([player("u1"), player("u2")], c).map((p) => p.userId)).toEqual(["u2"]);
        c = lib.placeToken(c, "u1", 0.1, 0.1);
        expect(c.slots[0].userId).toBe("");
        expect(c.tokens.map((k) => k.userId)).toEqual(["u1"]);
        expect(lib.unplaced([player("u1"), player("u2")], c).map((p) => p.userId)).toEqual(["u2"]);
    });

    it("names the players of a setup group for a group marker and counts the open slots", () => {
        const roster = [{ ...player("a"), group: 1 }, { ...player("b"), group: 2 }, { ...player("c"), group: 2 }];
        expect(lib.groupMembers({ kind: "group", n: 2 }, roster).map((p) => p.userId)).toEqual(["b", "c"]);
        let b = lib.addSlot(lib.addSlot(lib.addSlot(lib.emptyBoard(), "tank", ""), "group", ""), "label", "MT");
        expect(lib.openSlots(b)).toBe(1);
        b = lib.assignSlot(b, b.slots[0].id, "a");
        expect(lib.openSlots(b)).toBe(0);
    });

    it("treats objects as content for the questions", () => {
        const bosses = { a: { slots: [{ id: "1" }], marks: [{ id: "2" }], zones: [{ id: "3" }], lines: [{ id: "4" }], texts: [{ id: "5" }] } };
        expect(lib.hasContent(lib.boardOf(bosses, "a"))).toBe(true);
        expect(lib.planHasContent(bosses, ["a", "b"])).toBe(true);
        expect(lib.planHasContent(bosses, ["b"])).toBe(false);
        expect(lib.planHasContent({}, ["a"])).toBe(false);
    });
});

describe("melee and ranged slots", () => {
    it("titles them, counts them as open, and offers them in the palette's context menu", async () => {
        const slot = { id: "a", kind: "melee", n: 2, label: "", x: 0, y: 0, userId: "" };
        expect(lib.slotTitle(slot)).toBe("Melee 2");
        expect(lib.slotTitle({ ...slot, kind: "ranged" })).toBe("Ranged 2");
        expect(lib.slotTitle({ ...slot, kind: "dps" })).toBe("DPS (egal) 2");
        expect(await inLang("en", () => lib.slotTitle({ ...slot, kind: "dps" }))).toBe("DPS (any) 2");
        let b = lib.addSlot(lib.addSlot(lib.addSlot(lib.emptyBoard(), "melee", ""), "ranged", ""), "dps", "");
        expect(lib.openSlots(b)).toBe(3);
        b = lib.assignSlot(b, b.slots[0].id, "u1");
        expect(lib.openSlots(b)).toBe(2);
        const ids = lib.contextMenuItems("board", { locked: false, hasPlayer: false, isEvent: false, kind: "" }).map((i) => i.id);
        for (const k of ["melee", "ranged", "dps"]) expect(ids).toContain("insert:slot:" + k);
        expect(lib.parseInsertId("insert:slot:ranged")).toEqual({ type: "slot", kind: "ranged", label: "" });
    });
});

describe("the Besetzung", () => {
    const bes = { size: 25, counts: { tank: 3, healer: 7, dps: 15, melee: 0, ranged: 0 }, groups: 5, split: false };
    const split = { ...bes, counts: { tank: 3, healer: 7, dps: 15, melee: 8, ranged: 4 }, split: true };
    const p = (userId, role) => ({ ...player(userId), role });
    const kinds = (b, kind) => b.slots.filter((s) => s.kind === kind).map((s) => s.n);
    it("tanks, healers and DPS 1..n exist at once, not on the map, groups included; no melee / ranged unless split", () => {
        const b = lib.ensureBesetzung(lib.emptyBoard(), bes, []);
        expect(b.slots).toHaveLength(3 + 7 + 15 + 5);
        expect(b.slots.every((s) => s.placed === false && s.userId === "")).toBe(true);
        expect(kinds(b, "dps")).toHaveLength(15);
        expect(kinds(b, "melee")).toEqual([]);
        expect(lib.besetzungSlots(b).slice(0, 4).map((s) => s.kind + s.n)).toEqual(["tank1", "tank2", "tank3", "healer1"]);
        expect(kinds(b, "group")).toEqual([1, 2, 3, 4, 5]);
    });
    it("a split makes melee / ranged slots and the rest stays DPS n; an old board with melee / ranged slots keeps them", () => {
        const b = lib.ensureBesetzung(lib.emptyBoard(), split, []);
        expect([kinds(b, "melee").length, kinds(b, "ranged").length, kinds(b, "dps").length]).toEqual([8, 4, 3]);
        expect(lib.slotCounts(split.counts)).toEqual({ tank: 3, healer: 7, dps: 3, melee: 8, ranged: 4 });
    });
    it("never changes or removes what is there, only adds what is missing", () => {
        const start = lib.addSlot(lib.emptyBoard(), "tank", "");
        const b = lib.ensureBesetzung(start, bes, []);
        expect(b.slots.find((s) => s.id === start.slots[0].id)).toEqual(start.slots[0]);
        expect(kinds(b, "tank")).toHaveLength(3);
        expect(lib.ensureBesetzung(b, bes, [])).toBe(b);
        expect(lib.ensureBesetzung(b, null, [])).toBe(b);
    });
    it("in an event DPS n is filled from the damage dealers of the setup in setup order, melee / ranged only by their role", () => {
        const roster = [p("t", "tank"), p("h1", "healer"), p("m", "melee"), p("r", "ranged"), p("d", "dps")];
        const b = lib.ensureBesetzung(lib.emptyBoard(), bes, roster);
        const who = (k, n) => b.slots.find((s) => s.kind === k && s.n === n).userId;
        expect([who("tank", 1), who("healer", 1), who("healer", 2), who("dps", 1), who("dps", 2), who("dps", 3), who("dps", 4)]).toEqual(["t", "h1", "", "m", "r", "d", ""]);
        const s2 = lib.ensureBesetzung(lib.emptyBoard(), { ...split, counts: { ...split.counts, dps: 3, melee: 1, ranged: 1 } }, roster);
        const w2 = (k, n) => s2.slots.find((s) => s.kind === k && s.n === n).userId;
        expect([w2("melee", 1), w2("ranged", 1), w2("dps", 1)]).toEqual(["m", "r", "d"]);
    });
    it("the lineup decides when it has more than the type: extra slots are added; fewer leave slots open, nothing false is filled", () => {
        const many = [...Array.from({ length: 4 }, (_, i) => p("t" + i, "tank")), ...Array.from({ length: 9 }, (_, i) => p("h" + i, "healer")), ...Array.from({ length: 16 }, (_, i) => p("d" + i, "dps"))];
        const b = lib.ensureBesetzung(lib.emptyBoard(), bes, many);
        expect([kinds(b, "tank").length, kinds(b, "healer").length, kinds(b, "dps").length]).toEqual([4, 9, 16]);
        expect(b.slots.filter((s) => s.kind !== "group").every((s) => s.userId)).toBe(true);
        const few = lib.ensureBesetzung(lib.emptyBoard(), bes, [p("t", "tank")]);
        expect(few.slots.filter((s) => s.kind === "tank").map((s) => s.userId)).toEqual(["t", "", ""]);
        // a boss with numbers of its own is not adapted
        const own = lib.ensureBesetzung({ ...lib.emptyBoard(), counts: { tank: 2, healer: 6, dps: 17, melee: 0, ranged: 0 } }, bes, many);
        expect([kinds(own, "tank").length, kinds(own, "healer").length, kinds(own, "dps").length]).toEqual([2, 6, 17]);
    });
    it("+/- set the numbers of this boss, the DPS is one number, melee + ranged stay within it, reset goes back to the type", () => {
        let b = lib.ensureBesetzung(lib.emptyBoard(), bes, []);
        b = lib.setCount(b, bes, "healer", 6, []);
        expect(b.counts).toEqual({ tank: 3, healer: 6, dps: 15, melee: 0, ranged: 0 });
        expect(kinds(b, "healer")).toHaveLength(6);
        expect(lib.ensureBesetzung(b, bes, [])).toBe(b);
        b = lib.setCount(b, bes, "dps", 16, []);
        expect(kinds(lib.ensureBesetzung(b, bes, []), "dps")).toHaveLength(16);
        b = lib.setCount(b, bes, "melee", 99, []);
        expect(b.counts.melee).toBe(16);
        b = lib.setCount(b, bes, "ranged", 5, []);
        expect(b.counts.ranged).toBe(0);
        expect(lib.setCount(b, bes, "tank", -4, []).counts.tank).toBe(0);
        expect(lib.resetCounts(b, bes).counts).toBeNull();
        expect(kinds(lib.ensureBesetzung(lib.resetCounts(b, bes), bes, []), "dps")).toHaveLength(15);
    });
    it("a slot goes onto the map and back, and the palette places the next free one instead of making a new slot", () => {
        let b = lib.ensureBesetzung(lib.emptyBoard(), bes, []);
        const id = b.slots.find((s) => s.kind === "healer" && s.n === 1).id;
        b = lib.placeSlot(b, id, { x: 0.3, y: 0.4 });
        expect(b.slots.find((s) => s.id === id)).toMatchObject({ placed: true, x: 0.3, y: 0.4 });
        expect(lib.unplaceSlot(b, id).slots.find((s) => s.id === id).placed).toBe(false);
        const r = lib.insertObject(b, { type: "slot", kind: "healer", label: "" }, { x: 0.6, y: 0.6 });
        expect(r.board.slots).toHaveLength(b.slots.length);
        expect(r.board.slots.find((s) => s.id === r.sel.id)).toMatchObject({ kind: "healer", n: 2, placed: true, x: 0.6 });
        expect(lib.layerList(b, new Map()).filter((l) => l.kind === "slot")).toHaveLength(1);
    });
    it("flex: a healer plays DPS on this boss, leaves his slot (open) and takes the first open DPS place; the setup role is untouched", () => {
        const roster = [p("h1", "healer"), p("d1", "dps")];
        let b = lib.ensureBesetzung(lib.emptyBoard(), bes, roster);
        expect(b.slots.find((s) => s.kind === "healer" && s.n === 1).userId).toBe("h1");
        b = lib.setFlexRole(b, roster, "h1", "dps");
        expect(b.roles).toEqual({ h1: "dps" });
        expect(b.slots.find((s) => s.kind === "healer" && s.n === 1).userId).toBe("");
        expect(b.slots.find((s) => s.kind === "dps" && s.n === 2).userId).toBe("h1");
        expect(lib.roleOn(b, roster[0])).toBe("dps");
        expect(roster[0].role).toBe("healer");
        // back to the setup's role clears the flex
        const back = lib.setFlexRole(b, roster, "h1", "healer");
        expect(back.roles).toEqual({});
        expect(back.slots.find((s) => s.kind === "healer" && s.n === 1).userId).toBe("h1");
        expect(lib.setFlexRole(b, roster, "nobody", "tank")).toBe(b);
    });
    it("is derived from the raid type with the rules of the events: DPS is what is left", () => {
        const bt = { defaultSize: 25, suggested: { 25: { tanks: 3, healers: 7 } } };
        expect(lib.besetzungFor([bt], 25)).toEqual(bes);
        expect(lib.besetzungFor([bt], 0).size).toBe(25);
        const kara = { defaultSize: 10, suggested: {} };
        const ten = lib.besetzungFor([kara], 10);
        expect(ten.counts.tank + ten.counts.healer + ten.counts.dps).toBe(10);
        expect(ten.groups).toBe(2);
        expect(lib.besetzungFor([], 40).counts.tank).toBe(4);
        expect(lib.besetzungFor([bt, kara], 25).counts.tank).toBe(3);
    });
});

describe("the numbers of a board in an event", () => {
    const bes = { size: 25, counts: { tank: 2, healer: 5, dps: 18, melee: 0, ranged: 0 }, groups: 5, split: false };
    const p = (userId, role) => ({ ...player(userId), role });
    const roster = [...Array.from({ length: 3 }, (_, i) => p("t" + i, "tank")), ...Array.from({ length: 7 }, (_, i) => p("h" + i, "healer")), ...Array.from({ length: 15 }, (_, i) => p("d" + i, "dps"))];
    it("at least what the lineup really has: more tanks and healers than the type give extra slots, fewer DPS leave slots open", () => {
        const c = lib.effectiveCounts(lib.emptyBoard(), bes, roster);
        expect(c).toMatchObject({ tank: 3, healer: 7, dps: 18 });
        const b = lib.ensureBesetzung(lib.emptyBoard(), bes, roster);
        expect(b.slots.filter((s) => s.kind === "dps")).toHaveLength(18);
        expect(b.slots.filter((s) => s.kind === "dps" && !s.userId)).toHaveLength(3);
    });
    it("+/- start from those numbers and then make the boss's own", () => {
        const b = lib.setCount(lib.ensureBesetzung(lib.emptyBoard(), bes, roster), bes, "tank", 4, roster);
        expect(b.counts).toMatchObject({ tank: 4, healer: 7, dps: 18 });
        expect(lib.effectiveCounts(b, bes, roster).tank).toBe(4);
    });
    it("a flex role counts: a healer who plays DPS is one healer less and one DPS more", () => {
        const flexed = { ...lib.emptyBoard(), roles: { h0: "dps" } };
        expect(lib.effectiveCounts(flexed, { ...bes, counts: { tank: 3, healer: 5, dps: 10, melee: 0, ranged: 0 } }, roster)).toMatchObject({ healer: 6, dps: 16 });
    });
});

describe("the palette never makes new role slots", () => {
    const bes = { size: 25, counts: { tank: 3, healer: 7, dps: 15, melee: 0, ranged: 0 }, groups: 5, split: false };
    it("a group or role from the palette places the next slot that is not on the map, never a new one", () => {
        let b = lib.ensureBesetzung(lib.emptyBoard(), bes, []);
        const before = b.slots.length;
        for (let i = 0; i < 5; i += 1) b = lib.insertObject(b, { type: "slot", kind: "group", label: "" }, { x: 0.1 * (i + 1), y: 0.5 }).board;
        expect(b.slots).toHaveLength(before);
        expect(b.slots.filter((s) => s.kind === "group").map((s) => [s.n, s.placed])).toEqual([[1, true], [2, true], [3, true], [4, true], [5, true]]);
    });
    it("when all are placed it says so and changes nothing (also for the context menu and every role)", () => {
        let b = lib.ensureBesetzung(lib.emptyBoard(), bes, []);
        for (let i = 0; i < 5; i += 1) b = lib.insertObject(b, { type: "slot", kind: "group", label: "" }, null).board;
        const r = lib.insertObject(b, { type: "slot", kind: "group", label: "" }, null);
        expect(r.blocked).toBe("group");
        expect(r.board).toBe(b);
        expect(r.sel).toBeNull();
        expect(lib.applyMenuAction(b, "insert:slot:group", "", "", { x: 0.5, y: 0.5 }).blocked).toBe("group");
        expect(lib.insertObject(lib.emptyBoard(), { type: "slot", kind: "melee", label: "" }, null).blocked).toBe("melee");
        expect(lib.slotTally(b).find((t) => t.kind === "group")).toEqual({ kind: "group", placed: 5, total: 5 });
        expect(lib.slotTally(b).find((t) => t.kind === "tank")).toEqual({ kind: "tank", placed: 0, total: 3 });
    });
    it("things without a role stay unlimited: a free label, a mark, a zone, a text, an icon", () => {
        let b = lib.emptyBoard();
        for (let i = 0; i < 3; i += 1) b = lib.insertObject(b, { type: "slot", kind: "label", label: "x" }, null).board;
        expect(b.slots).toHaveLength(3);
        expect(lib.insertObject(b, { type: "mark", mark: "star" }, null).blocked).toBeUndefined();
    });
});

describe("mending role slots that got out of step", () => {
    const bes = { size: 25, counts: { tank: 3, healer: 7, dps: 15, melee: 0, ranged: 0 }, groups: 5, split: false };
    const slot = (kind, n, extra = {}) => ({ id: "s" + Math.random().toString(36).slice(2, 8), kind, n, label: "", x: 0.5, y: 0.5, userId: "", size: 38, hideMembers: false, split: false, offsets: {}, placed: false, opacity: 1, lock: false, hidden: false, ...extra });
    it("the same number twice becomes one: it keeps the player and the map position, the count is the Besetzung's again", () => {
        const start = lib.ensureBesetzung(lib.emptyBoard(), bes, []);
        const extra = [slot("group", 3, { placed: true, x: 0.2, y: 0.3 }), slot("group", 4), slot("group", 4), slot("group", 5, { placed: true, x: 0.9, y: 0.9 }), slot("group", 5), slot("group", 6), slot("healer", 2, { userId: "h" })];
        const broken = { ...start, slots: [...start.slots, ...extra] };
        const b = lib.ensureBesetzung(broken, bes, []);
        expect(b.slots.filter((s) => s.kind === "group").map((s) => s.n).sort()).toEqual([1, 2, 3, 4, 5]);
        expect(b.slots.find((s) => s.kind === "group" && s.n === 3)).toMatchObject({ placed: true, x: 0.2, y: 0.3 });
        expect(b.slots.find((s) => s.kind === "group" && s.n === 5)).toMatchObject({ placed: true, x: 0.9 });
        expect(b.slots.find((s) => s.kind === "healer" && s.n === 2).userId).toBe("h");
        expect(b.slots.filter((s) => s.kind === "healer")).toHaveLength(7);
    });
    it("two different players in one slot are both kept: the second gets a free number", () => {
        const start = lib.ensureBesetzung(lib.emptyBoard(), bes, []);
        const broken = { ...start, slots: [...start.slots.filter((s) => !(s.kind === "tank" && s.n === 1)), slot("tank", 1, { userId: "a" }), slot("tank", 1, { userId: "b" })] };
        const b = lib.repairSlots(broken, bes, []);
        const tanks = b.slots.filter((s) => s.kind === "tank");
        expect(new Set(tanks.map((s) => s.n)).size).toBe(tanks.length);
        expect(tanks.map((s) => s.userId).filter(Boolean).sort()).toEqual(["a", "b"]);
    });
    it("a healthy board is left as it is (the same object), and unassigned unplaced slots above the count go", () => {
        const ok = lib.ensureBesetzung(lib.emptyBoard(), bes, []);
        expect(lib.repairSlots(ok, bes, [])).toBe(ok);
        const more = { ...ok, slots: [...ok.slots, slot("group", 9)] };
        expect(lib.repairSlots(more, bes, []).slots.some((s) => s.kind === "group" && s.n === 9)).toBe(false);
        const keepPlaced = { ...ok, slots: [...ok.slots, slot("group", 9, { placed: true })] };
        expect(lib.repairSlots(keepPlaced, bes, []).slots.some((s) => s.kind === "group" && s.n === 9)).toBe(true);
    });
});

describe("sections in or out of the sheet", () => {
    const sections = [
        { key: "bt/a", name: "A" }, { key: "bt/b", name: "B" },
        { key: "bt/trash", name: "Trash", trash: true }, { key: "bt/general", name: "Allgemein", general: true },
    ];
    it("every section is in unless its board says inSheet: false", () => {
        expect(lib.sheetIncluded({}, "bt/a")).toBe(true);
        expect(lib.sheetIncluded({ "bt/a": { inSheet: true } }, "bt/a")).toBe(true);
        expect(lib.sheetIncluded({ "bt/a": { inSheet: false } }, "bt/a")).toBe(false);
        expect(lib.sheetIncluded({ "bt/a": { inSheet: false } }, "bt/b")).toBe(true);
    });
    it("boardOf reads the flag, a missing one is in", () => {
        expect(lib.boardOf({}, "bt/a").inSheet).toBe(true);
        expect(lib.boardOf({ "bt/a": { inSheet: false } }, "bt/a").inSheet).toBe(false);
    });
    it("the quick actions pick the sections that go in", () => {
        expect(lib.sheetKeysFor(sections, "all")).toEqual(["bt/a", "bt/b", "bt/trash", "bt/general"]);
        expect(lib.sheetKeysFor(sections, "none")).toEqual([]);
        expect(lib.sheetKeysFor(sections, "bosses")).toEqual(["bt/a", "bt/b"]);
        expect(lib.sheetKeysFor(sections, "noTrash")).toEqual(["bt/a", "bt/b", "bt/general"]);
    });
});
