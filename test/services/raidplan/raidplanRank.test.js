// The ranking of candidates (#501): who of several raiders who COULD do a task should do it. The three cases of the issue (an elemental
// vs. an enhancement shaman for "Fernkampf", a druid tank + a second druid for decursing, a mage tank at the Illidari Council + a second
// mage for the kick) run on the pure scoring, the class-reference resolution and the suggestion. The client twin runs the same cases in
// src/web-client/src/lib/raidplan/rank.test.ts.
const assign = require("../../../src/services/raidplan/raidplanAssign");
const catalogStore = require("../../../src/stores/raidplanCatalogStore");
const { tempStoreFile } = require("../../helpers/tempStore");

beforeAll(() => catalogStore.useFile(tempStoreFile("rank-catalog.json")));

const P = (userId, classId, role, specRole = "") => ({ userId, character: userId, classId, role, specRole, group: 1 });
const row = (id, type, assignees, extra = {}) => ({ id, type, title: "", spell: null, assignees, targets: [], note: "", suggested: false, ...extra });
const who = (list, id) => list.find((a) => a.id === id).assignees;

// the three cases of the issue
const enh = P("enh", "Shaman", "melee", "melee");
const ele = P("ele", "Shaman", "ranged", "ranged");
const bear = P("bear", "Druid", "tank", "tank");
const tree = P("tree", "Druid", "healer", "healer");
const mageTank = P("mtank", "Mage", "ranged", "ranged");
const mage2 = P("mage2", "Mage", "ranged", "ranged");
const councilTank = row("t1", "tank", ["class:Mage:1:any"], { targets: [{ kind: "mob", ref: "d:zerevor", name: "High Nethermancer Zerevor", icon: "" }] });

describe("scoreCandidate / rankCandidates", () => {
    it("case 1: the row's role puts the elemental shaman first for Fernkampf, the enhancement one for Nahkampf; any role = setup order", () => {
        expect(assign.rankCandidates({ type: "kick", preferredRole: "ranged" }, [enh, ele]).map((p) => p.userId)).toEqual(["ele", "enh"]);
        expect(assign.rankCandidates({ type: "kick", preferredRole: "melee" }, [ele, enh]).map((p) => p.userId)).toEqual(["enh", "ele"]);
        expect(assign.rankCandidates({ type: "kick" }, [enh, ele]).map((p) => p.userId)).toEqual(["enh", "ele"]);
        expect(assign.scoreCandidate({ type: "kick", preferredRole: "ranged" }, ele)).toEqual({ score: 100, parts: { role: 100, spell: 0, tank: 0, healer: 0, load: 0 } });
    });
    it("case 2: a druid tank (by his spec) comes after the other druid for decursing", () => {
        expect(assign.rankCandidates({ type: "dispel" }, [bear, tree]).map((p) => p.userId)).toEqual(["tree", "bear"]);
        expect(assign.scoreCandidate({ type: "dispel" }, bear).parts.tank).toBe(assign.RANK_POINTS.tank);
        // a tanking row itself knows no tank penalty and no load
        expect(assign.scoreCandidate({ type: "tank" }, bear, { load: { bear: 3 } }).score).toBe(0);
    });
    it("case 3: a mage in a tank row of the board comes after the second mage for the kick", () => {
        const ctx = assign.boardContext([row("t1", "tank", ["user:mtank"])], [], {});
        expect(ctx.tanks).toEqual({ mtank: true });
        expect(assign.rankCandidates({ type: "kick" }, [mageTank, mage2], ctx).map((p) => p.userId)).toEqual(["mage2", "mtank"]);
        expect(assign.scoreCandidate({ type: "kick" }, mageTank, ctx)).toEqual({ score: -43, parts: { role: 0, spell: 0, tank: -40, healer: 0, load: -3 } });
    });
    it("a flex role on the boss wins over the setup and the spec", () => {
        expect(assign.playerRole(bear, { bear: "dps" })).toBe("dps");
        expect(assign.playerRole(P("x", "Warrior", "melee", "tank"), {})).toBe("tank");
        expect(assign.playerRole(P("x", "Shaman", "dps", "ranged"), { x: "dps" })).toBe("ranged");
        expect(assign.playerRole(P("x", "Paladin", "tank", "melee"), {})).toBe("tank");
        expect(assign.playerRole(P("x", "Mage", "ranged"), {})).toBe("ranged");
        expect(assign.rankCandidates({ type: "dispel" }, [bear, tree], { roles: { bear: "dps" } }).map((p) => p.userId)).toEqual(["bear", "tree"]);
    });
    it("a healer comes after a damage dealer for damage dealers' utility, not for a dispel; a class with a spell of the catalog comes first", () => {
        const holy = P("holy", "Priest", "healer", "healer");
        const shadow = P("shadow", "Priest", "ranged", "ranged");
        expect(assign.rankCandidates({ type: "kick" }, [holy, shadow]).map((p) => p.userId)).toEqual(["shadow", "holy"]);
        expect(assign.rankCandidates({ type: "dispel" }, [holy, shadow]).map((p) => p.userId)).toEqual(["holy", "shadow"]);
        expect(assign.rankCandidates({ type: "kick" }, [P("hu", "Hunter", "ranged"), P("ro", "Rogue", "melee")], { spellClasses: ["Rogue"] }).map((p) => p.userId)).toEqual(["ro", "hu"]);
    });
    it("fewer tasks first (at most six count), a tie keeps the order given", () => {
        const a = P("a", "Warlock", "ranged");
        const b = P("b", "Warlock", "ranged");
        expect(assign.rankCandidates({ type: "curse" }, [a, b], { load: { a: 1 } }).map((p) => p.userId)).toEqual(["b", "a"]);
        expect(assign.rankCandidates({ type: "curse" }, [a, b], { load: { a: 2, b: 2 } }).map((p) => p.userId)).toEqual(["a", "b"]);
        expect(assign.scoreCandidate({ type: "curse" }, a, { load: { a: 20 } }).parts.load).toBe(6 * assign.RANK_POINTS.load);
    });
    it("hard rules only while somebody is left", () => {
        expect(assign.withoutMisfits({ type: "dispel" }, [bear, tree]).map((p) => p.userId)).toEqual(["tree"]);
        expect(assign.withoutMisfits({ type: "dispel" }, [bear]).map((p) => p.userId)).toEqual(["bear"]);
        expect(assign.withoutMisfits({ type: "kick" }, [tree, bear]).map((p) => p.userId)).toEqual(["tree"]);
        expect(assign.withoutMisfits({ type: "thunderclap" }, [bear]).map((p) => p.userId)).toEqual(["bear"]);
        expect(assign.withoutMisfits({ type: "tank" }, [bear, tree]).map((p) => p.userId)).toEqual(["bear", "tree"]);
    });
});

describe("class references resolve by the ranking", () => {
    it("case 1: Shaman 1 on a Fernkampf row is the elemental one", () => {
        const out = assign.expandClassRefs([row("k", "kick", ["class:Shaman:1"], { preferredRole: "ranged" })], [], [enh, ele], {});
        expect(who(out, "k")).toEqual(["user:ele"]);
        expect(who(assign.expandClassRefs([row("k", "kick", ["class:Shaman:1"])], [], [enh, ele], {}), "k")).toEqual(["user:enh"]);
    });
    it("case 2: Druid 1 decursing is not the druid tank, while he is the only druid he is", () => {
        const board = [row("t", "tank", ["user:bear"]), row("d", "dispel", ["class:Druid:1"])];
        expect(who(assign.expandClassRefs(board, [], [bear, tree], {}), "d")).toEqual(["user:tree"]);
        expect(who(assign.expandClassRefs(board, [], [bear], {}), "d")).toEqual(["user:bear"]);
    });
    it("case 3: the council's mage tank (a class reference too) does not kick while a second mage is there; alone he does", () => {
        const board = [row("k", "kick", ["class:Mage:1"]), councilTank];
        const out = assign.expandClassRefs(board, [], [mageTank, mage2], {});
        expect(who(out, "t1")).toEqual(["user:mtank"]);
        expect(who(out, "k")).toEqual(["user:mage2"]);
        expect(who(assign.expandClassRefs(board, [], [mageTank], {}), "k")).toEqual(["user:mtank"]);
    });
    it("spreads the load over the kinds of task: the second warlock takes the soulstone the first one's curse row would have given him", () => {
        const a = P("a", "Warlock", "ranged");
        const b = P("b", "Warlock", "ranged");
        const out = assign.expandClassRefs([row("c", "curse", ["class:Warlock:1"]), row("s", "ss", ["class:Warlock:1"])], [], [a, b], {});
        expect(who(out, "c")).toEqual(["user:a"]);
        expect(who(out, "s")).toEqual(["user:b"]);
    });
    it("a hand pick still wins, and a target keeps the setup order", () => {
        const board = [councilTank, row("k", "kick", ["class:Mage:1"], { picks: { "class:Mage:1": "mtank" } })];
        expect(who(assign.expandClassRefs(board, [], [mageTank, mage2], {}), "k")).toEqual(["user:mtank"]);
        const ss = row("s", "ss", ["class:Warlock:1"], { targets: [{ kind: "class", ref: "Mage:1" }] });
        const out = assign.expandClassRefs([councilTank, ss], [], [mageTank, mage2, P("w", "Warlock", "ranged")], {});
        expect(out[1].targets).toEqual([{ kind: "player", ref: "mtank" }]);
    });
});

describe("suggest uses the ranking", () => {
    it("case 1: a kick suggestion of shamans for Fernkampf starts with the elemental one, for Nahkampf with the enhancement one", () => {
        const ranged = assign.suggest("kick", { roster: [enh, ele], preferredClasses: ["Shaman"], preferredRole: "ranged" });
        expect(ranged[0].assignees).toEqual(["user:ele", "user:enh"]);
        expect(ranged[0].preferredRole).toBe("ranged");
        const melee = assign.suggest("kick", { roster: [ele, enh], preferredClasses: ["Shaman"], preferredRole: "melee" });
        expect(melee[0].assignees).toEqual(["user:enh", "user:ele"]);
    });
    it("case 3: the council's mage tank is not suggested for the kick while a second mage is there; alone he is", () => {
        const context = [row("t1", "tank", ["user:mtank"])];
        expect(assign.suggest("kick", { roster: [mageTank, mage2], preferredClasses: ["Mage"], context })[0].assignees).toEqual(["user:mage2"]);
        expect(assign.suggest("kick", { roster: [mageTank], preferredClasses: ["Mage"], context })[0].assignees).toEqual(["user:mtank"]);
        // the tank row as a class reference ("Magier-Tank") counts the same
        expect(assign.suggest("kick", { roster: [mageTank, mage2], preferredClasses: ["Mage"], context: [councilTank] })[0].assignees).toEqual(["user:mage2"]);
    });
    it("case 2: the row dialog's wand on a decurse row of druids names the other druid, not the druid tank; alone the tank", () => {
        expect(assign.SUGGESTABLE).toEqual(expect.arrayContaining(["dispel", "cc", "buff"]));
        expect(assign.suggest("dispel", { roster: [bear, tree], preferredClasses: ["Druid"] }).map((a) => a.assignees)).toEqual([["user:tree"]]);
        expect(assign.suggest("dispel", { roster: [bear], preferredClasses: ["Druid"] }).map((a) => a.assignees)).toEqual([["user:bear"]]);
        // a template names the class, nobody of it in the raid = nothing
        expect(assign.suggest("dispel", { preferredClasses: ["Druid"] })[0].assignees).toEqual(["class:Druid:1"]);
        expect(assign.suggest("dispel", { roster: [mage2], preferredClasses: ["Druid"] })).toEqual([]);
    });
    it("nobody is suggested a task twice when an alternative is there (load of the other rows)", () => {
        const h1 = P("h1", "Hunter", "ranged");
        const h2 = P("h2", "Hunter", "ranged");
        const context = [row("x", "cc", ["user:h1"])];
        const out = assign.suggest("md", { roster: [h1, h2], slots: [{ kind: "tank", n: 1, userId: "" }], context });
        expect(out.map((a) => a.assignees)).toEqual([["user:h2"]]);
    });
    it("a template (no roster) is unchanged: class references, no role stored when none is chosen", () => {
        const out = assign.suggest("kick", {});
        expect(out[0].assignees).toEqual(["class:Rogue:1", "class:Shaman:1", "class:Warrior:1"]);
        expect(out[0].preferredRole).toBeUndefined();
    });
});

describe("cleanAssignments keeps only the four roles", () => {
    it("stores melee / ranged / healer / tank, drops anything else (and stores nothing for any)", () => {
        const clean = (preferredRole) => assign.cleanAssignments([{ id: "a", type: "kick", assignees: [], targets: [], preferredRole }]).assignments[0];
        for (const r of ["melee", "ranged", "healer", "tank"]) expect(clean(r).preferredRole).toBe(r);
        for (const r of ["", "dps", "any", "boss", 3, null]) expect(clean(r)).not.toHaveProperty("preferredRole");
    });
});
