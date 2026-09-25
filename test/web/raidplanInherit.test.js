// The Standard of a template (src/web/raidplanInherit.js): inherited by every boss, deviated from, applied to an event.
const { tempStoreFile } = require("../helpers/tempStore");
const templates = require("../../src/web/raidplanTemplateStore");
const plans = require("../../src/web/raidplanStore");
const inherit = require("../../src/web/raidplanInherit");
const raidplan = require("../../src/web/raidplan");
const board = require("../../src/web/raidplanBoard");

const BOSS = "bt/supremus";
const OTHER = "bt/shade-of-akama";
const TRASH = "bt/trash";
const roster = [{ userId: "t1", role: "tank", group: 1 }, { userId: "t2", role: "tank", group: 1 }, { userId: "h1", role: "healer", group: 1 }];

beforeEach(() => {
    plans.useFile(tempStoreFile("plans.json"));
    templates.useFile(tempStoreFile("templates.json"));
});
afterAll(() => {
    plans.useFile();
    templates.useFile();
});

const row = (id, type, assignees, targets) => ({ id, type, title: "", spell: null, assignees, targets, note: "", suggested: false });
const DEFAULT_ROWS = [
    row("d1", "tank", ["slot:tank:1"], [{ kind: "mob", ref: "b:this", name: "Boss", icon: "" }]),
    row("d2", "heal", ["slot:healer:1"], [{ kind: "slot", ref: "tank:1" }]),
];
const layout = { slots: [{ kind: "tank", n: 1 }, { kind: "healer", n: 1 }] };

function template(defaults = DEFAULT_ROWS, bosses = {}) {
    const t = templates.createTemplate({ name: "Montag", category: "Raid", instanceIds: ["bt"] }).template;
    const r = templates.updateTemplate(t.id, { version: 1, bosses: { [inherit.DEFAULTS_KEY]: { assignments: defaults, slots: layout.slots }, ...bosses } });
    return r.template;
}
const apply = (t) => plans.applyTemplate("e1", t, { version: 0, bossKeys: [BOSS, OTHER, TRASH, "general"], roster, userId: "orga" });

describe("the Standard as a board of the template", () => {
    it("is a board like the others: it can be saved, and it is not a boss (not counted)", () => {
        const t = template();
        expect(t.bosses[inherit.DEFAULTS_KEY].assignments.map((a) => a.id)).toHaveLength(2);
        expect(raidplan.templateSummary(t).bossCount).toBe(0);
        const view = raidplan.templateView(t);
        // the Standard right after "Allgemein"
        expect(view.bossList[0]).toMatchObject({ key: "general" });
        expect(view.bossList[1]).toMatchObject({ key: "defaults", defaults: true, name: "Standard" });
        expect(view.bossList.filter((b) => b.defaults)).toHaveLength(1);
    });
    it("a template without a Standard is as before (nothing added to the bosses)", () => {
        const t = template([], { [BOSS]: { notes: "x" } });
        const r = apply(t).plan;
        expect(Object.keys(r.bosses)).toEqual([BOSS]);
        expect(r.bosses[BOSS].assignments).toEqual([]);
    });
});

describe("the sections", () => {
    const boss = (key, name, extra = {}) => ({ key, name, iconUrl: "/bosses/601.jpg", instanceId: "bt", ...extra });
    it("a boss section offers its boss, the catalog's adds of it and the mobs of its board", () => {
        const s = inherit.sectionOf(boss(BOSS, "Supremus"), [{ id: "d:x", name: "X", bossKey: BOSS, kind: "add", icon: "a" }, { id: "d:y", name: "Y", bossKey: "bt/other", kind: "add" }], [{ id: "c:own", name: "Own", icon: "" }]);
        expect([...s.mobs.keys()]).toEqual([`b:${BOSS}`, "d:x", "c:own"]);
        expect(s.bossMob).toEqual({ id: `b:${BOSS}`, name: "Supremus", icon: "boss:601" });
    });
    it("a trash section has no boss, its trash mobs of the instance, and 'Boss' falls back to nothing", () => {
        const s = inherit.sectionOf(boss(TRASH, "Trash", { trash: true }), [{ id: "d:t", name: "T", kind: "trash", instanceId: "bt", bossKey: "" }], []);
        expect(s.bossMob).toBe(null);
        const rows = inherit.inheritedRows(DEFAULT_ROWS, [], s);
        expect(rows[0].targets).toEqual([]);
        expect(rows[1].targets).toEqual([{ kind: "slot", ref: "tank:1" }]);
    });
    it("the relative boss target is the boss of each section, a mob the section lacks is dropped without an error", () => {
        const rows = [row("m", "tank", ["slot:tank:2"], [{ kind: "mob", ref: "b:this", name: "B", icon: "" }, { kind: "mob", ref: "d:gone", name: "G", icon: "" }])];
        const a = inherit.inheritedRows(rows, [], inherit.sectionOf(boss(BOSS, "Supremus"), [], []));
        const b = inherit.inheritedRows(rows, [], inherit.sectionOf(boss(OTHER, "Akama"), [], []));
        expect(a[0].targets.map((t) => t.ref)).toEqual([`b:${BOSS}`]);
        expect(b[0].targets.map((t) => t.ref)).toEqual([`b:${OTHER}`]);
    });
    it("a row switched off for a boss is not written in", () => {
        const s = inherit.sectionOf(boss(BOSS, "Supremus"), [], []);
        expect(inherit.effectiveRows(DEFAULT_ROWS, { inheritOff: ["d1"], assignments: [] }, s).map((r) => r.type)).toEqual(["heal"]);
    });
    it("the icon key of a boss image", () => {
        expect(inherit.bossIconKey("/bosses/601.jpg")).toBe("boss:601");
        expect(inherit.bossIconKey("https://wow.zamimg.com/images/wow/icons/large/inv_misc_gear_01.jpg")).toBe("inv_misc_gear_01");
        expect(inherit.bossIconKey("")).toBe("");
    });
});

describe("applying a template with a Standard to an event", () => {
    it("every boss (and trash) gets the inherited rows, resolved for it, marked as from the Standard, with fresh ids; Allgemein stays as it is", () => {
        const t = template(DEFAULT_ROWS, { [BOSS]: layout });
        const r = apply(t).plan;
        for (const key of [BOSS, OTHER, TRASH]) expect(r.bosses[key]).toBeDefined();
        expect(r.bosses.general).toBeUndefined();
        const own = r.bosses[BOSS].assignments;
        expect(own.map((a) => a.type)).toEqual(["tank", "heal"]);
        expect(own[0].targets[0].ref).toBe(`b:${BOSS}`);
        expect(r.bosses[OTHER].assignments[0].targets[0].ref).toBe(`b:${OTHER}`);
        expect(r.bosses[TRASH].assignments[0].targets).toEqual([]);
        expect(own[0].origin).toBe("default");
        expect(own[0].id).not.toBe("d1");
        expect(r.bosses[BOSS].inheritOff).toEqual([]);
    });
    it("a boss that deviated keeps its own row and gets the other inherited ones; a switched-off row is not written", () => {
        const dev = board.cleanBoard({ assignments: [{ ...row("mine", "tank", ["slot:tank:2"], []), origin: "d1" }], inheritOff: ["d1"], slots: layout.slots }, { allowedUserIds: [] }).board;
        const t = template(DEFAULT_ROWS, { [BOSS]: dev, [OTHER]: { inheritOff: ["d2"] } });
        const r = apply(t).plan;
        const a = r.bosses[BOSS].assignments;
        expect(a.map((x) => x.type).sort()).toEqual(["heal", "tank"]);
        expect(a.find((x) => x.type === "tank").assignees).toEqual(["slot:tank:2"]);
        expect(r.bosses[OTHER].assignments.map((x) => x.type)).toEqual(["tank"]);
    });
    it("the plan is a snapshot: a later change of the Standard does not reach it", () => {
        const t = template();
        apply(t);
        templates.updateTemplate(t.id, { version: 2, bosses: { [inherit.DEFAULTS_KEY]: { assignments: [row("d1", "tank", ["slot:tank:3"], [])] } } });
        expect(plans.getPlan("e1").bosses[BOSS].assignments[0].assignees).toEqual(["slot:tank:1"]);
    });
});

describe("validation", () => {
    it("keeps inheritOff as a list of ids (once each, only sane ones) and origin as an id or 'default'", () => {
        const r = board.cleanBoard({ inheritOff: ["d1", "d1", "bad id!", 5, "d2"], assignments: [{ ...row("a", "tank", [], []), origin: "d1" }, { ...row("b", "tank", [], []), origin: "no way!" }] }, { allowedUserIds: [] });
        expect(r.board.inheritOff).toEqual(["d1", "5", "d2"]);
        expect(r.board.assignments.map((a) => a.origin)).toEqual(["d1", ""]);
        expect(board.boardHasContent(r.board)).toBe(true);
        expect(board.boardHasContent(board.cleanBoard({}, { allowedUserIds: [] }).board)).toBe(false);
        expect(board.cleanBoard({ inheritOff: ["d1"] }, { allowedUserIds: [] }).board.inheritOff).toEqual(["d1"]);
    });
    it("a template from before has no Standard: nothing is lost, nothing appears", () => {
        const t = templates.createTemplate({ name: "Alt", instanceIds: ["bt"] }).template;
        expect(t.bosses).toEqual({});
        const view = raidplan.templateView(t);
        expect(view.bossList.filter((b) => b.defaults)).toHaveLength(1);
        expect(plans.applyTemplate("e2", t, { version: 0, bossKeys: [BOSS], roster, userId: "o" }).plan.bosses).toEqual({});
    });
});

describe("template -> event: what the boss icon's auto facing needs", () => {
    it("the event's board has the placed tank slot, the boss icon and the resolved 'Tank -> boss of this section' row, so the facing follows from the rows alone", () => {
        const icon = { id: "i1", iconKey: "boss:601", label: "", showLabel: false, x: 0.5, y: 0.5, size: 48, rotation: 0, mobId: "", autoFace: true, opacity: 1, lock: false, hidden: false };
        const tank = { id: "s1", kind: "tank", n: 1, x: 0.2, y: 0.8, label: "", userId: "", size: 38, hideMembers: false, split: false, offsets: {}, placed: true, opacity: 1, lock: false, hidden: false };
        const t = template(DEFAULT_ROWS, { [BOSS]: { icons: [icon], slots: [tank] } });
        const plan = apply(t).plan;
        const b = plan.bosses[BOSS];
        expect(b.icons).toHaveLength(1);
        expect(b.slots.some((s) => s.kind === "tank" && s.n === 1 && s.placed !== false)).toBe(true);
        const inherited = b.assignments.find((a) => a.type === "tank" && a.origin === "default");
        expect(inherited.assignees).toEqual(["slot:tank:1"]);
        expect(inherited.targets).toEqual([expect.objectContaining({ kind: "mob", ref: `b:${BOSS}` })]);
        // the other boss gets its own boss as the target, not this one's
        const o = plan.bosses[OTHER].assignments.find((a) => a.type === "tank");
        expect(o.targets[0].ref).toBe(`b:${OTHER}`);
    });
});
