// Auto placement from the tank rows on the server (docs/raidplan.md): the switch and the moved positions are validated, a mob target
// can name one of several mobs of its kind, and the moved positions follow their rows when a template is applied or duplicated.
const { tempStoreFile } = require("../../helpers/tempStore");
const templates = require("../../../src/stores/raidplanTemplateStore");
const plans = require("../../../src/stores/raidplanStore");
const inherit = require("../../../src/services/raidplan/raidplanInherit");
const board = require("../../../src/services/raidplan/raidplanBoard");
const assign = require("../../../src/services/raidplan/raidplanAssign");

const BOSS = "bt/supremus";
const OTHER = "bt/shade-of-akama";
const roster = [{ userId: "t1", role: "tank", classId: "Warrior", group: 1 }, { userId: "t2", role: "tank", classId: "Paladin", group: 1 }];

beforeEach(() => {
    plans.useFile(tempStoreFile("plans.json"));
    templates.useFile(tempStoreFile("templates.json"));
});
afterAll(() => {
    plans.useFile();
    templates.useFile();
});

const row = (id, type, assignees, targets, extra = {}) => ({ id, type, title: "", spell: null, assignees, targets, note: "", suggested: false, ...extra });
const clean = (b) => board.cleanBoard(b, { allowedUserIds: [] });

describe("validation", () => {
    it("autoPlace is on unless it is exactly false; an old board (no field) keeps it; off alone is content", () => {
        expect(clean({}).board.autoPlace).toBe(true);
        expect(clean({ autoPlace: "no" }).board.autoPlace).toBe(true);
        expect(clean({ autoPlace: false }).board.autoPlace).toBe(false);
        expect(board.boardHasContent(clean({ autoPlace: false }).board)).toBe(true);
        expect(board.boardHasContent(clean({}).board)).toBe(false);
    });

    it("autoPos keeps known keys only, a point on the board, at most 80", () => {
        const r = clean({ autoPos: { "t:r1:1": { x: 1.5, y: -2 }, "m:d:flame#2": { x: 0.25, y: 0.5 }, "m:b:bt/supremus#1": { x: 0.5, y: 0.4 }, bad: { x: 0, y: 0 }, "t:r1:x": { x: 0, y: 0 }, "t:r2:1": { x: "a", y: 0 }, "m:zz#1": { x: 0, y: 0 } } }).board;
        expect(r.autoPos).toEqual({ "t:r1:1": { x: 1, y: 0 }, "m:d:flame#2": { x: 0.25, y: 0.5 }, "m:b:bt/supremus#1": { x: 0.5, y: 0.4 } });
        const many = {};
        for (let i = 0; i < 100; i++) many[`t:r${i}:1`] = { x: 0.1, y: 0.1 };
        expect(Object.keys(clean({ autoPos: many }).board.autoPos)).toHaveLength(80);
        expect(board.boardHasContent(clean({ autoPos: { "t:r1:1": { x: 0.1, y: 0.1 } } }).board)).toBe(true);
    });

    it("autoStyle keeps known keys and sane values only (size in the range of a token / an icon, opacity, flags, label, facing, order), autoScale 0.4..2", () => {
        const r = clean({ autoScale: 3, autoStyle: {
            "t:r1:1": { size: 999, opacity: 0.05, ring: false, showName: false, label: "x".repeat(60), hidden: true, lock: true, z: 5000, junk: 1 },
            "m:d:flame#1": { size: 1, rotation: 370, autoFace: false, showLabel: true, ring: true, opacity: "a" },
            "m:b:bt/illidan#1": { ring: true, showName: true },
            bad: { size: 40 },
        } }).board;
        expect(r.autoScale).toBe(2);
        expect(r.autoStyle["t:r1:1"]).toEqual({ size: 152, opacity: 0.1, ring: false, showName: false, label: "x".repeat(40), hidden: true, lock: true, z: 999 });
        expect(r.autoStyle["m:d:flame#1"]).toEqual({ size: 12, rotation: 10, autoFace: false, showLabel: true });
        // nothing that differs from the default = no entry
        expect(r.autoStyle["m:b:bt/illidan#1"]).toBeUndefined();
        expect(r.autoStyle.bad).toBeUndefined();
        expect(clean({}).board).toMatchObject({ autoStyle: {}, autoScale: 1 });
        expect(clean({ autoScale: 0.1 }).board.autoScale).toBe(0.4);
        expect(board.boardHasContent(clean({ autoScale: 0.5 }).board)).toBe(true);
        expect(board.boardHasContent(clean({ autoStyle: { "t:r1:1": { opacity: 0.5 } } }).board)).toBe(true);
    });

    it("a mob target can name one of several of its kind: 1..20, the same mob twice only with different numbers", () => {
        const flame = (n) => ({ kind: "mob", ref: "d:flame", name: "Flame", icon: "", ...(n !== undefined ? { n } : {}) });
        const r = assign.cleanAssignments([row("a", "tank", [], [flame(1), flame(2), flame(2), flame(), flame(0), flame(25)])]);
        expect(r.assignments[0].targets.map((t) => t.n)).toEqual([1, 2, undefined]);
        expect(r.dropped).toBe(3);
        expect(assign._internal.mobInstance("3")).toBe(3);
        expect(assign._internal.mobInstance(21)).toBe(0);
    });

    it("a default row keeps the number of its mob target in each section", () => {
        const s = inherit.sectionOf({ key: "bt/illidan", name: "Illidan", iconUrl: "", instanceId: "bt" }, [{ id: "d:flame", name: "Flame", icon: "", bossKey: "bt/illidan", kind: "add" }], []);
        const rows = inherit.inheritedRows([row("d1", "tank", ["slot:tank:2"], [{ kind: "mob", ref: "d:flame", name: "Flame", icon: "", n: 2 }])], [], s);
        expect(rows[0].targets).toEqual([{ kind: "mob", ref: "d:flame", name: "Flame", icon: "", n: 2 }]);
    });
});

describe("the moved positions follow their rows", () => {
    it("reidBoard: a row under a new id takes its moved tanks along; a copy of a default row and the mobs keep their keys", () => {
        const b = clean({
            assignments: [row("own", "tank", ["slot:tank:1"], []), row("dev", "tank", ["slot:tank:2"], [], { origin: "d1" })],
            autoPos: { "t:own:1": { x: 0.1, y: 0.2 }, "t:d1:1": { x: 0.3, y: 0.4 }, "m:d:flame#1": { x: 0.5, y: 0.6 } },
            autoStyle: { "t:own:1": { size: 19 }, "m:d:flame#1": { opacity: 0.5 } }, autoScale: 0.6,
        }).board;
        const copy = board.reidBoard(b);
        const own = copy.assignments[0].id;
        expect(own).not.toBe("own");
        // the look moves with the row as the position does
        expect(copy.autoStyle).toEqual({ [`t:${own}:1`]: { size: 19 }, "m:d:flame#1": { opacity: 0.5 } });
        expect(copy.autoScale).toBe(0.6);
        expect(copy.autoPos).toEqual({ [`t:${own}:1`]: { x: 0.1, y: 0.2 }, "t:d1:1": { x: 0.3, y: 0.4 }, "m:d:flame#1": { x: 0.5, y: 0.6 } });
    });

    it("applying a template: a tank of an inherited Standard row moved in the template stands there in the event; showMap and autoPlace come along", () => {
        const t0 = templates.createTemplate({ name: "BT", category: "Raid", instanceIds: ["bt"] }).template;
        const defaults = [row("d1", "tank", ["class:Paladin:1:tank"], [{ kind: "mob", ref: "b:this", name: "Boss", icon: "" }])];
        const t = templates.updateTemplate(t0.id, { version: 1, bosses: {
            [inherit.DEFAULTS_KEY]: { assignments: defaults },
            [BOSS]: { autoPos: { "t:d1:1": { x: 0.2, y: 0.8 }, [`m:b:${BOSS}#1`]: { x: 0.5, y: 0.3 } }, autoStyle: { "t:d1:1": { size: 19 }, [`m:b:${BOSS}#1`]: { size: 96 } }, autoScale: 0.8 },
            [OTHER]: { showMap: false, autoPlace: false, notes: "x" },
        } }).template;
        const plan = plans.applyTemplate("e1", t, { version: 0, bossKeys: [BOSS, OTHER], roster, userId: "orga" }).plan;
        const b = plan.bosses[BOSS];
        const inh = b.assignments.find((a) => a.origin === "default");
        expect(inh.id).not.toBe("d1");
        expect(b.autoPos).toEqual({ [`t:${inh.id}:1`]: { x: 0.2, y: 0.8 }, [`m:b:${BOSS}#1`]: { x: 0.5, y: 0.3 } });
        // a boss at 200 %, the tank at 50 %, all of them at 80 %: the same in the event
        expect(b.autoStyle).toEqual({ [`t:${inh.id}:1`]: { size: 19 }, [`m:b:${BOSS}#1`]: { size: 96 } });
        expect(b.autoScale).toBe(0.8);
        expect(plan.bosses[OTHER]).toMatchObject({ showMap: false, autoPlace: false });
    });

    it("duplicating a template keeps showMap, autoPlace and the moved positions (under the rows' new ids)", () => {
        const t0 = templates.createTemplate({ name: "BT", category: "Raid", instanceIds: ["bt"] }).template;
        const t = templates.updateTemplate(t0.id, { version: 1, bosses: {
            [BOSS]: { showMap: false, autoPlace: false, assignments: [row("r1", "tank", ["class:Mage:1:any"], [])], autoPos: { "t:r1:1": { x: 0.1, y: 0.9 } } },
        } }).template;
        const dup = templates.duplicateTemplate(t.id).template;
        const b = dup.bosses[BOSS];
        expect(b).toMatchObject({ showMap: false, autoPlace: false });
        expect(b.autoPos).toEqual({ [`t:${b.assignments[0].id}:1`]: { x: 0.1, y: 0.9 } });
        expect(b.assignments[0].id).not.toBe("r1");
    });
});
