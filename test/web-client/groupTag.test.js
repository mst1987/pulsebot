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

describe("which ring tokens a split group shows", () => {
    const p = (userId, g) => ({ userId, character: userId, group: g, role: "dps" });
    const roster = [p("a", 3), p("b", 3), p("c", 3), p("d", 4)];
    const board = (slots, tokens = []) => ({ slots, tokens });
    const slot = (id, userId, placed) => ({ id, kind: "dps", n: 1, userId, x: 0.2, y: 0.2, label: "", ...(placed === undefined ? {} : { placed }) });
    const ids = (b, g = group({ split: true })) => lib.splitMembers(b, g, roster).map((x) => x.userId);

    it("everybody of the group is shown when their slots are only in the Besetzung bar", () => {
        expect(ids(board([slot("s1", "a", false), slot("s2", "b", false)]))).toEqual(["a", "b", "c"]);
    });
    it("a person whose slot is on the map is not drawn twice, one whose slot is unplaced still is", () => {
        expect(ids(board([slot("s1", "a", true), slot("s2", "b", false), slot("s3", "c")]))).toEqual(["b"]);
    });
    it("a free token also counts as the person being on the map", () => {
        expect(ids(board([], [{ userId: "c" }]))).toEqual(["a", "b"]);
    });
    it("hidden members draw nothing; the not-placed list only skips people shown on the map", () => {
        expect(ids(board([]), group({ split: true, hideMembers: true }))).toEqual([]);
        const b = board([slot("s1", "a", false), slot("s2", "d", true)]);
        expect(lib.unplaced(roster, b).map((x) => x.userId)).toEqual(["a", "b", "c"]);
        const split = { ...b, slots: [...b.slots, group({ split: true })] };
        expect(lib.unplaced(roster, split).map((x) => x.userId)).toEqual([]);
    });
});

describe("members with a place of their own leave the group view", () => {
    const p = (userId, g) => ({ userId, character: userId, group: g, role: "dps" });
    const roster = [p("a", 3), p("b", 3), p("c", 3), p("d", 4)];
    const list = (b) => lib.groupListMembers(b, group(), roster).map((x) => x.userId);
    const ring = (b) => lib.splitMembers(b, group({ split: true }), roster).map((x) => x.userId);

    it("the name list of a non-split group drops a free token and a role slot on the map", () => {
        expect(list({ slots: [], tokens: [] })).toEqual(["a", "b", "c"]);
        expect(list({ slots: [], tokens: [{ userId: "a" }] })).toEqual(["b", "c"]);
        expect(list({ slots: [{ id: "s", kind: "dps", userId: "b", placed: true }], tokens: [] })).toEqual(["a", "c"]);
        expect(list({ slots: [{ id: "s", kind: "dps", userId: "b", placed: false }], tokens: [] })).toEqual(["a", "b", "c"]);
    });
    it("the list is empty for split or hidden groups", () => {
        expect(lib.groupListMembers({ slots: [], tokens: [] }, group({ split: true }), roster)).toEqual([]);
        expect(lib.groupListMembers({ slots: [], tokens: [] }, group({ hideMembers: true }), roster)).toEqual([]);
    });
    it("taking a member out makes a free token where he stands, and removing it puts him back", () => {
        const b = { slots: [group({ split: true, offsets: {} })], tokens: [], icons: [], zones: [], lines: [], marks: [], texts: [] };
        const out = lib.takeOutOfGroup(b, "g1~b", { x: 0.4, y: 0.4 });
        expect(out.tokens.map((x) => x.userId)).toEqual(["b"]);
        expect(ring(out)).toEqual(["a", "c"]);
        const back = lib.removeToken(out, "b");
        expect(ring(back)).toEqual(["a", "b", "c"]);
    });
    it("a single player keeps the group number badge only while a split group of his exists", () => {
        const withGroup = { slots: [group({ split: true })], tokens: [] };
        expect(lib.ownBadgeGroup(withGroup, p("a", 3))).toBe(3);
        expect(lib.ownBadgeGroup(withGroup, p("d", 4))).toBe(0);
        expect(lib.ownBadgeGroup({ slots: [group()], tokens: [] }, p("a", 3))).toBe(0);
    });
});
