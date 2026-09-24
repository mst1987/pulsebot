// When a group marker shows its tag, the number badges and the ring (lib/raidplan.ts groupTag / ringCover).
const { loadTs, makeT } = require("./i18nHelper");

const lib = loadTs("lib/raidplan.ts", { t: makeT("de") });
const group = (over = {}) => ({ id: "g1", kind: "group", n: 3, userId: "", x: 0.5, y: 0.5, label: "", ...over });

describe("groupTag", () => {
    it("the tag always has the number, also without a label, split or not, in every view", () => {
        for (const over of [{}, { split: true }, { split: true, hideMembers: true }, { label: "  " }]) {
            expect(lib.groupTag(group(over), 5, true).number).toBe("3");
            expect(lib.groupTag(group(over), 0, false).number).toBe("3");
        }
    });
    it("a typed label is added, blanks are not a label", () => {
        expect(lib.groupTag(group({ label: "Melee" }), 5, true).label).toBe("Melee");
        expect(lib.groupTag(group({ label: "   " }), 5, true).label).toBe("");
    });
    it("a split group puts badges on its tokens and a ring round them; hidden members or no split do not", () => {
        expect(lib.groupTag(group({ split: true }), 5, true)).toMatchObject({ badges: true, ring: true, placeholders: 0 });
        expect(lib.groupTag(group(), 5, true)).toMatchObject({ badges: false, ring: false });
        expect(lib.groupTag(group({ split: true, hideMembers: true }), 5, true)).toMatchObject({ badges: false, ring: false });
    });
    it("a template (no roster) shows placeholder tokens for a split group", () => {
        expect(lib.groupTag(group({ split: true }), 0, false)).toMatchObject({ placeholders: lib.GROUP_PLACEHOLDERS, ring: true, dim: false });
        expect(lib.groupTag(group(), 0, false).placeholders).toBe(0);
    });
    it("an event group nobody is in is dimmed and has no ring", () => {
        expect(lib.groupTag(group({ split: true }), 0, true)).toMatchObject({ dim: true, ring: false, placeholders: 0 });
        expect(lib.groupTag(group(), 2, true).dim).toBe(false);
    });
});

describe("ringCover", () => {
    it("covers the widest and highest offset plus the padding", () => {
        const c = lib.ringCover([{ dx: 0.1, dy: -0.2 }, { dx: -0.15, dy: 0.05 }], 0.02, 0.03);
        expect(c.rx).toBeCloseTo(0.17);
        expect(c.ry).toBeCloseTo(0.23);
        expect(lib.ringCover([], 0.02, 0.03)).toEqual({ rx: 0.02, ry: 0.03 });
    });
});
