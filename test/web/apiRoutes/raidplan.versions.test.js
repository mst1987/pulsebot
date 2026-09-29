// #544: the raid plan per game version - templates and tactic profiles carry a versionId, an event is offered the
// templates of its version, and the catalog of a plan (editor, suggestions, template editor) is that version's only.
let mockUser = null;
jest.mock("../../../src/web/http/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
jest.mock("../../../src/web/http/apiBody", () => require("../../helpers/http").apiBodyMock());
jest.mock("../../../src/web/http/auth", () => ({ getUser: jest.fn(() => null) }));
const mockEvents = {};
jest.mock("../../../src/stores/eventStore", () => ({
    ...jest.requireActual("../../../src/stores/eventStore"),
    getEvent: jest.fn((id) => mockEvents[id] || null),
    isOwnEventId: jest.fn((id) => String(id).startsWith("eh-")),
}));

const { readJsonBody } = require("../../../src/web/http/apiBody");
const { tempStoreFile } = require("../../helpers/tempStore");
const { ownEvent } = require("../../factories/events");
const plans = require("../../../src/stores/raidplanStore");
const profiles = require("../../../src/stores/raidplanProfileStore");
const templates = require("../../../src/stores/raidplanTemplateStore");
const catalog = require("../../../src/stores/raidplanCatalogStore");
const raidplan = require("../../../src/web/raidplan/raidplan");
const route = require("../../../src/web/apiRoutes/raidplan");
const { mockRes, status, json } = require("../../helpers/http");

const ORGA = { id: "orga", isAdmin: false, access: { raids: { read: true, write: true } } };
const person = (userId, character, spec, role) => ({ userId, character, spec, role });
const APPROVED = {
    version: 1, approvedAt: 1, approvedBy: "orga",
    groups: [{ index: 1, slots: [
        person("u1", "Tanky", "Warrior-Protection", "tank"), person("u2", "Heally", "Priest-Holy", "healer"),
        person("u3", "Locky", "Warlock-Destruction", "ranged"), person("u4", "Shammy", "Shaman-Restoration", "healer"),
    ] }],
    bench: [],
};

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
    catalog.useFile(tempStoreFile("catalog.json"));
    for (const k of Object.keys(mockEvents)) delete mockEvents[k];
    mockEvents["eh-tbc"] = ownEvent({ id: "eh-tbc", guildId: "500000", title: "BT", startTime: 1800000000, instanceIds: ["bt"], setup: { approved: APPROVED } });
    mockEvents["eh-fv"] = ownEvent({ id: "eh-fv", guildId: "500000", title: "Ony", startTime: 1800000000, versionId: "forever", instanceIds: ["forever-ony"], setup: { approved: APPROVED } });
});
afterAll(() => {
    plans.useFile();
    profiles.useFile();
    templates.useFile();
    catalog.useFile();
});

describe("templates carry their game version", () => {
    it("takes the version of its instances, refuses instances of another version, and the template editor gets that version's catalog", async () => {
        const tbc = body(await call(route.postTemplate, ORGA, { name: "BT", instanceIds: ["bt"] })).template;
        const fv = body(await call(route.postTemplate, ORGA, { name: "Ony", versionId: "forever", instanceIds: ["forever-ony"] })).template;
        expect(tbc.versionId).toBe("tbc");
        expect(fv.versionId).toBe("forever");
        expect(tbc.catalog.mobs.length).toBeGreaterThan(30);
        // everything of the catalog is TBC so far: a Forever template offers none of it
        expect(fv.catalog).toEqual({ mobs: [], spells: [] });

        const mixed = await call(route.postTemplate, ORGA, { name: "Mix", versionId: "tbc", instanceIds: ["forever-ony"] });
        expect(status(mixed)).toBe(400);
        expect(body(mixed).message || body(mixed).error || JSON.stringify(body(mixed))).toMatch(/Spielversion/);
        expect(status(await call(route.postTemplate, ORGA, { name: "X", versionId: "nope", instanceIds: ["bt"] }))).toBe(400);
        expect(status(await call(route.patchTemplate, ORGA, { id: fv.id, instanceIds: ["bt"] }))).toBe(400);
        // switching the version together with fitting instances is fine
        expect(body(await call(route.patchTemplate, ORGA, { id: fv.id, versionId: "tbc", instanceIds: ["hyjal"] })).template.versionId).toBe("tbc");
    });

    it("a duplicate keeps the version", async () => {
        const fv = body(await call(route.postTemplate, ORGA, { name: "Ony", instanceIds: ["forever-ony"] })).template;
        expect(body(await call(route.postTemplateDuplicate, ORGA, { id: fv.id })).template.versionId).toBe("forever");
    });
});

describe("an event plan and its version", () => {
    it("the editor names the plan's version and lists the templates of every version with theirs", async () => {
        await call(route.postTemplate, ORGA, { name: "BT", instanceIds: ["bt"] });
        await call(route.postTemplate, ORGA, { name: "Ony", instanceIds: ["forever-ony"] });
        const d = body(await call(route.getPlan, ORGA, null, "event=eh-tbc"));
        expect(d.versionId).toBe("tbc");
        expect(d.templates.map((t) => [t.name, t.versionId]).sort()).toEqual([["BT", "tbc"], ["Ony", "forever"]]);
        expect(body(await call(route.getPlan, ORGA, null, "event=eh-fv")).versionId).toBe("forever");
        // the server's own list for applying: only the event's version
        expect(raidplan.templatesFor(mockEvents["eh-tbc"]).map((t) => t.name)).toEqual(["BT"]);
        expect(raidplan.templatesFor(mockEvents["eh-fv"]).map((t) => t.name)).toEqual(["Ony"]);
    });

    it("applies a template of another version only when asked to (409 version_mismatch otherwise)", async () => {
        const fv = body(await call(route.postTemplate, ORGA, { name: "Ony", instanceIds: ["forever-ony"] })).template;
        const refused = await call(route.postApply, ORGA, { event: "eh-tbc", templateId: fv.id, version: 0 });
        expect(status(refused)).toBe(409);
        expect(json(refused).error.code).toBe("version_mismatch");
        expect(plans.getPlan("eh-tbc")).toBeNull();
        const done = await call(route.postApply, ORGA, { event: "eh-tbc", templateId: fv.id, version: 0, otherVersion: true });
        expect(status(done)).toBe(200);
        expect(body(done).plan.templateId).toBe(fv.id);
        const tbc = body(await call(route.postTemplate, ORGA, { name: "BT", instanceIds: ["bt"] })).template;
        expect(status(await call(route.postApply, ORGA, { event: "eh-tbc", templateId: tbc.id, version: 1 }))).toBe(200);
    });

    it("a Forever plan gets no TBC catalog entry; a Forever entry shows there and not in TBC", async () => {
        expect(body(await call(route.getPlan, ORGA, null, "event=eh-fv")).catalog).toEqual({ mobs: [], spells: [] });
        const own = body(await call(route.postMob, ORGA, { name: "Onyxian Whelp", kind: "add", instanceId: "forever-ony", versions: ["forever"] })).entry;
        const fvCatalog = body(await call(route.getPlan, ORGA, null, "event=eh-fv")).catalog;
        expect(fvCatalog.mobs.map((m) => m.id)).toEqual([own.id]);
        const tbcCatalog = body(await call(route.getPlan, ORGA, null, "event=eh-tbc")).catalog;
        expect(tbcCatalog.mobs.some((m) => m.id === own.id)).toBe(false);
        expect(tbcCatalog.mobs.length).toBeGreaterThan(30);
    });

    it("suggestions only use the spells of the plan's version (curses, soulstone, totems)", async () => {
        const rows = async (event, type) => body(await call(route.postSuggest, ORGA, { event, type, slots: [{ kind: "tank", n: 1, userId: "u1" }] })).assignments;
        const tbcCurses = await rows("eh-tbc", "curse");
        expect(tbcCurses.length).toBeGreaterThan(0);
        expect(tbcCurses[0].spell).toMatchObject({ id: "d:curse-of-the-elements" });
        for (const type of ["curse", "ss", "totem", "debuff", "blessing"]) {
            for (const a of await rows("eh-fv", type)) expect({ type, spell: a.spell || null }).toEqual({ type, spell: null });
        }
        // a template's suggestion names its version
        const tpl = body(await call(route.postSuggest, ORGA, { type: "curse", versionId: "forever", slots: [] })).assignments;
        for (const a of tpl) expect(a.spell || null).toBeNull();
    });
});

describe("tactic profiles carry their game version", () => {
    it("stores the version given, derives it from the boss, and refuses an unknown one", async () => {
        const made = body(await call(route.postProfile, ORGA, { name: "Kiten", versionId: "forever" })).profile;
        expect(made.versionId).toBe("forever");
        expect(body(await call(route.postProfile, ORGA, { name: "Council", bossKey: "bt/the-illidari-council" })).profile.versionId).toBe("tbc");
        expect(status(await call(route.postProfile, ORGA, { name: "X", versionId: "nope" }))).toBe(400);
        expect(body(await call(route.patchProfile, ORGA, { id: made.id, versionId: "tbc" }, "PATCH")).profile.versionId).toBe("tbc");
        expect(body(await call(route.getProfiles, ORGA)).profiles.every((p) => typeof p.versionId === "string")).toBe(true);
    });
});
