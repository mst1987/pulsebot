// Giving roster slots to players (lib/rosterAssign.ts): assign, swap, clear, fill by role and class, candidates.
import { describe, expect, it } from "vitest";
import * as ra from "./rosterAssign";

const P = (userId, role, classId) => ({ userId, character: userId, role, classId, group: 1 });
const S = (id, kind, n, userId = "", extra = {}) => ({ id, kind, n, userId, x: 0.5, y: 0.5, label: "", placed: false, ...extra });
const board = (slots, over = {}) => ({ tokens: [], slots, marks: [], icons: [], zones: [], lines: [], texts: [], targets: [], assignments: [], notes: "", counts: null, roles: {}, mobs: [], hiddenCards: [], inheritOff: [], ...over });
const who = (b) => Object.fromEntries(b.slots.map((s) => [s.id, s.userId]));
const roster = [P("t1", "tank", "Warrior"), P("t2", "tank", "Druid"), P("h1", "healer", "Priest"), P("h2", "healer", "Paladin"), P("h3", "healer", "Druid"), P("m1", "melee", "Rogue"), P("r1", "ranged", "Mage")];

describe("assign and swap", () => {
    const b = board([S("t1s", "tank", 1, "t1"), S("h1s", "healer", 1, "h1"), S("h2s", "healer", 2, "h2"), S("h3s", "healer", 3)]);
    it("gives a free slot to a player and takes it from where he stood: he stands in one place", () => {
        const r = ra.assignOrSwap(b, "h3s", "h1");
        expect(who(r)).toEqual({ t1s: "t1", h1s: "", h2s: "h2", h3s: "h1" });
    });
    it("a player who already stands in another slot SWAPS with the slot's occupant instead of standing twice", () => {
        const r = ra.assignOrSwap(b, "h2s", "h1");
        expect(who(r)).toEqual({ t1s: "t1", h1s: "h2", h2s: "h1", h3s: "" });
        expect(new Set(Object.values(who(r)).filter(Boolean)).size).toBe(3);
    });
    it("a player from the not-placed list takes the slot and his free token goes", () => {
        const r = ra.assignOrSwap(board([S("h3s", "healer", 3, "h2")], { tokens: [{ userId: "h3", x: 0.1, y: 0.1 }] }), "h3s", "h3");
        expect(who(r)).toEqual({ h3s: "h3" });
        expect(r.tokens).toEqual([]);
    });
    it("clearing empties the slot; an unknown slot changes nothing", () => {
        expect(who(ra.assignOrSwap(b, "h1s", ""))).toMatchObject({ h1s: "" });
        expect(ra.assignOrSwap(b, "nope", "h3")).toBe(b);
        expect(who(ra.clearSlot(b, "t1s")).t1s).toBe("");
    });
    it("clear all empties the role slots only", () => {
        const c = board([S("a", "tank", 1, "t1"), S("g", "group", 1)]);
        expect(who(ra.clearAllSlots(c))).toEqual({ a: "", g: "" });
        expect(ra.clearAllSlots(board([S("l", "label", 1)])).slots[0].kind).toBe("label");
    });
});

describe("fill what is open", () => {
    it("fills only open slots, by role, and never touches a manual one", () => {
        const b = board([S("t1s", "tank", 1, "t2"), S("t2s", "tank", 2), S("h1s", "healer", 1), S("h2s", "healer", 2, "h3")]);
        const r = ra.fillOpenSlots(b, roster);
        expect(who(r)).toEqual({ t1s: "t2", t2s: "t1", h1s: "h1", h2s: "h3" });
    });
    it("a slot with a class comes before the ones without, takes that class only, and a missing class leaves it open", () => {
        const b = board([S("m1s", "melee", 1), S("m2s", "melee", 2, "", { preferredClasses: ["Rogue"] }), S("d1s", "dps", 1, "", { preferredClasses: ["Hunter"] })]);
        const r = ra.fillOpenSlots(b, roster);
        expect(who(r)).toEqual({ m1s: "", m2s: "m1", d1s: "" });
        expect(r.slots[1].byClass).toBe(true);
        expect(r.slots[0].byClass).toBeFalsy();
    });
    it("nothing to fill = the same board", () => {
        const b = board([S("t1s", "tank", 1, "t1")]);
        expect(ra.fillOpenSlots(b, roster.slice(0, 1))).toBe(b);
    });
    it("a flex role counts: a healer who plays DPS here fills a DPS slot, not a healer slot", () => {
        const b = board([S("h1s", "healer", 1), S("d1s", "dps", 1)], { roles: { h1: "dps" } });
        const r = ra.fillOpenSlots(b, [P("h1", "healer", "Priest")]);
        expect(who(r)).toEqual({ h1s: "", d1s: "h1" });
    });
});

describe("candidates of a slot", () => {
    const b = board([S("h1s", "healer", 1, "h1"), S("h2s", "healer", 2, "", { preferredClasses: ["Paladin", "Druid"] }), S("t1s", "tank", 1, "t1")]);
    it("the players of the slot's role come first (its classes first among them), then everybody else, each with where he stands now", () => {
        const c = ra.slotCandidates(b, b.slots[1], roster);
        expect(c.map((x) => x.player.userId).slice(0, 3)).toEqual(["h2", "h3", "h1"]);
        expect(c.filter((x) => x.fits).length).toBe(3);
        expect(c.find((x) => x.player.userId === "h1").at.id).toBe("h1s");
        expect(c.find((x) => x.player.userId === "m1").at).toBe(null);
        expect(c.length).toBe(roster.length);
    });
    it("a generic DPS slot fits every damage dealer, melee and ranged alike", () => {
        expect(ra.fitsSlot("dps", "melee")).toBe(true);
        expect(ra.fitsSlot("dps", "ranged")).toBe(true);
        expect(ra.fitsSlot("dps", "tank")).toBe(false);
        expect(ra.fitsSlot("melee", "ranged")).toBe(false);
    });
});

describe("classes on slots", () => {
    const b = board([S("a", "dps", 3), S("b", "dps", 4, "", { preferredClasses: ["Mage"] }), S("g", "group", 1)]);
    it("toggling adds a class in the order chosen and takes it away again", () => {
        const one = ra.toggleSlotClass(b, "a", "Rogue");
        const two = ra.toggleSlotClass(one, "a", "Mage");
        expect(two.slots[0].preferredClasses).toEqual(["Rogue", "Mage"]);
        expect(ra.toggleSlotClass(two, "a", "Rogue").slots[0].preferredClasses).toEqual(["Mage"]);
    });
    it("a row's classes go to the slots it names, roles only", () => {
        const r = ra.bindClassesToSlots(b, ["slot:dps:3", "slot:group:1", "user:x"], ["Rogue"]);
        expect(r.slots.map((s) => s.preferredClasses || [])).toEqual([["Rogue"], ["Mage"], []]);
    });
    it("says filled / open / missing / nothing", () => {
        const bound = { ...S("x", "dps", 1, "", { preferredClasses: ["Rogue"] }) };
        expect(ra.classStatus(bound, roster, board([bound]))).toBe("open");
        expect(ra.classStatus({ ...bound, preferredClasses: ["Hunter"] }, roster, board([bound]))).toBe("missing");
        expect(ra.classStatus({ ...bound, userId: "m1" }, roster, board([bound]))).toBe("filled");
        expect(ra.classStatus(S("y", "dps", 2), roster, board([bound]))).toBe("");
        const taken = board([bound, S("z", "melee", 1, "m1")]);
        expect(ra.classStatus(bound, roster, taken)).toBe("missing");
    });
});

describe("classes of a row, precedence and re-assigning by class", () => {
    const b = board([S("d3", "dps", 3, "", { preferredClasses: ["Rogue"] }), S("d4", "dps", 4)]);
    it("the classes of the slots a row names win over the row's own classes; none = the row's", () => {
        expect(ra.slotClassesOfRow(b, { assignees: ["slot:dps:3", "user:x"] })).toEqual(["Rogue"]);
        expect(ra.effectiveClasses(b, { assignees: ["slot:dps:3"], preferredClasses: ["Mage"] })).toEqual(["Rogue"]);
        expect(ra.effectiveClasses(b, { assignees: ["slot:dps:4"], preferredClasses: ["Mage"] })).toEqual(["Mage"]);
        expect(ra.effectiveClasses(b, { assignees: ["slot:dps:4"] })).toEqual([]);
    });
    it("re-assigning by class empties wrong or class-placed slots and fills again", () => {
        const x = board([S("a", "melee", 1, "r1", { preferredClasses: ["Rogue"] })]);
        const rr = [P("m1", "melee", "Rogue"), P("r1", "melee", "Warrior")];
        expect(who(ra.refillByClass(x, rr))).toEqual({ a: "m1" });
        const y = board([S("a", "melee", 1, "m1", { preferredClasses: ["Rogue"], byClass: true }), S("b", "melee", 2, "", { preferredClasses: ["Rogue"] })]);
        expect(who(ra.refillByClass(y, [P("m1", "melee", "Rogue")]))).toEqual({ a: "m1", b: "" });
    });
});
