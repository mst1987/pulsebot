const { mockRes, json, routerClient } = require("../../../helpers/http");

// #927: Raid-Helper on for every server, as before it was set per server
jest.mock("../../../../src/utils/raidhelper/servers", () => require("../../../helpers/raidhelperOn").serversMock());
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
    allRaidTemplates: jest.fn(() => []),
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
// the listed servers are A and B: anything else resolves to the first one, as the real resolver does
jest.mock("../../../../src/services/discord/roles/guildRoles", () => ({
    ...jest.requireActual("../../../../src/services/discord/roles/guildRoles"),
    resolveServer: jest.fn(({ guildId }) => (["111111111111111111", "222222222222222222"].includes(guildId) ? guildId : "111111111111111111")),
}));
jest.mock("../../../../src/services/events/eventServer", () => ({
    ...jest.requireActual("../../../../src/services/events/eventServer"),
    guildOfCategory: jest.fn(() => ""),
}));
jest.mock("../../../../src/services/discord/discord", () => require("../../../helpers/discordMock").withClientHelpers({
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
jest.mock("../../../../src/classes/raidhelper", () =>
    jest.fn().mockImplementation(() => ({
        getTemplates: mockGetTemplates,
        createEvent: mockCreateEvent,
        getPastEvents: mockGetPastEvents,
        getEvent: mockGetEvent,
        getSetup: mockGetSetup,
    })));
const auth = require("../../../../src/web/http/auth");
const settingsStore = require("../../../../src/stores/settings/settingsStore");
const discord = require("../../../../src/services/discord/discord");
const { activeGuildFor } = require("../../../../src/web/http/activeGuild");
const { guildOfCategory } = require("../../../../src/services/events/eventServer");
const { emptyAccess } = require("../../../../src/config/permissions");
const { request, post, patch, handle, get } = routerClient(require("../../../../src/web/apiRoutes/events/raidTemplates"));

const A = "111111111111111111";
const B = "222222222222222222";
const orgaAccess = () => ({ ...emptyAccess(), raids: { read: true, write: true } });
const status = (res) => res.writeHead.mock.calls[0][0];

describe("web/apiRoutes/raidTemplates", () => {
    beforeEach(() => {
        activeGuildFor.mockReturnValue(A);
        guildOfCategory.mockReturnValue("");
        settingsStore.getConfig.mockReturnValue({ discordServers: [{ guildId: A }, { guildId: B }] });
        settingsStore.getRaidTemplate.mockReset();
        settingsStore.saveRaidTemplate.mockReset();
        settingsStore.saveRaidTemplates.mockReset();
        settingsStore.deleteRaidTemplate.mockReset();
        settingsStore.listRaidTemplates.mockReset().mockReturnValue([]);
        discord.listCategories.mockReset().mockReturnValue([]);
    });

    describe("/api/raid-templates (#266)", () => {
        const admin = () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
        };
        const kara = {
            id: "k1", name: "Karazhan PuG", versionId: "tbc", instanceIds: ["kara"], size: 10,
            composition: { tank: 2, healer: 3, melee: null, ranged: null },
            requiredBuffs: [], signupDeadline: null, fairness: false, wishes: false, raidhelperTemplateId: "",
            libraryGuildId: A,
        };
        const ony = { ...kara, id: "f1", name: "Forever Ony", versionId: "forever", instanceIds: ["forever-ony"], size: 40 };

        it("GET returns the templates of the active server with their badges and the category names", async () => {
            admin();
            settingsStore.listRaidTemplates.mockReturnValue([kara, ony, { ...kara, id: "rh-3", size: null, instanceIds: [] }]);
            settingsStore.getConfig.mockReturnValue({ categoryRaidTemplate: { cat1: "k1" } });
            discord.listCategories.mockReturnValue([{ id: "cat1", name: "Donnerstag" }]);
            const res = mockRes();
            await handle("/api/raid-templates", { method: "GET" }, res);
            const data = json(res).data;
            expect(settingsStore.listRaidTemplates).toHaveBeenCalledWith(A);
            expect(discord.listCategories).toHaveBeenCalledWith(A);
            expect(data.guildId).toBe(A);
            expect(data.categoryNames).toEqual({ cat1: "Donnerstag" });
            expect(data.templates.map((t) => [t.id, t.needsSize, t.incomplete, t.defaultFor])).toEqual([
                ["k1", false, false, ["cat1"]],
                ["f1", false, true, []],
                ["rh-3", true, false, []],
            ]);
        });

        it("GET ?version= answers the templates of that game version only (#741), the main version while the others are hidden (#563)", async () => {
            admin();
            settingsStore.listRaidTemplates.mockReturnValue([kara, ony]);
            const ask = async (query, config) => {
                settingsStore.getConfig.mockReturnValue(config);
                return json(await get("/api/raid-templates", query)).data.templates.map((t) => t.id);
            };
            expect(await ask({ version: "forever" }, { mainVersion: "tbc" })).toEqual(["f1"]);
            expect(await ask({ version: "tbc" }, { mainVersion: "tbc" })).toEqual(["k1"]);
            expect(await ask(undefined, { mainVersion: "tbc" })).toEqual(["k1", "f1"]);
            expect(await ask({ version: "forever" }, { mainVersion: "tbc", hideOtherVersions: true })).toEqual(["k1"]);
        });

        it("POST creates on the tab's server and answers 201, ignoring an id in the body", async () => {
            admin();
            settingsStore.saveRaidTemplate.mockReturnValue({ template: kara });
            const res = await post("/api/raid-templates", { ...kara, id: "sneaky" });
            expect(settingsStore.saveRaidTemplate).toHaveBeenCalledWith(A, expect.objectContaining({ id: "", name: "Karazhan PuG" }));
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
            expect(settingsStore.saveRaidTemplate).toHaveBeenCalledWith(A, expect.objectContaining({ id: "k1", name: "Neu" }));
            expect(json(res).data.name).toBe("Neu");

            res = await patch("/api/raid-templates", { name: "x", libraryGuildId: A });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));

            settingsStore.saveRaidTemplate.mockReturnValue({ notFound: true, error: "Vorlage nicht gefunden." });
            res = await patch("/api/raid-templates", kara);
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
        });

        it("DELETE removes a template nobody uses as default", async () => {
            admin();
            settingsStore.getRaidTemplate.mockReturnValue(kara);
            settingsStore.getConfig.mockReturnValue({ categoryRaidTemplate: { cat1: "other" } });
            const res = await request("DELETE", "/api/raid-templates", { id: "k1", libraryGuildId: A });
            expect(settingsStore.deleteRaidTemplate).toHaveBeenCalledWith(A, "k1");
            expect(json(res)).toEqual({ data: { id: "k1" } });
        });

        it("DELETE answers 409 and names the category when the template is a default", async () => {
            admin();
            settingsStore.getRaidTemplate.mockReturnValue(kara);
            settingsStore.getConfig.mockReturnValue({ categoryRaidTemplate: { cat1: "k1" } });
            discord.listCategories.mockReturnValue([{ id: "cat1", name: "Donnerstag" }]);
            const res = await request("DELETE", "/api/raid-templates", { id: "k1", libraryGuildId: A });
            expect(res.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
            expect(json(res).error.message).toContain("Standard für Donnerstag");
            expect(settingsStore.deleteRaidTemplate).not.toHaveBeenCalled();
        });

        it("DELETE: the default of another server's category does not block, a reference to the origin of a copy does", async () => {
            admin();
            guildOfCategory.mockImplementation((id) => (id === "foreign" ? B : A));
            settingsStore.getRaidTemplate.mockReturnValue({ ...kara, originId: "old" });

            settingsStore.getConfig.mockReturnValue({ categoryRaidTemplate: { foreign: "k1" } });
            await request("DELETE", "/api/raid-templates", { id: "k1", libraryGuildId: A });
            expect(settingsStore.deleteRaidTemplate).toHaveBeenCalledWith(A, "k1");

            settingsStore.deleteRaidTemplate.mockClear();
            settingsStore.getConfig.mockReturnValue({ categoryRaidTemplate: { own: "old" } });
            const res = await request("DELETE", "/api/raid-templates", { id: "k1", libraryGuildId: A });
            expect(status(res)).toBe(409);
            expect(settingsStore.deleteRaidTemplate).not.toHaveBeenCalled();
        });

        it("DELETE: a category of unknown server counts as using the template", async () => {
            admin();
            settingsStore.getRaidTemplate.mockReturnValue(kara);
            settingsStore.getConfig.mockReturnValue({ categoryRaidTemplate: { unknown: "k1" } });
            const res = await request("DELETE", "/api/raid-templates", { id: "k1", libraryGuildId: A });
            expect(status(res)).toBe(409);
        });

        it("DELETE answers 404 for an unknown template", async () => {
            admin();
            settingsStore.getRaidTemplate.mockReturnValue(null);
            const res = await request("DELETE", "/api/raid-templates", { id: "gone", libraryGuildId: A });
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
        });

        it("DELETE names the exact id: the old id of a copy is not what gets deleted", async () => {
            admin();
            settingsStore.getRaidTemplate.mockReturnValue({ ...kara, id: "copy", originId: "k1" });
            const res = await request("DELETE", "/api/raid-templates", { id: "k1", libraryGuildId: A });
            expect(status(res)).toBe(404);
            expect(settingsStore.deleteRaidTemplate).not.toHaveBeenCalled();
        });

        it("reads with raids:read, but writes only with raids:write", async () => {
            auth.getUser.mockReturnValue({ id: "2", name: "Leser", isAdmin: false, access: { ...emptyAccess(), raids: { read: true, write: false } } });
            auth.checkCsrf.mockReturnValue(true);
            const read = mockRes();
            await handle("/api/raid-templates", { method: "GET" }, read);
            expect(read.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            for (const method of ["POST", "PATCH", "DELETE"]) {
                const res = await request(method, "/api/raid-templates", kara);
                expect({ method, status: res.writeHead.mock.calls[0][0] }).toEqual({ method, status: 403 });
            }
        });
    });

    describe("a server sees and changes only its own templates (#1076)", () => {
        const orga = () => {
            auth.getUser.mockReturnValue({ id: "2", name: "Orga", isAdmin: false, access: orgaAccess() });
            auth.checkCsrf.mockReturnValue(true);
        };
        const stored = { id: "k1", name: "Kara", versionId: "tbc", instanceIds: ["kara"], size: 10, guildId: B };
        // what the real store answers for a template of another server
        const ownedByB = () => {
            settingsStore.getRaidTemplate.mockImplementation((server, id) => (server === B && id === "k1" ? stored : null));
            settingsStore.saveRaidTemplate.mockImplementation((server, data) => (server === B
                ? { template: { ...stored, ...data } }
                : { notFound: true, error: "Vorlage nicht gefunden." }));
            settingsStore.listRaidTemplates.mockImplementation((server) => (server === B ? [stored] : []));
        };

        it("GET: an orga member asking for another server gets 404 and no template", async () => {
            orga();
            ownedByB();
            const res = await get("/api/raid-templates", { guildId: B });
            expect(status(res)).toBe(404);
            expect(settingsStore.listRaidTemplates).not.toHaveBeenCalled();
        });

        it("GET: the list of the active server holds no foreign template", async () => {
            orga();
            ownedByB();
            const data = json(await get("/api/raid-templates")).data;
            expect(data.guildId).toBe(A);
            expect(data.templates).toEqual([]);
        });

        it("PATCH of a foreign template answers 404, it is not created here", async () => {
            orga();
            ownedByB();
            const res = await patch("/api/raid-templates", { id: "k1", name: "Meins", libraryGuildId: A });
            expect(status(res)).toBe(404);
            expect(settingsStore.saveRaidTemplate).toHaveBeenCalledWith(A, expect.objectContaining({ id: "k1" }));
        });

        it("DELETE of a foreign template answers 404 and deletes nothing", async () => {
            orga();
            ownedByB();
            const res = await request("DELETE", "/api/raid-templates", { id: "k1", libraryGuildId: A });
            expect(status(res)).toBe(404);
            expect(settingsStore.deleteRaidTemplate).not.toHaveBeenCalled();
        });

        it("every write from a tab of another server answers 409 server_switched and changes nothing", async () => {
            orga();
            ownedByB();
            activeGuildFor.mockReturnValue(B);
            const calls = [
                () => post("/api/raid-templates", { name: "x", libraryGuildId: A }),
                () => patch("/api/raid-templates", { id: "k1", name: "x", libraryGuildId: A }),
                () => request("DELETE", "/api/raid-templates", { id: "k1", libraryGuildId: A }),
                () => post("/api/raid-templates/import", { libraryGuildId: A }),
                // a body naming no server is no way in either
                () => patch("/api/raid-templates", { id: "k1", name: "x" }),
            ];
            for (const call of calls) {
                const res = await call();
                expect(status(res)).toBe(409);
                expect(json(res).error.code).toBe("server_switched");
            }
            expect(settingsStore.saveRaidTemplate).not.toHaveBeenCalled();
            expect(settingsStore.deleteRaidTemplate).not.toHaveBeenCalled();
            expect(settingsStore.saveRaidTemplates).not.toHaveBeenCalled();
        });

        it("a full admin reads and writes a listed server, an unlisted one is 404", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            ownedByB();
            const read = json(await get("/api/raid-templates", { guildId: B })).data;
            expect(read.guildId).toBe(B);
            expect(read.templates.map((t) => t.id)).toEqual(["k1"]);

            const written = await patch("/api/raid-templates", { id: "k1", name: "Neu", libraryGuildId: B });
            expect(status(written)).toBe(200);
            expect(settingsStore.saveRaidTemplate).toHaveBeenCalledWith(B, expect.objectContaining({ name: "Neu" }));

            const unlisted = "333333333333333333";
            expect(status(await get("/api/raid-templates", { guildId: unlisted }))).toBe(404);
            expect(status(await patch("/api/raid-templates", { id: "k1", name: "Neu", libraryGuildId: unlisted }))).toBe(404);
        });

        it("no active server: an orga member gets 400 no_active_server, a write as well", async () => {
            orga();
            activeGuildFor.mockReturnValue("");
            const read = await get("/api/raid-templates");
            expect(status(read)).toBe(400);
            expect(json(read).error.code).toBe("no_active_server");
            expect(status(await post("/api/raid-templates", { name: "x" }))).toBe(400);
        });
    });

    describe("POST /api/raid-templates/import", () => {
        beforeEach(() => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
        });

        it("returns 400 when Raid-Helper has no templates", async () => {
            mockGetTemplates.mockResolvedValue([]);
            const res = await post("/api/raid-templates/import", { libraryGuildId: A });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
        });

        it("imports onto the tab's server and returns added/updated counts plus the refreshed list", async () => {
            mockGetTemplates.mockResolvedValue([{ id: "t1", name: "GDKP Kara" }]);
            settingsStore.saveRaidTemplates.mockReturnValue({ added: 1, updated: 0 });
            settingsStore.listRaidTemplates.mockReturnValue([{ id: "rh-t1", name: "GDKP Kara", versionId: "tbc", instanceIds: [], size: null, raidhelperTemplateId: "t1" }]);

            const res = await post("/api/raid-templates/import", { libraryGuildId: A });

            expect(settingsStore.saveRaidTemplates).toHaveBeenCalledWith(A, [{ id: "t1", name: "GDKP Kara" }]);
            expect(json(res).data).toMatchObject({ guildId: A, added: 1, updated: 0, templates: [{ id: "rh-t1", needsSize: true, defaultFor: [] }] });
        });
    });
});
