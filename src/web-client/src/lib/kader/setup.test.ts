import { describe, expect, it } from "vitest";
import type { KaderVariant } from "../../api";
import { kader, kaderView, U } from "../../pages/kader/kader.fixture";
import {
    defaultSpec, groupHints, moveToSlot, placedIds, removeFromGroups, setSlotSpec, setupText, slotRoles, specsFor, unplaced, visibleGroups,
} from "./setup";

const view = kaderView();

function variant(over: Partial<KaderVariant> = {}): KaderVariant {
    return { ...kader().setups[0], ...over };
}

describe("lib/kader/setup", () => {
    it("shows two groups in a 10er and four in a 20er, and counts only those", () => {
        const v = variant();
        expect(visibleGroups(v)).toBe(4);
        const small = variant({ size: 10, groups: v.groups.map((g, i) => (i === 3 ? [{ userId: U.sham, spec: "Shaman-Enhancement" }, null, null, null, null] : g)) });
        expect(visibleGroups(small)).toBe(2);
        expect([...placedIds(small)]).toEqual([U.tank]);
    });

    it("lists who has no group yet: roster first, then Vorläufig, bench and tentative, by the chosen states", () => {
        const k = kader();
        expect(unplaced(view, k, variant(), ["roster", "provisional"])).toEqual([U.heal]);
        expect(unplaced(view, k, variant(), ["roster", "provisional", "bench", "tentative"])).toEqual([U.heal, U.sham, U.tent]);
    });

    it("offers the decision and the wishes as specs, the decision first in the roster", () => {
        const k = kader();
        expect(specsFor(k.players[U.heal])).toEqual(["Shaman-Restoration", "Shaman-Enhancement"]);
        expect(defaultSpec(k.players[U.tank])).toBe("Warrior-Protection");
        expect(defaultSpec(k.players[U.heal])).toBe("Shaman-Restoration");
    });

    it("places, swaps, takes out and changes the spec of a slot", () => {
        const v = variant();
        const placed = moveToSlot(v.groups, U.heal, "Shaman-Restoration", 0, 1);
        expect(placed[0][1]).toEqual({ userId: U.heal, spec: "Shaman-Restoration" });
        // the tank moves onto the healer's slot, the healer takes the tank's old one
        const swapped = moveToSlot(placed, U.tank, "Warrior-Protection", 0, 1);
        expect(swapped[0][0]).toEqual({ userId: U.heal, spec: "Shaman-Restoration" });
        expect(swapped[0][1]).toEqual({ userId: U.tank, spec: "Warrior-Protection" });
        expect(removeFromGroups(swapped, U.tank)[0][1]).toBeNull();
        expect(setSlotSpec(placed, 0, 1, "Shaman-Enhancement")[0][1]).toEqual({ userId: U.heal, spec: "Shaman-Enhancement" });
        expect(moveToSlot(v.groups, U.heal, "x", 9, 0)).toBe(v.groups);
    });

    it("counts roles by the slot's spec and names the group's buffs", () => {
        const groups = moveToSlot(variant().groups, U.heal, "Shaman-Restoration", 0, 1);
        expect(slotRoles(view.classes, variant({ groups }))).toEqual({ tank: 1, healer: 1, melee: 0, ranged: 0 });
        expect(groupHints(groups[0], view.buffs.party)).toEqual([{ key: "windfury", label: "Totem des Windzorns", ok: true, important: true }]);
        // two who want Windfury and nobody bringing it: missing
        const wanting = [{ userId: U.tank, spec: "Warrior-Protection" }, { userId: U.done, spec: "Warrior-Fury" }, null, null, null];
        expect(groupHints(wanting, view.buffs.party)).toEqual([{ key: "windfury", label: "Totem des Windzorns", ok: false, important: true }]);
    });

    it("writes the variant as text for Discord", () => {
        const text = setupText({ view, kader: kader(), variant: variant({ size: 10 }), sources: ["roster", "provisional"] });
        expect(text).toContain("**Forever-Kader · Variante A · 10er**");
        expect(text).toContain("1. Aldric (Krieger · Schutz)");
        expect(text).toContain("Mira (Schamane · Wiederherstellung)");
        expect(text).not.toContain("Gruppe 3");
    });
});
