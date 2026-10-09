// The Standard of a template (src/services/raidplan/raidplanInherit.js): inherited by every boss, deviated from, applied to an event.
const { tempStoreFile } = require("../../helpers/tempStore");
const templates = require("../../../src/stores/raidplanTemplateStore");
const plans = require("../../../src/stores/raidplanStore");
const inherit = require("../../../src/services/raidplan/raidplanInherit");
const raidplan = require("../../../src/web/raidplan/raidplan");
const board = require("../../../src/services/raidplan/raidplanBoard");

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
        // the Standard first, before "Allgemein" (#524: the same order as in an event plan)
        expect(view.bossList[0]).toMatchObject({ key: "defaults", defaults: true, name: "Standard" });
        expect(view.bossList[1]).toMatchObject({ key: "general" });
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
        const rows = DEFAULT_ROWS.map((r) => inherit.resolveRow(r, s));
        expect(rows[0].targets).toEqual([]);
        expect(rows[1].targets).toEqual([{ kind: "slot", ref: "tank:1" }]);
    });
    it("the relative boss target is the boss of each section, a mob the section lacks is dropped without an error", () => {
        const rows = [row("m", "tank", ["slot:tank:2"], [{ kind: "mob", ref: "b:this", name: "B", icon: "" }, { kind: "mob", ref: "d:gone", name: "G", icon: "" }])];
        const a = rows.map((r) => inherit.resolveRow(r, inherit.sectionOf(boss(BOSS, "Supremus"), [], [])));
        const b = rows.map((r) => inherit.resolveRow(r, inherit.sectionOf(boss(OTHER, "Akama"), [], [])));
        expect(a[0].targets.map((t) => t.ref)).toEqual([`b:${BOSS}`]);
        expect(b[0].targets.map((t) => t.ref)).toEqual([`b:${OTHER}`]);
    });
    it("a row switched off for a boss is not inherited", () => {
        const s = inherit.sectionOf(boss(BOSS, "Supremus"), [], []);
        expect(inherit.mergeRows(DEFAULT_ROWS, { inheritOff: ["d1"], assignments: [] }, s).map((r) => r.type)).toEqual(["heal"]);
    });
    it("the icon key of a boss image", () => {
        expect(inherit.bossIconKey("/bosses/601.jpg")).toBe("boss:601");
        expect(inherit.bossIconKey("https://wow.zamimg.com/images/wow/icons/large/inv_misc_gear_01.jpg")).toBe("inv_misc_gear_01");
        expect(inherit.bossIconKey("")).toBe("");
    });
});

describe("applying a template with a Standard to an event (#524)", () => {
    const section = (key, name) => inherit.sectionOf({ key, name, iconUrl: "/bosses/601.jpg", instanceId: "bt", trash: key === TRASH }, [], []);
    const eff = (plan, key, name) => inherit.effectiveRows(plan.bosses, key, section(key, name));
    it("the template's Standard becomes the event's Standard (the same row ids); no boss gets copies, every boss and trash inherits it", () => {
        const t = template(DEFAULT_ROWS, { [BOSS]: layout });
        const r = apply(t).plan;
        expect(r.bosses[inherit.DEFAULTS_KEY].assignments.map((a) => a.id)).toEqual(["d1", "d2"]);
        expect(r.bosses[BOSS].assignments).toEqual([]);
        expect(r.bosses.general).toBeUndefined();
        const own = eff(r, BOSS, "Supremus");
        expect(own.map((a) => a.type)).toEqual(["tank", "heal"]);
        expect(own[0].targets[0].ref).toBe(`b:${BOSS}`);
        expect(own[0].origin).toBe("d1");
        expect(eff(r, OTHER, "Akama")[0].targets[0].ref).toBe(`b:${OTHER}`);
        expect(eff(r, TRASH, "Trash")[0].targets).toEqual([]);
        // "Allgemein" inherits nothing
        expect(eff(r, "general", "Allgemein")).toEqual([]);
    });
    it("a boss that deviated keeps its own row in the default's place and the other inherited ones; a switched-off row is not inherited", () => {
        const dev = board.cleanBoard({ assignments: [{ ...row("mine", "tank", ["slot:tank:2"], []), origin: "d1" }], inheritOff: ["d1"], slots: layout.slots }, { allowedUserIds: [] }).board;
        const t = template(DEFAULT_ROWS, { [BOSS]: dev, [OTHER]: { inheritOff: ["d2"] } });
        const r = apply(t).plan;
        const a = eff(r, BOSS, "Supremus");
        expect(a.map((x) => x.type)).toEqual(["tank", "heal"]);
        expect(a[0].assignees).toEqual(["slot:tank:2"]);
        expect(r.bosses[BOSS].inheritOff).toEqual(["d1"]);
        expect(eff(r, OTHER, "Akama").map((x) => x.type)).toEqual(["tank"]);
    });
    it("the event's Standard is its own: a later change of the template does not reach it, a change of the event's Standard reaches every boss", () => {
        const t = template();
        apply(t);
        templates.updateTemplate(t.id, { version: 2, bosses: { [inherit.DEFAULTS_KEY]: { assignments: [row("d1", "tank", ["slot:tank:3"], [])] } } });
        const plan = plans.getPlan("e1");
        expect(eff(plan, BOSS, "Supremus")[0].assignees).toEqual(["slot:tank:1"]);
        const std = plan.bosses[inherit.DEFAULTS_KEY];
        const saved = plans.savePlan("e1", { version: plan.version, bosses: { ...plan.bosses, [inherit.DEFAULTS_KEY]: { ...std, assignments: [{ ...std.assignments[0], assignees: ["slot:tank:2"] }, std.assignments[1]] } } }, { bossKeys: [BOSS, OTHER, TRASH, "general", inherit.DEFAULTS_KEY], allowedUserIds: [], userId: "o" }).plan;
        for (const [key, name] of [[BOSS, "Supremus"], [OTHER, "Akama"], [TRASH, "Trash"]]) expect(eff(saved, key, name)[0].assignees).toEqual(["slot:tank:2"]);
    });
    it("applying a template without a Standard removes the event's Standard", () => {
        apply(template());
        const plan = plans.getPlan("e1");
        const t2 = template([], { [BOSS]: { notes: "neu" } });
        const r = plans.applyTemplate("e1", t2, { version: plan.version, bossKeys: [BOSS, OTHER, TRASH, "general", inherit.DEFAULTS_KEY], roster, userId: "orga" }).plan;
        expect(r.bosses[inherit.DEFAULTS_KEY]).toBeUndefined();
        expect(eff(r, BOSS, "Supremus")).toEqual([]);
    });
});

describe("the effective rows of a section (mergeRows, the server twin of lib/raidplan/inherit.ts mergeInherited)", () => {
    const s = () => inherit.sectionOf({ key: BOSS, name: "Supremus", iconUrl: "", instanceId: "bt" }, [], []);
    const own = (id, extra = {}) => ({ ...row(id, "kick", ["slot:dps:1"], []), ...extra });
    it("Standard rows first in the Standard's order, then the own rows", () => {
        const r = inherit.mergeRows(DEFAULT_ROWS, { assignments: [own("o1"), own("o2")] }, s());
        expect(r.map((a) => a.id)).toEqual(["d1", "d2", "o1", "o2"]);
        expect(r[0]).toMatchObject({ origin: "d1", suggested: false });
    });
    it("a deviation stands in the place of its default row, a hidden one is left out", () => {
        const dev = own("x", { type: "heal", origin: "d2" });
        expect(inherit.mergeRows(DEFAULT_ROWS, { assignments: [own("o1"), dev], inheritOff: ["d2"] }, s()).map((a) => a.id)).toEqual(["d1", "x", "o1"]);
        expect(inherit.mergeRows(DEFAULT_ROWS, { assignments: [own("o1")], inheritOff: ["d1"] }, s()).map((a) => a.id)).toEqual(["d2", "o1"]);
    });
    it("a deviation whose default is inherited anyway (not switched off) is an own row after the Standard", () => {
        expect(inherit.mergeRows(DEFAULT_ROWS, { assignments: [own("x", { origin: "d1" })] }, s()).map((a) => a.id)).toEqual(["d1", "d2", "x"]);
    });
    it("Allgemein and the Standard have only their own rows; which sections inherit", () => {
        const bosses = { [inherit.DEFAULTS_KEY]: { assignments: DEFAULT_ROWS }, general: { assignments: [own("g")] } };
        expect(inherit.effectiveRows(bosses, "general", s()).map((a) => a.id)).toEqual(["g"]);
        expect(inherit.effectiveRows(bosses, inherit.DEFAULTS_KEY, s()).map((a) => a.id)).toEqual(["d1", "d2"]);
        expect(inherit.effectiveRows(bosses, BOSS, s()).map((a) => a.id)).toEqual(["d1", "d2"]);
        expect(inherit.effectiveRows(undefined, BOSS, s())).toEqual([]);
        expect([BOSS, TRASH, "general", inherit.DEFAULTS_KEY].map(inherit.inherits)).toEqual([true, true, false, false]);
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
        const inherited = inherit.effectiveRows(plan.bosses, BOSS, inherit.sectionOf({ key: BOSS, name: "Supremus", iconUrl: "", instanceId: "bt" }, [], [])).find((a) => a.type === "tank");
        expect(inherited.assignees).toEqual(["slot:tank:1"]);
        expect(inherited.targets).toEqual([expect.objectContaining({ kind: "mob", ref: `b:${BOSS}` })]);
        // the other boss gets its own boss as the target, not this one's
        const o = inherit.effectiveRows(plan.bosses, OTHER, inherit.sectionOf({ key: OTHER, name: "Akama", iconUrl: "", instanceId: "bt" }, [], [])).find((a) => a.type === "tank");
        expect(o.targets[0].ref).toBe(`b:${OTHER}`);
    });
});
