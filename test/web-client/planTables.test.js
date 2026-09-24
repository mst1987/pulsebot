// The read view's tables (lib/planTables.ts): Tank | Ziel | Heiler, group healing, the slim tables, "my" assignments.
const { loadTs, makeT } = require("./i18nHelper");

const assign = loadTs("lib/assign.ts", { t: makeT("de") });
const tables = loadTs("lib/planTables.ts", assign);

const player = (userId, character, classId = "Priest", group = 1) => ({ userId, character, classId, className: "", classColor: "", spec: "", specLabel: "", role: "dps", group });
const slot = (kind, n, userId = "") => ({ id: `${kind}${n}`, kind, n, userId, x: 0.1, y: 0.1, label: "" });
const row = (id, type, assignees, targets, extra = {}) => ({ id, type, title: "", spell: null, assignees, targets, note: "", suggested: false, ...extra });
const ctxOf = (slots, list) => ({ slots, players: new Map(list.map((p) => [p.userId, p])), catalog: null });
const none = () => false;

const players = [player("t1", "Tankwart", "Warrior"), player("t2", "Baerchen", "Druid"), player("h1", "Segenreich", "Paladin"), player("h2", "Baumbart", "Druid"), player("r1", "Schleich", "Rogue")];
const slots = [slot("tank", 1, "t1"), slot("tank", 2, "t2"), slot("healer", 1, "h1"), slot("healer", 2, "h2")];
const ctx = ctxOf(slots, players);
const mob = { kind: "mob", ref: "d:gathios", name: "Gathios", icon: "mob:22949" };

describe("Tank | Ziel | Heiler", () => {
    const assignments = [
        row("t-a", "tank", ["slot:tank:1"], [mob]),
        row("t-b", "tank", ["slot:tank:2"], [{ kind: "mob", ref: "b:bt/x", name: "Boss", icon: "boss:601" }]),
        row("h-a", "heal", ["slot:healer:1"], [{ kind: "slot", ref: "tank:1" }, { kind: "group", ref: "3" }]),
        row("h-b", "heal", ["slot:healer:2"], [{ kind: "slot", ref: "tank:1" }, { kind: "slot", ref: "tank:2" }]),
    ];
    it("a row per tank and target, with the healers derived from the heal rows that name him", () => {
        const r = tables.tankTable(assignments, ctx, none);
        expect(r).toHaveLength(2);
        expect(r[0].tank.label).toBe("Tank 1");
        expect(r[0].target.label).toBe("Gathios");
        expect(r[0].healers.map((h) => h.ref)).toEqual(["slot:healer:1", "slot:healer:2"]);
        expect(r[1].healers.map((h) => h.ref)).toEqual(["slot:healer:2"]);
    });
    it("a heal row that targets the person (a raider) counts for the tank standing in the slot", () => {
        const a = [row("t", "tank", ["slot:tank:1"], [mob]), row("h", "heal", ["user:h1"], [{ kind: "player", ref: "t1" }])];
        expect(tables.tankTable(a, ctx, none)[0].healers.map((h) => h.ref)).toEqual(["user:h1"]);
    });
    it("several tanks or targets make several rows, a tank without a target one row with an empty target, other types none", () => {
        const a = [row("t", "tank", ["slot:tank:1", "slot:tank:2"], [mob, { kind: "mark", ref: "skull" }]), row("u", "trashtank", ["slot:tank:1"], []), row("k", "kick", ["user:r1"], [])];
        const r = tables.tankTable(a, ctx, none);
        expect(r).toHaveLength(5);
        expect(r[4].target).toBe(null);
    });
    it("marks the rows that are the visitor's", () => {
        const r = tables.tankTable(assignments, ctx, (a) => a.id === "t-b");
        expect(r.map((x) => x.own)).toEqual([false, true]);
    });
    it("the healer of nobody named is empty, not a guess", () => {
        expect(tables.tankTable([row("t", "tank", ["slot:tank:1"], [mob])], ctx, none)[0].healers).toEqual([]);
    });
});

describe("group healing by group", () => {
    const pl = (userId, group) => ({ userId, character: userId, classId: "Priest", className: "", classColor: "", spec: "", specLabel: "", role: "healer", group });
    const gctx = { slots: [{ kind: "healer", n: 1, userId: "h1", id: "x", x: 0, y: 0, label: "" }, { kind: "healer", n: 2, userId: "h2", id: "y", x: 0, y: 0, label: "" }], players: new Map([["h1", pl("h1", 1)], ["h2", pl("h2", 2)], ["m1", pl("m1", 3)], ["m2", pl("m2", 3)]]) };
    it("has a row per group with its members, also groups nobody heals, and at least the minimum number of groups", () => {
        const a = [row("h", "heal", ["slot:healer:1"], [{ kind: "group", ref: "1" }, { kind: "group", ref: "3" }])];
        const r = tables.groupHealByGroup(a, gctx, 5);
        expect(r.map((x) => x.group)).toEqual([1, 2, 3, 4, 5]);
        expect(r[2].members.map((p) => p.userId)).toEqual(["m1", "m2"]);
        expect(r[1].healers).toEqual([]);
        expect(r[3].members).toEqual([]);
    });
    it("a healer with several groups is in several rows, each healer once per group, in the order of the rows", () => {
        const a = [row("h", "heal", ["slot:healer:1"], [{ kind: "group", ref: "1" }, { kind: "group", ref: "3" }]), row("i", "heal", ["slot:healer:2", "slot:healer:1"], [{ kind: "group", ref: "3" }])];
        const r = tables.groupHealByGroup(a, gctx, 3);
        expect(r[0].healers.map((h) => h.ref)).toEqual(["slot:healer:1"]);
        expect(r[2].healers.map((h) => h.ref)).toEqual(["slot:healer:1", "slot:healer:2"]);
    });
    it("tank-only rows and rows of other types are not group healing; a named group above the lineup still gets its row", () => {
        const a = [row("i", "heal", ["slot:healer:2"], [{ kind: "slot", ref: "tank:2" }]), row("k", "kick", ["slot:healer:1"], [{ kind: "group", ref: "1" }]), row("g", "heal", ["slot:healer:2"], [{ kind: "group", ref: "7" }])];
        const r = tables.groupHealByGroup(a, gctx, 5);
        expect(r).toHaveLength(7);
        expect(r[0].healers).toEqual([]);
        expect(r[6].healers.map((h) => h.ref)).toEqual(["slot:healer:2"]);
    });
});

describe("the slim tables", () => {
    it("interrupts get a row per assignee with the place in the rotation; other types one row", () => {
        const a = [
            row("k", "kick", ["user:r1", "slot:tank:1"], [{ kind: "text", ref: "Fear" }], { spell: { id: "s", name: "Kick", icon: "" } }),
            row("m", "md", ["user:r1"], [{ kind: "slot", ref: "tank:1" }]),
            row("c", "curse", ["user:r1"], [], { title: "Elements" }),
        ];
        const t = tables.simpleTables(a, ctx);
        expect(t.map((x) => x.type)).toEqual(["kick", "md", "curse"]);
        expect(t[0].rows.map((r) => r.order)).toEqual([1, 2]);
        expect(t[0].rows[0].spell).toBe("Kick");
        expect(t[0].rows[0].targets[0].label).toBe("Fear");
        expect(t[1].rows[0].order).toBe(0);
        expect(t[2].rows[0].task).toBe("Elements");
    });
    it("a type without rows has no table, the tank and heal types are not here", () => {
        expect(tables.simpleTables([row("t", "tank", ["slot:tank:1"], []), row("h", "heal", ["slot:healer:1"], [])], ctx)).toEqual([]);
    });
});

