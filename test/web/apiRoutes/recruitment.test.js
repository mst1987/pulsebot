const { json, routerClient } = require("../../helpers/http");

jest.mock("../../../src/web/auth", () => ({
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
jest.mock("../../../src/web/activeGuild", () => ({ activeGuildFor: jest.fn(() => "") }));
jest.mock("../../../src/web/discord", () => require("../../helpers/discordMock").withClientHelpers({
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
const auth = require("../../../src/web/auth");
const settingsStore = require("../../../src/stores/settingsStore");
const { activeGuildFor } = require("../../../src/web/activeGuild");
const discord = require("../../../src/web/discord");
const { post, get } = routerClient(require("../../../src/web/apiRoutes/recruitment"));

describe("web/apiRoutes/recruitment", () => {
    describe("GET /api/recruitment", () => {
        beforeEach(() => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
        });

        it("returns 401 for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = await get("/api/recruitment");
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
        });

        it("does not fetch applications outside the applications tab", async () => {
            await get("/api/recruitment", { view: "posts" });
            expect(discord.listApplications).not.toHaveBeenCalled();
        });

        it("does not fetch applications while editing a template or post", async () => {
            await get("/api/recruitment", { view: "applications", edit: "t1" });
            expect(discord.listApplications).not.toHaveBeenCalled();
            await get("/api/recruitment", { view: "applications", editpost: "p1" });
            expect(discord.listApplications).not.toHaveBeenCalled();
        });

        it("fetches applications only on the applications tab and returns them", async () => {
            settingsStore.getConfig.mockReturnValue({ applicationChannelId: "chan1" });
            discord.listApplications.mockResolvedValue({
                applications: [{ threadId: "a1", classSpec: "Druid – Balance", createdAt: Date.now(), archived: false }],
                error: null,
            });

            const res = await get("/api/recruitment", { view: "applications" });

            expect(discord.listApplications).toHaveBeenCalledWith("chan1");
            expect(json(res).data).toMatchObject({
                view: "applications",
                applications: [{ threadId: "a1", className: "Druid", spec: "Balance", classIcon: "classicon_druid", status: "neu" }],
                applicationsError: null,
                applicationChannelId: "chan1",
            });
        });

        it("names the active guild for the page head", async () => {
            activeGuildFor.mockReturnValueOnce("g1");
            discord.listGuilds.mockReturnValueOnce([{ id: "g0", name: "Andere" }, { id: "g1", name: "Pulse" }]);
            const res = await get("/api/recruitment", { view: "posts" });
            expect(json(res).data.guildName).toBe("Pulse");
        });

        it("resolves editing/editingPost from the id query params", async () => {
            settingsStore.getRecruitment.mockReturnValue({ id: "t1", name: "Tpl" });
            settingsStore.getRecruitmentPost.mockReturnValue({ id: "p1", content: "hi" });

            const res = await get("/api/recruitment", { edit: "t1", editpost: "p1" });

            expect(settingsStore.getRecruitment).toHaveBeenCalledWith("t1");
            expect(settingsStore.getRecruitmentPost).toHaveBeenCalledWith("p1");
            expect(json(res).data).toMatchObject({
                editing: { id: "t1", name: "Tpl" },
                editingPost: { id: "p1", content: "hi" },
            });
        });

        it("filters posts to the active guild", async () => {
            activeGuildFor.mockReturnValue("guild-1");
            settingsStore.listRecruitmentPosts.mockReturnValue([
                { id: "p1", guildId: "guild-1" },
                { id: "p2", guildId: "guild-2" },
            ]);

            const res = await get("/api/recruitment");

            expect(json(res).data.posts).toEqual([{ id: "p1", guildId: "guild-1" }]);
        });
    });

    describe("POST /api/recruitment (save template)", () => {
        it("saves and returns the template", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.saveRecruitment.mockReturnValue({ id: "t1", name: "Tpl", content: "hi" });

            const res = await post("/api/recruitment", { name: "Tpl", content: "hi" });

            expect(settingsStore.saveRecruitment).toHaveBeenCalledWith({ name: "Tpl", content: "hi" });
            expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
            expect(json(res)).toEqual({ data: { id: "t1", name: "Tpl", content: "hi" } });
        });
    });

    describe("POST /api/recruitment/delete", () => {
        it("returns 404 when nothing was removed", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.deleteRecruitment.mockReturnValue(false);
            const res = await post("/api/recruitment/delete", { id: "t1" });
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
        });

        it("deletes and returns the id", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.deleteRecruitment.mockReturnValue(true);
            const res = await post("/api/recruitment/delete", { id: "t1" });
            expect(json(res)).toEqual({ data: { id: "t1" } });
        });
    });

    describe("POST /api/recruitment/post", () => {
        it("returns 400 when the template or channel is missing", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.getRecruitment.mockReturnValue(null);
            const res = await post("/api/recruitment/post", { templateId: "t1", channelId: "c1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(discord.postRecruitment).not.toHaveBeenCalled();
        });

        it("posts the template and tracks the message", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.getRecruitment.mockReturnValue({ id: "t1", content: "hi", title: "", body: "", buttonLabel: "" });
            discord.postRecruitment.mockResolvedValue({ guildId: "g1", channelId: "c1", messageId: "m1" });
            settingsStore.saveRecruitmentPost.mockReturnValue({ id: "p1" });

            const res = await post("/api/recruitment/post", { templateId: "t1", channelId: "c1" });

            expect(discord.postRecruitment).toHaveBeenCalledWith("c1", expect.objectContaining({ id: "t1" }));
            expect(settingsStore.saveRecruitmentPost).toHaveBeenCalledWith(expect.objectContaining({
                guildId: "g1", channelId: "c1", messageId: "m1", source: "web", templateId: "t1",
            }));
            expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
        });

        it("returns 400 with the Discord error message on failure", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.getRecruitment.mockReturnValue({ id: "t1", content: "hi" });
            discord.postRecruitment.mockRejectedValue(new Error("channel not found"));

            const res = await post("/api/recruitment/post", { templateId: "t1", channelId: "c1" });

            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "post_failed", message: "channel not found" } });
        });
    });

    describe("POST /api/recruitment/post-update", () => {
        it("returns 404 when the post is not found", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.getRecruitmentPost.mockReturnValue(null);
            const res = await post("/api/recruitment/post-update", { id: "p1", content: "new" });
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
            expect(discord.editRecruitment).not.toHaveBeenCalled();
        });

        it("edits the Discord message and updates the tracked post", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.getRecruitmentPost.mockReturnValue({ id: "p1", channelId: "c1", messageId: "m1" });
            settingsStore.saveRecruitmentPost.mockReturnValue({ id: "p1", content: "new" });

            const res = await post("/api/recruitment/post-update", { id: "p1", content: "new", buttonLabel: "Bewerben" });

            expect(discord.editRecruitment).toHaveBeenCalledWith("c1", "m1", { content: "new", title: "", body: "", buttonLabel: "Bewerben" });
            expect(settingsStore.saveRecruitmentPost).toHaveBeenCalledWith({ id: "p1", content: "new", title: "", body: "", buttonLabel: "Bewerben" });
            expect(json(res)).toEqual({ data: { id: "p1", content: "new" } });
        });
    });

    describe("POST /api/recruitment/post-delete", () => {
        it("deletes and returns the id", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.deleteRecruitmentPost.mockReturnValue(true);
            const res = await post("/api/recruitment/post-delete", { id: "p1" });
            expect(json(res)).toEqual({ data: { id: "p1" } });
        });
    });

    describe("POST /api/recruitment/scan", () => {
        it("returns 400 when no guild is active", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            activeGuildFor.mockReturnValue("");
            const res = await post("/api/recruitment/scan", {});
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
        });

        it("imports found posts and returns the count", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            activeGuildFor.mockReturnValue("guild-1");
            discord.scanRecruitment.mockResolvedValue([{ channelId: "c1", messageId: "m1" }, { channelId: "c2", messageId: "m2" }]);

            const res = await post("/api/recruitment/scan", {});

            expect(settingsStore.saveRecruitmentPost).toHaveBeenCalledTimes(2);
            expect(settingsStore.saveRecruitmentPost).toHaveBeenCalledWith(expect.objectContaining({ channelId: "c1", source: "scan" }));
            expect(json(res)).toEqual({ data: { count: 2 } });
        });
    });
});
