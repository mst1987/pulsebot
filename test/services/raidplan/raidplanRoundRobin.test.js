// Round robin of class references (src/services/raidplan/raidplanAssign.js): "Hunter 1, Hunter 2 ..." over the rows of one kind of task, a count per
// class in a row, the general tank ("any tank", "Tank (Warrior)") by the SPEC role, no fallback, "allow several", the renumbering of
// old data, and the suggestions going through the same resolution.
const assign = require("../../../src/services/raidplan/raidplanAssign");

const P = (userId, classId, role) => ({ userId, classId, role });
const row = (id, type, assignees, targets = [], extra = {}) => ({ id, type, title: "", assignees, targets, note: "", ...extra });
const expand = (list, roster, roles = {}, slots = []) => assign.expandClassRefs(list, slots, roster, roles);
const who = (list) => list.map((a) => a.assignees);

const hunters2 = [P("h1", "Hunter", "ranged"), P("h2", "Hunter", "ranged"), P("m1", "Mage", "ranged"), P("r1", "Rogue", "melee")];
const tanks = [
    P("war", "Warrior", "tank"), P("pal", "Paladin", "tank"), P("ret", "Paladin", "melee"), P("bear", "Druid", "tank"),
    P("fury", "Warrior", "melee"), P("holy", "Paladin", "healer"),
];

describe("misdirect round robin", () => {
    it("2 hunters, 3 misdirect rows (Hunter 1, 2, 3): two are filled, the third stays open - no mage, no rogue", () => {
        const out = expand([row("a", "md", ["class:Hunter:1"]), row("b", "md", ["class:Hunter:2"]), row("c", "md", ["class:Hunter:3"])], hunters2);
        expect(who(out)).toEqual([["user:h1"], ["user:h2"], ["class:Hunter:3"]]);
    });
    it("the same number in every row still goes round (old data): the next free hunter", () => {
        const out = expand([row("a", "md", ["class:Hunter:1"]), row("b", "md", ["class:Hunter:1"]), row("c", "md", ["class:Hunter:1"])], hunters2);
        expect(who(out)).toEqual([["user:h1"], ["user:h2"], ["class:Hunter:1"]]);
    });
    it("a count of 2 in a row is two references: both hunters, the next row finds none", () => {
        const out = expand([row("a", "md", ["class:Hunter:1", "class:Hunter:2"]), row("b", "md", ["class:Hunter:3"])], hunters2);
        expect(who(out)).toEqual([["user:h1", "user:h2"], ["class:Hunter:3"]]);
    });
    it("a hunter named by hand in another row of the task is skipped; another kind of task may take him again", () => {
        const out = expand([row("a", "md", ["user:h1"]), row("b", "md", ["class:Hunter:1"]), row("c", "cc", ["class:Hunter:1"])], hunters2);
        expect(who(out)).toEqual([["user:h1"], ["user:h2"], ["user:h1"]]);
    });
    it("'allow several' on the row repeats a raider instead of leaving the place open", () => {
        const out = expand([row("a", "md", ["class:Hunter:1", "class:Hunter:2", "class:Hunter:3"], [], { allowMulti: true })], hunters2);
        expect(who(out)).toEqual([["user:h1", "user:h2", "user:h1"]]);
    });
});

describe("general tank", () => {
    it("Tank (Paladin) is the PROTECTION paladin, never the retribution one; nobody fitting stays open", () => {
        expect(who(expand([row("a", "tank", ["class:Paladin:1:tank"]), row("b", "tank", ["class:Paladin:2:tank"])], tanks))).toEqual([["user:pal"], ["class:Paladin:2:tank"]]);
        // a tank row implies the role: the plain class reference also only takes a tank spec
        expect(who(expand([row("a", "tank", ["class:Paladin:1"])], tanks.filter((p) => p.userId !== "pal")))).toEqual([["class:Paladin:1"]]);
    });
    it("Tank (Druid) = the bear, Tank (Warrior) = the protection warrior (not the fury one)", () => {
        expect(who(expand([row("a", "tank", ["class:Druid:1:tank"]), row("b", "tank", ["class:Warrior:1:tank"])], tanks))).toEqual([["user:bear"], ["user:war"]]);
    });
    it("any tank goes round the tanks of the setup in order, one per row, never a DPS or healer spec", () => {
        const out = expand([row("a", "tank", ["class:Any:1:tank"]), row("b", "tank", ["class:Any:2:tank"]), row("c", "tank", ["class:Any:3:tank"]), row("d", "tank", ["class:Any:4:tank"])], tanks);
        expect(who(out)).toEqual([["user:war"], ["user:pal"], ["user:bear"], ["class:Any:4:tank"]]);
    });
    it("a named class is served before 'any tank', so the one warrior tank goes to the Tank (Warrior) row", () => {
        const out = expand([row("a", "tank", ["class:Any:1:tank"]), row("b", "tank", ["class:Warrior:1:tank"])], tanks);
        expect(who(out)).toEqual([["user:pal"], ["user:war"]]);
    });
    it("a flex role on this boss counts: the ret paladin tanking here is a tank", () => {
        expect(who(expand([row("a", "tank", ["class:Paladin:1:tank"]), row("b", "tank", ["class:Paladin:2:tank"])], tanks, { ret: "tank" }))).toEqual([["user:pal"], ["user:ret"]]);
    });
    it("'Any' without a role means nobody and is not stored", () => {
        expect(who(expand([row("a", "md", ["class:Any:1"])], tanks))).toEqual([["class:Any:1"]]);
        const c = assign.cleanAssignments([row("a", "tank", ["class:Any:1", "class:Any:1:tank", "class:Any:2:boss"])]);
        expect(c.assignments[0].assignees).toEqual(["class:Any:1:tank"]);
        expect(c.dropped).toBe(2);
    });
    it("the resolved tank of a tank row is a plain user reference (what the facing of a boss icon reads)", () => {
        const out = expand([row("a", "tank", ["class:Any:1:tank"], [{ kind: "mob", ref: "b:bt/supremus" }])], tanks);
        expect(out[0]).toMatchObject({ assignees: ["user:war"], targets: [{ kind: "mob", ref: "b:bt/supremus" }] });
    });
});

describe("a class of any spec, chosen on purpose (a mage tank)", () => {
    const raid = [...tanks, P("mage", "Mage", "ranged"), P("lock", "Warlock", "ranged")];
    it("'any' takes any spec of the class on a tanking row; without it the tank role applies and nobody fills it", () => {
        expect(who(expand([row("a", "tank", ["class:Mage:1:any"])], raid))).toEqual([["user:mage"]]);
        expect(who(expand([row("a", "tank", ["class:Mage:1"])], raid))).toEqual([["class:Mage:1"]]);
        // the fury warrior as a tank on purpose: the prot warrior already tanks, "any spec" takes the next warrior
        expect(who(expand([row("a", "tank", ["class:Warrior:1:tank"]), row("b", "tank", ["class:Warrior:1:any"])], raid))).toEqual([["user:war"], ["user:fury"]]);
    });
    it("no mage in the raid: the place stays open, no other class stands in", () => {
        expect(who(expand([row("a", "tank", ["class:Mage:1:any"])], tanks))).toEqual([["class:Mage:1:any"]]);
    });
    it("a healing row keeps its role unless 'any' is chosen", () => {
        const noHoly = raid.filter((p) => p.userId !== "holy");
        expect(who(expand([row("a", "heal", ["class:Paladin:1"])], noHoly))).toEqual([["class:Paladin:1"]]);
        expect(who(expand([row("a", "heal", ["class:Paladin:1:any"])], noHoly))).toEqual([["user:pal"]]);
    });
    it("'any' is kept on save for a class; 'Any' (a role) still needs a real role", () => {
        const c = assign.cleanAssignments([row("a", "tank", ["class:Mage:1:any", "class:Any:1:any"], [{ kind: "class", ref: "Priest:1:any" }])]);
        expect(c.assignments[0].assignees).toEqual(["class:Mage:1:any"]);
        expect(c.assignments[0].targets).toEqual([{ kind: "class", ref: "Priest:1:any" }]);
    });
});

describe("renumbering (migration of stored references, nothing lost)", () => {
    it("repeated numbers over the rows of a task become 1, 2, 3; other tasks count on their own", () => {
        const out = assign._internal.renumberClassRefs([row("a", "md", ["class:Hunter:1"]), row("b", "md", ["class:Hunter:1"]), row("c", "cc", ["class:Hunter:1"]), row("d", "md", ["class:Hunter:1"])]);
        expect(who(out)).toEqual([["class:Hunter:1"], ["class:Hunter:2"], ["class:Hunter:1"], ["class:Hunter:3"]]);
    });
    it("unique numbers stay as they are; a class with another role counts separately", () => {
        const list = [row("a", "tank", ["class:Warrior:2:tank"]), row("b", "tank", ["class:Warrior:1"]), row("c", "tank", ["class:Warrior:1:tank"])];
        expect(who(assign._internal.renumberClassRefs(list))).toEqual([["class:Warrior:2:tank"], ["class:Warrior:1"], ["class:Warrior:1:tank"]]);
    });
    it("a hand-made pick moves with its renumbered reference; the pick of the reference that keeps its name stays", () => {
        const out = assign._internal.renumberClassRefs([row("a", "md", ["class:Hunter:1"], [], { picks: { "class:Hunter:1": "h2" } }), row("b", "md", ["class:Hunter:1"], [], { picks: { "class:Hunter:1": "h1" } })]);
        expect(out[0].picks).toEqual({ "class:Hunter:1": "h2" });
        expect(out[1]).toMatchObject({ assignees: ["class:Hunter:2"], picks: { "class:Hunter:2": "h1" } });
        const twice = assign._internal.renumberClassRefs([row("a", "md", ["class:Hunter:1", "class:Hunter:1"], [], { picks: { "class:Hunter:1": "h2" } })]);
        expect(twice[0]).toMatchObject({ assignees: ["class:Hunter:1", "class:Hunter:2"], picks: { "class:Hunter:1": "h2" } });
    });
    it("class targets are numbered on among the targets", () => {
        const out = assign._internal.renumberClassRefs([row("a", "ss", [], [{ kind: "class", ref: "Priest:1" }]), row("b", "ss", [], [{ kind: "class", ref: "Priest:1" }])]);
        expect(out.map((a) => a.targets[0].ref)).toEqual(["Priest:1", "Priest:2"]);
    });
    it("the save keeps a template's old references (count 1 each) and resolves them as before", () => {
        const old = [row("a", "md", ["class:Hunter:1"]), row("b", "md", ["class:Hunter:1"])];
        const saved = assign.cleanAssignments(old).assignments;
        expect(who(saved)).toEqual([["class:Hunter:1"], ["class:Hunter:2"]]);
        expect(who(expand(saved, hunters2))).toEqual(who(expand(old, hunters2)));
    });
    it("tolerates raw junk", () => {
        expect(assign._internal.renumberClassRefs([null, 5, { type: "md" }, { type: "md", assignees: "x", targets: [null] }])).toHaveLength(4);
        expect(assign._internal.renumberClassRefs("nope")).toEqual([]);
    });
});

describe("suggestions use the same round robin", () => {
    const tankSlots = [{ kind: "tank", n: 1, userId: "war" }, { kind: "tank", n: 2, userId: "pal" }, { kind: "tank", n: 3, userId: "bear" }];
    it("misdirect in an event: 2 hunters for 3 tanks = 2 rows, the third tank gets nobody (no rogue)", () => {
        const md = assign.suggest("md", { slots: tankSlots, roster: [...hunters2, ...tanks], groups: [1], versionId: "tbc" });
        expect(md.map((a) => [a.assignees, a.targets[0].ref])).toEqual([[["user:h1"], "tank:1"], [["user:h2"], "tank:2"]]);
    });
    it("goes round the rows the orga keeps: a hunter already misdirecting by hand is not suggested again", () => {
        const keep = [row("k", "md", ["user:h1"], [{ kind: "slot", ref: "tank:3" }])];
        const md = assign.suggest("md", { slots: tankSlots, roster: [...hunters2, ...tanks], groups: [1], versionId: "tbc", keep });
        expect(md.map((a) => a.assignees)).toEqual([["user:h2"]]);
    });
    it("in a template the numbers go on after the kept rows", () => {
        const keep = [row("k", "md", ["class:Hunter:1"])];
        const md = assign.suggest("md", { slots: tankSlots.map((s) => ({ ...s, userId: "" })), roster: [], groups: [1], versionId: "tbc", keep });
        expect(md.map((a) => a.assignees[0])).toEqual(["class:Hunter:2", "class:Hunter:3", "class:Hunter:4"]);
    });
    it("soulstones: warlocks to healers in order, only as many as there are warlocks", () => {
        const roster = [P("w1", "Warlock", "ranged"), P("hp", "Priest", "healer"), P("hs", "Shaman", "healer")];
        const ss = assign.suggest("ss", { slots: [], roster, groups: [1], versionId: "tbc" });
        expect(ss.map((a) => [a.assignees, a.targets])).toEqual([[["user:w1"], [{ kind: "player", ref: "hp" }]]]);
    });
    it("kicks: a rotation of at most three in the class order; thunder clap the warrior tanks first", () => {
        const roster = [P("r1", "Rogue", "melee"), P("r2", "Rogue", "melee"), P("s1", "Shaman", "melee"), P("w1", "Warrior", "melee"), P("w2", "Warrior", "tank")];
        expect(assign.suggest("kick", { roster, groups: [1], versionId: "tbc" })[0].assignees).toEqual(["user:r1", "user:r2", "user:s1"]);
        expect(assign.suggest("thunderclap", { roster, groups: [1], versionId: "tbc" })[0].assignees).toEqual(["user:w2", "user:w1"]);
        expect(assign.suggest("demoshout", { roster, groups: [1], versionId: "tbc" })[0].assignees).toEqual(["user:w1", "user:w2"]);
    });
    it("nobody fits: nothing is suggested", () => {
        expect(assign.suggest("md", { slots: tankSlots, roster: tanks, groups: [1], versionId: "tbc" })).toEqual([]);
        expect(assign.suggest("curse", { roster: tanks, groups: [1] })).toEqual([]);
    });
});
