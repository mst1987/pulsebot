// The Besetzung: the role slots a raid type has, derived from instances and size (tanks and healers are
// known, the DPS is what is left, melee / ranged are optional); the raid type of a template; slots that
// are not on the map yet; flex roles; the old task rows read as assignments.
const bes = require("../../src/web/raidplanBesetzung");
const board = require("../../src/web/raidplanBoard");
const assign = require("../../src/web/raidplanAssign");
const raidplan = require("../../src/web/raidplan");
const templateStore = require("../../src/stores/raidplanTemplateStore");
const { tempStoreFile } = require("../helpers/tempStore");

describe("defaultBesetzung", () => {
    it("Black Temple with 25: 3 tanks, 7 healers, the 15 that are left are DPS (no melee / ranged split), five groups", () => {
        expect(bes.defaultBesetzung(["bt"], 25)).toEqual({ size: 25, counts: { tank: 3, healer: 7, dps: 15, melee: 0, ranged: 0 }, groups: 5, split: false });
    });
    it("takes the instance's own size when none is given and adds up to the size", () => {
        const b = bes.defaultBesetzung(["bt"], 0);
        expect(b.size).toBe(25);
        expect(b.counts.tank + b.counts.healer + b.counts.dps).toBe(25);
    });
    it("a 10 player raid and a 40 player one", () => {
        const ten = bes.defaultBesetzung(["kara"], 10);
        expect(ten.groups).toBe(2);
        expect(ten.counts.tank + ten.counts.healer + ten.counts.dps).toBe(10);
        const forty = bes.defaultBesetzung(["mc"], 40);
        expect(forty.counts).toMatchObject({ tank: 3, healer: 10, dps: 27 });
        expect(forty.groups).toBe(8);
    });
    it("an unknown instance and a silly size fall back to 25", () => {
        expect(bes.defaultBesetzung(["nope"], 999).size).toBe(25);
        expect(bes.defaultBesetzung(undefined, -3).size).toBe(25);
    });
});

describe("counts", () => {
    it("whole numbers 0..40, null for nothing", () => {
        expect(bes.cleanCounts({ tank: "3", healer: 99, dps: 10, melee: -2, ranged: 1.7 })).toEqual({ tank: 3, healer: 40, dps: 10, melee: 0, ranged: 1 });
        expect(bes.cleanCounts(null)).toBeNull();
        expect(bes.cleanCounts([1])).toBeNull();
    });
    it("an older object without dps: its melee + ranged are the DPS, so every slot that existed still exists", () => {
        const c = bes.cleanCounts({ tank: 3, healer: 7, melee: 8, ranged: 7 });
        expect(c).toEqual({ tank: 3, healer: 7, dps: 15, melee: 8, ranged: 7 });
        expect(bes.slotCounts(c)).toEqual({ tank: 3, healer: 7, dps: 0, melee: 8, ranged: 7 });
    });
    it("melee + ranged never exceed the DPS; the rest of a split is 'DPS n'", () => {
        expect(bes.cleanCounts({ tank: 2, healer: 6, dps: 5, melee: 4, ranged: 4 }).dps).toBe(8);
        expect(bes.slotCounts(bes.cleanCounts({ tank: 3, healer: 7, dps: 15, melee: 5, ranged: 4 }))).toEqual({ tank: 3, healer: 7, dps: 6, melee: 5, ranged: 4 });
    });
    it("effective Besetzung: the plan's own counts, else the raid type's; split is only on when somebody split", () => {
        const own = bes.effectiveBesetzung(["bt"], 25, { tank: 2, healer: 6, dps: 17 });
        expect(own.counts.tank).toBe(2);
        expect(own.split).toBe(false);
        expect(bes.effectiveBesetzung(["bt"], 25, { tank: 2, healer: 6, dps: 17, melee: 9 }).split).toBe(true);
        expect(bes.effectiveBesetzung(["bt"], 25, null).counts.tank).toBe(3);
    });
});

describe("slots, counts and flex roles on a board", () => {
    it("a slot is on the map unless placed is false; counts are cleaned or null", () => {
        const r = board.cleanBoard({ slots: [{ kind: "tank", n: 1 }, { kind: "healer", n: 1, placed: false }], counts: { tank: 4, healer: 7, dps: 14 } });
        expect(r.board.slots.map((s) => s.placed)).toEqual([true, false]);
        expect(r.board.counts).toEqual({ tank: 4, healer: 7, dps: 14, melee: 0, ranged: 0 });
        expect(board.cleanBoard({}).board.counts).toBeNull();
    });
    it("roles: only players of the lineup and only known roles, in an event; none in a template", () => {
        const raw = { roles: { u1: "dps", u2: "tank", u3: "banana", ghost: "healer" } };
        const r = board.cleanBoard(raw, { allowedUserIds: ["u1", "u2", "u3"] });
        expect(r.board.roles).toEqual({ u1: "dps", u2: "tank" });
        expect(r.dropped).toBe(2);
        expect(board.cleanBoard(raw).board.roles).toEqual({});
        expect(board.boardHasContent(r.board)).toBe(true);
    });
});

describe("the task rows read as assignments", () => {
    it("title = the task, players = assignees, unknown players dropped, nothing invented", () => {
        const r = assign.targetsToAssignments([{ id: "r1", title: "Kick Fear", userIds: ["u1", "zz"] }, { title: "Tank", userIds: [] }], new Set(["u1"]));
        expect(r[0]).toMatchObject({ id: "r1", type: "other", title: "Kick Fear", assignees: ["user:u1"], targets: [] });
        expect(r[1]).toMatchObject({ type: "other", title: "Tank", assignees: [] });
        expect(assign.targetsToAssignments(undefined)).toEqual([]);
    });
    it("an assignment keeps its title and the new types", () => {
        const r = assign.cleanAssignments([{ type: "dispel", title: "x".repeat(200) }, { type: "cc" }, { type: "buff" }, { type: "tank" }]);
        expect(r.assignments.map((a) => a.type)).toEqual(["dispel", "cc", "buff", "tank"]);
        expect(r.assignments[0].title).toHaveLength(80);
    });
});

describe("a template is a raid type", () => {
    beforeAll(() => templateStore.useFile(tempStoreFile("besetzung-templates.json")));
    it("keeps size and counts, and shows the effective Besetzung", () => {
        const { template } = templateStore.createTemplate({ name: "BT", instanceIds: ["bt"], size: 25, counts: { tank: 2, healer: 6, dps: 17 } });
        expect(template).toMatchObject({ size: 25, counts: { tank: 2, healer: 6, dps: 17, melee: 0, ranged: 0 } });
        expect(raidplan.templateView(template).besetzung).toEqual({ size: 25, counts: { tank: 2, healer: 6, dps: 17, melee: 0, ranged: 0 }, groups: 5, split: false });
        const plain = templateStore.createTemplate({ name: "Old", instanceIds: ["bt"] }).template;
        expect(plain).toMatchObject({ size: 0, counts: null });
        expect(raidplan.templateView(plain).besetzung.counts).toEqual({ tank: 3, healer: 7, dps: 15, melee: 0, ranged: 0 });
        expect(templateStore.updateTemplate(plain.id, { size: 10 }).template.size).toBe(10);
        expect(templateStore.updateTemplate(plain.id, { size: 99 }).code).toBe("invalid");
        expect(templateStore.updateTemplate(plain.id, { counts: "x" }).code).toBe("invalid");
        const dup = templateStore.duplicateTemplate(template.id).template;
        expect(dup).toMatchObject({ size: 25, counts: { tank: 2 } });
    });
    it("an old template with melee / ranged counts keeps every slot", () => {
        const old = templateStore.createTemplate({ name: "Legacy", instanceIds: ["bt"], size: 25, counts: { tank: 3, healer: 7, melee: 8, ranged: 7 } }).template;
        expect(old.counts).toEqual({ tank: 3, healer: 7, dps: 15, melee: 8, ranged: 7 });
        expect(raidplan.templateView(old).besetzung.split).toBe(true);
    });
});
