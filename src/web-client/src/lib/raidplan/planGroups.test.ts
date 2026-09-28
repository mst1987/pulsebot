// "Gruppen im Plan" (#529): the client twin of src/services/raidplan/raidplanGroups.js (the same cases against the server module), the
// editor's refill of a slot a raider outside the plan leaves (besetzung.ts refillVacated, the twin of raidplanGroups.refillSlots), the
// class priority that never takes a bench raider, and the "nicht im Plan" warning of a row that names one.
import { describe, expect, it } from "vitest";
import type { RaidplanAssignment, RaidplanBoard, RaidplanPlayer } from "../../api";
import * as pg from "./planGroups";
import { emptyBoard } from "./model";
import { ensureBesetzung } from "./besetzung";
import { expandClassRefs } from "./classRefs";
import { assigneeItems, isMissing, openAssignments } from "./assignLine";
import { requireBackend } from "../../test/backend";

const server = requireBackend("services/raidplan/raidplanGroups");

const P = (userId: string, group: number, classId: string, role: string, extra: Partial<RaidplanPlayer> = {}): RaidplanPlayer => ({ userId, character: userId, classId, className: classId, classColor: "", spec: "", specLabel: "", specRole: role, role, iconUrl: "", group, ...extra });

/** 25 raiders in groups 1..5 (a tank or rogue, a priest / shaman healer, three damage dealers) and 3 on the bench (a paladin healer). */
function lineup(): RaidplanPlayer[] {
    const out: RaidplanPlayer[] = [];
    for (let g = 1; g <= 5; g += 1) {
        out.push(g <= 3 ? P(`t${g}`, g, "Warrior", "tank") : P(`r${g}`, g, "Rogue", "melee"));
        out.push(P(`h${g}`, g, g % 2 ? "Priest" : "Shaman", "healer"));
        for (let i = 1; i <= 3; i += 1) out.push(P(`d${g}${i}`, g, "Mage", "ranged"));
    }
    out.push(P("bPal", 0, "Paladin", "healer", { bench: true }), P("bRog", 0, "Rogue", "melee", { bench: true }), P("bMag", 0, "Mage", "ranged", { bench: true }));
    return out;
}
const ids = (list: RaidplanPlayer[]) => list.map((p) => p.userId);
const row = (id: string, type: string, extra: Partial<RaidplanAssignment> = {}): RaidplanAssignment => ({ id, type, title: "", spell: null, assignees: [], targets: [], note: "", suggested: false, ...extra } as RaidplanAssignment);

describe("which raiders the plan picks from (twin of the server)", () => {
    const cases: [unknown, number][] = [[null, 5], [[1, 2, 3, 4], 5], [[1, 2, 3, 4, 5, "bench"], 5], [[], 5], [null, 2], [["bench", 3, "3", 9, "x"], 5]];
    it.each(cases)("included %j of %i groups: the same raiders as the server", (stored, count) => {
        const inc = pg.includedGroups(stored, count);
        expect(inc).toEqual(server.includedGroups(stored, count));
        expect(ids(pg.planRoster(lineup(), inc))).toEqual(ids(server.planRoster(lineup(), inc)));
        expect(ids(pg.outOfPlanRoster(lineup(), inc))).toEqual(ids(server.outOfPlanRoster(lineup(), inc)));
    });
    it("default: 25 of 28, with the bench 28, group 5 off 20", () => {
        expect(pg.planRoster(lineup(), pg.includedGroups(null, 5))).toHaveLength(25);
        expect(pg.planRoster(lineup(), [1, 2, 3, 4, 5, "bench"])).toHaveLength(28);
        const split = pg.splitRoster(lineup(), [1, 2, 3, 4]);
        expect(split.roster).toHaveLength(20);
        expect(split.outside.every((p) => p.outOfPlan)).toBe(true);
        expect(ids(split.outside)).toEqual(["r5", "h5", "d51", "d52", "d53", "bPal", "bRog", "bMag"]);
    });
    it("toggles a chip, knows the default and offers the chips with their counts", () => {
        expect(pg.toggleIncluded([1, 2, 3, 4, 5], 5)).toEqual([1, 2, 3, 4]);
        expect(pg.toggleIncluded([1, 2, 3, 4], 5)).toEqual([1, 2, 3, 4, 5]);
        expect(pg.toggleIncluded([1, 2, 3, 4, 5], "bench")).toEqual([1, 2, 3, 4, 5, "bench"]);
        expect(pg.isDefaultSelection([1, 2, 3, 4, 5], 5)).toBe(true);
        expect(pg.isDefaultSelection([1, 2, 3, 4, 5, "bench"], 5)).toBe(false);
        expect(pg.groupChoices(lineup(), 5)).toEqual([
            { key: 1, count: 5 }, { key: 2, count: 5 }, { key: 3, count: 5 }, { key: 4, count: 5 }, { key: 5, count: 5 }, { key: "bench", count: 3 },
        ]);
        // a setup with a 6th group offers it too; no bench, no bench chip
        expect(pg.groupChoices([P("x", 6, "Mage", "ranged")], 5).map((c) => c.key)).toEqual([1, 2, 3, 4, 5, 6]);
        expect(pg.groupNumbers([1, 3, "bench"])).toEqual([1, 3]);
    });
});

describe("the editor never resolves a bench raider", () => {
    it("1 x Paladin > Priest heals: the paladin sits on the bench - the first priest of the raid; with the bench on: the paladin", () => {
        const r = row("h", "heal", { count: 1, classPriority: ["Paladin", "Priest"] });
        expect(expandClassRefs([r], [], pg.planRoster(lineup(), [1, 2, 3, 4, 5]), {})[0].assignees).toEqual(["user:h1"]);
        expect(expandClassRefs([r], [], pg.planRoster(lineup(), [1, 2, 3, 4, 5, "bench"]), {})[0].assignees).toEqual(["user:bPal"]);
    });

    it("a bench raider in a role slot leaves it and ONLY that place is filled again (the server does the same for the read view)", () => {
        const planned = pg.planRoster(lineup(), [1, 2, 3, 4, 5]);
        const slot = (kind: string, n: number, userId: string) => ({ id: `bes-${kind}-${n}`, kind, n, label: "", x: 0.5, y: 0.5, userId, size: 36, hideMembers: false, split: false, offsets: {}, placed: false, opacity: 1, lock: false, hidden: false });
        const board = { ...emptyBoard(), counts: { tank: 0, healer: 3, dps: 0, melee: 0, ranged: 0 }, slots: [slot("healer", 1, "h1"), slot("healer", 2, "bPal"), slot("healer", 3, "")] } as unknown as RaidplanBoard;
        const besetzung = { size: 25, counts: { tank: 0, healer: 3, dps: 0, melee: 0, ranged: 0 }, groups: 0, split: false };
        const out = ensureBesetzung(board, besetzung, planned);
        expect(out.slots.filter((s) => s.kind === "healer").map((s) => s.userId)).toEqual(["h1", "h2", ""]);
        expect(server.refillSlots(board.slots, planned).map((s: { userId: string }) => s.userId)).toEqual(["h1", "h2", ""]);
        // with the bench in the plan nothing moves
        expect(ensureBesetzung(board, besetzung, pg.planRoster(lineup(), [1, 2, 3, 4, 5, "bench"])).slots.map((s) => s.userId)).toEqual(["h1", "bPal", ""]);
    });

    it("a bench raider named in a row keeps his place, the chip counts as missing and the plan's badge names him", () => {
        const split = pg.splitRoster(lineup(), [1, 2, 3, 4, 5]);
        const players = new Map([...split.roster, ...split.outside].map((p) => [p.userId, p]));
        const a = row("n", "other", { assignees: ["user:bRog", "user:r4"] });
        const items = assigneeItems(a, a, { slots: [], players }, [], false, true);
        expect(items.map((x) => [x.r && x.r.player ? x.r.player.userId : "", x.open])).toEqual([["bRog", true], ["r4", false]]);
        expect(isMissing(items[0].r!, false)).toBe(false);
        const board = { ...emptyBoard(), assignments: [a] } as unknown as RaidplanBoard;
        const open = openAssignments([{ key: "k", name: "Boss", board }], split.roster, split.outside);
        expect(open).toHaveLength(1);
        expect(open[0].missing[0]).toContain("bRog");
    });
});
