// Raidplan (docs/raidplan.md): the board logic behind the editors
// (src/web-client/src/lib/raidplan.ts) run for real, and the pages' structure
// checked on the source — the client is TSX without a React renderer here.
const fs = require("fs");
const path = require("path");
const { loadTs, read, makeT, stripComments, allDicts } = require("./i18nHelper");

const lib = loadTs("lib/raidplan.ts", { t: makeT("de") });
const libEn = loadTs("lib/raidplan.ts", { t: makeT("en") });

// Role slots belong to the Besetzung: the palette places a free one. These tests start from a board that has one free.
const slotIns = (b, spec, at) => {
    if (spec.type === "slot" && lib.isRoleKind(spec.kind)) {
        const free = { ...lib.addSlot(lib.emptyBoard(), spec.kind, "").slots[0], n: lib.nextSlotNumber(b, spec.kind), placed: false };
        return lib.insertObject({ ...b, slots: [...b.slots, free] }, spec, at);
    }
    return lib.insertObject(b, spec, at);
};

const player = (userId, role = "dps") => ({ userId, character: userId, classId: "", className: "", classColor: "", spec: "", specLabel: "", role, iconUrl: "", group: 1 });
const board = (extra = {}) => ({ ...lib.emptyBoard(), ...extra });
const profile = (extra = {}) => ({ id: "p1", name: "Tanks", category: "Tank", bossKey: "", targets: [{ title: "Main-Tank" }, { title: "Off-Tank" }], notes: "", updatedAt: 0, ...extra });
const look = (extra = {}) => ({ opacity: 1, lock: false, hidden: false, ...extra });

describe("roles and clamping", () => {
    it("tells tank, healer, melee and ranged apart and files everything else as any damage", () => {
        for (const r of ["tank", "healer", "melee", "ranged"]) expect(lib.roleTone(r)).toBe(r);
        for (const r of ["dps", "", "whatever"]) expect(lib.roleTone(r)).toBe("dps");
    });

    it("clamps a coordinate to 0..1 and treats junk as 0", () => {
        expect(lib.clamp01(-2)).toBe(0);
        expect(lib.clamp01(3)).toBe(1);
        expect(lib.clamp01(0.4)).toBe(0.4);
        expect(lib.clamp01(NaN)).toBe(0);
    });

    it("clamps an opacity to 0.1..1 and falls back for junk", () => {
        expect(lib.clampOpacity(0, 1)).toBe(0.1);
        expect(lib.clampOpacity(7, 1)).toBe(1);
        expect(lib.clampOpacity(0.456, 1)).toBe(0.46);
        expect(lib.clampOpacity(NaN, 0.3)).toBe(0.3);
    });
});

describe("boards", () => {
    it("completes the board of an untouched boss", () => {
        expect(lib.boardOf({}, "bt/supremus")).toEqual({ tokens: [], slots: [], marks: [], icons: [], zones: [], lines: [], texts: [], targets: [], assignments: [], steps: [], showMap: true, autoPlace: true, autoPos: {}, mobs: [], hiddenCards: [], inheritOff: [], showRings: true, inSheet: true, groupColors: {}, groupMarks: {}, showNames: true, showBadges: true, showRoleRings: true, view: null, counts: null, roles: {}, notes: "", profileId: "", mapOpacity: 1, objectScale: 1 });
        expect(lib.boardOf({ "bt/supremus": { notes: "x" } }, "bt/supremus")).toMatchObject({ notes: "x", tokens: [] });
        expect(lib.boardOf({ a: { mapOpacity: 0.4 } }, "a").mapOpacity).toBe(0.4);
    });

    it("lists who is not placed yet, in setup order", () => {
        const roster = [player("a"), player("b"), player("c")];
        expect(lib.unplaced(roster, board({ tokens: [{ userId: "b", x: 0.5, y: 0.5, ...look() }] })).map((p) => p.userId)).toEqual(["a", "c"]);
    });

    it("places a token once and moves it afterwards, clamped to the board, keeping its look", () => {
        let b = lib.placeToken(board(), "a", 0.3, 0.6);
        expect(b.tokens).toEqual([{ userId: "a", x: 0.3, y: 0.6, size: 38, opacity: 1, lock: false, hidden: false }]);
        b = lib.patchLook(b, "token", "a", { opacity: 0.4 });
        b = lib.placeToken(b, "a", 1.4, -0.2);
        expect(b.tokens).toEqual([{ userId: "a", x: 1, y: 0, size: 38, opacity: 0.4, lock: false, hidden: false }]);
        b = lib.placeToken(b, "b", 0.1, 0.1);
        expect(b.tokens.map((t) => t.userId)).toEqual(["a", "b"]);
    });

    it("takes a token off without touching the rows and nudges within the board", () => {
        const b = board({ tokens: [{ userId: "a", x: 0.5, y: 0.5, ...look() }], targets: [{ id: "r", title: "MT", userIds: ["a"] }] });
        expect(lib.removeToken(b, "a").tokens).toEqual([]);
        expect(lib.removeToken(b, "a").targets[0].userIds).toEqual(["a"]);
        expect(lib.nudgeObject(b, "token", "a", 0.01, -0.01).tokens[0]).toMatchObject({ userId: "a", x: 0.51, y: 0.49 });
        expect(lib.nudgeObject(lib.placeToken(b, "a", 0.999, 0), "token", "a", 0.05, -0.05).tokens[0]).toMatchObject({ x: 1, y: 0 });
        expect(lib.nudgeObject(b, "token", "nobody", 0.1, 0.1)).toBe(b);
    });

    it("counts objects and rows for the boss chips", () => {
        const bosses = { a: { tokens: [{ userId: "x", x: 0, y: 0 }], targets: [{ id: "1", title: "t", userIds: [] }], lines: [{ id: "l" }], texts: [{ id: "x" }] } };
        expect(lib.boardCount(bosses, "a")).toBe(4);
        expect(lib.boardCount(bosses, "b")).toBe(0);
    });

    it("compares what a save would carry, not the incidental shape", () => {
        const keys = ["a", "b"];
        expect(lib.sameBosses({}, { a: undefined }, keys)).toBe(true);
        expect(lib.sameBosses({ a: { notes: "x" } }, { a: { notes: "x", tokens: [], targets: [], profileId: "" } }, keys)).toBe(true);
        expect(lib.sameBosses({ a: { notes: "x" } }, { a: { notes: "y" } }, keys)).toBe(false);
        expect(lib.sameBosses({ a: { mapOpacity: 0.5 } }, { a: {} }, keys)).toBe(false);
        // a boss the event does not have is not part of the save
        expect(lib.sameBosses({ gone: { notes: "x" } }, {}, keys)).toBe(true);
        expect(Object.keys(lib.toSave({ a: { notes: "x" }, gone: { notes: "y" } }, keys))).toEqual(["a"]);
    });
});

describe("task rows", () => {
    it("old target rows are read as assignments: the title is the task, the players do it, nothing is invented", () => {
        const r = lib.boardOf({ k: { targets: [{ id: "r1", title: "Main-Tank", userIds: ["u1", "u2"] }, { id: "r2", title: "Kick", userIds: [] }], assignments: [{ id: "a1", type: "heal", assignees: ["slot:healer:1"], targets: [], note: "", suggested: false }] } }, "k");
        expect(r.targets).toEqual([]);
        expect(r.assignments.map((x) => [x.id, x.type, x.title, x.assignees])).toEqual([["r1", "other", "Main-Tank", ["user:u1", "user:u2"]], ["r2", "other", "Kick", []], ["a1", "heal", "", ["slot:healer:1"]]]);
        // reading it again gives the same (nothing changes until it is edited)
        expect(lib.boardOf({ k: r }, "k")).toEqual(r);
    });

    it("gives every new row its own id", () => {
        expect(new Set(Array.from({ length: 50 }, () => lib.newRowId())).size).toBe(50);
    });
});

describe("tactic profiles", () => {
    it("asks first only when the board holds something", () => {
        expect(lib.hasContent(board())).toBe(false);
        expect(lib.hasContent(board({ notes: "  " }))).toBe(false);
        expect(lib.hasContent(board({ notes: "x" }))).toBe(true);
        expect(lib.hasContent(board({ assignments: [{ id: "a", type: "other", title: "a", assignees: [], targets: [], note: "", suggested: false }] }))).toBe(true);
        expect(lib.hasContent(board({ mapOpacity: 0.5 }))).toBe(true);
    });

    it("applies a profile: its titles become rows, the profile id is kept, typed assignments and players on rows whose title stays are kept", () => {
        const row = (id, type, title, assignees = []) => ({ id, type, title, assignees, targets: [], note: "", suggested: false });
        const b = board({
            tokens: [{ userId: "a", x: 0.5, y: 0.5, ...look() }],
            assignments: [row("keep", "other", "main-tank", ["user:u1"]), row("old", "other", "Something else", ["user:u2"]), row("heal", "heal", "", ["slot:healer:1"])],
            notes: "mine",
        });
        const r = lib.applyProfile(b, profile());
        expect(r.profileId).toBe("p1");
        expect(r.assignments.map((x) => x.title)).toEqual(["", "Main-Tank", "Off-Tank"]);
        expect(r.assignments[0]).toMatchObject({ id: "heal", type: "heal" });
        expect(r.assignments[1]).toMatchObject({ id: "keep", assignees: ["user:u1"] });
        expect(r.assignments[2].assignees).toEqual([]);
        expect(r.tokens).toEqual(b.tokens);
        expect(r.notes).toBe("mine");
        expect(lib.applyProfile(b, profile({ notes: "phase 1" })).notes).toBe("phase 1");
    });

    it("saves only the task titles as a profile", () => {
        const row = (title) => ({ id: title, type: "other", title, assignees: ["user:u1"], targets: [], note: "", suggested: false });
        expect(lib.profileRows(board({ assignments: [row(" MT "), row("  ")] }))).toEqual([{ title: "MT" }]);
    });

    it("offers the profiles for every boss, the boss's instance or exactly this boss", () => {
        const all = profile({ id: "all" });
        const inst = profile({ id: "inst", bossKey: "bt" });
        const here = profile({ id: "here", bossKey: "bt/supremus" });
        const other = profile({ id: "other", bossKey: "bt/illidan-stormrage" });
        const elsewhere = profile({ id: "kara", bossKey: "kara" });
        expect(lib.profilesFor([all, inst, here, other, elsewhere], "bt/supremus").map((p) => p.id)).toEqual(["all", "inst", "here"]);
    });

    it("groups by category, filtered by a search, with the uncategorised last", () => {
        const ps = [profile({ id: "1", name: "Zeta", category: "Tank" }), profile({ id: "2", name: "Alpha", category: "" }), profile({ id: "3", name: "Beta", category: "Heiler" })];
        expect(lib.groupProfiles(ps, "").map((g) => g.category)).toEqual(["Heiler", "Tank", ""]);
        expect(lib.groupProfiles(ps, "  ZETA ").map((g) => g.profiles.map((p) => p.id))).toEqual([["1"]]);
        expect(lib.groupProfiles(ps, "heil").map((g) => g.profiles[0].id)).toEqual(["3"]);
        expect(lib.groupProfiles(ps, "nothing")).toEqual([]);
    });

    it("looks players up by userId", () => {
        const m = lib.rosterMap([player("a"), player("b")]);
        expect(m.get("b").userId).toBe("b");
        expect(m.get("zzz")).toBeUndefined();
    });
});

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

    it("titles a slot in the active language, with its own label winning", () => {
        const slot = { id: "a", kind: "tank", n: 2, label: "", x: 0, y: 0, userId: "" };
        expect(lib.slotTitle(slot)).toBe("Tank 2");
        expect(lib.slotTitle({ ...slot, kind: "healer" })).toBe("Heiler 2");
        expect(libEn.slotTitle({ ...slot, kind: "healer" })).toBe("Healer 2");
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

    it("keeps a menu inside the viewport", () => {
        expect(lib.clampMenuPosition(100, 100, 200, 300, 1600, 900)).toEqual({ x: 100, y: 100 });
        expect(lib.clampMenuPosition(1500, 100, 200, 300, 1600, 900)).toEqual({ x: 1392, y: 100 });
        expect(lib.clampMenuPosition(100, 800, 200, 300, 1600, 900)).toEqual({ x: 100, y: 592 });
        expect(lib.clampMenuPosition(1590, 890, 200, 300, 1600, 900)).toEqual({ x: 1392, y: 592 });
        // taller than the viewport: at the top edge, never above it
        expect(lib.clampMenuPosition(10, 500, 200, 2000, 1600, 900)).toEqual({ x: 10, y: 8 });
        expect(lib.clampMenuPosition(-50, -50, 200, 300, 1600, 900)).toEqual({ x: 8, y: 8 });
    });
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

describe("the pages", () => {
    const tab = read("pages/raid-detail/RaidplanTab.tsx");
    const work = read("pages/raid-detail/raidplan/BoardWorkspace.tsx");
    const tpl = read("pages/RaidplanTemplatesPage.tsx");
    const board2 = read("components/raidplan/PlanBoard.tsx");
    const detail = read("pages/RaidDetailPage.tsx");
    const app = read("App.tsx");
    const pub = read("pages/PlanPublicPage.tsx");
    const css = read("styles/raidplan.css");
    const menu = read("pages/raid-detail/raidplan/ContextMenu.tsx");
    const insp = read("pages/raid-detail/raidplan/Inspector.tsx");

    it("is a tab of an own event only, after the setup", () => {
        expect(detail).toMatch(/const TABS: Tab\[\] = \["roster", "setup", "plan", "loot", "logs"\];/);
        expect(detail).toMatch(/\(t !== "setup" && t !== "plan"\) \|\| ownEvent/);
        expect(detail).toContain("{shown === \"plan\" && <RaidplanTab ctx={ctx} />}");
    });

    it("drags with Pointer Events on window, never with HTML5 drag and drop", () => {
        const src = stripComments(tab + work + board2);
        expect(src).toContain("window.addEventListener(\"pointermove\"");
        expect(src).toContain("window.addEventListener(\"pointerup\"");
        expect(src).toContain("window.addEventListener(\"pointercancel\"");
        for (const banned of ["onDragStart", "onDrop", "onDragOver", "draggable={true}", "dataTransfer"]) expect(src).not.toContain(banned);
        expect(css).toMatch(/\.rp-token\.is-editable \.rp-token-btn \{[^}]*touch-action: none/);
        expect(css).toMatch(/\.rp-zone\.is-editable \{[^}]*touch-action: none/);
        expect(css).toMatch(/\.rp-handle \{[^}]*touch-action: none/);
        expect(css).toMatch(/\.rp-pal-item \{[^}]*touch-action: none/);
        expect(css).toMatch(/\.rp-text\.is-editable \{[^}]*touch-action: none/);
    });

    it("sends the version it read, treats a conflict as a hint and writes nothing before Save", () => {
        expect(tab).toContain("version: view.plan.version");
        expect(tab).toContain("e.code === \"conflict\"");
        expect(tab).toContain("raidBoard.conflict.text");
        expect(tab.match(/saveRaidplan\(/g)).toHaveLength(1);
    });

    it("draws players with their spec icon in a role ring, not with hand-drawn circles", () => {
        expect(board2).toContain("player.iconUrl");
        expect(board2).toContain("rp-role-${roleTone(player.role)}");
        expect(css).toMatch(/\.rp-role-tank \{ --ring: var\(--rp-tank\)/);
        expect(css).toMatch(/--rp-tank: #60a5fa; --rp-healer: #35d6c4; --rp-melee: #f97316; --rp-ranged: #a78bfa; --rp-dps: #f5c542/);
        // ranged is told from melee by a double ring, not only by its colour
        expect(css).toMatch(/\.rp-role-ranged \{[^}]*border-style: double/);
    });

    it("answers the public route before the menu asks for a session", () => {
        expect(app).toMatch(/pathname\.match\(\/\^\\\/p\\\/\(\[A-Za-z0-9_-\]\+\)\\\/\?\$\/\)/);
        expect(app).toMatch(/if \(publicPlan\) return <PlanPublicPage token=\{publicPlan\[1\]\} \/>;\s*\n\s*return <MenuApp \/>;/);
        expect(pub).toContain("getRaidplanPublic(token)");
        expect(pub).toContain("data.me");
        expect(pub).not.toContain("csrfToken");
    });

    it("keeps to its own css namespace and the app's tokens", () => {
        const classes = [...css.matchAll(/\.([a-z]{2,4}-[\w-]+)/g)].map((m) => m[1]);
        const prefixes = new Set(classes.map((c) => c.split("-")[0]));
        expect([...prefixes].filter((p) => p !== "rp" && p !== "is" && p !== "no")).toEqual([]);
        expect(css).toContain("var(--accent)");
        expect(css).toContain("var(--panel)");
    });

    it("shares one workspace between the event plan and the template, with no second copy of the drag", () => {
        expect(tab).toContain("<BoardWorkspace");
        expect(tpl).toContain("<BoardWorkspace");
        expect(tab).toContain('mode="event"');
        expect(tpl).toContain('mode="template"');
        for (const src of [tab, tpl]) expect(stripComments(src)).not.toContain("addEventListener");
    });

    it("keeps the head and tabs in the normal frame and lifts the width cap only where an editor is", () => {
        expect(css).toContain(".content:has([data-rp-editor]) { max-width: none; }");
        expect(tab).not.toContain("rp-wide");
        expect(tpl).not.toContain("rp-wide");
        expect(tpl).toContain("<PageHead");
        expect(css).toMatch(/\.rp-stage \{[^}]*grid-template-columns: 124px minmax\(0, 1fr\) 236px/);
        expect(css).toMatch(/\.rp-public \{ max-width: 1800px/);
        expect(css).toMatch(/\.rp-public-body \{ display: flex; flex-direction: column/);
    });

    it("keeps everything editable in view: a sticky tool bar, the palette, the properties panel and the layers, no dialog for edits", () => {
        expect(css).toMatch(/\.rp-sticky \{ position: sticky; top: 62px/);
        for (const needle of ["<Palette", "<Inspector", "<LayerList", "<MapPanel", "rp-toolbar2", "role=\"toolbar\"", "data-rp-tray"]) expect(work).toContain(needle);
        // the edits that used to hide in dialogs are gone; only the rare things keep one
        expect(fs.existsSync(path.join(__dirname, "..", "..", "src", "web-client", "src", "pages", "raid-detail", "raidplan", "ObjectModals.tsx"))).toBe(false);
        expect(fs.existsSync(path.join(__dirname, "..", "..", "src", "web-client", "src", "pages", "raid-detail", "raidplan", "MapModal.tsx"))).toBe(false);
        expect(stripComments(work)).not.toContain("<Modal");
        expect(stripComments(insp)).not.toContain("<Modal");
        // rows and the players not placed are open, not folded away
        expect(stripComments(work)).not.toContain("<details");
    });

    it("has a right-click menu of its own on the board only, keyboard-operable and inside the viewport", () => {
        expect(board2).toContain("onContextMenu");
        expect(board2).toContain("e.preventDefault()");
        expect(work).toContain("<ContextMenu");
        expect(work).toContain("LONG_PRESS_MS");
        expect(work).toContain("e.pointerType === \"touch\"");
        expect(menu).toContain("role=\"menu\"");
        expect(menu).toContain("role=\"menuitem\"");
        expect(menu).toContain("role=\"separator\"");
        for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Escape"]) expect(menu).toContain(`"${key}"`);
        expect(menu).toContain("clampMenuPosition");
        expect(menu).toContain("createPortal");
    });

    it("undoes with Ctrl+Z / Ctrl+Y and offers the buttons", () => {
        expect(work).toContain("mod && e.key.toLowerCase() === \"z\"");
        expect(work).toContain("history.undo");
        expect(work).toContain("history.redo");
        expect(read("pages/raid-detail/raidplan/useDraftHistory.ts")).toContain("historyRecord");
    });

    it("uses icon buttons with a tooltip and an accessible name instead of text buttons", () => {
        expect(work).toContain("lucide-react");
        expect(work).toContain("<IconButton");
        expect(tab).toContain("<IconButton");
        expect(tab).toContain("tip={");
        expect(read("components/ui/Button.tsx")).toContain("aria-label={rest[\"aria-label\"] || tip}");
        expect(work).not.toMatch(/<Button[^>]*>\s*\{t\("raidBoard\.bar\.save"\)/);
    });

    it("gives every kind of object an opacity control, and the map its own", () => {
        expect(insp).toContain("OpacityField");
        expect(insp).toContain("min={10} max={100} step={5} unit=\"%\"");
        expect(insp).toContain("MapOpacityField");
        expect(board2).toContain("style={{ opacity: mapOpacity }}");
        expect(board2).toContain("opacity: l.opacity");
        expect(board2).toContain("opacity: x.opacity");
        expect(board2).toContain("opacity: m.opacity");
        expect(board2).toContain("opacity: s.opacity");
        expect(board2).toContain("opacity: tok.opacity");
        expect(board2).toContain("\"--zo\": z.opacity");
    });

    it("renders zones, marks, slots, lines, texts and groups in the shared board and the read view", () => {
        for (const needle of ["zones.filter", "marks.filter", "slots.filter", "lines.filter", "texts.filter", "tokens.filter", "groupListMembers", "rp-zone-label", "ZONE_GLYPHS", "arrowHead"]) expect(board2).toContain(needle);
        expect(pub).toContain("slots={boss.slots}");
        expect(pub).toContain("lines={boss.lines}");
        expect(pub).toContain("texts={boss.texts}");
        expect(pub).toContain("mapOpacity={boss.mapOpacity}");
        expect(pub).toContain("boss.slots.some((sl) => sl.userId === data.me)");
    });

    it("fits any map: the board takes the map's aspect ratio", () => {
        expect(board2).toContain("naturalWidth / i.naturalHeight");
        expect(board2).toContain("aspectRatio: String(ar)");
        expect(board2).toContain("100vh - 420px");
    });

    it("marks a zone's type by pattern and label as well as colour", () => {
        expect(css).toMatch(/\.rp-zone-danger \{[^}]*repeating-linear-gradient/);
        expect(css).toMatch(/\.rp-zone-healthy \{[^}]*radial-gradient/);
        expect(css).toMatch(/\.rp-zone-neutral \{[^}]*dashed/);
        expect(board2).toContain("aria-label={`${t(`raidBoard.zone.${z.type}`)}: ${name}`}");
    });

    it("uses the game's own raid mark icons, served from the client's public folder", () => {
        const icon = read("components/raidplan/MarkIcon.tsx");
        expect(icon).toContain("markUrl(mark)");
        expect(lib.markUrl("skull")).toBe("/raidmarks/skull.png");
        const dir = path.join(__dirname, "..", "..", "src", "web-client", "public", "raidmarks");
        for (const m of lib.RAID_MARKS) {
            const file = path.join(dir, `${m}.png`);
            expect(fs.existsSync(file)).toBe(true);
            // a real PNG, not an error page
            expect(fs.readFileSync(file).subarray(0, 4).toString("hex")).toBe("89504e47");
        }
    });

    it("lets a map be reset to its default from the background tab", () => {
        const panel = read("pages/raid-detail/raidplan/MapPanel.tsx");
        expect(panel).toContain("raidBoard.board.mapReset");
        expect(tab).toContain("e/${eventId}/${boss.key}");
        expect(tpl).toContain("t/${tpl.id}/${boss.key}");
    });

    it("applies a template on the server's answer and asks first only when the plan holds something", () => {
        expect(tab).toContain("applyRaidplanTemplate(csrfToken, { event: eventId, templateId: tpl.id, version: view.plan.version })");
        expect(tab).toContain("planHasContent(view.plan.bosses, bossKeys)");
    });

    it("reaches the template page from the raid list and the router, inside the raids area", () => {
        expect(app).toMatch(/path="raids\/plan-templates" element=\{<Guard user=\{user\} areas=\{\["raids"\]\}><RaidplanTemplatesPage \/><\/Guard>\}/);
        // in the menu (a sub entry of Raid-Events), no longer a button in the page head
        expect(read("pages/RaidsPage.tsx")).not.toContain("/raids/plan-templates");
        expect(JSON.stringify(require("../../src/config/menu.json"))).toContain("/raids/plan-templates");
        expect(read("components/Shell.tsx")).toContain("/raids/plan-templates");
    });
});

describe("the texts", () => {
    it("exist in German and English for every key the raid plan asks for", () => {
        const { de, en } = allDicts();
        const files = [
            "pages/RaidplanTemplatesPage.tsx", "pages/raid-detail/raidplan/BoardWorkspace.tsx", "pages/raid-detail/raidplan/Inspector.tsx", "pages/raid-detail/raidplan/LayerList.tsx",
            "pages/raid-detail/raidplan/Palette.tsx", "pages/raid-detail/raidplan/MapPanel.tsx", "pages/raid-detail/raidplan/BossNav.tsx", "pages/raid-detail/raidplan/Palette.tsx", "pages/raid-detail/RaidplanTab.tsx",
            "pages/raid-detail/raidplan/TargetsPanel.tsx", "pages/raid-detail/raidplan/ProfileModals.tsx", "pages/raid-detail/raidplan/ShareModal.tsx", "pages/PlanPublicPage.tsx",
            "components/raidplan/PlanBoard.tsx",
        ];
        const keys = new Set();
        for (const f of files) for (const m of read(f).matchAll(/\bt\(\s*"((?:raidBoard|planTemplates)\.[\w.]+)"/g)) keys.add(m[1]);
        expect(keys.size).toBeGreaterThan(110);
        const missing = [...keys].filter((k) => de[k] === undefined || en[k] === undefined);
        expect(missing).toEqual([]);
        // the labels that are looked up by a computed key
        for (const role of ["tank", "healer", "dps"]) expect(de[`raidBoard.role.${role}`]).toBeTruthy();
        for (const k of ["skull", "cross", "square", "moon", "triangle", "diamond", "circle", "star"]) expect([de, en].map((d) => d[`raidBoard.mark.${k}`])).not.toContain(undefined);
        for (const k of ["danger", "healthy", "neutral", "custom", "rect", "ellipse"]) expect([de, en].map((d) => d[`raidBoard.zone.${k}`])).not.toContain(undefined);
        for (const k of ["tank", "healer", "melee", "ranged", "dps", "group", "label"]) expect([de, en].map((d) => d[`raidBoard.slot.kind.${k}`])).not.toContain(undefined);
        for (const k of ["boss", "wow", "enemy", "bosspos", "label"]) expect([de, en].map((d) => d[`raidBoard.icon.${k}`])).not.toContain(undefined);
        for (const k of ["members_hide", "members_show", "split_on", "split_off", "resetpos"]) expect([de, en].map((d) => d[`raidBoard.ctx.${k}`])).not.toContain(undefined);
        for (const k of ["tank", "healer", "melee", "ranged", "dps", "group"]) expect([de, en].map((d) => d[`raidBoard.slot.${k}`])).not.toContain(undefined);
        for (const k of ["token", "slot", "mark", "icon", "member", "zone", "line", "text"]) expect([de, en].map((d) => d[`raidBoard.obj.${k}`])).not.toContain(undefined);
        for (const k of ["arrow", "line"]) expect([de, en].map((d) => d[`raidBoard.line.${k}`])).not.toContain(undefined);
        for (const k of ["properties", "duplicate", "front", "back", "lock", "unlock", "assign", "unassign", "delete", "deselect", "insertHere", "board"]) expect([de, en].map((d) => d[`raidBoard.ctx.${k}`])).not.toContain(undefined);
        expect(de["raidDetail.page.tab.plan"]).toBe("Raidplan");
        expect(en["raidDetail.page.tab.plan"]).toBe("Raid plan");
    });

    it("keeps the two languages' placeholders in step", () => {
        const de = makeT("de");
        const en = makeT("en");
        expect(de("raidBoard.profile.applyTitle", { name: "X" })).toContain("X");
        expect(en("raidBoard.profile.applyTitle", { name: "X" })).toContain("X");
        expect(de("raidBoard.bar.savedDropped", { count: 2 })).toContain("2");
        expect(de("raidBoard.ctx.insertHere", { what: "Tank" })).toBe("Hier einfügen: Tank");
        expect(en("raidBoard.ctx.insertHere", { what: "Tank" })).toBe("Insert here: Tank");
    });

    it("has no leftover file for the wrong namespace", () => {
        const dir = path.join(__dirname, "..", "..", "src", "web-client", "src", "i18n", "locales");
        expect(fs.existsSync(path.join(dir, "de", "raidBoard.json"))).toBe(true);
        expect(fs.existsSync(path.join(dir, "en", "raidBoard.json"))).toBe(true);
    });
});

describe("melee and ranged slots", () => {
    it("titles them, counts them as open, and offers them in the palette's context menu", () => {
        const slot = { id: "a", kind: "melee", n: 2, label: "", x: 0, y: 0, userId: "" };
        expect(lib.slotTitle(slot)).toBe("Melee 2");
        expect(lib.slotTitle({ ...slot, kind: "ranged" })).toBe("Ranged 2");
        expect(lib.slotTitle({ ...slot, kind: "dps" })).toBe("DPS (egal) 2");
        expect(libEn.slotTitle({ ...slot, kind: "dps" })).toBe("DPS (any) 2");
        let b = lib.addSlot(lib.addSlot(lib.addSlot(lib.emptyBoard(), "melee", ""), "ranged", ""), "dps", "");
        expect(lib.openSlots(b)).toBe(3);
        b = lib.assignSlot(b, b.slots[0].id, "u1");
        expect(lib.openSlots(b)).toBe(2);
        const ids = lib.contextMenuItems("board", { locked: false, hasPlayer: false, isEvent: false, kind: "" }).map((i) => i.id);
        for (const k of ["melee", "ranged", "dps"]) expect(ids).toContain("insert:slot:" + k);
        expect(lib.parseInsertId("insert:slot:ranged")).toEqual({ type: "slot", kind: "ranged", label: "" });
    });
});

describe("sizes", () => {
    const one = (spec) => slotIns(lib.emptyBoard(), spec, { x: 0.5, y: 0.5 });

    it("starts every object with the default size of its kind", () => {
        expect(one({ type: "slot", kind: "tank", label: "" }).board.slots[0].size).toBe(38);
        expect(one({ type: "mark", mark: "star" }).board.marks[0].size).toBe(34);
        expect(one({ type: "icon", iconKey: "enemy", label: "" }).board.icons[0]).toMatchObject({ size: 48, rotation: 0, iconKey: "enemy" });
        expect(lib.placeToken(lib.emptyBoard(), "u1", 0.5, 0.5).tokens[0].size).toBe(38);
    });

    it("sets a size inside the range of each kind and leaves a locked object alone", () => {
        const check = (kind, board, id, low, high) => {
            expect(lib.sizeOf(lib.setObjectSize(board, kind, id, 1), kind, id)).toBe(low);
            expect(lib.sizeOf(lib.setObjectSize(board, kind, id, 9999), kind, id)).toBe(high);
        };
        let b = lib.emptyBoard();
        for (const spec of [{ type: "slot", kind: "tank", label: "" }, { type: "mark", mark: "star" }, { type: "icon", iconKey: "enemy", label: "" }, { type: "text", text: "T" }, { type: "line", kind: "line" }]) b = slotIns(b, spec, { x: 0.5, y: 0.5 }).board;
        b = lib.placeToken(b, "u1", 0.5, 0.5);
        check("token", b, "u1", 10, 152);
        check("slot", b, b.slots[0].id, 10, 152);
        check("mark", b, b.marks[0].id, 9, 136);
        check("icon", b, b.icons[0].id, 12, 192);
        check("text", b, b.texts[0].id, 5, 72);
        check("line", b, b.lines[0].id, 1, 16);
        expect(lib.setObjectSize(b, "mark", b.marks[0].id, NaN)).toBe(b);
        const locked = lib.patchLook(b, "icon", b.icons[0].id, { lock: true });
        expect(lib.setObjectSize(locked, "icon", b.icons[0].id, 100)).toBe(locked);
        expect(lib.sizeOf(b, "zone", "x")).toBeNull();
        expect(lib.sizeOf(b, "mark", "nope")).toBeNull();
    });

    it("scales an object by a factor, a zone around its centre and inside the board", () => {
        let b = slotIns(lib.emptyBoard(), { type: "icon", iconKey: "enemy", label: "" }, null).board;
        const id = b.icons[0].id;
        expect(lib.sizeOf(lib.scaleObject(b, "icon", id, 2), "icon", id)).toBe(96);
        expect(lib.sizeOf(lib.scaleObject(b, "icon", id, 0.5), "icon", id)).toBe(24);
        expect(lib.sizeOf(lib.scaleObject(lib.scaleObject(b, "icon", id, 1.1), "icon", id, 1 / 1.1), "icon", id)).toBe(48);
        b = slotIns(lib.emptyBoard(), { type: "zone", zoneType: "danger", shape: "rect" }, { x: 0.5, y: 0.5 }).board;
        const z = b.zones[0];
        const big = lib.scaleObject(b, "zone", z.id, 2).zones[0];
        expect(big.w).toBeCloseTo(0.4);
        expect(big.x + big.w / 2).toBeCloseTo(z.x + z.w / 2);
        const huge = lib.scaleObject(b, "zone", z.id, 50).zones[0];
        expect([huge.w, huge.h]).toEqual([1, 1]);
        expect(lib.scaleObject(lib.patchLook(b, "zone", z.id, { lock: true }), "zone", z.id, 2).zones[0].w).toBe(z.w);
        expect(lib.scaleObject(b, "mark", "nope", 2)).toBe(b);
    });

    it("sets the board's default object size between 0.5 and 2", () => {
        expect(lib.setObjectScale(lib.emptyBoard(), 1.5).objectScale).toBe(1.5);
        expect(lib.setObjectScale(lib.emptyBoard(), 0).objectScale).toBe(0.4);
        expect(lib.setObjectScale(lib.emptyBoard(), 7).objectScale).toBe(2);
        expect(lib.setObjectScale(lib.emptyBoard(), NaN).objectScale).toBe(1);
        expect(lib.hasContent(lib.setObjectScale(lib.emptyBoard(), 1.2))).toBe(true);
    });
});

describe("icons", () => {
    it("tells the sources apart and turns a boss entry into its icon key", () => {
        expect(lib.iconKeyType("boss:609")).toBe("boss");
        expect(lib.iconKeyType("wow:spell_fire_fireball")).toBe("wow");
        expect(lib.iconKeyType("enemy")).toBe("enemy");
        expect(lib.iconKeyType("bosspos")).toBe("bosspos");
        expect(lib.iconKeyType("http://x")).toBe("");
        expect(lib.iconKeyForBoss("/bosses/602.jpg")).toBe("boss:602");
        // a boss the encounter list has no picture for shows its instance's icon
        expect(lib.iconKeyForBoss("https://wow.zamimg.com/images/wow/icons/large/achievement_boss_illidan.jpg")).toBe("wow:achievement_boss_illidan");
        expect(lib.iconKeyForBoss("https://wow.zamimg.com/images/wow/icons/large/achievement_boss_kael%27thassunstrider_01.jpg")).toBe("wow:achievement_boss_kael'thassunstrider_01");
        expect(lib.iconKeyForBoss("")).toBe("enemy");
    });

    it("moves, copies, orders, names and deletes an icon, and lists it among the layers", () => {
        let b = slotIns(lib.emptyBoard(), { type: "icon", iconKey: "boss:609", label: "Illidan" }, { x: 0.3, y: 0.3 }).board;
        const id = b.icons[0].id;
        b = lib.moveObject(b, "icon", id, 2, -1);
        expect(b.icons[0]).toMatchObject({ x: 1, y: 0 });
        b = lib.updateIcon(b, id, { rotation: 90 });
        const copy = lib.duplicateObject(b, "icon", id);
        expect(copy.board.icons).toHaveLength(2);
        expect(copy.board.icons[1].rotation).toBe(90);
        expect(lib.reorderObject(copy.board, "icon", id, "front").icons[1].id).toBe(id);
        const players = lib.rosterMap([]);
        expect(lib.objectName(b, "icon", id, players)).toBe("Illidan");
        expect(lib.objectName(lib.updateIcon(b, id, { label: "", iconKey: "enemy" }), "icon", id, players)).toBe("Gegner / Add");
        expect(lib.layerList(b, players)[0]).toMatchObject({ kind: "icon", name: "Illidan" });
        expect(lib.patchLook(b, "icon", id, { opacity: 0.5 }).icons[0].opacity).toBe(0.5);
        expect(lib.removeObject(b, "icon", id).icons).toEqual([]);
        expect(lib.parseInsertId("insert:icon:enemy")).toEqual({ type: "icon", iconKey: "enemy", label: "" });
    });
});

describe("group markers: hiding and splitting", () => {
    const roster = () => [
        { ...player("t1", "tank"), group: 1 }, { ...player("h1", "healer"), group: 1 }, { ...player("m1", "melee"), group: 1 },
        { ...player("r1", "ranged"), group: 2 }, { ...player("m2", "melee"), group: 2 },
    ];
    const group = (extra = {}) => {
        const b = slotIns(lib.emptyBoard(), { type: "slot", kind: "group", label: "" }, { x: 0.5, y: 0.5 }).board;
        return lib.updateSlot(b, b.slots[0].id, extra);
    };

    it("starts a group together, showing its raiders, and lists its members only when it is split and shown", () => {
        const b = group({ n: 1 });
        expect(b.slots[0]).toMatchObject({ hideMembers: false, split: false, offsets: {} });
        expect(lib.splitMembers(b, b.slots[0], roster())).toEqual([]);
        const s = group({ n: 1, split: true });
        expect(lib.splitMembers(s, s.slots[0], roster()).map((p) => p.userId)).toEqual(["t1", "h1", "m1"]);
        const hidden = group({ n: 1, split: true, hideMembers: true });
        expect(lib.splitMembers(hidden, hidden.slots[0], roster())).toEqual([]);
        expect(lib.splitMembers(lib.addSlot(lib.emptyBoard(), "tank", ""), lib.addSlot(lib.emptyBoard(), "tank", "").slots[0], roster())).toEqual([]);
    });

    it("leaves out a raider who already stands elsewhere on the board and counts split raiders as placed", () => {
        let b = group({ n: 1, split: true });
        b = lib.placeToken(b, "t1", 0.1, 0.1);
        expect(lib.splitMembers(b, b.slots[0], roster()).map((p) => p.userId)).toEqual(["h1", "m1"]);
        expect(lib.unplaced(roster(), b).map((p) => p.userId)).toEqual(["r1", "m2"]);
        // together, the group's raiders are not on the board as tokens: they are still "not placed"
        const together = group({ n: 1 });
        expect(lib.unplaced(roster(), together)).toHaveLength(5);
    });

    it("keeps hiding and splitting independent of each other", () => {
        let b = group({ n: 1 });
        const id = b.slots[0].id;
        b = lib.applyMenuAction(b, "split:on", "slot", id, null).board;
        expect(b.slots[0]).toMatchObject({ split: true, hideMembers: false });
        b = lib.applyMenuAction(b, "members:hide", "slot", id, null).board;
        expect(b.slots[0]).toMatchObject({ split: true, hideMembers: true });
        b = lib.applyMenuAction(b, "split:off", "slot", id, null).board;
        expect(b.slots[0]).toMatchObject({ split: false, hideMembers: true });
        b = lib.applyMenuAction(b, "members:show", "slot", id, null).board;
        expect(b.slots[0]).toMatchObject({ split: false, hideMembers: false });
    });

    it("offers the two switches in the group's menu, named for what they will do", () => {
        const items = (extra) => lib.contextMenuItems("slot", { locked: false, hasPlayer: false, isEvent: true, kind: "group", ...extra }).map((i) => i.id);
        expect(items({})).toEqual(expect.arrayContaining(["members:hide", "split:on"]));
        expect(items({ hideMembers: true, split: true })).toEqual(expect.arrayContaining(["members:show", "split:off"]));
        expect(items({})).not.toContain("assign");
        expect(lib.contextMenuItems("slot", { locked: false, hasPlayer: false, isEvent: true, kind: "tank" }).map((i) => i.id)).not.toContain("split:on");
        expect(lib.contextMenuItems("member", { locked: false, hasPlayer: false, isEvent: true, kind: "" }).map((i) => i.id)).toEqual(["properties", "member:out", "resetpos"]);
    });

    it("arranges the raiders on a ring that grows with their number and never overlaps", () => {
        expect(lib.ringOffsets(0, 600, 400, 38)).toEqual([]);
        expect(lib.ringOffsets(3, 0, 400, 38)).toEqual([]);
        for (const [count, w, h] of [[1, 600, 400], [5, 650, 650], [12, 800, 500], [25, 1200, 700]]) {
            const ring = lib.ringOffsets(count, w, h, 38);
            expect(ring).toHaveLength(count);
            const pts = ring.map((o) => ({ x: o.dx * w, y: o.dy * h }));
            for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)).toBeGreaterThanOrEqual(38);
            // a circle in pixels, whatever the board's shape
            for (const p of pts) expect(Math.hypot(p.x, p.y)).toBeCloseTo(Math.hypot(pts[0].x, pts[0].y), 5);
        }
        // the first raider is at the top of the marker
        expect(lib.ringOffsets(4, 600, 400, 38)[0].dx).toBeCloseTo(0);
        expect(lib.ringOffsets(4, 600, 400, 38)[0].dy).toBeLessThan(0);
        expect(Math.hypot(...Object.values(lib.ringOffsets(25, 1200, 700, 38)[0]).map((v, i) => v * [1200, 700][i]))).toBeGreaterThan(Math.hypot(...Object.values(lib.ringOffsets(3, 1200, 700, 38)[0]).map((v, i) => v * [1200, 700][i])));
    });

    it("moves a single raider relative to the marker, so the group still moves along, and puts him back with reset", () => {
        let b = group({ n: 1, split: true });
        const slot = b.slots[0].id;
        const mid = lib.memberId(slot, "t1");
        expect(lib.parseMemberId(mid)).toEqual({ slotId: slot, userId: "t1" });
        expect(lib.objectPoint(b, "member", mid)).toBeNull();
        b = lib.moveObject(b, "member", mid, 0.7, 0.4);
        expect(b.slots[0].offsets.t1).toMatchObject({ size: 38 });
        expect(b.slots[0].offsets.t1.dx).toBeCloseTo(0.2);
        expect(b.slots[0].offsets.t1.dy).toBeCloseTo(-0.1);
        expect(lib.objectPoint(b, "member", mid)).toEqual({ x: expect.closeTo(0.7), y: expect.closeTo(0.4) });
        // the marker moves: the raider keeps his place relative to it
        b = lib.moveObject(b, "slot", slot, 0.3, 0.3);
        expect(lib.objectPoint(b, "member", mid).x).toBeCloseTo(0.5);
        expect(lib.objectPoint(b, "member", mid).y).toBeCloseTo(0.2);
        b = lib.removeObject(b, "member", mid);
        expect(b.slots[0].offsets).toEqual({});
        expect(lib.moveObject(b, "member", "nope~x", 0.1, 0.1)).toBe(b);
    });

    it("scales a single raider on his own, defaulting to the marker's size, and honours the marker's lock", () => {
        let b = group({ n: 1, split: true, size: 50 });
        const mid = lib.memberId(b.slots[0].id, "h1");
        expect(lib.sizeOf(b, "member", mid)).toBe(50);
        b = lib.setObjectSize(b, "member", mid, 70);
        expect(lib.sizeOf(b, "member", mid)).toBe(70);
        expect(b.slots[0].size).toBe(50);
        expect(lib.sizeOf(lib.scaleObject(b, "member", mid, 2), "member", mid)).toBe(140);
        const locked = lib.patchLook(b, "slot", b.slots[0].id, { lock: true });
        expect(lib.isLocked(locked, "member", mid)).toBe(true);
        expect(lib.moveObject(locked, "member", mid, 0.9, 0.9)).toBe(locked);
        expect(lib.setObjectSize(locked, "member", mid, 30)).toBe(locked);
    });

    it("does not copy a group's individual places into a duplicate", () => {
        let b = group({ n: 1, split: true });
        b = lib.moveObject(b, "member", lib.memberId(b.slots[0].id, "t1"), 0.7, 0.4);
        const c = lib.duplicateObject(b, "slot", b.slots[0].id).board;
        expect(c.slots[1].offsets).toEqual({});
        expect(c.slots[1].split).toBe(true);
    });
});

describe("the new pages", () => {
    const work = read("pages/raid-detail/raidplan/BoardWorkspace.tsx");
    const board2 = read("components/raidplan/PlanBoard.tsx");
    const palette = read("pages/raid-detail/raidplan/Palette.tsx");
    const insp = read("pages/raid-detail/raidplan/Inspector.tsx");
    const css = read("styles/raidplan.css");
    const pub = read("pages/PlanPublicPage.tsx");

    it("scales objects by a grip, by + / -, by Alt + wheel and by the inspector; Shift keeps a zone's proportions", () => {
        expect(board2).toContain("rp-h-size");
        expect(work).toContain("e.key === \"+\" || e.key === \"=\"");
        expect(work).toContain("e.key === \"-\"");
        expect(work).toContain("e.altKey");
        expect(work).toContain("{ passive: false }");
        expect(work).toContain("keepRatio: e.shiftKey");
        expect(insp).toContain("SizeField");
        expect(insp).toContain("ObjectScaleField");
        expect(css).toMatch(/\.rp-h-size \{/);
        expect(css).toContain("var(--rp-s, 38px)");
    });

    it("offers the encounter's icons, an enemy and a boss position, and any icon by its name", () => {
        expect(palette).toContain("iconKeyForBoss(b.iconUrl)");
        expect(palette).toContain("iconKey: \"enemy\"");
        expect(palette).toContain("iconKey: \"bosspos\"");
        expect(palette).toContain("wowIconUrl(clean, 56)");
        expect(work).toContain("bosses={allBosses}");
        for (const kind of ["tank", "healer", "melee", "ranged", "dps", "group", "label"]) expect(palette).toContain("kind: \"" + kind + "\"");
    });

    it("draws icons, split groups and the new roles on the shared board and in the read view", () => {
        for (const needle of ["icons.filter", "splitMembers", "ringOffsets", "rp-member", "hideMembers", "rp-icon-face", "sizeHandle(", "objectScale"]) expect(board2).toContain(needle);
        expect(pub).toContain("icons={boss.icons}");
        expect(pub).toContain("objectScale={boss.objectScale}");
        expect(css).toMatch(/\.rp-role-melee \{/);
    });
});

describe("template overview", () => {
    const tpl = read("pages/RaidplanTemplatesPage.tsx");
    it("has search, filters, duplicate, confirmed delete and an empty state", () => {
        expect(tpl).toContain("function TemplateList");
        expect(tpl).toContain("duplicateRaidplanTemplate");
        expect(tpl).toMatch(/tone: "danger"/);
        expect(tpl).toContain("b.updatedAt - a.updatedAt");
        expect(tpl).toContain("rp-empty");
    });
    it("has de and en texts, with plural forms for the boss progress", () => {
        for (const lang of ["de", "en"]) {
            const d = JSON.parse(fs.readFileSync(path.join(__dirname, "../../src/web-client/src/i18n/locales", lang, "planTemplates.json"), "utf8"));
            for (const k of ["search", "duplicate", "delete", "noMatch", "emptyTitle", "updated", "deleteText"]) expect(typeof d[k]).toBe("string");
            expect(Object.keys(d.bossesFilled).sort()).toEqual(["one", "other"]);
        }
    });
});

describe("facing and board labels", () => {
    const withIcon = (extra = {}) => slotIns(board(), { type: "icon", iconKey: "boss:602", label: "" }, { x: 0.5, y: 0.5 });
    it("angle maths: 0 = up, clockwise, normalised", () => {
        expect(lib.normAngle(-90)).toBe(270);
        expect(lib.normAngle(360)).toBe(0);
        expect(lib.normAngle(725.6)).toBe(6);
        expect(lib.normAngle(NaN)).toBe(0);
        expect(lib.angleTo(0, 0, 0, -10)).toBe(0);
        expect(lib.angleTo(0, 0, 10, 0)).toBe(90);
        expect(lib.angleTo(0, 0, 0, 10)).toBe(180);
        expect(lib.angleTo(0, 0, -10, 0)).toBe(270);
        expect(lib.snapAngle(52, 15)).toBe(45);
        expect(lib.snapAngle(358, 15)).toBe(0);
        expect(lib.compassName(92)).toBe("E");
        expect(lib.compassName(350)).toBe("N");
        expect(lib.COMPASS).toHaveLength(8);
    });
    it("only boss, enemy and position icons face somewhere", () => {
        expect(lib.canFace("boss:602")).toBe(true);
        expect(lib.canFace("enemy")).toBe(true);
        expect(lib.canFace("wow:spell_fire_fireball")).toBe(false);
    });
    it("turns an icon, and the compass entries of the menu set the angle", () => {
        const r = withIcon();
        const id = r.sel.id;
        expect(r.board.icons[0]).toMatchObject({ rotation: 0, showLabel: false });
        expect(lib.turnIcon(r.board, id, -15).icons[0].rotation).toBe(345);
        const items = lib.contextMenuItems("icon", { locked: false, hasPlayer: false, isEvent: false, kind: "", faces: true }).map((m) => m.id);
        expect(items.filter((x) => x.startsWith("face:"))).toHaveLength(8);
        expect(lib.contextMenuItems("icon", { locked: false, hasPlayer: false, isEvent: false, kind: "" }).some((m) => m.id.startsWith("face:"))).toBe(false);
        expect(lib.applyMenuAction(r.board, "face:225", "icon", id, null).board.icons[0].rotation).toBe(225);
    });
    it("draws only labels that were typed (no fallback names on the board)", () => {
        const tank = slotIns(board(), { type: "slot", kind: "tank", label: "" }, null).board.slots[0];
        expect(lib.slotBoardLabel(tank)).toBe("");
        expect(lib.slotTitle(tank)).not.toBe("");
        expect(lib.zoneBoardLabel({ label: "  ", type: "danger" })).toBe("");
        expect(lib.zoneBoardLabel({ label: "Feuer", type: "danger" })).toBe("Feuer");
        expect(lib.iconBoardLabel({ label: "Boss", showLabel: false })).toBe("");
        expect(lib.iconBoardLabel({ label: "Boss", showLabel: true })).toBe("Boss");
        expect(lib.iconBoardLabel({ label: "", showLabel: true })).toBe("");
        expect(lib.textShown({ text: "" }, false)).toBe(false);
        expect(lib.textShown({ text: "" }, true)).toBe(true);
        expect(lib.textShown({ text: "Go" }, false)).toBe(true);
    });
    it("has the facing UI and its texts", () => {
        const insp = read("pages/raid-detail/raidplan/Inspector.tsx");
        expect(insp).toContain("rp-compass");
        const ws = read("pages/raid-detail/raidplan/BoardWorkspace.tsx");
        expect(ws).toContain("angleTo(");
        expect(ws).toContain("snapAngle(a, 15)");
        expect(read("components/raidplan/PlanBoard.tsx")).toContain("rp-h-rot");
        for (const lang of ["de", "en"]) {
            const d = JSON.parse(fs.readFileSync(path.join(__dirname, "../../src/web-client/src/i18n/locales", lang, "raidBoard.json"), "utf8"));
            for (const n of lib.COMPASS_NAMES) expect(typeof d.compass[n]).toBe("string");
            expect(d.ctx.face).toContain("{dir}");
            expect(typeof d.icon.showLabel).toBe("string");
        }
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
