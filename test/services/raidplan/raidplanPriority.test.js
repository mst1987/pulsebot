// Rows with a count and a class priority (#525): "1 x Paladin > Shaman" takes the first free paladin healer, else a shaman, else the place
// stays open; rows of the same kind of task share nobody while somebody else is free (twice rather than open); a row without a class list
// resolves exactly as before (golden master). The client twin runs the same cases: src/web-client/src/lib/raidplan/classPriority.test.ts.
const assign = require("../../../src/services/raidplan/raidplanAssign");
const inherit = require("../../../src/services/raidplan/raidplanInherit");

const P = (userId, classId, role, specRole = "") => ({ userId, character: userId, classId, role, specRole, group: 1 });
const row = (id, type, assignees, extra = {}) => ({ id, type, title: "", spell: null, assignees, targets: [], note: "", suggested: false, ...extra });
const prio = (id, type, count, classPriority, extra = {}) => row(id, type, [], { count, classPriority, ...extra });
const who = (list, id) => list.find((a) => a.id === id).assignees;

const pal = P("pal", "Paladin", "healer", "healer");
const sham = P("sham", "Shaman", "healer", "healer");
const priest = P("priest", "Priest", "healer", "healer");
const druid = P("druid", "Druid", "healer", "healer");
const ele = P("ele", "Shaman", "ranged", "ranged");

describe("a row with a count and a class priority", () => {
    it("1 x Paladin > Shaman: the paladin when there is one, else the shaman, else the place stays open", () => {
        const r = prio("h", "heal", 1, ["Paladin", "Shaman"]);
        expect(who(assign.expandClassRefs([r], [], [sham, pal], {}), "h")).toEqual(["user:pal"]);
        expect(who(assign.expandClassRefs([r], [], [sham, priest], {}), "h")).toEqual(["user:sham"]);
        expect(who(assign.expandClassRefs([r], [], [priest], {}), "h")).toEqual(["class:Paladin:1"]);
    });
    it("takes the task's role: an elemental shaman does not heal", () => {
        expect(who(assign.expandClassRefs([prio("h", "heal", 1, ["Shaman"])], [], [ele], {}), "h")).toEqual(["class:Shaman:1"]);
        // a kick row names no role: every shaman fits
        expect(who(assign.expandClassRefs([prio("k", "kick", 1, ["Shaman"])], [], [ele], {}), "k")).toEqual(["user:ele"]);
    });
    it("2 x Priest > Druid with one priest: the priest and the druid", () => {
        const out = assign.expandClassRefs([prio("h", "heal", 2, ["Priest", "Druid"])], [], [druid, priest], {});
        expect(who(out, "h")).toEqual(["user:priest", "user:druid"]);
    });
    it("fixed assignees count: a named raider fills one of the places", () => {
        const out = assign.expandClassRefs([prio("h", "heal", 2, ["Paladin", "Shaman"], { assignees: ["user:priest"] })], [], [pal, sham, priest], {});
        expect(who(out, "h")).toEqual(["user:priest", "user:pal"]);
        // as many fixed ones as the count: nothing is added
        const full = assign.expandClassRefs([prio("h", "heal", 1, ["Paladin"], { assignees: ["user:priest"] })], [], [pal, priest], {});
        expect(who(full, "h")).toEqual(["user:priest"]);
    });
    it("two heal rows and three healers: three different healers", () => {
        const rows = [prio("a", "heal", 1, ["Paladin", "Shaman", "Priest"]), prio("b", "heal", 2, ["Paladin", "Shaman", "Priest"])];
        const out = assign.expandClassRefs(rows, [], [pal, sham, priest], {});
        expect(who(out, "a")).toEqual(["user:pal"]);
        expect(who(out, "b")).toEqual(["user:sham", "user:priest"]);
    });
    it("two heal rows and one healer: the same one in both (twice rather than open), never twice in one row", () => {
        const rows = [prio("a", "heal", 1, ["Paladin", "Shaman"]), prio("b", "heal", 2, ["Shaman", "Paladin"])];
        const out = assign.expandClassRefs(rows, [], [sham], {});
        expect(who(out, "a")).toEqual(["user:sham"]);
        expect(who(out, "b")).toEqual(["user:sham", "class:Shaman:2"]);
    });
    it("a healer named by hand in another heal row is skipped while another one is free", () => {
        const out = assign.expandClassRefs([row("x", "heal", ["user:pal"]), prio("h", "heal", 1, ["Paladin", "Shaman"])], [], [pal, sham], {});
        expect(who(out, "h")).toEqual(["user:sham"]);
        // a filled slot counts the same
        const slots = [{ kind: "healer", n: 1, userId: "pal" }];
        expect(who(assign.expandClassRefs([row("x", "heal", ["slot:healer:1"]), prio("h", "heal", 1, ["Paladin", "Shaman"])], slots, [pal, sham], {}), "h")).toEqual(["user:sham"]);
    });
    it("exclusive per kind of task only: a healer can dispel as well", () => {
        const out = assign.expandClassRefs([prio("h", "heal", 1, ["Priest"]), prio("d", "dispel", 1, ["Priest"])], [], [priest], {});
        expect(who(out, "h")).toEqual(["user:priest"]);
        expect(who(out, "d")).toEqual(["user:priest"]);
    });
    it("an inherited Standard row and a boss's own heal row share the exclusivity", () => {
        const bosses = {
            defaults: { assignments: [prio("std", "heal", 1, ["Paladin", "Shaman"], { targets: [{ kind: "slot", ref: "tank:1" }] })] },
            boss1: { assignments: [prio("own", "heal", 1, ["Paladin", "Shaman"])], inheritOff: [] },
        };
        const section = inherit.sectionOf({ key: "boss1", name: "Boss", iconUrl: "" }, [], []);
        const rows = inherit.effectiveRows(bosses, "boss1", section);
        expect(rows.map((a) => a.id)).toEqual(["std", "own"]);
        const out = assign.expandClassRefs(rows, [], [pal, sham], {});
        expect(who(out, "std")).toEqual(["user:pal"]);
        expect(who(out, "own")).toEqual(["user:sham"]);
    });
    it("the older class references of the type are served first; the priority row takes who is left", () => {
        const out = assign.expandClassRefs([prio("p", "heal", 1, ["Paladin", "Shaman"]), row("r", "heal", ["class:Paladin:1"])], [], [pal, sham], {});
        expect(who(out, "r")).toEqual(["user:pal"]);
        expect(who(out, "p")).toEqual(["user:sham"]);
    });
    it("within a class the ranking decides (the row's role, fewer tasks first)", () => {
        const enh = P("enh", "Shaman", "melee", "melee");
        const out = assign.expandClassRefs([prio("k", "kick", 1, ["Shaman"], { preferredRole: "ranged" })], [], [enh, ele], {});
        expect(who(out, "k")).toEqual(["user:ele"]);
    });
    it("resolving twice changes nothing (the open places are counted)", () => {
        const rows = [prio("a", "heal", 2, ["Paladin", "Shaman"]), prio("b", "heal", 1, ["Priest"])];
        const once = assign.expandClassRefs(rows, [], [pal, sham], {});
        expect(assign.expandClassRefs(once, [], [pal, sham], {})).toEqual(once);
        expect(who(once, "b")).toEqual(["class:Priest:1"]);
    });
    it("a template (no roster): every place stays open", () => {
        expect(who(assign.expandClassRefs([prio("h", "heal", 2, ["Paladin", "Shaman"])], [], [], {}), "h")).toEqual(["class:Paladin:1", "class:Paladin:2"]);
    });
    it("a tanking row with a priority is served in the tank pass, before the utility rows", () => {
        const wt = P("wt", "Warrior", "tank", "tank");
        const pt = P("pt", "Paladin", "tank", "tank");
        const out = assign.expandClassRefs([prio("t", "tank", 1, ["Paladin", "Warrior"])], [], [wt, pt], {});
        expect(who(out, "t")).toEqual(["user:pt"]);
    });
});

describe("cleanAssignments of count and class priority", () => {
    it("keeps known classes once in their order and a count 1..40", () => {
        const { assignments } = assign.cleanAssignments([{ id: "a", type: "heal", assignees: [], targets: [], classPriority: ["Shaman", "Nope", "Paladin", "Shaman"], count: 3 }]);
        expect(assignments[0].classPriority).toEqual(["Shaman", "Paladin"]);
        expect(assignments[0].count).toBe(3);
    });
    it("a count out of range or not a whole number becomes 1", () => {
        for (const count of [0, 41, -2, 1.5, "x", null, undefined]) {
            const { assignments } = assign.cleanAssignments([{ id: "a", type: "heal", classPriority: ["Priest"], count }]);
            expect(assignments[0].count).toBe(1);
        }
        const { assignments } = assign.cleanAssignments([{ id: "a", type: "heal", classPriority: ["Priest"], count: 40 }]);
        expect(assignments[0].count).toBe(40);
    });
    it("without a class list neither is stored (an older row stays as it was)", () => {
        const { assignments } = assign.cleanAssignments([{ id: "a", type: "heal", assignees: ["class:Paladin:1"], count: 2, classPriority: ["Any", "x"] }]);
        expect(assignments[0]).not.toHaveProperty("count");
        expect(assignments[0]).not.toHaveProperty("classPriority");
        expect(assignments[0].assignees).toEqual(["class:Paladin:1"]);
    });
});

describe("golden master: rows without a count resolve exactly as before #525", () => {
    const roster = [
        P("wt", "Warrior", "tank", "tank"), P("pt", "Paladin", "tank", "tank"), P("dt", "Druid", "tank", "tank"),
        P("ph", "Paladin", "healer", "healer"), P("sh1", "Shaman", "healer", "healer"), P("sh2", "Shaman", "healer", "healer"),
        P("pr", "Priest", "healer", "healer"), P("dh", "Druid", "healer", "healer"), P("ele", "Shaman", "ranged", "ranged"),
        P("sp", "Priest", "ranged", "ranged"), P("hu1", "Hunter", "ranged"), P("hu2", "Hunter", "ranged"), P("ro", "Rogue", "melee", "melee"),
        P("ma1", "Mage", "ranged"), P("ma2", "Mage", "ranged"), P("wl", "Warlock", "ranged"), P("wa", "Warrior", "melee", "melee"),
    ];
    const slots = [{ kind: "tank", n: 1, userId: "wt" }, { kind: "healer", n: 1, userId: "ph" }];
    const board = [
        row("t1", "tank", ["class:Warrior:1:tank"], { targets: [{ kind: "mob", ref: "b:boss" }] }),
        row("t2", "tank", ["class:Any:1:tank"]),
        row("t3", "tank", ["class:Paladin:1:tank"]),
        row("h1", "heal", ["class:Paladin:1"], { targets: [{ kind: "slot", ref: "tank:1" }] }),
        row("h2", "heal", ["class:Shaman:1"], { targets: [{ kind: "slot", ref: "tank:2" }] }),
        row("h3", "heal", ["class:Shaman:2"], { targets: [{ kind: "group", ref: "1" }, { kind: "group", ref: "2" }] }),
        row("h4", "heal", ["class:Any:4:healer"], { targets: [{ kind: "group", ref: "3" }] }),
        row("h5", "heal", ["class:Priest:1", "slot:healer:1"], { targets: [{ kind: "group", ref: "4" }] }),
        row("h6", "heal", ["class:Paladin:1", "class:Shaman:1"]),
        row("k1", "kick", ["class:Rogue:1", "class:Mage:1", "class:Shaman:1"], { preferredRole: "ranged" }),
        row("m1", "md", ["class:Hunter:1"], { targets: [{ kind: "slot", ref: "tank:1" }] }),
        row("m2", "md", ["class:Hunter:2"]),
        row("m3", "md", ["class:Hunter:3"]),
        row("d1", "dispel", ["class:Priest:1"], { picks: { "class:Priest:1": "sp" } }),
        row("d2", "dispel", ["class:Druid:1"]),
        row("s1", "ss", ["class:Warlock:1"], { targets: [{ kind: "class", ref: "Priest:1" }] }),
        row("c1", "cc", ["class:Mage:1", "class:Mage:2", "class:Mage:3"], { allowMulti: true }),
        row("u1", "other", ["user:ro", "role:melee"]),
    ];
    // captured from the resolution before #525 (origin/main 439bd432)
    const GOLDEN = [["t1", ["user:wt"], ["mob|b:boss"]], ["t2", ["user:dt"], []], ["t3", ["user:pt"], []], ["h1", ["class:Paladin:1"], ["slot|tank:1"]], ["h2", ["user:sh1"], ["slot|tank:2"]], ["h3", ["user:sh2"], ["group|1", "group|2"]], ["h4", ["class:Any:4:healer"], ["group|3"]], ["h5", ["user:pr", "slot:healer:1"], ["group|4"]], ["h6", ["class:Paladin:1", "class:Shaman:1"], []], ["k1", ["user:ro", "user:ma1", "user:ele"], []], ["m1", ["user:hu1"], ["slot|tank:1"]], ["m2", ["user:hu2"], []], ["m3", ["class:Hunter:3"], []], ["d1", ["user:sp"], []], ["d2", ["user:dh"], []], ["s1", ["user:wl"], ["player|pr"]], ["c1", ["user:ma2", "user:ma1", "user:ma2"], []], ["u1", ["user:ro", "role:melee"], []]];
    const flat = (out) => out.map((a) => [a.id, a.assignees, a.targets.map((t) => `${t.kind}|${t.ref}`)]);

    it("the board resolves as it did", () => {
        expect(flat(assign.expandClassRefs(board, slots, roster, { dh: "dps" }))).toEqual(GOLDEN);
    });
    it("a count without a class list changes nothing", () => {
        expect(flat(assign.expandClassRefs(board.map((a) => ({ ...a, count: 1 })), slots, roster, { dh: "dps" }))).toEqual(GOLDEN);
    });
    it("a priority row at the end leaves the older rows as they were", () => {
        const out = assign.expandClassRefs([...board, prio("p", "heal", 1, ["Druid"])], slots, roster, { dh: "dps" });
        expect(flat(out).slice(0, board.length)).toEqual(GOLDEN);
    });
});
