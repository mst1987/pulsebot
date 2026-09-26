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
const auth = require("../../../src/web/http/auth");
const settingsStore = require("../../../src/stores/settingsStore");
const { post, handle } = routerClient(require("../../../src/web/apiRoutes/notifyTemplates"));

describe("web/apiRoutes/notifyTemplates", () => {
    describe("GET /api/notify-templates", () => {
        it("returns 401 for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = mockRes();
            await handle("/api/notify-templates", { method: "GET" }, res);
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
        });

        it("returns the stored templates", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            settingsStore.listNotify.mockReturnValue([{ id: "tpl1", name: "Standard-Aufruf" }]);
            const res = mockRes();
            await handle("/api/notify-templates", { method: "GET" }, res);
            expect(json(res)).toEqual({ data: { templates: [{ id: "tpl1", name: "Standard-Aufruf" }] } });
        });
    });

    describe("POST /api/notify-templates (save template)", () => {
        it("creates a new template", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.saveNotify.mockReturnValue({ id: "tpl1", name: "Standard-Aufruf", title: "Anmeldung", body: "Bitte anmelden" });

            const res = await post("/api/notify-templates", { name: "Standard-Aufruf", title: "Anmeldung", body: "Bitte anmelden" });

            expect(settingsStore.saveNotify).toHaveBeenCalledWith({ name: "Standard-Aufruf", title: "Anmeldung", body: "Bitte anmelden" });
            expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
            expect(json(res)).toEqual({ data: { template: { id: "tpl1", name: "Standard-Aufruf", title: "Anmeldung", body: "Bitte anmelden" } } });
        });

        it("updates an existing template by id", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.saveNotify.mockReturnValue({ id: "tpl1", name: "Renamed", title: "Anmeldung", body: "Neuer Text" });

            const res = await post("/api/notify-templates", { id: "tpl1", name: "Renamed", title: "Anmeldung", body: "Neuer Text" });

            expect(settingsStore.saveNotify).toHaveBeenCalledWith({ id: "tpl1", name: "Renamed", title: "Anmeldung", body: "Neuer Text" });
            expect(json(res)).toEqual({ data: { template: { id: "tpl1", name: "Renamed", title: "Anmeldung", body: "Neuer Text" } } });
        });
    });

    describe("POST /api/notify-templates/delete", () => {
        it("returns 404 when nothing was removed", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.deleteNotify.mockReturnValue(false);
            const res = await post("/api/notify-templates/delete", { id: "tpl1" });
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
        });

        it("deletes and returns the id", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.deleteNotify.mockReturnValue(true);
            const res = await post("/api/notify-templates/delete", { id: "tpl1" });
            expect(json(res)).toEqual({ data: { id: "tpl1" } });
        });
    });
});
