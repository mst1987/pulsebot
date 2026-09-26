// A template slot that asks for a class (preferredClasses) and the ring of a split group: validation, and the auto-fill by class.
const board = require("../../../src/services/raidplan/raidplanBoard");

const P = (userId, role, classId, group = 1) => ({ userId, role, classId, group });
const S = (kind, n, extra = {}) => ({ kind, n, userId: "", ...extra });
const roster = [
    P("t1", "tank", "Warrior"), P("h1", "healer", "Priest"), P("h2", "healer", "Paladin"),
    P("m1", "melee", "Warrior", 2), P("r1", "melee", "Rogue", 2), P("r2", "melee", "Rogue", 3), P("l1", "ranged", "Warlock", 3), P("l2", "ranged", "Mage", 3),
];
const ids = (slots) => slots.map((s) => `${s.kind}${s.n}=${s.userId || "-"}`);

describe("validation", () => {
    const clean = (slot) => board.cleanBoard({ slots: [slot] }, { allowedUserIds: [] }).board.slots[0];
    it("a role slot keeps known classes in order, once each; other slots and unknown classes get none", () => {
        expect(clean({ kind: "dps", n: 3, preferredClasses: ["Rogue", "Rogue", "Banana", "Mage", 4] }).preferredClasses).toEqual(["Rogue", "Mage"]);
        expect(clean({ kind: "group", n: 1, preferredClasses: ["Rogue"] }).preferredClasses).toEqual([]);
        expect(clean({ kind: "label", n: 1, label: "x", preferredClasses: ["Rogue"] }).preferredClasses).toEqual([]);
        expect(clean({ kind: "tank", n: 1 }).preferredClasses).toEqual([]);
        expect(clean({ kind: "dps", n: 1, byClass: true }).byClass).toBe(true);
        expect(clean({ kind: "group", n: 1, byClass: true }).byClass).toBe(false);
    });
    it("the ring of a group: shown by default, own colour and opacity validated; the board can switch all rings off", () => {
        const g = clean({ kind: "group", n: 1 });
        expect(g).toMatchObject({ showRing: true, ringColor: "", ringOpacity: 0.55 });
        expect(clean({ kind: "group", n: 1, showRing: false, ringColor: "#AA00ff", ringOpacity: 0.3 })).toMatchObject({ showRing: false, ringColor: "#aa00ff", ringOpacity: 0.3 });
        expect(clean({ kind: "group", n: 1, ringColor: "red", ringOpacity: "x" })).toMatchObject({ ringColor: "", ringOpacity: 0.55 });
        expect(board.cleanBoard({}, { allowedUserIds: [] }).board.showRings).toBe(true);
        const off = board.cleanBoard({ showRings: false }, { allowedUserIds: [] }).board;
        expect(off.showRings).toBe(false);
        expect(board.boardHasContent(off)).toBe(true);
    });
});

describe("fillSlots by class", () => {
    it("without any wish it works as before", () => {
        const out = board.fillSlots([S("tank", 1), S("healer", 1), S("healer", 2), S("melee", 1), S("ranged", 1), S("dps", 1)], roster);
        expect(ids(out)).toEqual(["tank1=t1", "healer1=h1", "healer2=h2", "melee1=m1", "ranged1=l1", "dps1=r1"]);
        expect(out.every((s) => !s.byClass)).toBe(true);
    });
    it("a slot with a class takes the first player of that class and role, and says it was filled by class", () => {
        const out = board.fillSlots([S("melee", 1), S("melee", 2, { preferredClasses: ["Rogue"] })], roster);
        expect(ids(out)).toEqual(["melee1=m1", "melee2=r1"]);
        expect(out[1].byClass).toBe(true);
        expect(out[0].byClass).toBeUndefined();
    });
    it("bound slots come first: an unbound slot before them never eats their player", () => {
        const out = board.fillSlots([S("melee", 1), S("melee", 2, { preferredClasses: ["Warrior"] })], [P("m1", "melee", "Warrior"), P("r1", "melee", "Rogue")]);
        expect(ids(out)).toEqual(["melee1=r1", "melee2=m1"]);
    });
    it("the order of the classes is the priority, and one player only fills one slot", () => {
        const out = board.fillSlots([S("ranged", 1, { preferredClasses: ["Mage", "Warlock"] }), S("ranged", 2, { preferredClasses: ["Mage", "Warlock"] }), S("ranged", 3, { preferredClasses: ["Mage"] })], roster);
        expect(ids(out)).toEqual(["ranged1=l2", "ranged2=l1", "ranged3=-"]);
        expect(new Set(out.map((s) => s.userId).filter(Boolean)).size).toBe(2);
    });
    it("a class that is not in the raid leaves the slot open, and a stranger never takes it, even when players are left over", () => {
        const out = board.fillSlots([S("dps", 1, { preferredClasses: ["Hunter"] }), S("dps", 2)], roster);
        expect(out[0].userId).toBe("");
        expect(out[0].byClass).toBeUndefined();
        expect(out[1].userId).not.toBe("");
    });
    it("only players of the slot's role count: a tank slot for a Warrior takes the tank Warrior, not the melee one", () => {
        const out = board.fillSlots([S("tank", 1, { preferredClasses: ["Warrior"] }), S("melee", 1, { preferredClasses: ["Warrior"] })], roster);
        expect(ids(out)).toEqual(["tank1=t1", "melee1=m1"]);
        expect(board.fillSlots([S("healer", 1, { preferredClasses: ["Warrior"] })], roster)[0].userId).toBe("");
    });
    it("a generic DPS slot takes any damage dealer of its class (melee or ranged), and a slot that already has a player is left alone", () => {
        const out = board.fillSlots([S("dps", 1, { preferredClasses: ["Warlock"] }), S("dps", 2, { userId: "r1" })], roster);
        expect(ids(out)).toEqual(["dps1=l1", "dps2=r1"]);
    });
    it("several bound slots of one class are filled in slot order with different players", () => {
        const out = board.fillSlots([S("melee", 4, { preferredClasses: ["Rogue"] }), S("melee", 3, { preferredClasses: ["Rogue"] })], roster);
        expect(ids(out)).toEqual(["melee4=r2", "melee3=r1"]);
    });
});
