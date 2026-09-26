// The row dialog "Variante B" (lib/raidplan/assignModal.ts) and the row container (lib/raidplan/assignLine.ts), run for real: categories per slot, the
// people list (slots and players in ONE list, grouped tank / healer / DPS, search and filter), the counters, the class counts, the
// preview lines, the row states and the card counter.
import { describe, expect, it } from "vitest";
import * as cr from "./classRefs";
import * as assign from "./assign";
import * as am from "./assignModal";
import * as al from "./assignLine";
import { requireBackend } from "../../test/backend";

const P = (userId, classId, role, group = 1) => ({ userId, character: userId, classId, className: classId, classColor: "#fff", spec: "", role, group });
const roster = [P("war", "Warrior", "tank"), P("bear", "Druid", "tank"), P("holy", "Paladin", "healer"), P("resto", "Shaman", "healer", 2), P("h1", "Hunter", "ranged", 2), P("rog", "Rogue", "melee", 3)];
const slots = [
    { kind: "tank", n: 1, userId: "war" }, { kind: "tank", n: 2, userId: "bear" }, { kind: "healer", n: 1, userId: "holy" }, { kind: "healer", n: 2, userId: "" },
    { kind: "dps", n: 1, userId: "h1" }, { kind: "melee", n: 1, userId: "rog" }, { kind: "group", n: 1, userId: "" },
];
const players = new Map(roster.map((p) => [p.userId, p]));
const ctx = { slots, players };
const row = (over) => ({ id: "r", type: "md", title: "", spell: null, assignees: [], targets: [], note: "", suggested: false, ...over });

describe("categories of the assignment bar", () => {
    it("who = people and classes; task = spells (when there are any) and free text", () => {
        expect(am.categoriesFor("who", "heal", true, true)).toEqual(["people", "classes", "roles"]);
        expect(am.categoriesFor("task", "md", false, true)).toEqual(["spells", "text"]);
        expect(am.categoriesFor("task", "other", false, false)).toEqual(["text"]);
    });
    it("at whom: mobs first for tanking / kicks / CC when the section has mobs, never an empty mob category", () => {
        expect(am.categoriesFor("at", "tank", true, false)[0]).toBe("mobs");
        expect(am.categoriesFor("at", "heal", true, false)).toEqual(["people", "groups", "roles", "classes", "marks", "mobs", "text"]);
        expect(am.categoriesFor("at", "heal", false, false)).not.toContain("mobs");
        expect(am.firstCategory("at", "kick", true, false)).toBe("mobs");
    });
    it("the next slot goes round (Tab / arrows)", () => {
        expect(am.nextSlot("who", 1)).toBe("at");
        expect(am.nextSlot("task", 1)).toBe("who");
        expect(am.nextSlot("who", -1)).toBe("task");
    });
});

describe("people: role slots and players in one list", () => {
    it("slot mode: tank, healer, DPS groups; a filled slot is named by its player, an open one keeps its kind; group markers are no people", () => {
        const list = am.peopleEntries(slots, roster, "slot", "who");
        expect(list.map((e) => [e.key, e.group, e.label])).toEqual([
            ["slot:tank:1", "tank", "war"], ["slot:tank:2", "tank", "bear"], ["slot:healer:1", "healer", "holy"], ["slot:healer:2", "healer", ""],
            ["slot:melee:1", "dps", "rog"], ["slot:dps:1", "dps", "h1"],
        ]);
        expect(am.peopleEntries(slots, roster, "slot", "at")[0].key).toBe("slot|tank:1");
    });
    it("player mode: fixed players by their spec role, keys as assignee or target", () => {
        const list = am.peopleEntries(slots, roster, "player", "who");
        expect(list.map((e) => e.key)).toEqual(["user:war", "user:bear", "user:holy", "user:resto", "user:h1", "user:rog"]);
        expect(am.peopleEntries(slots, roster, "player", "at")[3].key).toBe("player|resto");
    });
    it("filter tabs and the search (name, class, slot kind)", () => {
        const list = am.peopleEntries(slots, roster, "player", "who");
        expect(am.filterPeople(list, "healer", "").map((e) => e.label)).toEqual(["holy", "resto"]);
        expect(am.filterPeople(list, "all", "HUN").map((e) => e.label)).toEqual(["h1"]);
        expect(am.filterPeople(list, "tank", "rog")).toEqual([]);
        expect(am.peopleGroups(am.filterPeople(list, "dps", "")).map((g) => g.group)).toEqual(["dps"]);
    });
});

describe("what a slot holds, the counters", () => {
    const r = row({ assignees: ["slot:tank:1", "class:Hunter:1", "user:rog"], targets: [{ kind: "group", ref: "2" }, { kind: "mark", ref: "skull" }, { kind: "class", ref: "Priest:1" }], spell: { id: "d:md", name: "Misdirection", icon: "x" }, title: "Pull" });
    it("chosen keys per slot", () => {
        expect(am.chosenKeys(r, "who")).toEqual(["slot:tank:1", "class:Hunter:1", "user:rog"]);
        expect(am.chosenKeys(r, "at")).toEqual(["group|2", "mark|skull", "class|Priest:1"]);
        expect(am.chosenKeys(r, "task")).toEqual(["d:md"]);
    });
    it("the navigation counts chosen entries per category", () => {
        expect(am.chosenCounts(r, "who")).toEqual({ people: 2, classes: 1 });
        expect(am.chosenCounts(r, "at")).toEqual({ groups: 1, marks: 1, classes: 1 });
        expect(am.chosenCounts(r, "task")).toEqual({ spells: 1, text: 1 });
    });
    it("a class tile counts the raiders of the class for the role (a flex role counts)", () => {
        expect(am.classCount(roster, "Paladin", "healer", {})).toBe(1);
        expect(am.classCount(roster, "Paladin", "tank", {})).toBe(0);
        expect(am.classCount(roster, "Any", "tank", {})).toBe(2);
        expect(am.classCount(roster, "Paladin", "tank", { holy: "tank" })).toBe(1);
        expect(am.CLASS_ROLE_CHOICES.Hunter).toEqual([]);
        expect(am.CLASS_ROLE_CHOICES.Paladin).toEqual(["tank", "healer", "dps"]);
    });
});

describe("the preview: one line per assignee, the open place as its one mark", () => {
    it("resolved and open places", () => {
        const r = row({ assignees: ["class:Hunter:1", "class:Hunter:2"], targets: [{ kind: "slot", ref: "tank:1" }] });
        const filled = cr.expandClassRefs([r], slots, roster, {})[0];
        const lines = am.previewLines(r, filled, ctx);
        expect(lines.map((l) => am.previewText(l, "offen"))).toEqual(["h1 -> war", "Jäger 2 (offen) -> war"]);
        expect(lines.map((l) => l.open)).toEqual([false, true]);
        expect(lines.map((l) => l.order)).toEqual([1, 2]);
    });
});

describe("class role filter in a row", () => {
    it("moves the count of a class to another role with fresh numbers", () => {
        const list = [row({ id: "a", type: "heal", assignees: ["class:Priest:1", "class:Priest:2"] })];
        expect(cr.setClassRole(list, "a", "Priest", "", "healer", false)[0].assignees).toEqual(["class:Priest:1:healer", "class:Priest:2:healer"]);
        expect(cr.setClassRole(list, "a", "Priest", "", "", false)).toBe(list);
    });
});

describe("the row container", () => {
    it("brackets a class with a count ('Jäger x2') and keeps single references as one chip", () => {
        const r = row({ assignees: ["class:Hunter:1", "user:rog", "class:Hunter:2"], targets: [{ kind: "slot", ref: "tank:1" }] });
        const filled = cr.expandClassRefs([r], slots, roster, {})[0];
        const items = al.assigneeItems(r, filled, ctx, [], false, true);
        expect(items.map((x) => [x.kind, x.count])).toEqual([["ref", 2], ["one", 1]]);
        expect(items[0].items.map((x) => (x.player ? x.player.userId : x.label))).toEqual(["h1", "Jäger 2"]);
        expect(items[0].open).toBe(true);
        expect(al.lineState(r, filled, ctx, true)).toBe("open");
    });
    it("states: empty, open (a class nobody fills, an open slot in an event), ok; a template's open slot is only a placeholder", () => {
        expect(al.lineState(row({}), row({}), ctx, true)).toBe("empty");
        const ok = row({ assignees: ["slot:tank:1"], targets: [{ kind: "group", ref: "1" }] });
        expect(al.lineState(ok, ok, ctx, true)).toBe("ok");
        const openSlot = row({ assignees: ["slot:healer:2"], targets: [] });
        expect(al.lineState(openSlot, openSlot, ctx, true)).toBe("open");
        expect(al.lineState(openSlot, openSlot, { slots: [], players: new Map() }, false)).toBe("ok");
    });
    it("the card counter, the rotation numbers, the 'DU' of the viewer and the small line", () => {
        const rows = [row({ id: "a", assignees: ["user:war"] }), row({ id: "b", assignees: ["class:Mage:1"] }), row({ id: "c" })];
        expect(al.cardSummary(rows, cr.expandClassRefs(rows, slots, roster, {}), ctx, true)).toEqual({ rows: 3, open: 1 });
        const kick = row({ type: "kick", assignees: ["user:rog", "user:war"] });
        expect(al.assigneeItems(kick, kick, ctx, ["war"], true, true).map((x) => [x.order, x.mine])).toEqual([[1, false], [2, true]]);
        expect(al.subLine(row({ spell: { id: "d:x", name: "Misdirection", icon: "" }, title: "Pull", note: "vor dem Pull" }))).toEqual(["Misdirection", "Pull", "vor dem Pull"]);
        expect(al.subLine(row({}))).toEqual([]);
        const a = row({ assignees: ["user:war"], targets: [{ kind: "group", ref: "3" }] });
        expect(al.lineLabel("Heilen", al.assigneeItems(a, a, ctx, [], false, true), al.targetItems(a, a, ctx, [], true), "offen")).toBe("Heilen: war -> Gruppe 3");
    });
});

describe("a class of any spec (a mage tank) and missing classes", () => {
    const raid = [...roster, P("mage", "Mage", "ranged", 4)];
    it("the role a tile adds: a non-tank class on a tanking row is any spec, a tank class keeps the tank role, healing its healers", () => {
        expect(cr.defaultClassRole("Mage", "tank")).toBe("any");
        expect(cr.defaultClassRole("Warrior", "tank")).toBe("");
        expect(cr.defaultClassRole("Priest", "heal")).toBe("");
        expect(cr.defaultClassRole("Hunter", "md")).toBe("");
        expect(cr.effectiveRole("", "heal")).toBe("healer");
        expect(cr.effectiveRole("", "md")).toBe("any");
        expect(cr.effectiveRole("any", "tank")).toBe("any");
        expect(cr.storedRole("any", "md")).toBe("");
        expect(cr.storedRole("any", "heal")).toBe("any");
        expect(cr.storedRole("tank", "tank")).toBe("tank");
    });
    it("names it as the row does: 'Magier-Tank', 'Magier (alle Specs)' elsewhere; a player outside his spec role on a tanking row is 'als Tank'", () => {
        expect(assign.classPlaceNameFor("Mage", "any", "tank")).toBe("Magier-Tank");
        expect(assign.classRefLabelFor("class:Mage:1:any", "tank")).toBe("Magier-Tank 1");
        expect(assign.classPlaceNameFor("Mage", "any", "heal")).toBe("Magier (alle Specs)");
        expect(assign.classPlaceNameFor("Warrior", "tank", "tank")).toBe("Tank (Krieger)");
        expect(assign.offRole("tank", raid[6])).toBe(true);
        expect(assign.offRole("tank", raid[0])).toBe(false);
        expect(assign.offRole("heal", raid[6])).toBe(false);
    });
    it("the row: a resolved mage tank carries 'als Tank', a missing mage is an open 'Magier-Tank 1'", () => {
        const r = row({ type: "tank", assignees: ["class:Mage:1:any"], targets: [{ kind: "mob", ref: "d:zerevor", name: "Zerevor", icon: "" }] });
        const ctxRaid = { slots, players: new Map(raid.map((p) => [p.userId, p])) };
        const filled = cr.expandClassRefs([r], slots, raid, {})[0];
        const items = al.assigneeItems(r, filled, ctxRaid, [], false, true);
        expect(items[0]).toMatchObject({ asTank: true, open: false });
        expect(items[0].r.player.userId).toBe("mage");
        const none = al.assigneeItems(r, r, ctx, [], false, true);
        expect(none[0].r.label).toBe("Magier-Tank 1");
        expect(none[0].open).toBe(true);
        expect(am.previewLines(r, r, ctx).map((l) => am.previewText(l, "offen"))).toEqual(["Magier-Tank 1 (offen) -> Zerevor"]);
    });
    it("plan-wide: every row with a missing place, per section, with what is missing; the names for the summary", () => {
        const b1 = { slots, roles: {}, assignments: [row({ id: "a", type: "tank", assignees: ["class:Mage:1:any"] }), row({ id: "b", type: "md", assignees: ["class:Hunter:1", "class:Hunter:2"] })] };
        const b2 = { slots, roles: {}, assignments: [row({ id: "c", type: "heal", assignees: ["slot:healer:1"] })] };
        const open = al.openAssignments([{ key: "k1", name: "Council", board: b1 }, { key: "k2", name: "Supremus", board: b2 }, { key: "k3", name: "Leer", board: null }], roster);
        expect(open).toEqual([
            { key: "k1", name: "Council", rowId: "a", type: "tank", missing: ["Magier-Tank"] },
            { key: "k1", name: "Council", rowId: "b", type: "md", missing: ["Jäger"] },
        ]);
        expect(al.missingNames(open)).toEqual(["Magier-Tank", "Jäger"]);
        expect(al.openAssignments([{ key: "k1", name: "Council", board: b1 }], raid)).toHaveLength(1);
    });
    it("the client and the server resolve 'any' alike", () => {
        const server = requireBackend("services/raidplan/raidplanAssign");
        const list = [row({ id: "a", type: "tank", assignees: ["class:Mage:1:any", "class:Warrior:1"] }), row({ id: "b", type: "heal", assignees: ["class:Paladin:1:any"] })];
        expect(cr.expandClassRefs(list, [], raid, {})).toEqual(server.expandClassRefs(list, [], raid, {}));
    });
});
