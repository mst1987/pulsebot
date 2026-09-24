// A class as who does a task / at whom (class:<Class>:<n>[:<role>]): what the server keeps of it (src/web/raidplanAssign.js).
const assign = require("../../src/web/raidplanAssign");

const row = (over) => ({ id: "r1", type: "md", title: "", assignees: [], targets: [], note: "", ...over });
const clean = (r, allowed = new Set()) => assign.cleanAssignments([row(r)], allowed);

describe("class references", () => {
    it("are kept as assignees in a template and in an event, with the optional role", () => {
        const r = clean({ assignees: ["class:Hunter:1", "class:Rogue:2", "class:Priest:1:healer", "slot:dps:3"] });
        expect(r.assignments[0].assignees).toEqual(["class:Hunter:1", "class:Rogue:2", "class:Priest:1:healer", "slot:dps:3"]);
        expect(r.dropped).toBe(0);
    });
    it("drop an unknown class, a number outside 1..9, an unknown role and a duplicate", () => {
        const r = clean({ assignees: ["class:Paladin:0", "class:Death Knight:1", "class:Hunter:10", "class:Hunter:1:boss", "class:Hunter:1", "class:Hunter:1"] });
        expect(r.assignments[0].assignees).toEqual(["class:Hunter:1"]);
        expect(r.dropped).toBe(5);
    });
    it("a class is also a target ('Soulstone on a priest')", () => {
        const r = clean({ type: "ss", targets: [{ kind: "class", ref: "Priest:1" }, { kind: "class", ref: "Priest:1:healer" }, { kind: "class", ref: "Nope:1" }, { kind: "class", ref: "Priest:1" }] });
        expect(r.assignments[0].targets).toEqual([{ kind: "class", ref: "Priest:1" }, { kind: "class", ref: "Priest:1:healer" }]);
    });
    it("a hand-made pick is kept only for a class reference of the row and a raider of the event, never in a template", () => {
        const ev = clean({ assignees: ["class:Hunter:1"], targets: [{ kind: "class", ref: "Priest:1" }], picks: { "class:Hunter:1": "u1", "class:Rogue:1": "u1", "t:Priest:1": "u2", "class:Hunter:2": "zzz" } }, new Set(["u1", "u2"]));
        expect(ev.assignments[0].picks).toEqual({ "class:Hunter:1": "u1", "t:Priest:1": "u2" });
        const tpl = clean({ assignees: ["class:Hunter:1"], picks: { "class:Hunter:1": "u1" } });
        expect(tpl.assignments[0].picks).toEqual({});
    });
    it("'allow several' is a plain flag, off by default", () => {
        expect(clean({}).assignments[0].allowMulti).toBe(false);
        expect(clean({ allowMulti: true }).assignments[0].allowMulti).toBe(true);
    });
});

describe("expandClassRefs on the server (same rules as the client)", () => {
    const P = (userId, classId, role = "ranged") => ({ userId, classId, role });
    const roster = [P("h1", "Hunter"), P("h2", "Hunter"), P("p1", "Priest", "healer"), P("p2", "Priest")];
    const r = (id, type, assignees, targets = [], extra = {}) => ({ id, type, assignees, targets, ...extra });
    it("gives the n-th free raider, keeps the missing ones as references and leaves plans without class references alone", () => {
        const out = assign.expandClassRefs([r("a", "md", ["class:Hunter:1", "class:Rogue:1"]), r("b", "md", ["class:Hunter:1"])], [], roster, {});
        expect(out[0].assignees).toEqual(["user:h1", "class:Rogue:1"]);
        expect(out[1].assignees).toEqual(["user:h2"]);
        const plain = [r("a", "tank", ["slot:tank:1"])];
        expect(assign.expandClassRefs(plain, [], roster, {})).toBe(plain);
    });
    it("honours the role filter with a flex role, hand-made picks, allow-several and class targets", () => {
        expect(assign.expandClassRefs([r("a", "heal", ["class:Priest:1:healer"])], [], roster, {})[0].assignees).toEqual(["user:p1"]);
        expect(assign.expandClassRefs([r("a", "heal", ["class:Priest:1:healer"])], [], roster, { p2: "healer", p1: "ranged" })[0].assignees).toEqual(["user:p2"]);
        expect(assign.expandClassRefs([r("a", "md", ["class:Hunter:1"], [], { picks: { "class:Hunter:1": "h2" } })], [], roster, {})[0].assignees).toEqual(["user:h2"]);
        expect(assign.expandClassRefs([r("a", "md", ["class:Hunter:1", "class:Hunter:1", "class:Hunter:1"], [], { allowMulti: true })], [], roster, {})[0].assignees).toEqual(["user:h1", "user:h2", "user:h1"]);
        expect(assign.expandClassRefs([r("a", "ss", [], [{ kind: "class", ref: "Priest:1" }])], [], roster, {})[0].targets).toEqual([{ kind: "player", ref: "p1" }]);
    });
});

describe("suggestions without a setup (a template) name classes", () => {
    const tanks = [{ kind: "tank", n: 1, userId: "" }, { kind: "tank", n: 2, userId: "" }];
    it("misdirect: the class of the task per tank, kicks a rotation of classes, curses one warlock each", () => {
        const md = assign.suggest("md", { slots: tanks, roster: [], groups: [1], versionId: "tbc" });
        expect(md.map((a) => [a.assignees, a.targets])).toEqual([[["class:Hunter:1"], [{ kind: "slot", ref: "tank:1" }]], [["class:Hunter:1"], [{ kind: "slot", ref: "tank:2" }]]]);
        expect(assign.suggest("kick", { slots: tanks, roster: [], groups: [1], versionId: "tbc" })[0].assignees).toEqual(["class:Rogue:1", "class:Shaman:1", "class:Warrior:1"]);
        expect(assign.suggest("curse", { slots: [], roster: [], groups: [1] }).map((a) => a.assignees[0])).toEqual(["class:Warlock:1", "class:Warlock:2", "class:Warlock:3"]);
        expect(assign.suggest("ss", { slots: [], roster: [], groups: [1] })[0].assignees).toEqual(["class:Warlock:1"]);
    });
    it("every reference such a suggestion makes is one the server keeps", () => {
        for (const t of ["md", "fearward", "kick", "ss", "curse", "thunderclap", "demoshout"]) {
            const rows = assign.suggest(t, { slots: tanks, roster: [], groups: [1], versionId: "tbc" });
            const cleaned = assign.cleanAssignments(rows).assignments;
            expect(cleaned.map((a) => a.assignees)).toEqual(rows.map((a) => a.assignees));
        }
    });
});
