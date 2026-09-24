// Raid plan templates (src/web/raidplanTemplateStore.js) and copying one into an
// event's plan (raidplanStore.applyTemplate), plus the map lookup order.
const { tempStoreFile } = require("../helpers/tempStore");
const templates = require("../../src/web/raidplanTemplateStore");
const plans = require("../../src/web/raidplanStore");

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const BOSS = "bt/supremus";
const roster = [
    { userId: "t1", role: "tank", group: 1 }, { userId: "t2", role: "tank", group: 1 }, { userId: "h1", role: "healer", group: 1 },
    { userId: "d1", role: "melee", group: 2 }, { userId: "d2", role: "ranged", group: 2 },
];

beforeEach(() => {
    const file = tempStoreFile("plans.json");
    plans.useFile(file);
    templates.useFile(tempStoreFile("templates.json"));
});
afterAll(() => {
    plans.useFile();
    templates.useFile();
});

function make(extra = {}) {
    return templates.createTemplate({ name: "Montags-Raid", category: "Raid", instanceIds: ["bt"], ...extra }).template;
}

describe("templates", () => {
    it("creates one with a name and instances, starting without boards", () => {
        const t = make({ description: "  fuer Montag ", guildId: "1139509316387344395" });
        expect(t).toMatchObject({ name: "Montags-Raid", category: "Raid", description: "fuer Montag", guildId: "1139509316387344395", instanceIds: ["bt"], bosses: {}, version: 1 });
        expect(t.id).toMatch(/^[0-9a-f]{12}$/);
        expect(templates.getTemplate(t.id)).toEqual(t);
    });

    it("needs a name and a known instance and refuses bad fields", () => {
        expect(templates.createTemplate({ instanceIds: ["bt"] }).code).toBe("invalid");
        expect(templates.createTemplate({ name: "x" }).code).toBe("invalid");
        expect(templates.createTemplate({ name: "x", instanceIds: [] }).code).toBe("invalid");
        expect(templates.createTemplate({ name: "x", instanceIds: ["nope"] }).code).toBe("invalid");
        expect(templates.createTemplate({ name: "x".repeat(41), instanceIds: ["bt"] }).code).toBe("invalid");
        expect(templates.createTemplate({ name: "x", instanceIds: ["bt"], guildId: "abc" }).code).toBe("invalid");
        expect(templates.createTemplate({ name: "x", instanceIds: ["bt"], description: "d".repeat(201) }).code).toBe("invalid");
        expect(templates.listTemplates()).toEqual([]);
    });

    it("lists by category, then name", () => {
        make({ name: "B", category: "Zwei" });
        make({ name: "A", category: "Zwei" });
        make({ name: "C", category: "Eins" });
        expect(templates.listTemplates().map((t) => t.name)).toEqual(["C", "A", "B"]);
    });

    it("saves boards with a version check and no players", () => {
        const t = make();
        const board = { slots: [{ kind: "tank", n: 1, userId: "u1" }], zones: [{ type: "danger", x: 0.2, y: 0.2, w: 0.3, h: 0.3 }], tokens: [{ userId: "u1", x: 0.5, y: 0.5 }], targets: [{ title: "MT", userIds: ["u1"] }] };
        const r = templates.updateTemplate(t.id, { bosses: { [BOSS]: board, "kara/moroes": board, "bt/nobody": board }, version: 1 });
        expect(r.template.version).toBe(2);
        expect(Object.keys(r.template.bosses)).toEqual([BOSS]);
        const saved = r.template.bosses[BOSS];
        expect(saved.slots[0].userId).toBe("");
        expect(saved.tokens).toEqual([]);
        expect(saved.targets[0].userIds).toEqual([]);
        expect(saved.zones[0]).toMatchObject({ type: "danger", color: "#ef4444" });
        expect(templates.updateTemplate(t.id, { bosses: {}, version: 1 }).code).toBe("conflict");
        expect(templates.updateTemplate(t.id, { bosses: [], version: 2 }).code).toBe("invalid");
    });

    it("renames without needing a version and without touching the boards", () => {
        const t = make();
        templates.updateTemplate(t.id, { bosses: { [BOSS]: { notes: "x" } }, version: 1 });
        const r = templates.updateTemplate(t.id, { name: "Neu", category: "" });
        expect(r.template).toMatchObject({ name: "Neu", category: "", version: 2 });
        expect(r.template.bosses[BOSS].notes).toBe("x");
        expect(templates.updateTemplate(t.id, { name: " " }).code).toBe("invalid");
        expect(templates.updateTemplate("nope", { name: "x" }).code).toBe("not_found");
    });

    it("drops the boards of bosses the new instances do not have", () => {
        const t = make();
        templates.updateTemplate(t.id, { bosses: { [BOSS]: { notes: "x" } }, version: 1 });
        const r = templates.updateTemplate(t.id, { instanceIds: ["kara"] });
        expect(r.template.bosses).toEqual({});
        expect(templates.updateTemplate(t.id, { instanceIds: [] }).code).toBe("invalid");
    });

    it("deletes a template with its own maps, not the default ones", () => {
        const t = make();
        plans.saveMap(plans.templateMapKey(t.id, BOSS), PNG);
        plans.saveMap(BOSS, PNG);
        expect(templates.deleteTemplate(t.id)).toBe(true);
        expect(templates.deleteTemplate(t.id)).toBe(false);
        expect(plans.readMap(plans.templateMapKey(t.id, BOSS))).toBeNull();
        expect(plans.readMap(BOSS)).not.toBeNull();
    });
});

describe("applying a template to an event plan", () => {
    const layout = {
        slots: [{ kind: "tank", n: 1 }, { kind: "tank", n: 2 }, { kind: "healer", n: 1 }, { kind: "dps", n: 1 }, { kind: "group", n: 2 }, { kind: "tank", n: 3 }],
        marks: [{ mark: "skull", x: 0.5, y: 0.5 }],
        zones: [{ type: "healthy", x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
        targets: [{ title: "Main-Tank", userIds: [] }],
        notes: "Montag",
    };
    const apply = (t, version = 0, extra = {}) => plans.applyTemplate("e1", t, { version, bossKeys: ["bt/supremus", "bt/shade-of-akama"], roster, userId: "orga", ...extra });

    function withLayout() {
        const t = make();
        return templates.updateTemplate(t.id, { bosses: { [BOSS]: layout, "bt/shade-of-akama": { notes: "Akama" } }, version: 1 }).template;
    }

    it("copies the boards, fills the open slots from the setup and remembers the template", () => {
        const t = withLayout();
        const r = apply(t);
        expect(r.plan).toMatchObject({ version: 1, templateId: t.id });
        const b = r.plan.bosses[BOSS];
        expect(b.slots.map((s) => [s.kind, s.n, s.userId])).toEqual([
            ["tank", 1, "t1"], ["tank", 2, "t2"], ["healer", 1, "h1"], ["dps", 1, "d1"], ["group", 2, ""], ["tank", 3, ""],
        ]);
        expect(b.marks[0]).toMatchObject({ mark: "skull" });
        expect(b.zones[0]).toMatchObject({ type: "healthy" });
        expect(b.targets[0]).toMatchObject({ title: "Main-Tank", userIds: [] });
        expect(b.notes).toBe("Montag");
        expect(r.plan.bosses["bt/shade-of-akama"].notes).toBe("Akama");
        expect(plans.getPlan("e1").templateId).toBe(t.id);
    });

    it("is a snapshot: changing or deleting the template later leaves the plan alone", () => {
        const t = withLayout();
        apply(t);
        templates.updateTemplate(t.id, { bosses: { [BOSS]: { notes: "geaendert" } }, version: 2 });
        templates.deleteTemplate(t.id);
        expect(plans.getPlan("e1").bosses[BOSS].zones).toHaveLength(1);
        expect(plans.getPlan("e1").bosses[BOSS].notes).toBe("Montag");
    });

    it("gives the copy new ids, so applying twice does not share objects", () => {
        const t = withLayout();
        const a = apply(t).plan.bosses[BOSS].zones[0].id;
        const b = apply(t, 1).plan.bosses[BOSS].zones[0].id;
        expect(a).not.toBe(b);
    });

    it("replaces the boards it covers, leaves the other bosses and the publish state alone", () => {
        const t = withLayout();
        plans.savePlan("e1", { version: 0, bosses: { "bt/supremus": { notes: "alt", tokens: [{ userId: "t1", x: 0.5, y: 0.5 }] }, "bt/shade-of-akama": { notes: "bleibt nicht" } } }, { bossKeys: ["bt/supremus", "bt/shade-of-akama"], allowedUserIds: ["t1"], userId: "o" });
        const token = plans.setPublished("e1", true).plan.publicToken;
        const r = apply(t, 1);
        expect(r.plan.bosses[BOSS].tokens).toEqual([]);
        expect(r.plan.bosses[BOSS].notes).toBe("Montag");
        expect(r.plan).toMatchObject({ status: "published", publicToken: token });
    });

    it("only covers bosses the event has, checks the version and leaves unresolved slots open", () => {
        const t = withLayout();
        const r = apply(t, 0, { bossKeys: ["bt/supremus"] });
        expect(Object.keys(r.plan.bosses)).toEqual([BOSS]);
        expect(apply(t, 5).code).toBe("conflict");
        expect(apply(t, 1, { roster: [] }).plan.bosses[BOSS].slots.every((s) => s.userId === "")).toBe(true);
    });
});

describe("which map a boss shows", () => {
    const boss = plans.bossesForInstances(["bt"]).find((b) => b.key === BOSS);
    const ctx = { eventId: "eh-abc123", templateId: "abcdef123456" };

    it("goes event plan, template, boss default, instance default, grid", () => {
        expect(plans.mapForBoss(boss, ctx)).toBeNull();
        plans.saveMap("bt", PNG);
        expect(plans.mapForBoss(boss, ctx)).toMatchObject({ source: "instance", key: "bt" });
        plans.saveMap(BOSS, PNG);
        expect(plans.mapForBoss(boss, ctx)).toMatchObject({ source: "boss", key: BOSS });
        plans.saveMap(plans.templateMapKey(ctx.templateId, BOSS), PNG);
        expect(plans.mapForBoss(boss, ctx)).toMatchObject({ source: "template", key: `t/abcdef123456/${BOSS}` });
        plans.saveMap(plans.eventMapKey(ctx.eventId, BOSS), PNG);
        expect(plans.mapForBoss(boss, ctx)).toMatchObject({ source: "event", key: `e/eh-abc123/${BOSS}` });
        // "Auf Standard zuruecksetzen" = removing the override
        plans.deleteMap(plans.eventMapKey(ctx.eventId, BOSS));
        expect(plans.mapForBoss(boss, ctx).source).toBe("template");
        // without a template or an event in play only the defaults count
        expect(plans.mapForBoss(boss).source).toBe("boss");
    });

    it("recognises scoped keys and refuses malformed ones", () => {
        for (const k of [`t/abcdef123456/${BOSS}`, `e/eh-abc123/${BOSS}`]) expect(plans.isMapKey(k)).toBe(true);
        for (const k of ["t/abcdef123456/bt", "t/../bt/supremus", "x/abc/bt/supremus", "t/ab/bt/supremus", "t/abcdef123456/bt/nobody"]) expect(plans.isMapKey(k)).toBe(false);
        expect(plans.mapScope(`t/abcdef123456/${BOSS}`)).toEqual({ scope: "t", id: "abcdef123456" });
        expect(plans.mapScope(BOSS)).toBeNull();
    });
});
