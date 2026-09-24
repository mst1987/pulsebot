// A class as who does a task or at whom (lib/classRefs.ts): resolved from the setup, never a stranger, hand-made choices stay.
const { loadTs } = require("./i18nHelper");

const cr = loadTs("lib/classRefs.ts");

const P = (userId, classId, role = "ranged") => ({ userId, character: userId, classId, role, group: 1 });
const row = (id, type, assignees, targets = [], extra = {}) => ({ id, type, title: "", spell: null, assignees, targets, note: "", suggested: false, ...extra });
const roster = [P("h1", "Hunter"), P("h2", "Hunter"), P("r1", "Rogue", "melee"), P("p1", "Priest", "healer"), P("p2", "Priest", "ranged"), P("t1", "Warrior", "tank")];
const expand = (list, slots = [], roles = {}) => cr.expandClassRefs(list, slots, roster, roles);
const refs = (list, i = 0) => list[i].assignees;

describe("class reference parts", () => {
    it("builds and splits the assignee and the target form", () => {
        expect(cr.classRef("Hunter", 2, "")).toBe("class:Hunter:2");
        expect(cr.classRef("Priest", 1, "healer")).toBe("class:Priest:1:healer");
        expect(cr.classTargetRef("Priest", 1, "healer")).toBe("Priest:1:healer");
        expect(cr.parseClassRef("class:Hunter:2")).toEqual({ classId: "Hunter", n: 2, role: "" });
        expect(cr.parseClassRef("Priest:1:healer")).toEqual({ classId: "Priest", n: 1, role: "healer" });
        expect(cr.parseClassRef("user:x")).toBe(null);
        expect(cr.isClassRef("class:Rogue:1")).toBe(true);
        expect(cr.isClassRef("slot:dps:1")).toBe(false);
    });
    it("counts on: the next free number per class", () => {
        expect(cr.nextClassN([], "Hunter")).toBe(1);
        expect(cr.nextClassN(["class:Hunter:1", "class:Rogue:1", "class:Hunter:2"], "Hunter")).toBe(3);
        expect(cr.nextClassN(["class:Hunter:9"], "Hunter")).toBe(9);
    });
    it("a role filter: dps means melee or ranged, empty means anyone", () => {
        expect(cr.roleFits("", "tank")).toBe(true);
        expect(cr.roleFits("dps", "melee")).toBe(true);
        expect(cr.roleFits("dps", "healer")).toBe(false);
        expect(cr.roleFits("healer", "healer")).toBe(true);
    });
});

describe("resolving a class reference", () => {
    it("the n-th free raider of the class, in setup order", () => {
        const r = expand([row("a", "md", ["class:Hunter:1", "class:Hunter:2"])]);
        expect(refs(r)).toEqual(["user:h1", "user:h2"]);
    });
    it("another row of the same kind of task does not take the same raider; another kind may", () => {
        const r = expand([row("a", "md", ["class:Hunter:1"]), row("b", "md", ["class:Hunter:1"]), row("c", "special", ["class:Hunter:1"])]);
        expect([refs(r, 0), refs(r, 1), refs(r, 2)]).toEqual([["user:h1"], ["user:h2"], ["user:h1"]]);
    });
    it("a raider named by hand or by a slot is taken for that kind of task", () => {
        const slots = [{ kind: "dps", n: 1, userId: "h1" }];
        const r = expand([row("a", "md", ["slot:dps:1"]), row("b", "md", ["class:Hunter:1"])], slots);
        expect(refs(r, 1)).toEqual(["user:h2"]);
        const q = expand([row("a", "md", ["user:h1", "class:Hunter:1"])]);
        expect(refs(q)).toEqual(["user:h1", "user:h2"]);
    });
    it("nobody of the class free: the reference stays open, never a stranger; several are allowed only when the row says so", () => {
        const one = [P("h1", "Hunter")];
        expect(cr.expandClassRefs([row("a", "md", ["class:Hunter:1", "class:Hunter:1"])], [], one, {})[0].assignees).toEqual(["user:h1", "class:Hunter:1"]);
        expect(cr.expandClassRefs([row("a", "md", ["class:Hunter:1", "class:Hunter:1"], [], { allowMulti: true })], [], one, {})[0].assignees).toEqual(["user:h1", "user:h1"]);
        expect(cr.expandClassRefs([row("a", "md", ["class:Mage:1"])], [], one, {})[0].assignees).toEqual(["class:Mage:1"]);
    });
    it("the role filter and a flex role on this boss are honoured", () => {
        expect(refs(expand([row("a", "heal", ["class:Priest:1:healer"])]))).toEqual(["user:p1"]);
        expect(refs(expand([row("a", "heal", ["class:Priest:1:healer"])], [], { p2: "healer", p1: "ranged" }))).toEqual(["user:p2"]);
        expect(refs(expand([row("a", "heal", ["class:Warrior:1:healer"])]))).toEqual(["class:Warrior:1:healer"]);
    });
    it("a hand-made choice wins and is not overwritten by the automatic one", () => {
        const r = expand([row("a", "md", ["class:Hunter:1"], [], { picks: { "class:Hunter:1": "h2" } }), row("b", "md", ["class:Hunter:1"])]);
        expect([refs(r, 0), refs(r, 1)]).toEqual([["user:h2"], ["user:h1"]]);
        const gone = expand([row("a", "md", ["class:Hunter:1"], [], { picks: { "class:Hunter:1": "nobody" } })]);
        expect(refs(gone)).toEqual(["user:h1"]);
    });
    it("a class as a target is resolved among the targets, and the rest of the row is untouched", () => {
        const r = expand([row("a", "ss", ["class:Warlock:1"], [{ kind: "class", ref: "Priest:1" }, { kind: "mark", ref: "skull" }])]);
        expect(r[0].targets).toEqual([{ kind: "player", ref: "p1" }, { kind: "mark", ref: "skull" }]);
        expect(r[0].assignees).toEqual(["class:Warlock:1"]);
        const p = expand([row("a", "ss", [], [{ kind: "class", ref: "Priest:1" }], { picks: { "t:Priest:1": "p2" } })]);
        expect(p[0].targets).toEqual([{ kind: "player", ref: "p2" }]);
    });
    it("without a class reference the very same list comes back", () => {
        const list = [row("a", "tank", ["slot:tank:1", "user:t1"])];
        expect(expand(list)).toBe(list);
    });
});

describe("an unfilled class reference as it is shown", () => {
    const { makeT } = require("./i18nHelper");
    const mention = loadTs("lib/mention.ts");
    const assign = loadTs("lib/assign.ts", { t: makeT("de"), ...mention, ...cr });
    const ctx = { slots: [], players: new Map() };
    it("is an open place with the class icon and the class name, in a row and as a target", () => {
        const r = assign.resolveAssignee("class:Hunter:2", ctx);
        expect(r).toMatchObject({ kind: "class", open: true, classId: "Hunter", icon: "classicon_hunter", role: "" });
        expect(r.label).toBe("Jäger 2");
        expect(assign.resolveAssignee("class:Priest:1:healer", ctx)).toMatchObject({ label: "Priester", role: "healer" });
        expect(assign.resolveTarget({ kind: "class", ref: "Priest:1" }, ctx)).toMatchObject({ kind: "class", ref: "Priest:1", label: "Priester", open: true });
    });
});

describe("a role is the spec's role, never a class guess", () => {
    const Q = (userId, classId, role) => ({ userId, character: userId, classId, role, group: 1 });
    const setup = [Q("ret", "Paladin", "melee"), Q("enh", "Shaman", "melee"), Q("feral", "Druid", "melee"), Q("shadow", "Priest", "ranged"), Q("holy", "Paladin", "healer"), Q("resto", "Shaman", "healer"), Q("prot", "Paladin", "tank")];
    const run = (list) => cr.expandClassRefs(list, [], setup, {});
    it("a healing row takes only healer specs, whatever the ref says about the class", () => {
        const r = run([row("h", "heal", ["class:Paladin:1", "class:Shaman:1", "class:Druid:1", "class:Priest:1"])]);
        expect(r[0].assignees).toEqual(["user:holy", "user:resto", "class:Druid:1", "class:Priest:1"]);
    });
    it("without a healer of the class the place stays open: no damage dealer of that class fills it", () => {
        const r = cr.expandClassRefs([row("h", "heal", ["class:Paladin:1", "class:Paladin:2"])], [], setup.filter((p) => p.userId !== "holy"), {});
        expect(r[0].assignees).toEqual(["class:Paladin:1", "class:Paladin:2"]);
    });
    it("a tank row takes only tank specs; an explicit role in the reference still wins; other tasks ignore the role", () => {
        expect(run([row("t", "tank", ["class:Paladin:1", "class:Druid:1"])])[0].assignees).toEqual(["user:prot", "class:Druid:1"]);
        expect(run([row("t", "special", ["class:Paladin:1:melee"])])[0].assignees).toEqual(["user:ret"]);
        expect(run([row("k", "kick", ["class:Shaman:1"])])[0].assignees).toEqual(["user:enh"]);
        expect(cr.impliedRole("heal")).toBe("healer");
        expect(cr.impliedRole("md")).toBe("");
    });
    it("a flex role on this boss counts as the role", () => {
        const r = cr.expandClassRefs([row("h", "heal", ["class:Paladin:1"])], [], setup, { ret: "healer", holy: "melee" });
        expect(r[0].assignees).toEqual(["user:ret"]);
    });
});
