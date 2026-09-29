// The ranking of candidates (#501), client twin lib/raidplan/classRefs.ts against the server's raidplanAssign.js: the three cases of the
// issue (elemental vs. enhancement shaman for "Fernkampf", druid tank + second druid decursing, mage tank at the council + second mage
// kicking) and the resolution of class references run on BOTH and must agree. The server's own cases: test/services/raidplan/raidplanRank.test.js.
import { describe, expect, it } from "vitest";
import * as cr from "./classRefs";
import type { RaidplanAssignment, RaidplanPlayer } from "../../api";
import { requireBackend } from "../../test/backend";

const server = requireBackend("services/raidplan/raidplanAssign");
const twins = [["client", cr], ["server", server]] as const;

function P(userId: string, classId: string, role: string, specRole = ""): RaidplanPlayer {
    return { userId, character: userId, classId, className: classId, classColor: "", spec: "", specLabel: "", role, specRole, iconUrl: "", group: 1 };
}
function row(id: string, type: string, assignees: string[], extra: Partial<RaidplanAssignment> = {}): RaidplanAssignment {
    return { id, type: type as RaidplanAssignment["type"], title: "", spell: null, assignees, targets: [], note: "", suggested: false, ...extra };
}
function ids(list: { userId: string }[]): string[] {
    return list.map((p) => p.userId);
}
function who(list: RaidplanAssignment[], id: string): string[] {
    return (list.find((a) => a.id === id) || { assignees: [] as string[] }).assignees;
}

const enh = P("enh", "Shaman", "melee", "melee");
const ele = P("ele", "Shaman", "ranged", "ranged");
const bear = P("bear", "Druid", "tank", "tank");
const tree = P("tree", "Druid", "healer", "healer");
const mageTank = P("mtank", "Mage", "ranged", "ranged");
const mage2 = P("mage2", "Mage", "ranged", "ranged");
const councilTank = row("t1", "tank", ["class:Mage:1:any"]);

describe.each(twins)("ranking (%s)", (_name, lib) => {
    it("case 1: Fernkampf puts the elemental shaman first, Nahkampf the enhancement one, no role keeps the setup order", () => {
        expect(ids(lib.rankCandidates({ type: "kick", preferredRole: "ranged" }, [enh, ele]))).toEqual(["ele", "enh"]);
        expect(ids(lib.rankCandidates({ type: "kick", preferredRole: "melee" }, [ele, enh]))).toEqual(["enh", "ele"]);
        expect(ids(lib.rankCandidates({ type: "kick" }, [enh, ele]))).toEqual(["enh", "ele"]);
        const out = lib.expandClassRefs([row("k", "kick", ["class:Shaman:1"], { preferredRole: "ranged" })], [], [enh, ele], {});
        expect(who(out, "k")).toEqual(["user:ele"]);
    });
    it("case 2: the druid tank does not decurse while another druid is there; alone he does", () => {
        expect(ids(lib.rankCandidates({ type: "dispel" }, [bear, tree]))).toEqual(["tree", "bear"]);
        const board = [row("t", "tank", ["user:bear"]), row("d", "dispel", ["class:Druid:1"])];
        expect(who(lib.expandClassRefs(board, [], [bear, tree], {}), "d")).toEqual(["user:tree"]);
        expect(who(lib.expandClassRefs(board, [], [bear], {}), "d")).toEqual(["user:bear"]);
    });
    it("case 3: the council's mage tank does not kick while a second mage is there; alone he does", () => {
        const board = [row("k", "kick", ["class:Mage:1"]), councilTank];
        const out = lib.expandClassRefs(board, [], [mageTank, mage2], {});
        expect(who(out, "t1")).toEqual(["user:mtank"]);
        expect(who(out, "k")).toEqual(["user:mage2"]);
        expect(who(lib.expandClassRefs(board, [], [mageTank], {}), "k")).toEqual(["user:mtank"]);
        const ctx = lib.boardContext([row("t", "tank", ["user:mtank"])], [], {});
        expect(lib.scoreCandidate({ type: "kick" }, mageTank, ctx)).toEqual({ score: -43, parts: { role: 0, spell: 0, tank: -40, healer: 0, load: -3 } });
    });
    it("hard rules only while somebody is left, healers after damage dealers for DPS utility, load, flex role", () => {
        expect(ids(lib.withoutMisfits({ type: "dispel" }, [bear, tree]))).toEqual(["tree"]);
        expect(ids(lib.withoutMisfits({ type: "dispel" }, [bear]))).toEqual(["bear"]);
        expect(ids(lib.withoutMisfits({ type: "kick" }, [tree, enh]))).toEqual(["enh"]);
        expect(ids(lib.rankCandidates({ type: "curse" }, [mage2, mageTank], { load: { mage2: 1 } }))).toEqual(["mtank", "mage2"]);
        expect(ids(lib.rankCandidates({ type: "dispel" }, [bear, tree], { roles: { bear: "dps" } }))).toEqual(["bear", "tree"]);
        expect(lib.playerRole(P("x", "Shaman", "dps", "ranged"), { x: "dps" })).toBe("ranged");
    });
});

describe("the twins agree", () => {
    it("resolve a full board the same way", () => {
        const roster = [bear, tree, enh, ele, mageTank, mage2, P("w1", "Warlock", "ranged", "ranged"), P("w2", "Warlock", "ranged", "ranged"), P("pt", "Warrior", "tank", "tank"), P("fu", "Warrior", "melee", "melee")];
        const board = [
            councilTank, row("t2", "tank", ["class:Any:1:tank"]), row("k", "kick", ["class:Mage:1", "class:Shaman:1", "class:Warrior:1"], { preferredRole: "ranged" }),
            row("d", "dispel", ["class:Druid:1"]), row("c", "curse", ["class:Warlock:1"]), row("s", "ss", ["class:Warlock:1"], { targets: [{ kind: "class", ref: "Druid:1:healer" }] }),
            row("tc", "thunderclap", ["class:Warrior:1"]),
        ];
        expect(cr.expandClassRefs(board, [], roster, { enh: "ranged" })).toEqual(server.expandClassRefs(board, [], roster, { enh: "ranged" }));
    });
});

describe("the raid-wide tasks (#536)", () => {
    const wt = P("wt", "Warrior", "tank", "tank");
    const wd = P("wd", "Warrior", "melee", "melee");
    const prot = P("prot", "Paladin", "tank", "tank");
    const holy = P("holy", "Paladin", "healer", "healer");
    for (const [name, lib] of twins) {
        it(`${name}: Sunder Armor and Faerie Fire are a tank's own debuffs, another debuff is not; a protection paladin blesses and has an aura`, () => {
            expect(lib.scoreCandidate({ type: "debuff", spell: { id: "d:sunder-armor" } }, wt).parts.tank).toBe(0);
            expect(lib.scoreCandidate({ type: "debuff", spell: { id: "d:faerie-fire" } }, bear).parts.tank).toBe(0);
            expect(lib.scoreCandidate({ type: "debuff", spell: { id: "d:hunters-mark" } }, wt).parts.tank).toBe(-40);
            expect(ids(lib.withoutMisfits({ type: "debuff", spell: { id: "d:sunder-armor" } }, [wt, wd]))).toEqual(["wt", "wd"]);
            expect(ids(lib.withoutMisfits({ type: "debuff" }, [wt, wd]))).toEqual(["wd"]);
            expect(lib.scoreCandidate({ type: "blessing" }, prot).parts.tank).toBe(0);
            expect(lib.scoreCandidate({ type: "aura" }, prot).parts.tank).toBe(0);
            expect(lib.scoreCandidate({ type: "debuff" }, holy).parts.healer).toBe(-20);
        });
    }
    it("the twins resolve a debuff card the same way", () => {
        const roster = [wt, wd, prot, holy, P("ret", "Paladin", "melee", "melee"), bear, tree];
        const board = [
            row("s", "debuff", ["class:Warrior:1:tank"], { spell: { id: "d:sunder-armor", name: "Sunder Armor", icon: "" } }),
            row("j1", "debuff", ["class:Paladin:1"], { spell: { id: "d:judgement-of-wisdom", name: "Judgement of Wisdom", icon: "" } }),
            row("j2", "debuff", ["class:Paladin:2"], { spell: { id: "d:judgement-of-light", name: "Judgement of Light", icon: "" } }),
            row("f", "debuff", ["class:Druid:1"], { spell: { id: "d:faerie-fire", name: "Faerie Fire", icon: "" } }),
            row("b", "blessing", ["class:Paladin:1"]), row("a", "aura", ["class:Paladin:2"]),
        ];
        const out = cr.expandClassRefs(board, [], roster, {});
        expect(out).toEqual(server.expandClassRefs(board, [], roster, {}));
        expect(who(out, "s")).toEqual(["user:wt"]);
        expect(who(out, "j1")).toEqual(["user:ret"]);
    });
});
