// The raid plan of a Raid-Helper event in the client (docs/raidplan.md, "Raid-Helper-Events"): the slim menu with the switch, the
// activation dialog's start values, the head line of the plan and how a Raid-Helper name reads - the libs run for real, the pages
// checked on their source.
import { describe, expect, it } from "vitest";
import * as manage from "../eventManage";
import * as plan from ".";

describe("the menu of a Raid-Helper event", () => {
    it("holds only the switch: activate, or active with a way back", () => {
        const on = manage.raidhelperMenu({ planEnabled: false, disabled: false });
        expect(on).toHaveLength(1);
        expect(on[0]).toMatchObject({ id: "raidplanOn", label: "Raidplan aktivieren", danger: false });
        const off = manage.raidhelperMenu({ planEnabled: true, disabled: false });
        expect(off[0]).toMatchObject({ id: "raidplanOff", label: "Raidplan aktiv ✓ – deaktivieren" });
    });

    it("Raid-Helper switched off: the entry stays, its line says the plan works from the saved line-up", () => {
        for (const planEnabled of [false, true]) {
            expect(manage.raidhelperMenu({ planEnabled, disabled: true })[0].sub).toBe("Raid-Helper ist abgeschaltet – Aufstellung nur aus gespeichertem Stand");
        }
    });
});

describe("the activation dialog", () => {
    const instances = [{ id: "kara", sizes: [10] }, { id: "gruul", sizes: [25] }, { id: "bt", sizes: [25] }];

    it("starts from what the plan has, else from what the title says", () => {
        expect(manage.linkStart(null, { instanceIds: ["bt"], size: 25 })).toEqual({ instanceIds: ["bt"], size: 25 });
        expect(manage.linkStart({ instanceIds: ["kara"], size: 10 }, { instanceIds: ["bt"], size: 25 })).toEqual({ instanceIds: ["kara"], size: 10 });
        expect(manage.linkStart({ instanceIds: [], size: 0 }, { instanceIds: [], size: 0 })).toEqual({ instanceIds: [], size: 0 });
    });

    it("offers the sizes of the chosen instances", () => {
        expect(manage.linkSizes(instances, ["kara", "gruul"])).toEqual([10, 25]);
        expect(manage.linkSizes(instances, ["bt"])).toEqual([25]);
        expect(manage.linkSizes(instances, [])).toEqual([]);
    });
});

describe("the head of the plan", () => {
    const src = (over) => ({ kind: "raidhelper", origin: "cache", fetchedAt: 1, available: true, authoritative: true, stale: false, lineupSource: "raidplan", hasGroups: true, unknown: [], unmatchedNames: 0, goneCount: 0, disabled: false, error: "", ...over });

    it("fresh from the Aufstellung: one line, no warnings", () => {
        expect(plan.rhSourceText(src({}))).toEqual({ main: "Aufstellung aus Raid-Helper", warns: [], notes: [] });
        expect(plan.rhSourceText(src({ lineupSource: "signups" })).main).toBe("Aufstellung aus den Raid-Helper-Anmeldungen");
    });

    it("stale: why, and that saving loses nobody; no groups; nothing at all", () => {
        expect(plan.rhSourceText(src({ stale: true, origin: "last" })).warns[0]).toMatch(/^Raid-Helper antwortet gerade nicht.*Beim Speichern geht kein Spieler verloren\.$/);
        expect(plan.rhSourceText(src({ stale: true, origin: "saved", disabled: true })).warns[0]).toMatch(/^Raid-Helper ist abgeschaltet/);
        expect(plan.rhSourceText(src({ stale: true, origin: "snapshot" })).warns[0]).toMatch(/gespeicherte Stand des Raids/);
        expect(plan.rhSourceText(src({ hasGroups: false })).warns).toEqual(["Gruppen sind 5er-Blöcke in Reihenfolge – Gruppen-Einteilungen unzuverlässig."]);
        expect(plan.rhSourceText(src({ available: false, stale: true, origin: "none" })).warns).toEqual(["Setup gerade nicht verfügbar – Raid-Helper antwortet nicht und es gibt keinen gespeicherten Stand."]);
    });

    it("notes: names not matched, unknown specs (once each), raiders no longer listed", () => {
        expect(plan.rhSourceText(src({ unmatchedNames: 3, unknown: ["Frost", "Frost"], goneCount: 1 })).notes).toEqual([
            "3 Namen aus Raid-Helper nicht zuordenbar", "2× unbekannt: Frost", "1 nicht mehr im Setup",
        ]);
    });
});

describe("how a Raid-Helper name reads", () => {
    const p = (over) => ({ userId: "1", character: "Frostmain", classId: "Mage", className: "Magier", classColor: "", spec: "Mage-Frost", specLabel: "Frost", role: "ranged", iconUrl: "", group: 1, ...over });

    it("the tooltip adds Raid-Helper's name, the marker for an unmatched one and 'nicht mehr im Setup'", () => {
        expect(plan.rhNote(p({}))).toBe("");
        expect(plan.rhNote(p({ rhName: "Frostmain" }))).toBe("");
        expect(plan.rhNote(p({ rhName: "Nicki" }))).toBe("Raid-Helper: Nicki");
        expect(plan.rhNote(p({ character: "Nicki", rhName: "Nicki", nameFromRh: true }))).toBe("Name aus Raid-Helper");
        expect(plan.rhNote(p({ gone: true, rhName: "Nicki" }))).toBe("nicht mehr im Setup · Raid-Helper: Nicki");
    });
});
