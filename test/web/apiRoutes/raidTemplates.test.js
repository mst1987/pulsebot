const { mockRes, json, routerClient } = require("../../helpers/http");

jest.mock("../../../src/web/http/auth", () => ({
    getUser: jest.fn(),
    // "Ansicht als Rolle": the caller's own rights, and starting/stopping the view
    getRealUser: jest.fn(),
    setViewAs: jest.fn(() => true),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(),
    setActiveGuild: jest.fn(),
}));
jest.mock("../../../src/stores/settingsStore", () => ({
    getConfig: jest.fn(() => ({})),
    saveConfig: jest.fn((partial) => ({ ...partial })),
    listRecruitment: jest.fn(() => []),
    getRecruitment: jest.fn(),
    saveRecruitment: jest.fn(),
    deleteRecruitment: jest.fn(),
    listRecruitmentPosts: jest.fn(() => []),
    getRecruitmentPost: jest.fn(),
    saveRecruitmentPost: jest.fn(),
    deleteRecruitmentPost: jest.fn(),
    listRaidsheets: jest.fn(() => []),
    saveRaidsheet: jest.fn(),
    deleteRaidsheet: jest.fn(),
    listRaidTemplates: jest.fn(() => []),
    getRaidTemplate: jest.fn(),
    saveRaidTemplate: jest.fn(),
    saveRaidTemplates: jest.fn(),
    deleteRaidTemplate: jest.fn(),
    listNotify: jest.fn(() => []),
    getNotify: jest.fn(),
    saveNotify: jest.fn(),
    deleteNotify: jest.fn(),
    getRaidsheet: jest.fn(),
    // Default: no category sheet configured, so a raid links only its own copy.
    resolveEventSheetLink: jest.fn((eventSheet) => (eventSheet && eventSheet.url
        ? { url: eventSheet.url, name: eventSheet.sheetName || "", source: "event" }
        : null)),
}));
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "") }));
jest.mock("../../../src/services/discord/discord", () => require("../../helpers/discordMock").withClientHelpers({
    listGuilds: jest.fn(() => []),
    listCategories: jest.fn(() => []),
    listAllChannels: jest.fn(() => []),
    listTextChannels: jest.fn(() => []),
    listRoles: jest.fn(() => []),
    createChannel: jest.fn(),
    duplicateChannel: jest.fn(),
    listEmojis: jest.fn(() => []),
    postRecruitment: jest.fn(),
    editRecruitment: jest.fn(),
    scanRecruitment: jest.fn(() => Promise.resolve([])),
    listApplications: jest.fn(() => Promise.resolve({ applications: [], error: null })),
    getClient: jest.fn(() => null),
    getGuild: jest.fn(() => null),
    getChannelCategoryMap: jest.fn(() => ({})),
    listMembersWithRoles: jest.fn(() => Promise.resolve({ members: [], error: null })),
    resolveUserNames: jest.fn(() => Promise.resolve({})),
    postAnnouncement: jest.fn(),
    postMissingPing: jest.fn(),
    postLink: jest.fn(),
    editLink: jest.fn(),
}));
const mockGetTemplates = jest.fn(() => Promise.resolve([]));
const mockCreateEvent = jest.fn(() => Promise.resolve({ id: "ev1" }));
const mockGetPastEvents = jest.fn(() => Promise.resolve([]));
// The clone asks Raid-Helper for the one event it needs, by id.
const mockGetEvent = jest.fn(() => Promise.resolve(null));
const mockGetSetup = jest.fn(() => Promise.resolve({ setup: [] }));
jest.mock("../../../src/classes/raidhelper", () =>
    jest.fn().mockImplementation(() => ({
        getTemplates: mockGetTemplates,
        createEvent: mockCreateEvent,
        getPastEvents: mockGetPastEvents,
        getEvent: mockGetEvent,
        getSetup: mockGetSetup,
    })));
const auth = require("../../../src/web/http/auth");
const settingsStore = require("../../../src/stores/settingsStore");
const discord = require("../../../src/services/discord/discord");
const { emptyAccess } = require("../../../src/config/permissions");
const { request, post, patch, handle } = routerClient(require("../../../src/web/apiRoutes/raidTemplates"));

describe("web/apiRoutes/raidTemplates", () => {
    describe("/api/raid-templates (#266)", () => {
        const admin = () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
        };
        const kara = {
            id: "k1", name: "Karazhan PuG", versionId: "tbc", instanceIds: ["kara"], size: 10,
            composition: { tank: 2, healer: 3, melee: null, ranged: null },
            requiredBuffs: [], signupDeadline: null, fairness: false, wishes: false, raidhelperTemplateId: "",
        };
        const ony = { ...kara, id: "f1", name: "Forever Ony", versionId: "forever", instanceIds: ["forever-ony"], size: 40 };

        it("GET returns the templates with their badges and the category names", async () => {
            admin();
            settingsStore.listRaidTemplates.mockReturnValue([kara, ony, { ...kara, id: "rh-3", size: null, instanceIds: [] }]);
            settingsStore.getConfig.mockReturnValue({ categoryRaidTemplate: { cat1: "k1" } });
            discord.listCategories.mockReturnValue([{ id: "cat1", name: "Donnerstag" }]);
            const res = mockRes();
            await handle("/api/raid-templates", { method: "GET" }, res);
            const data = json(res).data;
            expect(data.categoryNames).toEqual({ cat1: "Donnerstag" });
            expect(data.templates.map((t) => [t.id, t.needsSize, t.incomplete, t.defaultFor])).toEqual([
                ["k1", false, false, ["cat1"]],
                ["f1", false, true, []],
                ["rh-3", true, false, []],
            ]);
        });

        it("POST creates and answers 201, ignoring an id in the body", async () => {
            admin();
            settingsStore.saveRaidTemplate.mockReturnValue({ template: kara });
            const res = await post("/api/raid-templates", { ...kara, id: "sneaky" });
            expect(settingsStore.saveRaidTemplate).toHaveBeenCalledWith(expect.objectContaining({ id: "", name: "Karazhan PuG" }));
            expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
            expect(json(res).data).toMatchObject({ id: "k1", needsSize: false });
        });

        it("POST answers 400 with the validation message", async () => {
            admin();
            settingsStore.saveRaidTemplate.mockReturnValue({ error: "Tanks + Heiler (11) passen nicht in die Größe 10." });
            const res = await post("/api/raid-templates", kara);
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res).error.message).toMatch(/passen nicht/);
        });

        it("PATCH updates by id, 400 without id, 404 for an unknown one", async () => {
            admin();
            settingsStore.saveRaidTemplate.mockReturnValue({ template: { ...kara, name: "Neu" } });
            let res = await patch("/api/raid-templates", { ...kara, name: "Neu" });
            expect(json(res).data.name).toBe("Neu");

            res = await patch("/api/raid-templates", { name: "x" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));

            settingsStore.saveRaidTemplate.mockReturnValue({ notFound: true, error: "Vorlage nicht gefunden." });
            res = await patch("/api/raid-templates", kara);
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
        });

        it("DELETE removes a template nobody uses as default", async () => {
            admin();
            settingsStore.getRaidTemplate.mockReturnValue(kara);
            settingsStore.getConfig.mockReturnValue({ categoryRaidTemplate: { cat1: "other" } });
            const res = await request("DELETE", "/api/raid-templates", { id: "k1" });
            expect(settingsStore.deleteRaidTemplate).toHaveBeenCalledWith("k1");
            expect(json(res)).toEqual({ data: { id: "k1" } });
        });

        it("DELETE answers 409 and names the category when the template is a default", async () => {
            admin();
            settingsStore.getRaidTemplate.mockReturnValue(kara);
            settingsStore.getConfig.mockReturnValue({ categoryRaidTemplate: { cat1: "k1" } });
            discord.listCategories.mockReturnValue([{ id: "cat1", name: "Donnerstag" }]);
            const res = await request("DELETE", "/api/raid-templates", { id: "k1" });
            expect(res.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
            expect(json(res).error.message).toContain("Standard für Donnerstag");
            expect(settingsStore.deleteRaidTemplate).not.toHaveBeenCalled();
        });

        it("DELETE answers 404 for an unknown template", async () => {
            admin();
            settingsStore.getRaidTemplate.mockReturnValue(null);
            const res = await request("DELETE", "/api/raid-templates", { id: "gone" });
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
        });

        it("reads with raids:read, but writes only with raids:write", async () => {
            auth.getUser.mockReturnValue({ id: "2", name: "Leser", isAdmin: false, access: { ...emptyAccess(), raids: { read: true, write: false } } });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.listRaidTemplates.mockReturnValue([]);
            const read = mockRes();
            await handle("/api/raid-templates", { method: "GET" }, read);
            expect(read.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            for (const method of ["POST", "PATCH", "DELETE"]) {
                const res = await request(method, "/api/raid-templates", kara);
                expect({ method, status: res.writeHead.mock.calls[0][0] }).toEqual({ method, status: 403 });
            }
        });
    });

    describe("POST /api/raid-templates/import", () => {
        it("returns 400 when Raid-Helper has no templates", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            mockGetTemplates.mockResolvedValue([]);
            const res = await post("/api/raid-templates/import", {});
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
        });

        it("imports and returns added/updated counts plus the refreshed list", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            mockGetTemplates.mockResolvedValue([{ id: "t1", name: "GDKP Kara" }]);
            settingsStore.saveRaidTemplates.mockReturnValue({ added: 1, updated: 0 });
            settingsStore.getConfig.mockReturnValue({});
            settingsStore.listRaidTemplates.mockReturnValue([{ id: "rh-t1", name: "GDKP Kara", versionId: "tbc", instanceIds: [], size: null, raidhelperTemplateId: "t1" }]);

            const res = await post("/api/raid-templates/import", {});

            expect(settingsStore.saveRaidTemplates).toHaveBeenCalledWith([{ id: "t1", name: "GDKP Kara" }]);
            expect(json(res).data).toMatchObject({ added: 1, updated: 0, templates: [{ id: "rh-t1", needsSize: true, defaultFor: [] }] });
        });
    });
});
