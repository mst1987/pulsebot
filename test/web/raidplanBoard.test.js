// The shared board (src/web/raidplanBoard.js): slots, marks, zones, cleaning, the
// slot auto-fill and copying a board with fresh ids.
const board = require("../../src/web/raidplanBoard");

const clean = (raw, opts = {}) => board.cleanBoard(raw, { allowedUserIds: ["u1", "u2", "u3"], ...opts });
const p = (userId, role, group = 1) => ({ userId, role, group });

describe("slots", () => {
    it("keeps the five kinds, clamps the position and limits n and the label", () => {
        const r = clean({ slots: [
            { id: "a", kind: "tank", n: 2, x: -1, y: 5 },
            { kind: "healer", n: 0 },
            { kind: "dps", n: 500 },
            { kind: "group", n: 3, label: "G".repeat(90) },
            { kind: "label", label: " Boss-Tank " },
        ] });
        expect(r.board.slots.map((s) => [s.kind, s.n])).toEqual([["tank", 2], ["healer", 1], ["dps", 99], ["group", 3], ["label", 1]]);
        expect(r.board.slots[0]).toMatchObject({ id: "a", x: 0, y: 1, userId: "" });
        expect(r.board.slots[3].label).toHaveLength(board.LIMITS.label);
        expect(r.board.slots[4].label).toBe("Boss-Tank");
    });

    it("drops an unknown kind and a label slot without a label", () => {
        const r = clean({ slots: [{ kind: "boss" }, { kind: "label", label: "  " }, { kind: "tank" }] });
        expect(r.board.slots).toHaveLength(1);
        expect(r.dropped).toBe(2);
    });

    it("lets a known player stand in one slot only, never in a group marker, never a stranger", () => {
        const r = clean({ slots: [
            { kind: "tank", userId: "u1" }, { kind: "healer", userId: "u1" }, { kind: "dps", userId: "stranger" }, { kind: "group", n: 1, userId: "u2" },
        ] });
        expect(r.board.slots.map((s) => s.userId)).toEqual(["u1", "", "", ""]);
    });

    it("gives clashing ids a new one", () => {
        const r = clean({ slots: [{ id: "x", kind: "tank" }, { id: "x", kind: "tank" }] });
        expect(new Set(r.board.slots.map((s) => s.id)).size).toBe(2);
    });

    it("refuses more than 60", () => {
        expect(clean({ slots: Array.from({ length: 61 }, () => ({ kind: "dps" })) }).code).toBe("invalid");
    });
});

describe("marks", () => {
    it("knows the eight raid marks and nothing else", () => {
        const r = clean({ marks: [...board.MARKS, "poop"].map((m) => ({ mark: m, x: 2, y: -2 })) });
        expect(r.board.marks.map((m) => m.mark)).toEqual(["skull", "cross", "square", "moon", "triangle", "diamond", "circle", "star"]);
        expect(r.board.marks[0]).toMatchObject({ x: 1, y: 0 });
        expect(r.dropped).toBe(1);
    });

    it("refuses more than 40", () => {
        expect(clean({ marks: Array.from({ length: 41 }, () => ({ mark: "star" })) }).code).toBe("invalid");
    });
});

describe("zones", () => {
    it("starts a zone with the colour of its type and a moderate opacity", () => {
        const r = clean({ zones: [{ type: "danger", x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, { type: "healthy" }, { type: "weird", shape: "star" }] });
        expect(r.board.zones.map((z) => [z.type, z.color, z.shape, z.opacity])).toEqual([
            ["danger", "#ef4444", "rect", 0.3], ["healthy", "#22c55e", "rect", 0.3], ["neutral", "#60a5fa", "rect", 0.3],
        ]);
    });

    it("keeps a valid colour, cuts the opacity into 0.1..0.6 and rejects junk colours", () => {
        const r = clean({ zones: [{ type: "custom", color: "#ABCDEF", opacity: 0.9 }, { type: "custom", color: "red", opacity: 0 }, { type: "custom", color: "#12345", opacity: "x" }] });
        expect(r.board.zones.map((z) => [z.color, z.opacity])).toEqual([["#abcdef", 0.6], ["#a78bfa", 0.1], ["#a78bfa", 0.3]]);
    });

    it("keeps a zone inside the board with a minimum size", () => {
        const r = clean({ zones: [{ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, { x: 0, y: 0, w: 0, h: -1 }, { x: 0, y: 0, w: 9, h: 9 }] });
        expect(r.board.zones[0]).toMatchObject({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
        expect(r.board.zones[1]).toMatchObject({ w: board.MIN_ZONE, h: board.MIN_ZONE });
        expect(r.board.zones[2]).toMatchObject({ w: 1, h: 1, x: 0, y: 0 });
    });

    it("cuts the label and refuses more than 30", () => {
        expect(clean({ zones: [{ label: "z".repeat(99) }] }).board.zones[0].label).toHaveLength(board.LIMITS.label);
        expect(clean({ zones: Array.from({ length: 31 }, () => ({})) }).code).toBe("invalid");
    });
});

describe("the rest of a board", () => {
    it("has every field even for nothing and reports no content", () => {
        const r = clean(undefined);
        expect(r.board).toEqual({ tokens: [], slots: [], marks: [], zones: [], targets: [], notes: "", profileId: "" });
        expect(board.boardHasContent(r.board)).toBe(false);
        expect(board.boardHasContent(clean({ zones: [{}] }).board)).toBe(true);
        expect(board.boardHasContent(clean({ notes: "x" }).board)).toBe(true);
    });

    it("takes no free tokens when they are switched off (a template)", () => {
        const r = clean({ tokens: [{ userId: "u1", x: 0.5, y: 0.5 }] }, { allowTokens: false });
        expect(r.board.tokens).toEqual([]);
    });
});

describe("fillSlots", () => {
    const slots = [
        { id: "1", kind: "tank", n: 2, userId: "" }, { id: "2", kind: "tank", n: 1, userId: "" },
        { id: "3", kind: "healer", n: 1, userId: "" }, { id: "4", kind: "dps", n: 1, userId: "" },
        { id: "5", kind: "dps", n: 2, userId: "" }, { id: "6", kind: "group", n: 1, userId: "" }, { id: "7", kind: "label", n: 1, label: "MT", userId: "" },
    ];
    const roster = [p("t1", "tank"), p("h1", "healer"), p("t2", "tank"), p("d1", "melee"), p("d2", "ranged"), p("d3", "dps")];

    it("gives tank 1..n the tanks, healers the healers and dps the rest, in setup order", () => {
        const out = board.fillSlots(slots, roster);
        const by = Object.fromEntries(out.map((s) => [s.id, s.userId]));
        expect(by).toEqual({ 1: "t2", 2: "t1", 3: "h1", 4: "d1", 5: "d2", 6: "", 7: "" });
    });

    it("leaves a slot open when nobody fits and never uses a player twice", () => {
        const out = board.fillSlots([{ id: "a", kind: "tank", n: 1, userId: "" }, { id: "b", kind: "tank", n: 2, userId: "" }], [p("t1", "tank")]);
        expect(out.map((s) => s.userId)).toEqual(["t1", ""]);
    });

    it("keeps a player who is already placed and does not put them into a second slot", () => {
        const out = board.fillSlots([{ id: "a", kind: "tank", n: 1, userId: "" }, { id: "b", kind: "tank", n: 2, userId: "t1" }], [p("t1", "tank"), p("t2", "tank")]);
        expect(out.map((s) => s.userId)).toEqual(["t2", "t1"]);
    });

    it("does not change its input", () => {
        const before = JSON.stringify(slots);
        board.fillSlots(slots, roster);
        expect(JSON.stringify(slots)).toBe(before);
    });
});

describe("reidBoard", () => {
    it("gives every object a new id, empties tokens and row assignments", () => {
        const b = { tokens: [{ userId: "u1", x: 0, y: 0 }], slots: [{ id: "s", kind: "tank", n: 1 }], marks: [{ id: "m", mark: "star", x: 0, y: 0 }], zones: [{ id: "z" }], targets: [{ id: "t", title: "MT", userIds: ["u1"] }], notes: "n" };
        const r = board.reidBoard(b);
        expect(r.tokens).toEqual([]);
        expect(r.slots[0].id).not.toBe("s");
        expect(r.marks[0].id).not.toBe("m");
        expect(r.zones[0].id).not.toBe("z");
        expect(r.targets[0]).toMatchObject({ title: "MT", userIds: [] });
        expect(r.targets[0].id).not.toBe("t");
        expect(r.notes).toBe("n");
    });
});
