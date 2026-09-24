// What dropping a chip of the Besetzung does (lib/raidplan.ts dropChip): the same reducer the workspace calls.
const { loadTs, makeT } = require("./i18nHelper");

const lib = loadTs("lib/raidplan.ts", { t: makeT("de") });

const slot = (id, kind, n, over = {}) => ({ id, kind, n, userId: "", x: 0.5, y: 0.5, label: "", placed: false, ...over });
const board = (slots) => ({ tokens: [], slots, marks: [], icons: [], zones: [], lines: [], texts: [], targets: [], assignments: [], notes: "", counts: null, roles: {}, mobs: [], hiddenCards: [] });

describe("dropChip", () => {
    const b = board([slot("bes-tank-1", "tank", 1), slot("bes-tank-2", "tank", 2, { placed: true, x: 0.2, y: 0.3 }), slot("bes-group-1", "group", 1)]);
    it("a drop on the map puts an unplaced slot exactly there and marks it placed", () => {
        const r = lib.dropChip(b, "bes-tank-1", "map", { x: 0.4, y: 0.6 });
        expect(r.slots.find((s) => s.id === "bes-tank-1")).toMatchObject({ placed: true, x: 0.4, y: 0.6 });
        expect(r.slots).toHaveLength(3);
    });
    it("a group chip drops the same way", () => {
        expect(lib.dropChip(b, "bes-group-1", "map", { x: 0.1, y: 0.9 }).slots.find((s) => s.id === "bes-group-1")).toMatchObject({ placed: true, x: 0.1, y: 0.9 });
    });
    it("a placed slot dropped on the map moves; on the bar it leaves the map and stays in the Besetzung", () => {
        expect(lib.dropChip(b, "bes-tank-2", "map", { x: 0.7, y: 0.7 }).slots.find((s) => s.id === "bes-tank-2")).toMatchObject({ placed: true, x: 0.7, y: 0.7 });
        const off = lib.dropChip(b, "bes-tank-2", "bar", null);
        expect(off.slots.find((s) => s.id === "bes-tank-2").placed).toBe(false);
        expect(off.slots).toHaveLength(3);
    });
    it("clamps to the map, and an unplaced slot dropped on the bar or outside changes nothing", () => {
        expect(lib.dropChip(b, "bes-tank-1", "map", { x: 1.4, y: -0.2 }).slots.find((s) => s.id === "bes-tank-1")).toMatchObject({ x: 1, y: 0 });
        expect(lib.dropChip(b, "bes-tank-1", "bar", null)).toBe(b);
        expect(lib.dropChip(b, "bes-tank-1", "none", null)).toBe(b);
        expect(lib.dropChip(b, "bes-tank-2", "none", { x: 0.5, y: 0.5 })).toBe(b);
    });
    it("never adds a slot or changes a count, and ignores an unknown or non-role slot", () => {
        const withLabel = board([slot("s1", "label", 1, { label: "x", placed: true })]);
        expect(lib.dropChip(withLabel, "s1", "bar", null)).toBe(withLabel);
        expect(lib.dropChip(b, "nope", "map", { x: 0.5, y: 0.5 })).toBe(b);
        let r = b;
        for (let i = 0; i < 4; i++) r = lib.dropChip(r, "bes-tank-1", "map", { x: 0.1 * i, y: 0.5 });
        expect(r.slots).toHaveLength(3);
        expect(r.counts).toBe(null);
    });
});
