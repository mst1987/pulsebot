// A group's badge (#528): shown / hidden and its size per group, the right-click entry and a multi-selection.
import { describe, expect, it } from "vitest";
import type { RaidplanBoard, RaidplanSlot } from "../../api";
import * as raidplan from "./index";
import * as ms from "./multiSelect";

const g = (id: string, n: number, extra: Partial<RaidplanSlot> = {}): RaidplanSlot => ({
    id, kind: "group", n, label: "", x: 0.5, y: 0.5, userId: "", size: 38, hideMembers: false, split: true, offsets: {}, placed: true,
    opacity: 1, lock: false, hidden: false, ...extra,
});
const board = (slots: RaidplanSlot[]): RaidplanBoard => ({ ...raidplan.emptyBoard(), slots });

describe("badgeShown", () => {
    it("the board's switch and the group's own, both default to shown", () => {
        expect(raidplan.badgeShown(true, {})).toBe(true);
        expect(raidplan.badgeShown(undefined, null)).toBe(true);
        expect(raidplan.badgeShown(true, { showBadge: false })).toBe(false);
        expect(raidplan.badgeShown(false, { showBadge: true })).toBe(false);
    });
});

describe("groupBadgeLook", () => {
    it("takes the split marker of that number, else any placed one; no marker = shown at 100 %", () => {
        const slots = [g("a", 1, { split: false, showBadge: false }), g("b", 1, { badgeScale: 1.4 }), g("c", 2, { split: false, badgeScale: 0.5 })];
        expect(raidplan.groupBadgeLook(slots, 1)).toEqual({ show: true, scale: 1.4 });
        expect(raidplan.groupBadgeLook(slots, 2)).toEqual({ show: true, scale: 0.5 });
        expect(raidplan.groupBadgeLook(slots, 3)).toEqual({ show: true, scale: 1 });
        expect(raidplan.groupBadgeLook([g("x", 4, { placed: false, showBadge: false })], 4).show).toBe(true);
        expect(raidplan.groupBadgeLook([g("x", 4, { showBadge: false })], 4).show).toBe(false);
    });
});

describe("the right-click menu", () => {
    const items = (opts: Record<string, boolean>) => raidplan.contextMenuItems("slot", { locked: false, hasPlayer: false, isEvent: false, kind: "group", split: false, ...opts }).map((i) => i.id);
    it("offers hide / show for every group (split or not), never for another slot", () => {
        expect(items({})).toContain("badge:hide");
        expect(items({ badgeOff: true })).toContain("badge:show");
        expect(raidplan.contextMenuItems("slot", { locked: false, hasPlayer: false, isEvent: false, kind: "tank" }).map((i) => i.id)).not.toContain("badge:hide");
    });
    it("switches the group's badge", () => {
        const off = raidplan.applyMenuAction(board([g("g1", 1)]), "badge:hide", "slot", "g1", null);
        expect(off.board.slots[0].showBadge).toBe(false);
        expect(off.sel).toEqual({ kind: "slot", id: "g1" });
        expect(raidplan.applyMenuAction(off.board, "badge:show", "slot", "g1", null).board.slots[0].showBadge).toBe(true);
    });
});

describe("a multi-selection", () => {
    it("sets the badge of every selected group, clamps the size and leaves the rest alone", () => {
        const b = board([g("g1", 1), g("g2", 2), g("g3", 3), { ...g("t1", 1), kind: "tank" }]);
        const sel = [{ kind: "slot" as const, id: "g1" }, { kind: "slot" as const, id: "g2" }, { kind: "slot" as const, id: "t1" }];
        const off = ms.setBadgeSelection(b, sel, { showBadge: false });
        expect(off.slots.map((s) => s.showBadge)).toEqual([false, false, undefined, undefined]);
        const big = ms.setBadgeSelection(off, sel, { badgeScale: 9 });
        expect(big.slots.map((s) => s.badgeScale)).toEqual([1.5, 1.5, undefined, undefined]);
        expect(big.slots[0].showBadge).toBe(false);
    });
});
