const { json, status, routerClient } = require("../../../helpers/http");

jest.mock("../../../../src/web/http/auth", () => ({
    getUser: jest.fn(),
    // "Ansicht als Rolle": the caller's own rights, and starting/stopping the view
    getRealUser: jest.fn(),
    setViewAs: jest.fn(() => true),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(),
    setActiveGuild: jest.fn(),
}));
jest.mock("../../../../src/stores/settings/settingsStore", () => ({
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
jest.mock("../../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "") }));
jest.mock("../../../../src/services/discord/discord", () => require("../../../helpers/discordMock").withClientHelpers({
    listGuilds: jest.fn(() => []),
    listCategories: jest.fn(() => []),
    listAllChannels: jest.fn(() => []),
    listTextChannels: jest.fn(() => []),
    listRecruitmentTargets: jest.fn(() => []),
    listInviteChannels: jest.fn(() => []),
    createRecruitmentInvite: jest.fn(),
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
const auth = require("../../../../src/web/http/auth");
const settingsStore = require("../../../../src/stores/settings/settingsStore");
const { activeGuildFor } = require("../../../../src/web/http/activeGuild");
const discord = require("../../../../src/services/discord/discord");
const { post, get } = routerClient(require("../../../../src/web/apiRoutes/system/recruitment"));

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

        it("hands the page the versions to filter by and the main version (#553)", async () => {
            const res = await get("/api/recruitment", { view: "posts" });
            const { data } = json(res);
            expect(data.gameVersions.map((v) => v.id)).toEqual(["tbc", "classic", "forever"]);
            expect(data.mainVersion).toBe("tbc");
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
            // the application channel of the active server (#924), not another server's
            activeGuildFor.mockReturnValue("1800000000000000001");
            settingsStore.getConfig.mockReturnValue({ serverSettings: {
                "1800000000000000001": { applicationChannelId: "1800000000000000011" },
                "1800000000000000002": { applicationChannelId: "1800000000000000012" },
            } });
            discord.listApplications.mockResolvedValue({
                applications: [{ threadId: "a1", classSpec: "Druid – Balance", createdAt: Date.now(), archived: false }],
                error: null,
            });

            const res = await get("/api/recruitment", { view: "applications" });

            expect(discord.listApplications).toHaveBeenCalledWith("1800000000000000011");
            expect(json(res).data).toMatchObject({
                view: "applications",
                applications: [{ threadId: "a1", className: "Druid", spec: "Balance", classIcon: "classicon_druid", status: "neu" }],
                applicationsError: null,
                applicationChannelId: "1800000000000000011",
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

    describe("GET /api/recruitment?version= (#741)", () => {
        const tpls = [{ id: "t1", versionId: "tbc" }, { id: "t2", versionId: "forever" }, { id: "t3" }];
        const posts = [{ id: "p1", versionId: "tbc" }, { id: "p2", versionId: "forever" }];
        beforeEach(() => {
            activeGuildFor.mockReturnValue("");
            settingsStore.listRecruitment.mockReturnValue(tpls);
            settingsStore.listRecruitmentPosts.mockReturnValue(posts);
            settingsStore.getConfig.mockReturnValue({ mainVersion: "tbc" });
        });
        afterEach(() => {
            settingsStore.listRecruitment.mockReturnValue([]);
            settingsStore.listRecruitmentPosts.mockReturnValue([]);
            settingsStore.getConfig.mockReturnValue({});
        });

        it("answers the lists of the asked version, an entry without a version counting as TBC", async () => {
            const forever = json(await get("/api/recruitment", { version: "forever" })).data;
            expect(forever.templates.map((t) => t.id)).toEqual(["t2"]);
            expect(forever.posts.map((p) => p.id)).toEqual(["p2"]);
            const tbc = json(await get("/api/recruitment", { version: "tbc" })).data;
            expect(tbc.templates.map((t) => t.id)).toEqual(["t1", "t3"]);
        });

        it("keeps every shown version when no version is asked", async () => {
            expect(json(await get("/api/recruitment")).data.templates.map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
        });

        it("keeps the entry an editor is opened on, whatever its version", async () => {
            const data = json(await get("/api/recruitment", { version: "forever", edit: "t1", editpost: "p1" })).data;
            expect(data.templates.map((t) => t.id)).toEqual(["t1", "t2"]);
            expect(data.posts.map((p) => p.id)).toEqual(["p1", "p2"]);
        });

        it("answers the applications of the asked version", async () => {
            discord.listApplications.mockResolvedValue({
                applications: [{ id: "a1", versionId: "forever" }, { id: "a2" }], error: null,
            });
            const data = json(await get("/api/recruitment", { view: "applications", version: "forever" })).data;
            expect(data.applications.map((a) => a.id)).toEqual(["a1"]);
        });

        it("answers the main version while the others are hidden, whatever is asked (#563)", async () => {
            settingsStore.getConfig.mockReturnValue({ mainVersion: "tbc", hideOtherVersions: true });
            const data = json(await get("/api/recruitment", { version: "forever" })).data;
            expect(data.templates.map((t) => t.id)).toEqual(["t1", "t3"]);
            expect(data.posts.map((p) => p.id)).toEqual(["p1"]);
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
            settingsStore.getRecruitment.mockReturnValue({ id: "t1", content: "hi", title: "", body: "", buttonLabel: "", versionId: "classic" });
            discord.postRecruitment.mockResolvedValue({ guildId: "g1", channelId: "c1", messageId: "m1" });
            settingsStore.saveRecruitmentPost.mockReturnValue({ id: "p1" });

            const res = await post("/api/recruitment/post", { templateId: "t1", channelId: "c1" });

            expect(discord.postRecruitment).toHaveBeenCalledWith("c1", expect.objectContaining({ id: "t1", versionId: "classic" }));
            // the post keeps the version its button names (#553)
            expect(settingsStore.saveRecruitmentPost).toHaveBeenCalledWith(expect.objectContaining({
                guildId: "g1", channelId: "c1", messageId: "m1", source: "web", templateId: "t1", versionId: "classic",
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

            // a post from before (no buttonKind) stays an apply post
            const sent = { content: "new", title: "", body: "", buttonLabel: "Bewerben", buttonKind: "apply", linkUrl: "", forumTitle: "", versionId: undefined };
            expect(discord.editRecruitment).toHaveBeenCalledWith("c1", "m1", sent);
            expect(settingsStore.saveRecruitmentPost).toHaveBeenCalledWith({ id: "p1", ...sent });
            expect(json(res)).toEqual({ data: { id: "p1", content: "new", notice: "" } });
        });

        it("saves the text but keeps the old title when Discord refuses the rename for now", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.getRecruitmentPost.mockReturnValue({ id: "p1", channelId: "t1", messageId: "t1", parentChannelId: "f1", forumTitle: "Alt" });
            settingsStore.saveRecruitmentPost.mockImplementation((p) => p);
            discord.editRecruitment.mockResolvedValueOnce({ notice: "title_rate_limited" });

            const res = await post("/api/recruitment/post-update", { id: "p1", content: "neu", forumTitle: "Neu" });

            expect(status(res)).toBe(200);
            expect(discord.editRecruitment).toHaveBeenLastCalledWith("t1", "t1", expect.objectContaining({ forumTitle: "Neu" }));
            expect(settingsStore.saveRecruitmentPost).toHaveBeenLastCalledWith(expect.objectContaining({ content: "neu", forumTitle: "Alt" }));
            expect(json(res).data).toMatchObject({ notice: "title_rate_limited", forumTitle: "Alt" });
            settingsStore.saveRecruitmentPost.mockReset();
        });

        it("answers thread_locked and update_failed without saving", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.getRecruitmentPost.mockReturnValue({ id: "p1", channelId: "c1", messageId: "m1" });
            settingsStore.saveRecruitmentPost.mockClear();

            discord.editRecruitment.mockRejectedValueOnce(Object.assign(new Error("Beitrag gesperrt"), { code: "thread_locked" }));
            const locked = await post("/api/recruitment/post-update", { id: "p1", content: "x" });
            expect(status(locked)).toBe(400);
            expect(json(locked).error).toEqual({ code: "thread_locked", message: "Beitrag gesperrt" });

            discord.editRecruitment.mockRejectedValueOnce(new Error("Unknown Message"));
            const failed = await post("/api/recruitment/post-update", { id: "p1", content: "x" });
            expect(json(failed).error).toEqual({ code: "update_failed", message: "Unknown Message" });
            expect(settingsStore.saveRecruitmentPost).not.toHaveBeenCalled();
        });

        it("renames a forum post and keeps its link, or takes a new valid one", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.getRecruitmentPost.mockReturnValue({
                id: "p1", channelId: "t1", messageId: "t1", parentChannelId: "f1", forumTitle: "Alt",
                buttonKind: "link", linkUrl: "https://discord.gg/alt", versionId: "tbc",
            });
            settingsStore.saveRecruitmentPost.mockReturnValue({ id: "p1" });

            await post("/api/recruitment/post-update", { id: "p1", content: "x", buttonLabel: "", forumTitle: "  Neu  " });
            expect(discord.editRecruitment).toHaveBeenLastCalledWith("t1", "t1", expect.objectContaining({
                buttonKind: "link", linkUrl: "https://discord.gg/alt", forumTitle: "Neu",
            }));

            await post("/api/recruitment/post-update", { id: "p1", content: "x", linkUrl: "https://discord.com/invite/neu" });
            expect(discord.editRecruitment).toHaveBeenLastCalledWith("t1", "t1", expect.objectContaining({
                linkUrl: "https://discord.com/invite/neu", forumTitle: "Alt",
            }));

            discord.editRecruitment.mockClear();
            const bad = await post("/api/recruitment/post-update", { id: "p1", content: "x", linkUrl: "https://evil.example/x" });
            expect(status(bad)).toBe(400);
            expect(json(bad).error.code).toBe("invalid_link");
            expect(discord.editRecruitment).not.toHaveBeenCalled();
        });

        it("keeps the post's version on its button (#553)", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.getRecruitmentPost.mockReturnValue({ id: "p1", channelId: "c1", messageId: "m1", versionId: "classic" });
            settingsStore.saveRecruitmentPost.mockReturnValue({ id: "p1" });
            await post("/api/recruitment/post-update", { id: "p1", content: "new", buttonLabel: "Los", versionId: "tbc" });
            expect(discord.editRecruitment).toHaveBeenCalledWith("c1", "m1", expect.objectContaining({ versionId: "classic" }));
            expect(settingsStore.saveRecruitmentPost).toHaveBeenCalledWith(expect.objectContaining({ versionId: "classic" }));
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

        it("keeps a found forum link post's forum, title and link", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            activeGuildFor.mockReturnValue("guild-1");
            settingsStore.saveRecruitmentPost.mockClear();
            discord.scanRecruitment.mockResolvedValue([{
                guildId: "guild-1", channelId: "t1", messageId: "t1", channelName: "recruitment", parentChannelId: "f1",
                forumTitle: "Wir suchen", buttonKind: "link", linkUrl: "https://discord.gg/abc", buttonLabel: "Komm rein",
            }]);

            await post("/api/recruitment/scan", {});

            expect(settingsStore.saveRecruitmentPost).toHaveBeenCalledWith(expect.objectContaining({
                channelId: "t1", parentChannelId: "f1", forumTitle: "Wir suchen", buttonKind: "link",
                linkUrl: "https://discord.gg/abc", buttonLabel: "Komm rein", source: "scan",
            }));
        });

        it("answers scan_failed when Discord fails", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            activeGuildFor.mockReturnValue("guild-1");
            discord.scanRecruitment.mockRejectedValueOnce(new Error("Missing Access"));
            const res = await post("/api/recruitment/scan", {});
            expect(status(res)).toBe(400);
            expect(json(res).error).toEqual({ code: "scan_failed", message: "Missing Access" });
        });
    });

    describe("default label of a link button", () => {
        beforeEach(() => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
        });
        afterEach(() => {
            settingsStore.getConfig.mockReturnValue({});
            activeGuildFor.mockReturnValue("");
        });

        it("follows the language of the active server", async () => {
            activeGuildFor.mockReturnValue("g-en");
            settingsStore.getConfig.mockReturnValue({ serverSettings: { "g-en": { botLanguage: "en" } } });
            expect(json(await get("/api/recruitment")).data.defaultLinkLabel).toBe("Join server");
            activeGuildFor.mockReturnValue("g-de");
            expect(json(await get("/api/recruitment")).data.defaultLinkLabel).toBe("Server beitreten");
        });

        it("labels a posted link button without a typed text in that language, a typed one stays", async () => {
            activeGuildFor.mockReturnValue("g-en");
            settingsStore.getConfig.mockReturnValue({ serverSettings: { "g-en": { botLanguage: "en" } } });
            settingsStore.getRecruitment.mockReturnValue({ id: "t1", content: "hi", buttonLabel: "" });
            discord.postRecruitment.mockResolvedValue({ guildId: "g-en", channelId: "c1", messageId: "m1" });

            await post("/api/recruitment/post", { templateId: "t1", channelId: "c1", buttonKind: "link", linkUrl: "https://discord.gg/abc" });
            expect(discord.postRecruitment).toHaveBeenLastCalledWith("c1", expect.objectContaining({ buttonLabel: "Join server" }));

            await post("/api/recruitment/post", { templateId: "t1", channelId: "c1", buttonKind: "link", linkUrl: "https://discord.gg/abc", buttonLabel: "Hop in" });
            expect(discord.postRecruitment).toHaveBeenLastCalledWith("c1", expect.objectContaining({ buttonLabel: "Hop in" }));
        });
    });
});

// Rights hold per server (#925, docs/permissions.md): the orga of server B posts into, edits and
// stops tracking nothing of server A; a full admin reaches every server.
describe("web/apiRoutes/recruitment - rights per server (#925)", () => {
    const orgaOfB = { id: "7", name: "Bob", isAdmin: false, isOrga: true, access: { recruitment: { read: true, write: true } } };
    const admin = { id: "1", name: "Admin", isAdmin: true };
    const channels = new Map([["cA", { id: "cA", guildId: "A" }], ["cB", { id: "cB", guildId: "B" }]]);

    beforeEach(() => {
        auth.checkCsrf.mockReturnValue(true);
        activeGuildFor.mockReturnValue("B");
        discord.getClient.mockReturnValue({ channels: { cache: channels } });
        settingsStore.getRecruitment.mockReturnValue({ id: "t1", content: "hi", title: "", body: "", buttonLabel: "", versionId: "tbc" });
        settingsStore.getRecruitmentPost.mockImplementation((id) => ({ pA: { id: "pA", guildId: "A", channelId: "cA", messageId: "m1" }, pB: { id: "pB", guildId: "B", channelId: "cB", messageId: "m2" } })[id] || null);
        settingsStore.deleteRecruitmentPost.mockReturnValue(true);
        discord.postRecruitment.mockResolvedValue({ guildId: "B", channelId: "cB", messageId: "m9" });
    });

    afterEach(() => {
        activeGuildFor.mockReturnValue("");
        discord.getClient.mockReturnValue(null);
        settingsStore.getRecruitmentPost.mockReset();
    });

    it("refuses posting into a channel of another server or an unknown one with 403", async () => {
        auth.getUser.mockReturnValue(orgaOfB);
        for (const channelId of ["cA", "c-unknown"]) {
            const res = await post("/api/recruitment/post", { templateId: "t1", channelId });
            expect(status(res)).toBe(403);
            expect(json(res).error.code).toBe("other_server");
        }
        expect(discord.postRecruitment).not.toHaveBeenCalled();
        await post("/api/recruitment/post", { templateId: "t1", channelId: "cB" });
        expect(discord.postRecruitment).toHaveBeenCalledWith("cB", expect.any(Object));
    });

    it("answers 404 for editing or untracking a post of another server", async () => {
        auth.getUser.mockReturnValue(orgaOfB);
        expect(status(await post("/api/recruitment/post-update", { id: "pA", content: "x" }))).toBe(404);
        expect(status(await post("/api/recruitment/post-delete", { id: "pA" }))).toBe(404);
        expect(discord.editRecruitment).not.toHaveBeenCalled();
        expect(settingsStore.deleteRecruitmentPost).not.toHaveBeenCalled();
        expect(status(await post("/api/recruitment/post-delete", { id: "pB" }))).toBe(200);
        expect(settingsStore.deleteRecruitmentPost).toHaveBeenCalledWith("pB");
    });

    it("lets a full admin act on every server", async () => {
        auth.getUser.mockReturnValue(admin);
        await post("/api/recruitment/post", { templateId: "t1", channelId: "cA" });
        expect(discord.postRecruitment).toHaveBeenCalledWith("cA", expect.any(Object));
        expect(status(await post("/api/recruitment/post-delete", { id: "pA" }))).toBe(200);
    });

    it("creates an invite only on the caller's own server and only into a channel of it", async () => {
        auth.getUser.mockReturnValue(orgaOfB);
        discord.createRecruitmentInvite.mockResolvedValue({ code: "abc", url: "https://discord.gg/abc" });
        // another server's channel: 403 and no invite made
        const foreign = await post("/api/recruitment/invite", { guildId: "A", channelId: "cA" });
        expect(status(foreign)).toBe(403);
        expect(json(foreign).error.code).toBe("other_server");
        // a channel of A named as one of B
        const wrong = await post("/api/recruitment/invite", { guildId: "B", channelId: "cA" });
        expect(json(wrong).error.code).toBe("wrong_guild");
        expect(status(await post("/api/recruitment/invite", { guildId: "B" }))).toBe(400);
        expect(discord.createRecruitmentInvite).not.toHaveBeenCalled();

        const res = await post("/api/recruitment/invite", { guildId: "B", channelId: "cB" });
        expect(status(res)).toBe(201);
        expect(json(res).data).toEqual({ code: "abc", url: "https://discord.gg/abc" });
        // the bot's permanent invite is reused unless "Neu erzeugen" asks for a fresh one
        expect(discord.createRecruitmentInvite).toHaveBeenCalledWith("cB", expect.stringContaining("Recruitment-Link"), { fresh: false });
        await post("/api/recruitment/invite", { guildId: "B", channelId: "cB", fresh: true });
        expect(discord.createRecruitmentInvite).toHaveBeenLastCalledWith("cB", expect.any(String), { fresh: true });
    });

    it("answers invite_failed for any other error", async () => {
        auth.getUser.mockReturnValue(orgaOfB);
        discord.createRecruitmentInvite.mockRejectedValueOnce(new Error("Maximum number of invites reached"));
        const res = await post("/api/recruitment/invite", { guildId: "B", channelId: "cB" });
        expect(status(res)).toBe(400);
        expect(json(res).error).toEqual({ code: "invite_failed", message: "Maximum number of invites reached" });
    });

    it("says so when the bot may not create an invite there", async () => {
        auth.getUser.mockReturnValue(orgaOfB);
        discord.createRecruitmentInvite.mockRejectedValue(Object.assign(new Error("Recht fehlt"), { code: "invite_permission" }));
        const res = await post("/api/recruitment/invite", { guildId: "B", channelId: "cB" });
        expect(status(res)).toBe(400);
        expect(json(res).error.code).toBe("invite_permission");
    });

    it("offers invites only on servers the caller may act on, suggesting a tracked post's channel", async () => {
        auth.getUser.mockReturnValue(orgaOfB);
        discord.listGuilds.mockReturnValue([{ id: "A", name: "Pulse A" }, { id: "B", name: "Pulse B" }]);
        discord.listInviteChannels.mockImplementation((g) => (g === "B"
            ? [{ id: "cB", name: "willkommen", canInvite: true }, { id: "fB", name: "forum", canInvite: true }]
            : [{ id: "cA", name: "a", canInvite: true }]));
        settingsStore.listRecruitmentPosts.mockReturnValue([{ id: "p", guildId: "B", channelId: "t9", parentChannelId: "fB" }]);
        try {
            const data = json(await get("/api/recruitment")).data;
            expect(data.inviteServers.map((s) => [s.id, s.suggestedChannelId])).toEqual([["B", "fB"]]);
            auth.getUser.mockReturnValue(admin);
            const all = json(await get("/api/recruitment")).data;
            expect(all.inviteServers.map((s) => s.id)).toEqual(["A", "B"]);
            expect(all.inviteServers[0].suggestedChannelId).toBe("cA");
        } finally {
            discord.listGuilds.mockReturnValue([]);
            discord.listInviteChannels.mockReset().mockReturnValue([]);
            settingsStore.listRecruitmentPosts.mockReturnValue([]);
        }
    });

    it("posts with a link button only for a Discord link", async () => {
        auth.getUser.mockReturnValue(orgaOfB);
        const bad = await post("/api/recruitment/post", { templateId: "t1", channelId: "cB", buttonKind: "link", linkUrl: "https://evil.example" });
        expect(status(bad)).toBe(400);
        expect(json(bad).error.code).toBe("invalid_link");
        expect(discord.postRecruitment).not.toHaveBeenCalled();

        await post("/api/recruitment/post", { templateId: "t1", channelId: "cB", buttonKind: "link", linkUrl: " https://discord.gg/abc ", buttonLabel: "Komm rein" });
        expect(discord.postRecruitment).toHaveBeenCalledWith("cB", expect.objectContaining({
            buttonKind: "link", linkUrl: "https://discord.gg/abc", buttonLabel: "Komm rein",
        }));
        expect(settingsStore.saveRecruitmentPost).toHaveBeenLastCalledWith(expect.objectContaining({
            buttonKind: "link", linkUrl: "https://discord.gg/abc", parentChannelId: "", forumTitle: "",
        }));
    });

    it("tracks a forum post by its thread, under the forum's name and with its title", async () => {
        auth.getUser.mockReturnValue(orgaOfB);
        const forumChannels = new Map([["fB", { id: "fB", guildId: "B", name: "recruitment" }]]);
        discord.getClient.mockReturnValue({ channels: { cache: forumChannels, fetch: jest.fn(async (id) => forumChannels.get(id) || null) } });
        discord.postRecruitment.mockResolvedValue({ guildId: "B", channelId: "t1", messageId: "t1", parentChannelId: "fB" });
        await post("/api/recruitment/post", {
            templateId: "t1", channelId: "fB", buttonKind: "link", linkUrl: "https://discord.gg/abc", forumTitle: " Wir suchen ",
        });
        expect(discord.postRecruitment).toHaveBeenCalledWith("fB", expect.objectContaining({ forumTitle: "Wir suchen" }));
        expect(settingsStore.saveRecruitmentPost).toHaveBeenLastCalledWith(expect.objectContaining({
            channelId: "t1", messageId: "t1", parentChannelId: "fB", channelName: "recruitment", forumTitle: "Wir suchen",
        }));

        discord.postRecruitment.mockRejectedValue(Object.assign(new Error("Titel fehlt"), { code: "title_required" }));
        const res = await post("/api/recruitment/post", { templateId: "t1", channelId: "fB" });
        expect(json(res).error.code).toBe("title_required");
    });
});
