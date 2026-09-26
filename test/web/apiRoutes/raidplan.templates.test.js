// The template API (src/web/apiRoutes/raidplan.js): gate, CRUD, applying a
// template to an event, scoped map uploads and the public view of slots, marks
// and zones. Stores are real, on scratch files.
let mockUser = null;
let mockViewer = null;
jest.mock("../../../src/web/http/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
jest.mock("../../../src/web/http/apiBody", () => require("../../helpers/http").apiBodyMock());
jest.mock("../../../src/web/http/auth", () => ({ getUser: jest.fn(() => mockViewer) }));
const mockEvents = {};
jest.mock("../../../src/stores/eventStore", () => ({
    ...jest.requireActual("../../../src/stores/eventStore"),
    getEvent: jest.fn((id) => mockEvents[id] || null),
    isOwnEventId: jest.fn((id) => String(id).startsWith("eh-")),
}));

const { readJsonBody, readRawBody } = require("../../../src/web/http/apiBody");
const { tempStoreFile } = require("../../helpers/tempStore");
const { ownEvent } = require("../../factories/events");
const plans = require("../../../src/stores/raidplanStore");
const profiles = require("../../../src/stores/raidplanProfileStore");
const templates = require("../../../src/stores/raidplanTemplateStore");
const route = require("../../../src/web/apiRoutes/raidplan");
const { checkAccess, areasFor } = require("../../../src/web/http/apiAccess");

const ORGA = { id: "orga", isAdmin: false, access: { raids: { read: true, write: true } } };
const READER = { id: "reader", isAdmin: false, access: { raids: { read: true, write: false } } };
const MEMBER = { id: "m", isAdmin: false, access: { signup: { read: true, write: true } } };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const BOSS = "bt/supremus";

const person = (userId, character, spec, role) => ({ userId, character, spec, role });
const APPROVED = {
    version: 1, approvedAt: 1, approvedBy: "orga",
    groups: [
        { index: 1, slots: [person("u1", "Tanky", "Warrior-Protection", "tank"), person("u2", "Heally", "Priest-Holy", "healer")] },
        { index: 2, slots: [person("u3", "Feury", "Mage-Fire", "ranged")] },
    ],
    bench: [],
};

const { mockRes, status, json } = require("../../helpers/http");
const body = (r) => { const p = json(r); return p.data || p.error; };
async function call(handler, user, payload, query = "") {
    mockUser = user;
    readJsonBody.mockResolvedValue(payload || {});
    const r = mockRes();
    await handler({ headers: {} }, r, new URL(`http://x/api/raidplan${query ? `?${query}` : ""}`));
    return r;
}

beforeEach(() => {
    jest.clearAllMocks();
    plans.useFile(tempStoreFile("plans.json"));
    profiles.useFile(tempStoreFile("profiles.json"));
    templates.useFile(tempStoreFile("templates.json"));
    mockViewer = null;
    for (const k of Object.keys(mockEvents)) delete mockEvents[k];
    mockEvents["eh-1"] = ownEvent({ id: "eh-1", guildId: "500000", title: "BT", startTime: 1800000000, instanceIds: ["bt"], setup: { approved: APPROVED } });
});
afterAll(() => {
    plans.useFile();
    profiles.useFile();
    templates.useFile();
});

async function makeTemplate(extra = {}) {
    const created = body(await call(route.postTemplate, ORGA, { name: "Montags-Raid", instanceIds: ["bt"], ...extra })).template;
    const layout = {
        slots: [{ kind: "tank", n: 1, x: 0.5, y: 0.3 }, { kind: "healer", n: 1, x: 0.2, y: 0.6 }, { kind: "dps", n: 1, x: 0.7, y: 0.6 }, { kind: "group", n: 2, x: 0.8, y: 0.8 }],
        marks: [{ mark: "skull", x: 0.5, y: 0.1 }], zones: [{ type: "danger", label: "Feuer", x: 0.3, y: 0.3, w: 0.2, h: 0.2 }],
        targets: [{ title: "Main-Tank" }],
    };
    return body(await call(route.patchTemplate, ORGA, { id: created.id, version: created.version, bosses: { [BOSS]: layout } })).template;
}

describe("access", () => {
    it("puts the template paths under raids: read reads, write writes", () => {
        for (const p of ["/api/raidplan/templates", "/api/raidplan/templates/duplicate", "/api/raidplan/apply"]) {
            expect(areasFor(p)).toEqual(["raids"]);
            expect(checkAccess(p, "GET", READER)).toBeNull();
            expect(checkAccess(p, "POST", READER)).toMatchObject({ status: 403 });
            expect(checkAccess(p, "DELETE", ORGA)).toBeNull();
            expect(checkAccess(p, "GET", MEMBER)).toMatchObject({ status: 403 });
            expect(checkAccess(p, "GET", null)).toMatchObject({ status: 401 });
        }
    });
});

describe("template CRUD", () => {
    it("creates, lists with the bosses of its instances, changes and deletes", async () => {
        const t = await makeTemplate({ category: "Raid" });
        expect(t).toMatchObject({ name: "Montags-Raid", version: 2 });
        expect(t.bossList.length).toBeGreaterThan(5);
        expect(t.bosses[BOSS].zones[0]).toMatchObject({ label: "Feuer", color: "#ef4444" });
        expect(body(await call(route.getTemplates, READER)).templates).toHaveLength(1);
        const renamed = body(await call(route.patchTemplate, ORGA, { id: t.id, name: "Dienstags-Raid" }));
        expect(renamed.template.name).toBe("Dienstags-Raid");
        expect(status(await call(route.deleteTemplate, ORGA, { id: t.id }))).toBe(200);
        expect(status(await call(route.deleteTemplate, ORGA, { id: t.id }))).toBe(404);
    });

    it("answers 400 / 409 / 404 and refuses a reader", async () => {
        expect(status(await call(route.postTemplate, ORGA, { name: "" }))).toBe(400);
        expect(status(await call(route.postTemplate, READER, { name: "x", instanceIds: ["bt"] }))).toBe(403);
        const t = await makeTemplate();
        expect(status(await call(route.patchTemplate, ORGA, { id: t.id, version: 1, bosses: {} }))).toBe(409);
        expect(status(await call(route.patchTemplate, ORGA, { id: "nope", name: "x" }))).toBe(404);
        expect(templates.listTemplates()).toHaveLength(1);
    });
});

describe("applying to an event", () => {
    it("copies the template, fills the slots from the approved setup and shows it in the editor payload", async () => {
        const t = await makeTemplate();
        const d = body(await call(route.postApply, ORGA, { event: "eh-1", templateId: t.id, version: 0 }));
        expect(d.plan).toMatchObject({ version: 1, templateId: t.id, templateName: "Montags-Raid" });
        const b = d.plan.bosses[BOSS];
        expect(b.slots.map((s) => [s.kind, s.userId])).toEqual([["tank", "u1"], ["healer", "u2"], ["dps", "u3"], ["group", ""]]);
        expect(b.zones[0].label).toBe("Feuer");
        expect(d.templates.map((x) => x.id)).toEqual([t.id]);
    });

    it("answers 409 on a stale version, 404 for a template made for another server, and needs write", async () => {
        const t = await makeTemplate();
        expect(status(await call(route.postApply, ORGA, { event: "eh-1", templateId: t.id, version: 3 }))).toBe(409);
        const other = await makeTemplate({ name: "Fremd", guildId: "999999" });
        expect(status(await call(route.postApply, ORGA, { event: "eh-1", templateId: other.id, version: 0 }))).toBe(404);
        expect(status(await call(route.postApply, READER, { event: "eh-1", templateId: t.id, version: 0 }))).toBe(403);
        expect(plans.getPlan("eh-1")).toBeNull();
    });

    it("offers only templates for the event's server (or for all) in the editor", async () => {
        await makeTemplate({ name: "Alle" });
        await makeTemplate({ name: "Dieser", guildId: "500000" });
        await makeTemplate({ name: "Anderer", guildId: "999999" });
        const d = body(await call(route.getPlan, ORGA, null, "event=eh-1"));
        expect(d.templates.map((x) => x.name).sort()).toEqual(["Alle", "Dieser"]);
    });
});

describe("scoped map uploads", () => {
    const upload = async (key, buffer = PNG) => {
        mockUser = ORGA;
        readRawBody.mockResolvedValue(buffer);
        const r = mockRes();
        await route.postMap({ headers: {} }, r, new URL(`http://x/api/raidplan/map?key=${encodeURIComponent(key)}`));
        return r;
    };

    it("stores a template's map and an event plan's map, and shows the most specific one", async () => {
        const t = await makeTemplate();
        expect(status(await upload(plans.templateMapKey(t.id, BOSS)))).toBe(200);
        expect(status(await upload(BOSS))).toBe(200);
        let d = body(await call(route.postApply, ORGA, { event: "eh-1", templateId: t.id, version: 0 }));
        expect(d.bosses.find((b) => b.key === BOSS)).toMatchObject({ mapSource: "template", templateMap: true, ownMap: true, eventMap: false });
        expect(d.bosses.find((b) => b.key === BOSS).mapUrl).toMatch(new RegExp(`^/rp-map/t/${t.id}/${BOSS}\\?v=\\d+$`));
        expect(status(await upload(plans.eventMapKey("eh-1", BOSS)))).toBe(200);
        d = body(await call(route.getPlan, ORGA, null, "event=eh-1"));
        expect(d.bosses.find((b) => b.key === BOSS)).toMatchObject({ mapSource: "event", eventMap: true });
        // reset to the default
        expect(body(await call(route.postMapDelete, ORGA, { key: plans.eventMapKey("eh-1", BOSS) })).removed).toBe(true);
        d = body(await call(route.getPlan, ORGA, null, "event=eh-1"));
        expect(d.bosses.find((b) => b.key === BOSS).mapSource).toBe("template");
    });

    it("refuses a map for a template or event that does not exist", async () => {
        expect(status(await upload(`t/abcdef123456/${BOSS}`))).toBe(404);
        expect(status(await upload(`e/eh-nope/${BOSS}`))).toBe(404);
        expect(status(await upload(`e/999/${BOSS}`))).toBe(404);
        expect(status(await call(route.postMapDelete, ORGA, { key: `t/abcdef123456/${BOSS}` }))).toBe(404);
    });
});

describe("the public view", () => {
    it("carries slots (players resolved, others open), marks and zones and marks the viewer", async () => {
        const t = await makeTemplate();
        await call(route.postApply, ORGA, { event: "eh-1", templateId: t.id, version: 0 });
        const on = body(await call(route.postPublish, ORGA, { event: "eh-1", published: true }));
        mockViewer = { id: "u1" };
        const r = mockRes();
        await route.getPublic({ headers: {} }, r, new URL(`http://x/api/raidplan/public?token=${on.plan.publicPath.replace("/p/", "")}`));
        const d = body(r);
        expect(d.me).toBe("u1");
        const b = d.bosses[0];
        expect(b.slots.map((s) => [s.kind, s.userId])).toEqual([["tank", "u1"], ["healer", "u2"], ["dps", "u3"], ["group", ""]]);
        expect(b.marks[0].mark).toBe("skull");
        expect(b.zones[0]).toMatchObject({ type: "danger", label: "Feuer" });
        // the roster holds everyone a slot or a group marker names
        expect(d.roster.map((p) => p.userId).sort()).toEqual(["u1", "u2", "u3"]);
    });

    it("shows a slot open whose player is not in the approved setup", async () => {
        const t = await makeTemplate();
        await call(route.postApply, ORGA, { event: "eh-1", templateId: t.id, version: 0 });
        const on = body(await call(route.postPublish, ORGA, { event: "eh-1", published: true }));
        mockEvents["eh-1"].setup = { approved: { ...APPROVED, groups: [{ index: 1, slots: [person("u2", "Heally", "Priest-Holy", "healer")] }] } };
        const r = mockRes();
        await route.getPublic({ headers: {} }, r, new URL(`http://x/api/raidplan/public?token=${on.plan.publicPath.replace("/p/", "")}`));
        expect(body(r).bosses[0].slots.map((s) => s.userId)).toEqual(["", "u2", "", ""]);
    });
});

describe("the public view of the newer objects", () => {
    it("carries lines, texts and the map's opacity, and leaves out what is hidden in the editor", async () => {
        await call(route.putPlan, ORGA, {
            event: "eh-1", version: 0,
            bosses: {
                [BOSS]: {
                    mapOpacity: 0.4,
                    lines: [{ kind: "arrow", x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5, opacity: 0.6 }, { kind: "line", hidden: true }],
                    texts: [{ text: "Boss", x: 0.5, y: 0.5, size: 24 }, { text: "versteckt", hidden: true }],
                    marks: [{ mark: "skull", x: 0.2, y: 0.2, opacity: 0.5 }, { mark: "star", hidden: true }],
                    zones: [{ type: "danger", x: 0.1, y: 0.1, w: 0.2, h: 0.2, opacity: 0.8 }, { type: "healthy", hidden: true }],
                },
            },
        });
        const on = body(await call(route.postPublish, ORGA, { event: "eh-1", published: true }));
        const r = mockRes();
        await route.getPublic({ headers: {} }, r, new URL(`http://x/api/raidplan/public?token=${on.plan.publicPath.replace("/p/", "")}`));
        const b = body(r).bosses[0];
        expect(b.mapOpacity).toBe(0.4);
        expect(b.lines).toHaveLength(1);
        expect(b.lines[0]).toMatchObject({ kind: "arrow", opacity: 0.6 });
        expect(b.texts.map((x) => x.text)).toEqual(["Boss"]);
        expect(b.marks.map((m) => [m.mark, m.opacity])).toEqual([["skull", 0.5]]);
        expect(b.zones).toHaveLength(1);
        expect(b.zones[0].opacity).toBe(0.8);
    });
});

describe("duplicating and deleting a template", () => {
    it("copies the boards, gives everything new ids and keeps the original", async () => {
        const t = await makeTemplate({ name: "Montags-Raid" });
        plans.saveMap(plans.templateMapKey(t.id, BOSS), PNG);
        const r = body(await call(route.postTemplateDuplicate, ORGA, { id: t.id }));
        expect(r.template.name).toBe("Montags-Raid (Kopie)");
        expect(r.template.id).not.toBe(t.id);
        expect(r.templates).toHaveLength(2);
        expect(r.template.bosses[BOSS].zones[0]).toMatchObject({ label: "Feuer" });
        expect(r.template.bosses[BOSS].zones[0].id).not.toBe(t.bosses[BOSS].zones[0].id);
        expect(r.template.bossList.find((b) => b.key === BOSS).templateMap).toBe(true);
        expect(templates.getTemplate(t.id).bosses[BOSS].zones).toHaveLength(1);
    });

    it("cuts a long name so the copy still fits, refuses a reader and answers 404 for a missing one", async () => {
        const t = await makeTemplate({ name: "x".repeat(40) });
        const r = body(await call(route.postTemplateDuplicate, ORGA, { id: t.id }));
        expect(r.template.name).toHaveLength(40);
        expect(r.template.name.endsWith(" (Kopie)")).toBe(true);
        expect(status(await call(route.postTemplateDuplicate, READER, { id: t.id }))).toBe(403);
        expect(status(await call(route.postTemplateDuplicate, ORGA, { id: "nope" }))).toBe(404);
    });

    it("deletes a template and its maps, but leaves a plan that used it as it is", async () => {
        const t = await makeTemplate();
        plans.saveMap(plans.templateMapKey(t.id, BOSS), PNG);
        await call(route.postApply, ORGA, { event: "eh-1", templateId: t.id, version: 0 });
        expect(status(await call(route.deleteTemplate, ORGA, { id: t.id }))).toBe(200);
        expect(plans.readMap(plans.templateMapKey(t.id, BOSS))).toBeNull();
        const plan = plans.getPlan("eh-1");
        expect(plan.bosses[BOSS].zones).toHaveLength(1);
        // the plan's editor no longer names the template
        expect(body(await call(route.getPlan, ORGA, null, "event=eh-1")).plan.templateName).toBe("");
    });
});
