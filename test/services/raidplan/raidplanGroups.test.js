// "Gruppen im Plan" (#529): the raid plan picks its raiders only from the setup groups up to the raid's size (25 = 1..5), never from the
// bench unless the orga switches it on; the pool ("Angemeldet") never comes in. The client twin runs the same cases:
// src/web-client/src/lib/raidplan/planGroups.test.ts.
const groups = require("../../../src/services/raidplan/raidplanGroups");
const assign = require("../../../src/services/raidplan/raidplanAssign");
const raidplan = require("../../../src/web/raidplan/raidplan");

const CLASSES = ["Warrior", "Hunter", "Warlock", "Mage", "Rogue"];
const P = (userId, group, classId, role, extra = {}) => ({ userId, character: userId, classId, role, specRole: role, group, ...extra });

/** 25 raiders in groups 1..5 (group g: a warrior tank-ish, a healer, three damage dealers), 3 on the bench (a paladin healer among them). */
function lineup() {
    const out = [];
    for (let g = 1; g <= 5; g += 1) {
        out.push(P(`t${g}`, g, "Warrior", g <= 3 ? "tank" : "melee"));
        out.push(P(`h${g}`, g, g % 2 ? "Priest" : "Shaman", "healer"));
        for (let i = 1; i <= 3; i += 1) out.push(P(`d${g}${i}`, g, CLASSES[(g + i) % CLASSES.length], "ranged"));
    }
    out.push(P("bPal", 0, "Paladin", "healer", { bench: true }));
    out.push(P("bRog", 0, "Rogue", "melee", { bench: true }));
    out.push(P("bMag", 0, "Mage", "ranged", { bench: true }));
    return out;
}

describe("which raiders the plan picks from", () => {
    it("default: the groups up to the raid's size, no bench - 25 of 28", () => {
        const inc = groups.includedGroups(null, 5);
        expect(inc).toEqual([1, 2, 3, 4, 5]);
        expect(groups.planRoster(lineup(), inc)).toHaveLength(25);
        expect(groups.planRoster(lineup(), inc).some((p) => p.bench)).toBe(false);
    });
    it("with \"bench\": all 28", () => {
        expect(groups.planRoster(lineup(), [1, 2, 3, 4, 5, "bench"])).toHaveLength(28);
    });
    it("a group switched off: its raiders drop out (and are the ones outside, marked)", () => {
        const inc = [1, 2, 3, 4];
        const inPlan = groups.planRoster(lineup(), inc);
        expect(inPlan).toHaveLength(20);
        expect(inPlan.some((p) => p.group === 5)).toBe(false);
        const out = groups.outOfPlanRoster(lineup(), inc);
        expect(out.map((p) => p.userId)).toEqual(["t5", "h5", "d51", "d52", "d53", "bPal", "bRog", "bMag"]);
        expect(out.every((p) => p.outOfPlan)).toBe(true);
    });
    it("a 10er takes groups 1 and 2; a raider Raid-Helper no longer lists and one without a group stay", () => {
        expect(groups.includedGroups(null, 2)).toEqual([1, 2]);
        expect(groups.inPlan(P("x", 0, "Mage", "ranged", { gone: true }), [])).toBe(true);
        expect(groups.inPlan(P("y", 0, "Mage", "ranged"), [1])).toBe(true);
        expect(groups.inPlan(null, [1])).toBe(false);
    });
    it("cleans a stored or sent value: numbers 1..8 once, ascending, \"bench\" last; anything else dropped; not a list = default", () => {
        expect(groups.cleanIncludedGroups([5, "3", 3, 9, 0, -1, "x", "bench", 1.5, null, 2])).toEqual([2, 3, 5, "bench"]);
        expect(groups.cleanIncludedGroups("1,2")).toBeNull();
        expect(groups.cleanIncludedGroups(undefined)).toBeNull();
        expect(groups.cleanIncludedGroups([])).toEqual([]);
        expect(groups.includedGroups([], 5)).toEqual([]);
        expect(groups.defaultIncludedGroups(0)).toEqual([1]);
        expect(groups.defaultIncludedGroups(12)).toHaveLength(8);
        expect(groups.groupNumbers([1, 3, "bench"])).toEqual([1, 3]);
    });
});

describe("the class references and priorities never take a bench raider", () => {
    const row = (id, type, extra = {}) => ({ id, type, title: "", spell: null, assignees: [], targets: [], note: "", suggested: false, ...extra });
    it("1 x Paladin > Priest heals: the only paladin sits on the bench - a priest of the raid", () => {
        const r = row("h", "heal", { count: 1, classPriority: ["Paladin", "Priest"] });
        const planned = groups.planRoster(lineup(), groups.includedGroups(null, 5));
        const out = assign.expandClassRefs([r], [], planned, {});
        expect(out[0].assignees).toEqual(["user:h1"]);
        // with the bench switched on the paladin is first again
        const all = assign.expandClassRefs([r], [], groups.planRoster(lineup(), [1, 2, 3, 4, 5, "bench"]), {});
        expect(all[0].assignees).toEqual(["user:bPal"]);
    });
    it("a class reference of the bench's class stays open", () => {
        const planned = groups.planRoster(lineup(), [1, 2, 3, 4, 5]);
        const out = assign.expandClassRefs([row("k", "other", { assignees: ["class:Paladin:1"] })], [], planned, {});
        expect(out[0].assignees).toEqual(["class:Paladin:1"]);
    });
});

describe("refillSlots: the read view's slots without the raiders outside the plan", () => {
    const slots = [
        { kind: "healer", n: 1, userId: "h1" },
        { kind: "healer", n: 2, userId: "bPal" },
        { kind: "healer", n: 3, userId: "" },
        { kind: "group", n: 1, userId: "" },
    ];
    it("a bench raider leaves his slot, only that place is filled again from the plan", () => {
        const planned = groups.planRoster(lineup(), [1, 2, 3, 4, 5]);
        const out = groups.refillSlots(slots, planned);
        expect(out.map((s) => s.userId)).toEqual(["h1", "h2", "", ""]);
    });
    it("nobody outside: the same list; a free token or a flex role counts", () => {
        const planned = groups.planRoster(lineup(), [1, 2, 3, 4, 5, "bench"]);
        expect(groups.refillSlots(slots, planned)).toBe(slots);
        const noBench = groups.planRoster(lineup(), [1, 2, 3, 4, 5]);
        // h2 stands as a free token: the next healer; d11 plays healer on this boss (flex) and comes before h3
        expect(groups.refillSlots(slots, noBench, {}, ["h2"]).map((s) => s.userId)[1]).toBe("h3");
        expect(groups.refillSlots(slots, noBench, { d11: "healer" }, ["h2"]).map((s) => s.userId)[1]).toBe("d11");
        expect(groups.refillSlots(undefined, noBench)).toEqual([]);
    });
});

describe("raidplan.rosterFrom marks the bench, never the pool", () => {
    it("bench raiders carry bench: true, a gone one does not; the pool is not read at all", () => {
        const r = raidplan.rosterFrom({
            groups: [{ index: 1, slots: [{ userId: "a", character: "A", spec: "Priest-Holy", role: "healer" }] }],
            bench: [{ userId: "b", character: "B", spec: "Mage-Fire" }, { userId: "g", character: "G", spec: "Mage-Fire", gone: true }],
            pool: [{ userId: "p", character: "P", spec: "Mage-Fire" }],
        }, "tbc");
        expect(r.map((p) => [p.userId, !!p.bench])).toEqual([["a", false], ["b", true], ["g", false]]);
    });
});
