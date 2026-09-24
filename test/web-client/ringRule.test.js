// The ring round a split group can be switched off: per group, per board, and for a selection of groups (lib/raidplan.ts, lib/multiSelect.ts).
const { loadTs, makeT } = require("./i18nHelper");

const raidplan = loadTs("lib/raidplan.ts", { t: makeT("de") });
const ms = loadTs("lib/multiSelect.ts", raidplan);

const look = { opacity: 1, lock: false, hidden: false };
const group = (id, n, extra = {}) => ({ id, kind: "group", n, userId: "", x: 0.5, y: 0.5, label: "", size: 38, offsets: {}, placed: true, split: true, ...look, ...extra });
const board = (slots) => ({ tokens: [], slots, marks: [], icons: [], zones: [], lines: [], texts: [], targets: [], assignments: [], notes: "", counts: null, roles: {}, mobs: [], hiddenCards: [], inheritOff: [], showRings: true });

describe("ringShown", () => {
    it("is drawn unless the board or the group switched it off; an old board without the fields draws it", () => {
        expect(raidplan.ringShown(true, {})).toBe(true);
        expect(raidplan.ringShown(undefined, {})).toBe(true);
        expect(raidplan.ringShown(true, { showRing: true })).toBe(true);
        expect(raidplan.ringShown(true, { showRing: false })).toBe(false);
        expect(raidplan.ringShown(false, { showRing: true })).toBe(false);
        expect(raidplan.ringShown(false, {})).toBe(false);
    });
    it("the group's own switch is one context menu entry either way, and works on the slot only", () => {
        const b = board([group("g1", 1), group("g2", 2)]);
        const off = raidplan.applyMenuAction(b, "ring:hide", "slot", "g1", null);
        expect(off.board.slots.map((s) => s.showRing)).toEqual([false, undefined]);
        expect(raidplan.applyMenuAction(off.board, "ring:show", "slot", "g1", null).board.slots[0].showRing).toBe(true);
        const items = (o) => raidplan.contextMenuItems("slot", { locked: false, hasPlayer: false, isEvent: true, kind: "group", split: true, ...o }).map((i) => i.id);
        expect(items({})).toContain("ring:hide");
        expect(items({ ringOff: true })).toContain("ring:show");
        expect(items({ split: false })).not.toContain("ring:hide");
    });
});

describe("a selection of several groups", () => {
    it("shows or hides all their rings together and leaves everything else alone", () => {
        const b = board([group("g1", 1), group("g2", 2, { showRing: false }), group("g3", 3), { ...group("s1", 1), kind: "tank" }]);
        const sel = [{ kind: "slot", id: "g1" }, { kind: "slot", id: "g2" }, { kind: "slot", id: "s1" }];
        const off = ms.setRingSelection(b, sel, false);
        expect(off.slots.map((s) => s.showRing)).toEqual([false, false, undefined, undefined]);
        const on = ms.setRingSelection(off, sel, true);
        expect(on.slots.map((s) => s.showRing)).toEqual([true, true, undefined, undefined]);
    });
});
