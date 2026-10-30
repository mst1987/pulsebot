// The raid plan library per server (#945, docs/raidplan.md "Bibliothek je Server") at the routes of
// src/web/apiRoutes/events/raidplan.js: reads and writes reach only the active server, a tab of another server is refused
// (409 server_switched), a full admin reaches every server, and a plan made before #945 finds its server's copy.
const A = "500000";
const B = "600000";
let mockUser = null;
let mockActive = A;
jest.mock("../../../../src/web/http/apiMiddleware", () => require("../../../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
jest.mock("../../../../src/web/http/apiBody", () => require("../../../helpers/http").apiBodyMock());
jest.mock("../../../../src/web/http/auth", () => ({ getUser: jest.fn(() => null), getActiveGuild: jest.fn(() => mockActive) }));
jest.mock("../../../../src/services/discord/guildRoles", () => ({
    ...jest.requireActual("../../../../src/services/discord/guildRoles"),
    // the server list of this test: A and B
    resolveServer: jest.fn(({ guildId = "" } = {}) => {
        const id = String(guildId || "");
        if (!id) return "500000";
        return ["500000", "600000"].includes(id) ? id : null;
    }),
}));
const mockEvents = {};
jest.mock("../../../../src/stores/eventStore", () => ({
    ...jest.requireActual("../../../../src/stores/eventStore"),
    getEvent: jest.fn((id) => mockEvents[id] || null),
    isOwnEventId: jest.fn((id) => String(id).startsWith("eh-")),
}));

const fs = require("fs");
const { readJsonBody } = require("../../../../src/web/http/apiBody");
const { tempStoreFile } = require("../../../helpers/tempStore");
const { ownEvent } = require("../../../factories/events");
const plans = require("../../../../src/stores/raidplanStore");
const profiles = require("../../../../src/stores/raidplanProfileStore");
const templates = require("../../../../src/stores/raidplanTemplateStore");
const route = require("../../../../src/web/apiRoutes/events/raidplan");
const { mockRes, status, json } = require("../../../helpers/http");

const ORGA = { id: "orga", isAdmin: false, isOrga: true, access: { raidplan: { read: true, write: true } } };
const ADMIN = { id: "admin", isAdmin: true, access: {} };
const BOSS = "bt/supremus";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const person = (userId, character, spec, role) => ({ userId, character, spec, role });
const APPROVED = {
    version: 1, approvedAt: 1, approvedBy: "orga",
    groups: [{ index: 1, slots: [person("u1", "Tanky", "Warrior-Protection", "tank")] }],
    bench: [],
};

const body = (r) => { const p = json(r); return p.data || p.error; };
/** A call with exactly this body (no libraryGuildId added: the tests here name it themselves). */
async function call(handler, user, payload, query = "") {
    mockUser = user;
    readJsonBody.mockResolvedValue(payload || {});
    const r = mockRes();
    await handler({ headers: {} }, r, new URL(`http://x/api/raidplan${query ? `?${query}` : ""}`));
    return r;
}

let templateFile;
beforeEach(() => {
    jest.clearAllMocks();
    mockActive = A;
    plans.useFile(tempStoreFile("plans.json"));
    profiles.useFile(tempStoreFile("profiles.json"));
    templateFile = tempStoreFile("templates.json");
    templates.useFile(templateFile);
    for (const k of Object.keys(mockEvents)) delete mockEvents[k];
    mockEvents["eh-a"] = ownEvent({ id: "eh-a", guildId: A, title: "BT A", startTime: 1800000000, instanceIds: ["bt"], setup: { approved: APPROVED } });
    mockEvents["eh-b"] = ownEvent({ id: "eh-b", guildId: B, title: "BT B", startTime: 1800000000, instanceIds: ["bt"], setup: { approved: APPROVED } });
});
afterAll(() => {
    plans.useFile();
    profiles.useFile();
    templates.useFile();
});

describe("an orga reaches only its active server", () => {
    it("reads the active server's library; another server is unknown (404)", async () => {
        templates.createTemplate(A, { name: "Nur A", instanceIds: ["bt"] });
        templates.createTemplate(B, { name: "Nur B", instanceIds: ["bt"] });
        mockActive = B;
        const d = body(await call(route.getTemplates, ORGA));
        expect(d.guildId).toBe(B);
        expect(d.templates.map((t) => t.name)).toEqual(["Nur B"]);
        expect(status(await call(route.getTemplates, ORGA, null, `guildId=${A}`))).toBe(404);
        expect(status(await call(route.getProfiles, ORGA, null, `guildId=${A}`))).toBe(404);
    });

    it("cannot change server A from server B", async () => {
        const onA = templates.createTemplate(A, { name: "Nur A", instanceIds: ["bt"] }).template;
        const profileA = profiles.createProfile(A, { name: "Tanks A", category: "Tank" }).profile;
        mockActive = B;
        // the tab still names A: refused, nothing changes
        const r = await call(route.patchTemplate, ORGA, { libraryGuildId: A, id: onA.id, version: onA.version, name: "Fremd" });
        expect(status(r)).toBe(409);
        expect(body(r).code).toBe("server_switched");
        expect(status(await call(route.deleteTemplate, ORGA, { libraryGuildId: A, id: onA.id }))).toBe(409);
        expect(status(await call(route.patchProfile, ORGA, { libraryGuildId: A, id: profileA.id, name: "Fremd" }))).toBe(409);
        // naming B (where the id does not exist) does not reach A either
        expect(status(await call(route.patchTemplate, ORGA, { libraryGuildId: B, id: onA.id, version: onA.version, name: "Fremd" }))).toBe(404);
        expect(status(await call(route.deleteProfile, ORGA, { libraryGuildId: B, id: profileA.id }))).toBe(404);
        expect(templates.getTemplate(A, onA.id).name).toBe("Nur A");
        expect(profiles.getProfile(A, profileA.id).name).toBe("Tanks A");
        // a write on B lands on B only
        expect(status(await call(route.postTemplate, ORGA, { libraryGuildId: B, name: "Neu B", instanceIds: ["bt"] }))).toBe(200);
        expect(templates.listTemplates(A).map((t) => t.name)).toEqual(["Nur A"]);
        expect(templates.listTemplates(B).map((t) => t.name)).toEqual(["Neu B"]);
    });

    it("answers 409 server_switched when the session switched server after the tab loaded", async () => {
        const loaded = body(await call(route.getTemplates, ORGA)).guildId;
        expect(loaded).toBe(A);
        mockActive = B;
        const r = await call(route.postTemplate, ORGA, { libraryGuildId: loaded, name: "Montag", instanceIds: ["bt"] });
        expect(status(r)).toBe(409);
        expect(body(r).code).toBe("server_switched");
        const p = await call(route.postProfile, ORGA, { libraryGuildId: loaded, name: "Tanks", category: "Tank" });
        expect(body(p).code).toBe("server_switched");
        expect(templates.listTemplates(A)).toEqual([]);
        expect(templates.listTemplates(B)).toEqual([]);
    });

    it("refuses a write that names no server (an old tab)", async () => {
        const r = await call(route.postTemplate, ORGA, { name: "Montag", instanceIds: ["bt"] });
        expect(status(r)).toBe(409);
        expect(body(r).code).toBe("server_switched");
    });

    it("says so without any active server", async () => {
        mockActive = "";
        const r = await call(route.postTemplate, ORGA, { name: "Montag", instanceIds: ["bt"] });
        expect(status(r)).toBe(400);
        expect(body(r).code).toBe("no_active_server");
        expect(status(await call(route.getTemplates, ORGA))).toBe(400);
    });

    it("keeps the raid-server filter of a template only for a server of the list", async () => {
        const known = body(await call(route.postTemplate, ORGA, { libraryGuildId: A, name: "Für A", guildId: A, instanceIds: ["bt"] })).template;
        expect(templates.getTemplate(A, known.id).guildId).toBe(A);
        const unknown = body(await call(route.postTemplate, ORGA, { libraryGuildId: A, name: "Fremd", guildId: "700000", instanceIds: ["bt"] })).template;
        expect(templates.getTemplate(A, unknown.id).guildId).toBe("");
        const t = templates.getTemplate(A, known.id);
        expect(status(await call(route.patchTemplate, ORGA, { libraryGuildId: A, id: t.id, version: t.version, guildId: "700000" }))).toBe(200);
        expect(templates.getTemplate(A, known.id).guildId).toBe("");
    });

    it("refuses a template map of another server's tab", async () => {
        const onA = templates.createTemplate(A, { name: "Nur A", instanceIds: ["bt"] }).template;
        mockActive = B;
        mockUser = ORGA;
        require("../../../../src/web/http/apiBody").readRawBody.mockResolvedValue(PNG);
        const r = mockRes();
        await route.postMap({ headers: {} }, r, new URL(`http://x/api/raidplan/map?key=${encodeURIComponent(plans.templateMapKey(onA.id, BOSS))}&libraryGuildId=${A}`));
        expect(status(r)).toBe(409);
        expect(plans.mapVersion(plans.templateMapKey(onA.id, BOSS))).toBeFalsy();
    });
});

describe("a full admin reaches every server", () => {
    it("reads and writes the library of both servers, whichever is active", async () => {
        mockActive = A;
        expect(status(await call(route.postTemplate, ADMIN, { libraryGuildId: A, name: "Auf A", instanceIds: ["bt"] }))).toBe(200);
        expect(status(await call(route.postTemplate, ADMIN, { libraryGuildId: B, name: "Auf B", instanceIds: ["bt"] }))).toBe(200);
        expect(status(await call(route.postProfile, ADMIN, { libraryGuildId: B, name: "Tanks B", category: "Tank" }))).toBe(200);
        expect(templates.listTemplates(A).map((t) => t.name)).toEqual(["Auf A"]);
        expect(templates.listTemplates(B).map((t) => t.name)).toEqual(["Auf B"]);
        expect(profiles.listProfiles(B).map((p) => p.name)).toEqual(["Tanks B"]);
        const d = body(await call(route.getTemplates, ADMIN, null, `guildId=${B}`));
        expect(d.guildId).toBe(B);
        expect(d.templates.map((t) => t.name)).toEqual(["Auf B"]);
    });

    it("gets 404 for a server that is not on the list", async () => {
        expect(status(await call(route.getTemplates, ADMIN, null, "guildId=700000"))).toBe(404);
        expect(status(await call(route.postTemplate, ADMIN, { libraryGuildId: "700000", name: "X", instanceIds: ["bt"] }))).toBe(404);
    });
});

describe("a plan made before #945 finds its server's copy", () => {
    const LEGACY = {
        id: "abc123", name: "BT Standard", instanceIds: ["bt"], versionId: "tbc", version: 1,
        bosses: { [BOSS]: { slots: [{ kind: "tank", n: 1, x: 0.5, y: 0.3 }], scenes: [{ id: "s1", title: "Kiten", frames: [] }] } },
    };

    beforeEach(() => {
        // the global library and two plans that applied its template
        fs.writeFileSync(templateFile, JSON.stringify({ templates: [LEGACY] }));
        plans.saveMap(plans.templateMapKey("abc123", BOSS), PNG);
        for (const eventId of ["eh-a", "eh-b"]) {
            const applied = plans.applyTemplate(eventId, LEGACY, { version: 0, bossKeys: [BOSS], roster: [], userId: "orga" });
            expect(applied.error).toBeUndefined();
        }
        templates.migrateToServers([A, B]);
    });

    it("in the editor and the public view, with the copy's map", async () => {
        const copyB = templates.listTemplates(B)[0];
        expect(copyB.id).not.toBe("abc123");

        mockActive = A;
        let d = body(await call(route.getPlan, ORGA, null, "event=eh-a"));
        expect(d.plan).toMatchObject({ templateId: "abc123", templateName: "BT Standard" });

        mockActive = B;
        d = body(await call(route.getPlan, ORGA, null, "event=eh-b"));
        expect(d.plan).toMatchObject({ templateId: copyB.id, templateName: "BT Standard" });
        expect(d.bosses.find((b) => b.key === BOSS)).toMatchObject({ mapSource: "template", templateMap: true });
        expect(d.bosses.find((b) => b.key === BOSS).mapUrl).toMatch(new RegExp(`^/rp-map/t/${copyB.id}/`));

        const on = body(await call(route.postPublish, ORGA, { event: "eh-b", published: true }));
        const r = mockRes();
        await route.getPublic({ headers: {} }, r, new URL(`http://x/api/raidplan/public?token=${on.plan.publicPath.replace("/p/", "")}`));
        expect(body(r).bosses.find((b) => b.key === BOSS).mapUrl).toMatch(new RegExp(`^/rp-map/t/${copyB.id}/`));
    });

    it("applies the old id again on its server: the copy of that server", async () => {
        mockActive = B;
        const d = body(await call(route.postApply, ORGA, { event: "eh-b", templateId: "abc123", version: plans.getPlan("eh-b").version }));
        expect(d.plan.templateId).toBe(templates.listTemplates(B)[0].id);
        // the copies keep the animation (#719)
        expect(templates.listTemplates(B)[0].bosses[BOSS].scenes).toEqual(LEGACY.bosses[BOSS].scenes);
    });
});
