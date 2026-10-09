// Rows with a count and a class priority (#525), client twin lib/raidplan/classRefs.ts against the server's raidplanAssign.js: the same
// cases as test/services/raidplan/raidplanPriority.test.js run on BOTH and must agree. Plus the editing helpers of the row dialog.
import { describe, expect, it } from "vitest";
import * as cr from "./classRefs";
import { mergeInherited } from "./inherit";
import { assigneeItems, lineState, openAssignments, priorityName } from "./assignLine";
import { previewLines } from "./assignModal";
import { emptyBoard } from "./model";
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
function prio(id: string, type: string, count: number, classPriority: string[], extra: Partial<RaidplanAssignment> = {}): RaidplanAssignment {
    return row(id, type, [], { count, classPriority, ...extra });
}
function who(list: RaidplanAssignment[], id: string): string[] {
    return (list.find((a) => a.id === id) || { assignees: [] as string[] }).assignees;
}

const pal = P("pal", "Paladin", "healer", "healer");
const sham = P("sham", "Shaman", "healer", "healer");
const priest = P("priest", "Priest", "healer", "healer");
const druid = P("druid", "Druid", "healer", "healer");
const ele = P("ele", "Shaman", "ranged", "ranged");

describe.each(twins)("count and class priority (%s)", (_name, lib) => {
    it("1 x Paladin > Shaman: the paladin, else the shaman, else open", () => {
        const r = prio("h", "heal", 1, ["Paladin", "Shaman"]);
        expect(who(lib.expandClassRefs([r], [], [sham, pal], {}), "h")).toEqual(["user:pal"]);
        expect(who(lib.expandClassRefs([r], [], [sham, priest], {}), "h")).toEqual(["user:sham"]);
        expect(who(lib.expandClassRefs([r], [], [priest], {}), "h")).toEqual(["class:Paladin:1"]);
    });
    it("takes the task's role", () => {
        expect(who(lib.expandClassRefs([prio("h", "heal", 1, ["Shaman"])], [], [ele], {}), "h")).toEqual(["class:Shaman:1"]);
        expect(who(lib.expandClassRefs([prio("k", "kick", 1, ["Shaman"])], [], [ele], {}), "k")).toEqual(["user:ele"]);
    });
    it("2 x Priest > Druid with one priest: priest + druid", () => {
        expect(who(lib.expandClassRefs([prio("h", "heal", 2, ["Priest", "Druid"])], [], [druid, priest], {}), "h")).toEqual(["user:priest", "user:druid"]);
    });
    it("fixed assignees count", () => {
        expect(who(lib.expandClassRefs([prio("h", "heal", 2, ["Paladin", "Shaman"], { assignees: ["user:priest"] })], [], [pal, sham, priest], {}), "h")).toEqual(["user:priest", "user:pal"]);
        expect(who(lib.expandClassRefs([prio("h", "heal", 1, ["Paladin"], { assignees: ["user:priest"] })], [], [pal, priest], {}), "h")).toEqual(["user:priest"]);
    });
    it("two heal rows, three healers: three different ones", () => {
        const out = lib.expandClassRefs([prio("a", "heal", 1, ["Paladin", "Shaman", "Priest"]), prio("b", "heal", 2, ["Paladin", "Shaman", "Priest"])], [], [pal, sham, priest], {});
        expect(who(out, "a")).toEqual(["user:pal"]);
        expect(who(out, "b")).toEqual(["user:sham", "user:priest"]);
    });
    it("two heal rows, one healer: the same one in both, never twice in a row", () => {
        const out = lib.expandClassRefs([prio("a", "heal", 1, ["Paladin", "Shaman"]), prio("b", "heal", 2, ["Shaman", "Paladin"])], [], [sham], {});
        expect(who(out, "a")).toEqual(["user:sham"]);
        expect(who(out, "b")).toEqual(["user:sham", "class:Shaman:2"]);
    });
    it("exclusive per kind of task only", () => {
        const out = lib.expandClassRefs([prio("h", "heal", 1, ["Priest"]), prio("d", "dispel", 1, ["Priest"])], [], [priest], {});
        expect(who(out, "d")).toEqual(["user:priest"]);
    });
    it("an inherited Standard row and an own heal row share the exclusivity", () => {
        const bosses = {
            defaults: { assignments: [prio("std", "heal", 1, ["Paladin", "Shaman"])] },
            boss1: { assignments: [prio("own", "heal", 1, ["Paladin", "Shaman"])], inheritOff: [] },
        };
        const rows = mergeInherited(bosses.defaults.assignments, bosses.boss1, { bossMob: null, mobs: [] });
        const out = lib.expandClassRefs(rows, [], [pal, sham], {});
        expect(who(out, "std")).toEqual(["user:pal"]);
        expect(who(out, "own")).toEqual(["user:sham"]);
    });
    it("older class references first, resolving twice changes nothing, a template stays open", () => {
        const out = lib.expandClassRefs([prio("p", "heal", 1, ["Paladin", "Shaman"]), row("r", "heal", ["class:Paladin:1"])], [], [pal, sham], {});
        expect(who(out, "p")).toEqual(["user:sham"]);
        const once = lib.expandClassRefs([prio("a", "heal", 2, ["Paladin", "Shaman"]), prio("b", "heal", 1, ["Priest"])], [], [pal, sham], {});
        expect(lib.expandClassRefs(once, [], [pal, sham], {})).toEqual(once);
        expect(who(lib.expandClassRefs([prio("h", "heal", 2, ["Paladin", "Shaman"])], [], [], {}), "h")).toEqual(["class:Paladin:1", "class:Paladin:2"]);
    });
});

describe("golden master: rows without a count resolve as before #525 (both twins)", () => {
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
    // the same capture as the server's golden master (origin/main 439bd432)
    const GOLDEN = [["t1", ["user:wt"], ["mob|b:boss"]], ["t2", ["user:dt"], []], ["t3", ["user:pt"], []], ["h1", ["class:Paladin:1"], ["slot|tank:1"]], ["h2", ["user:sh1"], ["slot|tank:2"]], ["h3", ["user:sh2"], ["group|1", "group|2"]], ["h4", ["class:Any:4:healer"], ["group|3"]], ["h5", ["user:pr", "slot:healer:1"], ["group|4"]], ["h6", ["class:Paladin:1", "class:Shaman:1"], []], ["k1", ["user:ro", "user:ma1", "user:ele"], []], ["m1", ["user:hu1"], ["slot|tank:1"]], ["m2", ["user:hu2"], []], ["m3", ["class:Hunter:3"], []], ["d1", ["user:sp"], []], ["d2", ["user:dh"], []], ["s1", ["user:wl"], ["player|pr"]], ["c1", ["user:ma2", "user:ma1", "user:ma2"], []], ["u1", ["user:ro", "role:melee"], []]];
    const flat = (out: RaidplanAssignment[]) => out.map((a) => [a.id, a.assignees, a.targets.map((t) => `${t.kind}|${t.ref}`)]);
    it.each(twins)("%s", (_name, lib) => {
        expect(flat(lib.expandClassRefs(board, slots, roster, { dh: "dps" }))).toEqual(GOLDEN);
        expect(flat(lib.expandClassRefs([...board, prio("p", "heal", 1, ["Druid"])], slots, roster, { dh: "dps" })).slice(0, board.length)).toEqual(GOLDEN);
    });
});

describe("editing a priority (the row dialog)", () => {
    it("rowCount / classPriorityOf are the server's", () => {
        for (const v of [0, 1, 40, 41, 2.5, "3", null]) expect(cr.rowCount(v)).toBe(server._internal.rowCount(v));
        const list = ["Shaman", "Any", "Paladin", "Shaman", "x"];
        expect(cr.classPriorityOf({ classPriority: list })).toEqual(server._internal.classPriorityOf({ classPriority: list }));
    });
    it("a new list starts at one raider; toggling and moving keep the count; an empty list drops both", () => {
        let r = row("h", "heal", []);
        r = cr.togglePriorityClass(r, "Paladin");
        expect(r.classPriority).toEqual(["Paladin"]);
        expect(r.count).toBe(1);
        r = cr.setRowCount(cr.togglePriorityClass(r, "Shaman"), 2);
        expect(r.classPriority).toEqual(["Paladin", "Shaman"]);
        r = cr.movePriorityClass(r, "Shaman", -1);
        expect(r.classPriority).toEqual(["Shaman", "Paladin"]);
        expect(r.count).toBe(2);
        expect(cr.movePriorityClass(r, "Shaman", -1)).toBe(r);
        r = cr.togglePriorityClass(cr.togglePriorityClass(r, "Shaman"), "Paladin");
        expect(r).not.toHaveProperty("classPriority");
        expect(r).not.toHaveProperty("count");
    });
    it("setRowCount clamps to 1..40 and leaves a row without a priority alone", () => {
        const r = prio("h", "heal", 1, ["Priest"]);
        expect(cr.setRowCount(r, 99).count).toBe(40);
        expect(cr.setRowCount(r, 0).count).toBe(1);
        const plain = row("x", "heal", ["class:Priest:1"]);
        expect(cr.setRowCount(plain, 3)).toBe(plain);
    });
    it("toPriority: Paladin 1 + Shaman 1 -> 1 x Paladin > Shaman; only when simple", () => {
        const r = cr.toPriority(row("h", "heal", ["class:Paladin:1", "class:Shaman:1"], { picks: { "class:Paladin:1": "pal" } }));
        expect(r && r.classPriority).toEqual(["Paladin", "Shaman"]);
        expect(r && r.count).toBe(1);
        expect(r && r.assignees).toEqual([]);
        expect(r && r.picks).toEqual({});
        const two = cr.toPriority(row("h", "heal", ["user:x", "class:Priest:1", "class:Priest:2", "class:Druid:1"]));
        expect(two && two.classPriority).toEqual(["Priest", "Druid"]);
        expect(two && two.count).toBe(3);
        expect(two && two.assignees).toEqual(["user:x"]);
        expect(cr.toPriority(row("h", "heal", ["class:Any:1:healer"]))).toBeNull();
        expect(cr.toPriority(row("k", "kick", ["class:Mage:1:tank"]))).toBeNull();
        expect(cr.toPriority(row("h", "heal", ["user:x"]))).toBeNull();
        // the healer role on a heal row is the task's own: fine
        expect(cr.toPriority(row("h", "heal", ["class:Priest:1:healer"]))).not.toBeNull();
    });
});

describe("how a priority row shows (card, open list, preview)", () => {
    const ctx = (roster: RaidplanPlayer[]) => ({ slots: [], players: new Map(roster.map((p) => [p.userId, p])) });
    it("an event: the resolved raider as his own chip, the places nobody fills as ONE open item", () => {
        const r = prio("h", "heal", 2, ["Paladin", "Shaman"], { targets: [{ kind: "slot", ref: "tank:1" }] });
        const filled = cr.expandClassRefs([r], [], [pal], {})[0];
        const items = assigneeItems(r, filled, ctx([pal]), [], false, true);
        expect(items.map((x) => x.kind)).toEqual(["one", "prio"]);
        expect(items[0].r && items[0].r.player && items[0].r.player.userId).toBe("pal");
        expect(items[1]).toMatchObject({ open: true, count: 1, classes: ["Paladin", "Shaman"] });
        expect(lineState(r, filled, ctx([pal]), true)).toBe("open");
        const open = openAssignments([{ key: "b", name: "Boss", board: { ...emptyBoard(), assignments: [r] } }], [pal]);
        expect(open[0].missing).toContain(priorityName(["Paladin", "Shaman"], "heal"));
        const lines = previewLines(r, filled, ctx([pal]));
        expect(lines.map((l) => l.open)).toEqual([false, true]);
        expect(lines[1].who.label).toBe(priorityName(["Paladin", "Shaman"], "heal"));
    });
    it("all filled: only player chips, the row is fine", () => {
        const r = prio("h", "heal", 1, ["Paladin", "Shaman"]);
        const filled = cr.expandClassRefs([r], [], [sham], {})[0];
        const items = assigneeItems(r, filled, ctx([sham]), [], false, true);
        expect(items.map((x) => x.kind)).toEqual(["one"]);
        expect(lineState(r, filled, ctx([sham]), true)).toBe("ok");
    });
    it("a template: one quiet item with the count, never 'empty'", () => {
        const r = prio("h", "heal", 2, ["Paladin", "Shaman"]);
        const filled = cr.expandClassRefs([r], [], [], {})[0];
        const items = assigneeItems(r, filled, ctx([]), [], false, false);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ kind: "prio", open: false, count: 2 });
        expect(lineState(r, filled, ctx([]), false)).toBe("ok");
    });
    it("a new row after a priority row takes the same priority (the next free healer)", () => {
        const list = [prio("a", "heal", 1, ["Paladin", "Shaman"]), row("b", "heal", [])];
        const out = cr.carryClasses(list, "b");
        expect(out[1]).toMatchObject({ classPriority: ["Paladin", "Shaman"], count: 1 });
        expect(who(cr.expandClassRefs(out, [], [pal, sham], {}), "b")).toEqual(["user:sham"]);
    });
});
