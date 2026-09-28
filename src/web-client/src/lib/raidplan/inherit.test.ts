// The Standard of a template (lib/raidplan/inherit.ts): inherited, deviated, switched off, the relative boss target, copy to all.
import { describe, expect, it } from "vitest";
import * as inh from "./inherit";
import { requireBackend } from "../../test/backend";

const server = requireBackend("services/raidplan/raidplanInherit");

const row = (id, type, assignees, targets, extra = {}) => ({ id, type, title: "", spell: null, assignees, targets, note: "", suggested: true, ...extra });
const board = (over = {}) => ({ tokens: [], slots: [], marks: [], icons: [], zones: [], lines: [], texts: [], targets: [], assignments: [], notes: "", counts: null, roles: {}, mobs: [], hiddenCards: [], inheritOff: [], ...over });
const mob = (id, name, icon = "") => ({ id, name, icon });
const boss = (key, name) => ({ bossMob: mob(`b:${key}`, name, "boss:601"), mobs: [mob(`b:${key}`, name, "boss:601"), mob("d:gathios", "Gathios", "mob:22949")] });
const trash = { bossMob: null, mobs: [mob("d:trash-1", "Trash 1")] };

const defaults = [
    row("d1", "tank", ["slot:tank:1"], [{ kind: "mob", ref: "b:this", name: "Boss (dieser Abschnitt)", icon: "" }]),
    row("d2", "tank", ["slot:tank:2"], [{ kind: "mob", ref: "d:gathios", name: "Gathios", icon: "" }, { kind: "mob", ref: "d:nope", name: "Nope", icon: "" }, { kind: "mark", ref: "skull" }]),
    row("d3", "heal", ["slot:healer:1"], [{ kind: "slot", ref: "tank:1" }, { kind: "group", ref: "2" }]),
];

describe("what a section inherits", () => {
    it("every default row, with the target 'Boss' becoming the boss of THIS section", () => {
        const a = inh.inheritedRows(defaults, [], boss("bt/supremus", "Supremus"));
        const b = inh.inheritedRows(defaults, [], boss("bt/gurtogg", "Gurtogg"));
        expect(a).toHaveLength(3);
        expect(a[0].targets[0]).toEqual({ kind: "mob", ref: "b:bt/supremus", name: "Supremus", icon: "boss:601" });
        expect(b[0].targets[0].ref).toBe("b:bt/gurtogg");
        expect(a[0].id).toBe("d1");
        expect(a[0].origin).toBe("d1");
        expect(a[0].suggested).toBe(false);
    });
    it("a mob the section lacks falls back to no target, other kinds of target stay, nothing throws", () => {
        const a = inh.inheritedRows(defaults, [], boss("bt/supremus", "Supremus"));
        expect(a[1].targets.map((t) => t.ref)).toEqual(["d:gathios", "skull"]);
        const t = inh.inheritedRows(defaults, [], trash);
        expect(t[0].targets).toEqual([]);
        expect(t[1].targets.map((x) => x.ref)).toEqual(["skull"]);
        expect(t[2].targets).toHaveLength(2);
    });
    it("a row switched off for the boss is not inherited, the others are", () => {
        expect(inh.inheritedRows(defaults, ["d2"], boss("bt/x", "X")).map((r) => r.id)).toEqual(["d1", "d3"]);
    });
    it("changing the Standard changes what a boss inherits, but not a boss that deviated", () => {
        const changed = [{ ...defaults[0], assignees: ["slot:tank:3"] }, defaults[1], defaults[2]];
        const s = boss("bt/x", "X");
        const dev = inh.deviate(board(), inh.inheritedRows(defaults, [], s)[0]);
        expect(inh.inheritedRows(changed, [], s)[0].assignees).toEqual(["slot:tank:3"]);
        expect(inh.inheritedRows(changed, dev.inheritOff, s).map((r) => r.id)).toEqual(["d2", "d3"]);
        expect(dev.assignments[0].assignees).toEqual(["slot:tank:1"]);
    });
});

describe("deviating, switching off, restoring", () => {
    const s = boss("bt/x", "X");
    it("deviating makes an own copy with a new id that remembers the default, and switches the default off", () => {
        const b = inh.deviate(board(), inh.inheritedRows(defaults, [], s)[0]);
        expect(b.assignments).toHaveLength(1);
        expect(b.assignments[0].id).not.toBe("d1");
        expect(b.assignments[0].origin).toBe("d1");
        expect(b.assignments[0].targets[0].ref).toBe("b:bt/x");
        expect(b.inheritOff).toEqual(["d1"]);
        expect(inh.isDeviation(b.assignments[0])).toBe(true);
        expect(inh.isDeviation({ origin: "default" })).toBe(false);
        expect(inh.isDeviation({ origin: "" })).toBe(false);
    });
    it("switching off is once per row, and it is only a default that goes", () => {
        const b = inh.hideInherited(inh.hideInherited(board(), "d2"), "d2");
        expect(b.inheritOff).toEqual(["d2"]);
    });
    it("restoring a card type brings its default rows back and removes the boss's copies of them, other types stay", () => {
        let b = board({ assignments: [row("own", "kick", ["slot:tank:1"], [])] });
        b = inh.deviate(b, inh.inheritedRows(defaults, [], s)[0]);
        b = inh.hideInherited(b, "d3");
        expect(inh.canRestore(b, defaults, "tank")).toBe(true);
        expect(inh.canRestore(b, defaults, "kick")).toBe(false);
        const r = inh.restoreInherited(b, defaults, "tank");
        expect(r.assignments.map((a) => a.id)).toEqual(["own"]);
        expect(r.inheritOff).toEqual(["d3"]);
        expect(inh.restoreInherited(b, defaults, "").inheritOff).toEqual([]);
    });
    it("a board differs from the Standard when it deviated or switched something off", () => {
        expect(inh.differs(board())).toBe(false);
        expect(inh.differs(undefined)).toBe(false);
        expect(inh.differs(board({ inheritOff: ["d1"] }))).toBe(true);
        expect(inh.differs(board({ assignments: [row("x", "tank", [], [], { origin: "d1" })] }))).toBe(true);
        expect(inh.differs(board({ assignments: [row("x", "tank", [], [], { origin: "default" })] }))).toBe(false);
    });
});

describe("copy to all", () => {
    const sections = { "bt/a": boss("bt/a", "A"), "bt/b": boss("bt/b", "B"), "bt/trash": trash };
    it("writes the rows into every boss that does not differ, resolved for it, and switches the inherited ones off", () => {
        const r = inh.copyDefaultsToAll({}, defaults, sections);
        expect(Object.keys(r).sort()).toEqual(["bt/a", "bt/b", "bt/trash"]);
        expect(r["bt/a"].assignments).toHaveLength(3);
        expect(r["bt/a"].assignments[0].targets[0].ref).toBe("b:bt/a");
        expect(r["bt/b"].assignments[0].targets[0].ref).toBe("b:bt/b");
        expect(r["bt/trash"].assignments[0].targets).toEqual([]);
        expect(r["bt/a"].inheritOff).toEqual(["d1", "d2", "d3"]);
        expect(r["bt/a"].assignments.every((a) => a.origin === "default")).toBe(true);
        expect(new Set(r["bt/a"].assignments.map((a) => a.id)).size).toBe(3);
    });
    it("leaves a boss that deviates alone and keeps the own rows of the others", () => {
        const dev = board({ inheritOff: ["d1"], assignments: [row("mine", "tank", ["slot:tank:9"], [], { origin: "d1" })] });
        const own = board({ assignments: [row("kick1", "kick", ["slot:tank:1"], [])] });
        const r = inh.copyDefaultsToAll({ "bt/a": dev, "bt/b": own }, defaults, sections);
        expect(r["bt/a"]).toBe(dev);
        expect(r["bt/b"].assignments[0].id).toBe("kick1");
        expect(r["bt/b"].assignments).toHaveLength(4);
    });
});

describe("the effective rows of a section (#524: event plans and templates alike)", () => {
    const own = (id, extra = {}) => row(id, "kick", ["slot:dps:1"], [], { suggested: false, ...extra });
    it("the Standard first in its order, then the own rows; a deviation in the place of its default; a hidden row left out", () => {
        const b = board({ assignments: [own("o1"), own("x", { type: "tank", origin: "d2" })], inheritOff: ["d2", "d3"] });
        expect(inh.mergeInherited(defaults, b, boss("bt/supremus", "Supremus")).map((a) => a.id)).toEqual(["d1", "x", "o1"]);
        const plain = inh.mergeInherited(defaults, board({ assignments: [own("o1")] }), boss("bt/supremus", "Supremus"));
        expect(plain.map((a) => a.id)).toEqual(["d1", "d2", "d3", "o1"]);
        expect(plain[0]).toMatchObject({ origin: "d1", suggested: false, targets: [{ ref: "b:bt/supremus" }] });
    });
    it("only boss and trash sections inherit; 'Allgemein' and the Standard keep their own rows", () => {
        const bosses = { defaults: board({ assignments: defaults }), general: board({ assignments: [own("g")] }), "bt/trash": board() };
        expect(inh.effectiveRows(bosses, "general", trash).map((a) => a.id)).toEqual(["g"]);
        expect(inh.effectiveRows(bosses, "defaults", trash).map((a) => a.id)).toEqual(["d1", "d2", "d3"]);
        expect(inh.effectiveRows(bosses, "bt/trash", trash).map((a) => a.targets.length)).toEqual([0, 1, 2]);
        expect(inh.effectiveRows(bosses, "bt/supremus", boss("bt/supremus", "Supremus"))).toHaveLength(3);
        expect(["bt/supremus", "bt/trash", "general", "defaults"].map(inh.inherits)).toEqual([true, true, false, false]);
    });
    it("a change of the Standard reaches every section that did not deviate; a deviated one keeps its row", () => {
        const swapped = defaults.map((d) => (d.id === "d3" ? { ...d, assignees: ["slot:healer:4"] } : d));
        const dev = board({ assignments: [own("mine", { type: "heal", assignees: ["slot:healer:2"], origin: "d3" })], inheritOff: ["d3"] });
        const bosses = { defaults: board({ assignments: swapped }), "bt/supremus": board(), "bt/gurtogg": dev };
        expect(inh.effectiveRows(bosses, "bt/supremus", boss("bt/supremus", "Supremus")).find((a) => a.type === "heal")?.assignees).toEqual(["slot:healer:4"]);
        expect(inh.effectiveRows(bosses, "bt/gurtogg", boss("bt/gurtogg", "Gurtogg")).find((a) => a.type === "heal")?.assignees).toEqual(["slot:healer:2"]);
    });
    it("is the twin of the server's mergeRows / effectiveRows: the same rows in the same order for the same boards", () => {
        const sections = { "bt/supremus": boss("bt/supremus", "Supremus"), "bt/trash": trash, general: trash };
        const serverSection = (s) => ({ bossMob: s.bossMob, mobs: new Map(s.mobs.map((m) => [m.id, m])) });
        const bosses = {
            defaults: board({ assignments: defaults }),
            "bt/supremus": board({ assignments: [own("o1"), own("x", { type: "tank", origin: "d2" })], inheritOff: ["d2"] }),
            "bt/trash": board({ inheritOff: ["d3"] }),
            general: board({ assignments: [own("g")] }),
        };
        for (const key of Object.keys(sections)) {
            const client = inh.effectiveRows(bosses, key, sections[key]);
            const srv = server.effectiveRows(bosses, key, serverSection(sections[key]));
            expect(client).toEqual(srv);
        }
    });
});
