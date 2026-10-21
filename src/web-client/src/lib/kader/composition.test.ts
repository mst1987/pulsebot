import { describe, expect, it } from "vitest";
import { entry, kader, kaderView, player, U } from "../../pages/kader/kader.fixture";
import { buffCoverage, buffSources, composition, compositionSpec, nearestSize } from "./composition";

const MOTW = { key: "motw", label: "Mal der Wildnis", labelEn: "Mark of the Wild", icon: "", providers: ["Shaman-Restoration", "Mage-Frost", "Mage-Fire"] };
const view = kaderView({ buffs: { raid: [MOTW], party: kaderView().buffs.party } });

describe("lib/kader/composition", () => {
    it("takes the decision, else the first wish, else the prefilled character", () => {
        const decided = entry({ state: "provisional", wishes: [{ className: "Warrior", spec: "Warrior-Fury" }], decision: { className: "Warrior", spec: "Warrior-Protection" } });
        expect(compositionSpec(undefined, decided)).toEqual({ className: "Warrior", spec: "Warrior-Protection" });
        const wished = entry({ state: "provisional", wishes: [{ className: "Mage", spec: "Mage-Fire" }] });
        expect(compositionSpec(undefined, wished)).toEqual({ className: "Mage", spec: "Mage-Fire" });
        const p = player({ userId: "x", prefill: { name: "X", className: "Mage", spec: "Mage-Frost", source: "profile", versionId: "" } });
        expect(compositionSpec(p, entry({ state: "roster" }))).toEqual({ className: "Mage", spec: "Mage-Frost" });
        expect(compositionSpec(player({ userId: "y" }), entry({ state: "roster" }))).toBeNull();
    });

    it("counts Vorläufig and Roster, shows bench and tentative uncounted until the switch is on", () => {
        const off = composition(view, kader(), false);
        expect(off.rows.map((r) => r.userId).sort()).toEqual([U.heal, U.tank, U.sham, U.tent].sort());
        expect(off.total).toBe(2);
        expect(off.extra).toBe(2);
        expect(off.roles).toEqual({ tank: 1, healer: 1, melee: 0, ranged: 0 });
        expect(off.rows.find((r) => r.userId === U.sham)?.counted).toBe(false);

        const on = composition(view, kader(), true);
        expect(on.total).toBe(4);
        expect(on.roles).toEqual({ tank: 1, healer: 1, melee: 1, ranged: 1 });
    });

    it("groups by class in the rule set's order, players without a class last, and keeps them out of the roles", () => {
        const k = kader();
        k.players.nobody = entry({ state: "roster", name: "Niemand" });
        k.players.classOnly = entry({ state: "provisional", wishes: [{ className: "Mage", spec: "" }] });
        const c = composition(view, k, false);
        expect(c.classes.map((g) => g.classKey)).toEqual(["Warrior", "Shaman", "Mage", ""]);
        expect(c.classes.find((g) => g.classKey === "Shaman")).toMatchObject({ counted: 1, shown: 2 });
        expect(c.total).toBe(4);
        expect(c.noSpec).toBe(2);
        expect(c.roles).toEqual({ tank: 1, healer: 1, melee: 0, ranged: 0 });
    });

    it("names the counted donors of each raid and party buff, none when nobody counted brings it", () => {
        const off = buffCoverage(view, composition(view, kader(), false).rows);
        expect(off.raid).toEqual([expect.objectContaining({ key: "motw", donors: [U.heal] })]);
        expect(off.party[0].donors).toEqual([U.heal]);
        const on = buffCoverage(view, composition(view, kader(), true).rows);
        expect(on.raid[0].donors.sort()).toEqual([U.heal, U.tent].sort());
        expect(on.party[0].donors.sort()).toEqual([U.heal, U.sham].sort());
        const none = buffCoverage(kaderView(), composition(view, kader({ players: {} }), false).rows);
        expect(none.party[0].donors).toEqual([]);
    });

    it("names whole classes when all their specs bring a buff, single specs else", () => {
        expect(buffSources(view.classes, MOTW.providers)).toEqual([
            { classKey: "Shaman", specs: ["Shaman-Restoration"] },
            { classKey: "Mage", specs: null },
        ]);
        expect(buffSources(view.classes, ["Unknown-Spec"])).toEqual([]);
    });

    it("picks the setup size closest to the count, the smaller on a tie", () => {
        expect(nearestSize([10, 20, 40], 25)).toBe(20);
        expect(nearestSize([40, 10, 20], 15)).toBe(10);
        expect(nearestSize([10, 25], 30)).toBe(25);
        expect(nearestSize([], 5)).toBeNull();
    });
});
