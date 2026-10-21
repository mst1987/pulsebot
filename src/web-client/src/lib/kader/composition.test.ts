import { describe, expect, it } from "vitest";
import { entry, kader, kaderView, player, U } from "../../pages/kader/kader.fixture";
import { buffCoverage, buffSources, composition, compositionSpec, nearestSize, planDecisions, planDiff, planWithPending } from "./composition";

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

    describe("Planspiel", () => {
        const plan = (over = {}) => ({ specs: {}, excluded: [], by: "lead", at: "2026-10-21T10:00:00.000Z", rev: 4, ...over });
        const ENH = { className: "Shaman", spec: "Shaman-Enhancement" };

        it("counts a planned spec instead of the shown one and keeps the old one as was", () => {
            const c = composition(view, kader(), false, plan({ specs: { [U.heal]: ENH } }));
            const row = c.rows.find((r) => r.userId === U.heal);
            expect(row).toMatchObject({ pick: ENH, role: "melee", was: { className: "Shaman", spec: "Shaman-Restoration" } });
            expect(c.roles).toEqual({ tank: 1, healer: 0, melee: 1, ranged: 0 });
            // a planned spec equal to the shown one changes nothing
            const same = composition(view, kader(), false, plan({ specs: { [U.tank]: { className: "Warrior", spec: "Warrior-Protection" } } }));
            expect(same.rows.find((r) => r.userId === U.tank)?.was).toBeUndefined();
        });

        it("shows a left-out player but counts it nowhere, even with the switch", () => {
            const c = composition(view, kader(), true, plan({ excluded: [U.tank, U.sham] }));
            expect(c.total).toBe(2);
            expect(c.roles).toEqual({ tank: 0, healer: 1, melee: 0, ranged: 1 });
            expect(c.rows.find((r) => r.userId === U.tank)).toMatchObject({ excluded: true, counted: false });
            expect(c.classes.find((g) => g.classKey === "Warrior")).toMatchObject({ counted: 0, shown: 1 });
        });

        it("says what the draft changes: roles, left-out players, buffs now, gone and double", () => {
            const k = kader();
            const before = composition(view, k, false);
            const after = composition(view, k, false, plan({ specs: { [U.heal]: ENH, [U.tank]: { className: "Warrior", spec: "Warrior-Fury" } }, excluded: [U.sham] }));
            const diff = planDiff(before, after, buffCoverage(view, before.rows), buffCoverage(view, after.rows));
            expect(diff.roles).toEqual([{ role: "tank", delta: -1 }, { role: "healer", delta: -1 }, { role: "melee", delta: 2 }]);
            // the bench player was not counted, so leaving him out changes no count
            expect(diff.excluded).toBe(0);
            expect(diff.changes).toBe(3);
            expect(diff.buffs).toEqual([expect.objectContaining({ key: "motw", change: "gone" })]);

            const on = composition(view, k, true);
            const twice = composition(view, k, true, plan({ specs: { [U.tank]: { className: "Mage", spec: "Mage-Frost" } } }));
            const d2 = planDiff(on, twice, buffCoverage(view, on.rows), buffCoverage(view, twice.rows));
            expect(d2.buffs).toEqual([]);
            const noMotw = composition(view, k, false, plan({ specs: { [U.heal]: ENH } }));
            const back = planDiff(noMotw, before, buffCoverage(view, noMotw.rows), buffCoverage(view, before.rows));
            expect(back.buffs).toEqual([expect.objectContaining({ key: "motw", change: "now" })]);
            const one = composition(view, k, false, plan({ specs: { [U.tank]: { className: "Mage", spec: "Mage-Frost" } } }));
            const dbl = planDiff(before, one, buffCoverage(view, before.rows), buffCoverage(view, one.rows));
            expect(dbl.buffs).toEqual([expect.objectContaining({ key: "motw", change: "double" })]);
            expect(dbl.excluded).toBe(0);
            const out = composition(view, k, false, plan({ excluded: [U.tank] }));
            expect(planDiff(before, out, buffCoverage(view, before.rows), buffCoverage(view, out.rows)).excluded).toBe(1);
        });

        it("lays own pending edits over the stored draft and starts one when there is none", () => {
            expect(planWithPending(null, {}, "me", "now")).toBeNull();
            const started = planWithPending(undefined, { [U.heal]: { spec: ENH } }, "me", "2026-10-21T11:00:00.000Z");
            expect(started).toEqual({ specs: { [U.heal]: ENH }, excluded: [], by: "me", at: "2026-10-21T11:00:00.000Z" });
            const stored = plan({ specs: { [U.heal]: ENH }, excluded: [U.tank] });
            const merged = planWithPending(stored, { [U.heal]: { spec: null }, [U.tank]: { excluded: false }, [U.sham]: { excluded: true } }, "me", "x");
            expect(merged).toMatchObject({ specs: {}, excluded: [U.sham], by: "lead", rev: 4 });
            expect(planWithPending(stored, { [U.heal]: { spec: null }, [U.tank]: { excluded: false } }, "me", "x")).toBeNull();
        });

        it("counts the decisions taking it over sets, like the server", () => {
            expect(planDecisions(null, kader())).toBe(0);
            const p = plan({
                specs: { [U.heal]: ENH, [U.tank]: { className: "Warrior", spec: "Warrior-Protection" }, [U.sham]: { className: "Shaman", spec: "Shaman-Restoration" }, gone: ENH },
                excluded: [U.sham],
            });
            // heal: new decision; tank: same as the decision; sham: left out; gone: no longer in the Kader
            expect(planDecisions(p, kader())).toBe(1);
        });
    });
});
