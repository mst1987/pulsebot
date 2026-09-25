// The count of a class in a row ("Jäger × 2"), the running number over the rows of a task, the general tank and the twin check of
// the resolution (client lib/classRefs.ts against the server's src/web/raidplanAssign.js). Pure logic run for real; the dialog's
// structure is read from its source.
const fs = require("fs");
const path = require("path");
const { loadTs, makeT } = require("./i18nHelper");
const server = require("../../src/web/raidplanAssign");

const cr = loadTs("lib/classRefs.ts");
const P = (userId, classId, role) => ({ userId, character: userId, classId, role, group: 1 });
const row = (id, type, assignees, targets = [], extra = {}) => ({ id, type, title: "", spell: null, assignees, targets, note: "", suggested: false, ...extra });
const rowOf = (list, id) => list.find((a) => a.id === id);

describe("count of a class in a row", () => {
    it("groups a row's references per class and role, with their numbers", () => {
        expect(cr.classGroups(["class:Hunter:1", "slot:dps:1", "class:Hunter:2", "class:Warrior:1:tank", "class:Warrior:2"])).toEqual([
            { classId: "Hunter", role: "", refs: ["class:Hunter:1", "class:Hunter:2"], ns: [1, 2] },
            { classId: "Warrior", role: "tank", refs: ["class:Warrior:1:tank"], ns: [1] },
            { classId: "Warrior", role: "", refs: ["class:Warrior:2"], ns: [2] },
        ]);
        expect(cr.numbersLabel([2, 1])).toBe("1-2");
        expect(cr.numbersLabel([1, 3])).toBe("1, 3");
        expect(cr.numbersLabel([4])).toBe("4");
    });
    it("× 2 adds the next running number of the task (over ALL its rows), × 1 takes the highest of the row away with its pick", () => {
        const list = [row("a", "md", ["class:Hunter:1"]), row("b", "md", ["class:Hunter:2"])];
        const more = cr.setClassCount(list, "a", "Hunter", "", 2, false);
        expect(rowOf(more, "a").assignees).toEqual(["class:Hunter:1", "class:Hunter:3"]);
        expect(rowOf(more, "b")).toBe(list[1]);
        const withPick = [row("a", "md", ["class:Hunter:1", "class:Hunter:3"], [], { picks: { "class:Hunter:3": "h2", "class:Hunter:1": "h1" } })];
        const fewer = cr.setClassCount(withPick, "a", "Hunter", "", 1, false);
        expect(rowOf(fewer, "a")).toMatchObject({ assignees: ["class:Hunter:1"], picks: { "class:Hunter:1": "h1" } });
        expect(rowOf(cr.setClassCount(withPick, "a", "Hunter", "", 0, false), "a").assignees).toEqual([]);
    });
    it("works on class targets too, and leaves other refs of the row alone", () => {
        const list = [row("a", "ss", ["class:Warlock:1"], [{ kind: "mark", ref: "skull" }])];
        const out = cr.setClassCount(list, "a", "Priest", "healer", 2, true);
        expect(rowOf(out, "a").targets).toEqual([{ kind: "mark", ref: "skull" }, { kind: "class", ref: "Priest:1:healer" }, { kind: "class", ref: "Priest:2:healer" }]);
        expect(rowOf(out, "a").assignees).toEqual(["class:Warlock:1"]);
    });
    it("a new row of the task takes the classes of the row before with the next numbers (Jäger 1 -> Jäger 2 -> Jäger 3)", () => {
        let list = [row("a", "md", ["class:Hunter:1"], [{ kind: "slot", ref: "tank:1" }]), row("b", "md", [])];
        list = cr.carryClasses(list, "b");
        expect(rowOf(list, "b")).toMatchObject({ assignees: ["class:Hunter:2"], targets: [] });
        list = cr.carryClasses([...list, row("c", "md", [])], "c");
        expect(rowOf(list, "c").assignees).toEqual(["class:Hunter:3"]);
        // counts carry: a "× 2" row is followed by two more
        const two = cr.carryClasses([row("a", "kick", ["class:Rogue:1", "class:Rogue:2"]), row("b", "kick", [])], "b");
        expect(rowOf(two, "b").assignees).toEqual(["class:Rogue:3", "class:Rogue:4"]);
        // nothing to carry: unchanged
        const none = [row("a", "md", ["user:x"]), row("b", "md", [])];
        expect(cr.carryClasses(none, "b")).toBe(none);
    });
});

describe("general tank (spec role, never the class alone)", () => {
    const setup = [P("war", "Warrior", "tank"), P("ret", "Paladin", "melee"), P("pal", "Paladin", "tank"), P("bear", "Druid", "tank"), P("cat", "Druid", "melee")];
    it("offers any tank and the three tanking classes on tanking rows", () => {
        expect(cr.TANK_CLASSES).toEqual(["Any", "Warrior", "Paladin", "Druid"]);
        expect(cr.TANK_TYPES).toEqual(expect.arrayContaining(["tank", "trashtank"]));
    });
    it("the candidates of a Tank (Paladin) are the prot paladins only; of any tank every tank", () => {
        expect(cr.candidatesOf("class:Paladin:1:tank", "tank", setup, {}).map((p) => p.userId)).toEqual(["pal"]);
        expect(cr.candidatesOf("class:Any:1:tank", "tank", setup, {}).map((p) => p.userId)).toEqual(["war", "pal", "bear"]);
        expect(cr.candidatesOf("class:Any:1", "md", setup, {})).toEqual([]);
    });
    it("several tank rows go round the tanks; a named class is served first; no fallback", () => {
        const out = cr.expandClassRefs([row("a", "tank", ["class:Any:1:tank"]), row("b", "tank", ["class:Druid:1:tank"]), row("c", "tank", ["class:Any:2:tank"]), row("d", "tank", ["class:Any:3:tank"])], [], setup, {});
        expect(out.map((a) => a.assignees[0])).toEqual(["user:war", "user:bear", "user:pal", "class:Any:3:tank"]);
    });
});

describe("the client and the server resolve alike (twins)", () => {
    const roster = [P("h1", "Hunter", "ranged"), P("h2", "Hunter", "ranged"), P("w1", "Warrior", "tank"), P("w2", "Warrior", "melee"), P("p1", "Paladin", "tank"), P("p2", "Paladin", "melee"), P("pr", "Priest", "healer"), P("d1", "Druid", "tank")];
    const cases = [
        [row("a", "md", ["class:Hunter:1"]), row("b", "md", ["class:Hunter:2"]), row("c", "md", ["class:Hunter:3"])],
        [row("a", "md", ["class:Hunter:1", "class:Hunter:2", "class:Hunter:3"], [], { allowMulti: true })],
        [row("a", "tank", ["class:Any:1:tank"]), row("b", "tank", ["class:Paladin:1:tank"]), row("c", "tank", ["class:Any:2:tank"]), row("d", "tank", ["class:Any:3:tank"])],
        [row("a", "tank", ["user:w1"]), row("b", "tank", ["class:Warrior:1:tank"]), row("c", "heal", ["class:Paladin:1"])],
        [row("a", "ss", ["class:Hunter:1"], [{ kind: "class", ref: "Any:1:healer" }, { kind: "class", ref: "Priest:1" }]), row("b", "md", ["class:Hunter:1"], [], { picks: { "class:Hunter:1": "h2" } })],
    ];
    it.each(cases.map((c, i) => [i, c]))("case %i", (_, list) => {
        const flex = { p2: "tank" };
        expect(cr.expandClassRefs(list, [], roster, flex)).toEqual(server.expandClassRefs(list, [], roster, flex));
    });
});

describe("the row dialog", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../src/web-client/src/pages/raid-detail/raidplan/AssignModal.tsx"), "utf8");
    it("shows the general tanks on tanking rows and edits counts through setClassCount", () => {
        expect(src).toMatch(/TANK_TYPES\.indexOf\(type\)/);
        expect(src).toMatch(/TANK_CLASSES\.map/);
        expect(src).toMatch(/setClassCount\(/);
        expect(src).toMatch(/candidatesOf\(/);
    });
    it("one card per class with a count stepper (- n +), a role filter and a remove", () => {
        expect(src).toMatch(/classGroups\(own\)/);
        expect(src).toMatch(/setCount\(g\.classId, g\.role, g\.refs\.length - 1, target\)/);
        expect(src).toMatch(/setCount\(g\.classId, g\.role, g\.refs\.length \+ 1, target\)/);
        expect(src).toMatch(/setCount\(g\.classId, g\.role, 0, target\)/);
        expect(src).toMatch(/setClassRole\(/);
    });
    it("has the texts in both languages", () => {
        for (const lang of ["de", "en"]) {
            const t = makeT(lang);
            for (const k of ["tankOf", "anyTank", "generalTank", "generalTankTip", "count", "more", "fewer"]) expect(t(`raidBoard.class.${k}`, { cls: "X" })).not.toMatch(/raidBoard\./);
        }
    });
});
