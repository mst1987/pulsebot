const { json, routerClient } = require("../../../helpers/http");

// #1073: roles count for data of every server on a server with the mark only
let mockTrusted = true;
jest.mock("../../../../src/services/discord/roles/guildRoles", () => ({ ...jest.requireActual("../../../../src/services/discord/roles/guildRoles"), serverIsTrusted: jest.fn(() => mockTrusted) }));
jest.mock("../../../../src/web/http/auth", () => ({
    getUser: jest.fn(),
    // "Ansicht als Rolle": the caller's own rights, and starting/stopping the view
    getRealUser: jest.fn(),
    getUserWithoutRank: jest.fn(() => null),
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
jest.mock("../../../../src/services/events/eventServer", () => ({
    ...jest.requireActual("../../../../src/services/events/eventServer"),
    guildOfCategory: jest.fn(() => ""),
}));
jest.mock("../../../../src/stores/roster/characterStore", () => ({
    getCharacter: jest.fn(() => null),
    listCharacters: jest.fn(() => []),
    characterMap: jest.fn(() => ({})),
}));
jest.mock("../../../../src/stores/roster/raiderCharactersStore", () => ({
    getCategoryAssignments: jest.fn(() => ({})),
    listAllAssignments: jest.fn(() => ({})),
    setCategoryAssignments: jest.fn(),
    resolveAssignmentProfiles: jest.fn(() => ({})),
}));
jest.mock("../../../../src/utils/loot/lootImport", () => {
    class LootParseError extends Error {}
    const actual = jest.requireActual("../../../../src/utils/loot/lootImport");
    return {
        parseLoot: jest.fn(() => []),
        detectImportDate: jest.fn(() => null),
        enrichItemNames: jest.fn((items) => Promise.resolve(items)),
        // Pure normalisation, no I/O: the roster keys its rows with
        // characterKey, and buildManualItem's shape (dedup key included) is what
        // the loot-add endpoint is tested for — a stub would test the stub.
        characterKey: actual.characterKey,
        characterKeyOf: actual.characterKeyOf,
        nameKeyOf: actual.nameKeyOf,
        splitPlayer: actual.splitPlayer,
        buildManualItem: actual.buildManualItem,
        LootParseError,
    };
});
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
jest.mock("../../../../src/utils/loot/wowhead", () => {
    const actual = jest.requireActual("../../../../src/utils/loot/wowhead");
    return {
        searchItems: jest.fn(() => Promise.resolve([])),
        // Pure URL builders, no network: the loot catalogue's icon and Wowhead
        // links are exactly these strings, and stubbing them tests nothing.
        iconUrl: actual.iconUrl,
        itemLink: actual.itemLink,
    };
});
const auth = require("../../../../src/web/http/auth");
const settingsStore = require("../../../../src/stores/settings/settingsStore");
const { activeGuildFor } = require("../../../../src/web/http/activeGuild");
const { guildOfCategory } = require("../../../../src/services/events/eventServer");
const discord = require("../../../../src/services/discord/discord");
const characterStore = require("../../../../src/stores/roster/characterStore");
const raiderCharactersStore = require("../../../../src/stores/roster/raiderCharactersStore");
const raiderProfileStore = require("../../../../src/stores/roster/raiderProfileStore");
// no raider profile unless a test names some (characterVersions reads them for the version of a name)
const listProfiles = jest.spyOn(raiderProfileStore, "listProfiles").mockReturnValue([]);
const { post, get } = routerClient(require("../../../../src/web/apiRoutes/roster/raiderCharacters"));

describe("web/apiRoutes/raiderCharacters", () => {
    describe("GET /api/raider-characters", () => {
        it("returns 401 for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = await get("/api/raider-characters", { category: "cat1" });
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
        });

        it("returns 400 when no category is given", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            const res = await get("/api/raider-characters", {});
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
        });

        it("returns the category's expected members, their assignments and known characters", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            activeGuildFor.mockReturnValue("guild-1");
            settingsStore.getConfig.mockReturnValue({ categoryRoles: { cat1: ["role1"] } });
            discord.listMembersWithRoles.mockResolvedValue({
                members: [{ id: "u1", displayName: "Sedroc" }],
                error: null,
            });
            raiderCharactersStore.getCategoryAssignments.mockReturnValue({ u1: "Elesham" });
            characterStore.listCharacters.mockReturnValue([{ character: "Elesham" }, { character: "Mage" }]);

            const res = await get("/api/raider-characters", { category: "cat1" });

            expect(discord.listMembersWithRoles).toHaveBeenCalledWith("guild-1", ["role1"]);
            expect(json(res)).toEqual({
                data: {
                    members: [{ id: "u1", displayName: "Sedroc" }],
                    membersError: null,
                    roleIds: ["role1"],
                    assignments: { u1: "Elesham" },
                    knownCharacters: ["Elesham", "Mage"],
                },
            });
        });

        it("gives the server-admin rank only the names of the category's own assignments (#1072)", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Rang", isAdmin: false, isServerAdmin: true, isOrga: true, access: { settings: { read: true, write: true } } });
            activeGuildFor.mockReturnValue("guild-1");
            guildOfCategory.mockReturnValueOnce("guild-1");
            settingsStore.getConfig.mockReturnValue({ categoryRoles: {} });
            raiderCharactersStore.getCategoryAssignments.mockReturnValue({ u1: "Zul", u2: "Elesham", u3: "Elesham" });
            // the character list holds the names of every server
            characterStore.listCharacters.mockReturnValue([{ character: "Elesham" }, { character: "FremderServer" }]);

            const data = json(await get("/api/raider-characters", { category: "cat1" })).data;

            expect(data.knownCharacters).toEqual(["Elesham", "Zul"]);
            expect(data.assignments).toEqual({ u1: "Zul", u2: "Elesham", u3: "Elesham" });
            expect(characterStore.listCharacters).not.toHaveBeenCalled();
        });

        it("offers only the known characters of the version the category plays (#741)", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            settingsStore.getConfig.mockReturnValue({ categoryRoles: {}, categoryVersion: { cat2: "forever" } });
            // Elesham is a TBC character, Aldric a Forever one; Mage no profile knows (= the category's version)
            listProfiles.mockReturnValue([
                { userId: "u1", characters: [{ name: "Elesham", versionId: "tbc" }, { name: "Aldric Sturmwind", versionId: "forever" }] },
            ]);
            characterStore.listCharacters.mockReturnValue([{ character: "Aldric Sturmwind" }, { character: "Elesham" }, { character: "Mage" }]);
            try {
                expect(json(await get("/api/raider-characters", { category: "cat1" })).data.knownCharacters).toEqual(["Elesham", "Mage"]);
                expect(json(await get("/api/raider-characters", { category: "cat2" })).data.knownCharacters).toEqual(["Aldric Sturmwind", "Mage"]);
            } finally {
                listProfiles.mockReturnValue([]);
            }
        });

        it("skips the member lookup when the category has no roles assigned yet", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            settingsStore.getConfig.mockReturnValue({ categoryRoles: {} });
            const res = await get("/api/raider-characters", { category: "cat1" });
            expect(discord.listMembersWithRoles).not.toHaveBeenCalled();
            expect(json(res).data.members).toEqual([]);
        });
    });

    describe("POST /api/raider-characters", () => {
        it("returns 403 when the CSRF token is invalid", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(false);
            const res = await post("/api/raider-characters", { categoryId: "cat1", assignments: {} });
            expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
            expect(raiderCharactersStore.setCategoryAssignments).not.toHaveBeenCalled();
        });

        it("returns 400 when categoryId is missing", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            const res = await post("/api/raider-characters", { assignments: { u1: "Elesham" } });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
        });

        it("returns 400 when assignments is missing/not an object", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            const res = await post("/api/raider-characters", { categoryId: "cat1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
        });

        it("saves the whole category map and returns it", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            raiderCharactersStore.setCategoryAssignments.mockReturnValue({ u1: "Elesham" });

            const res = await post("/api/raider-characters", { categoryId: "cat1", assignments: { u1: "Elesham", u2: "" } });

            expect(raiderCharactersStore.setCategoryAssignments).toHaveBeenCalledWith("cat1", { u1: "Elesham", u2: "" }, { actor: "1" });
            expect(json(res)).toEqual({ data: { assignments: { u1: "Elesham" } } });
        });
    });

    // The server-admin rank alone holds for its own server (#1072): the category comes from
    // the request. Whoever has the area by a role keeps what the role always allowed.
    describe("the server of the category (#1072)", () => {
        const SETTINGS = { settings: { read: true, write: true } };
        const settingsUser = { id: "2", name: "Rang", isAdmin: false, isServerAdmin: true, isOrga: true, access: SETTINGS };
        const roleUser = { id: "3", name: "Lead", isAdmin: false, access: SETTINGS };
        const fullAdmin = { id: "1", name: "Admin", isAdmin: true };
        const body = { categoryId: "cat-x", assignments: { u1: "Elesham" } };

        beforeEach(() => {
            jest.clearAllMocks();
            auth.getUser.mockReturnValue(settingsUser);
            auth.checkCsrf.mockReturnValue(true);
            activeGuildFor.mockReturnValue("guild-own");
            guildOfCategory.mockReturnValue("guild-other");
            settingsStore.getConfig.mockReturnValue({ categoryRoles: { "cat-x": ["role1"] } });
            raiderCharactersStore.setCategoryAssignments.mockReturnValue({ u1: "Elesham" });
        });
        afterEach(() => {
            guildOfCategory.mockReturnValue("");
            auth.getUserWithoutRank.mockReturnValue(null);
        });

        it.each([
            ["a role right", () => auth.getUser.mockReturnValue(roleUser), "3"],
            ["the rank plus a role right", () => auth.getUserWithoutRank.mockReturnValue(roleUser), "2"],
        ])("leaves %s as on main: any category, old ones without a server too, every known name", async (_label, arrange, actor) => {
            arrange();
            characterStore.listCharacters.mockReturnValue([{ character: "FremderServer" }]);
            for (const owner of ["guild-other", ""]) {
                guildOfCategory.mockReturnValue(owner);
                const res = await get("/api/raider-characters", { category: "cat-x" });
                expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
                expect(json(res).data.knownCharacters).toEqual(["FremderServer"]);
                expect((await post("/api/raider-characters", body)).writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            }
            expect(raiderCharactersStore.setCategoryAssignments).toHaveBeenCalledWith("cat-x", body.assignments, { actor });
            characterStore.listCharacters.mockReturnValue([]);
        });

        it("still refuses the rank to write another server when the role only reads", async () => {
            auth.getUserWithoutRank.mockReturnValue({ ...roleUser, access: { settings: { read: true, write: false } } });
            expect((await get("/api/raider-characters", { category: "cat-x" })).writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            expect(json(await post("/api/raider-characters", body)).error.code).toBe("other_server");
        });

        it("refuses a role another server's category on a server without the mark (#1073)", async () => {
            auth.getUser.mockReturnValue(roleUser);
            auth.getUserWithoutRank.mockReturnValue({ ...roleUser, access: {} });
            mockTrusted = false;
            try {
                expect(json(await get("/api/raider-characters", { category: "cat-x" })).error.code).toBe("other_server");
                expect(json(await post("/api/raider-characters", body)).error.code).toBe("other_server");
            } finally {
                mockTrusted = true;
            }
        });

        it("refuses to read a category of another server", async () => {
            const res = await get("/api/raider-characters", { category: "cat-x" });
            expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
            expect(json(res).error.code).toBe("other_server");
            expect(guildOfCategory).toHaveBeenCalledWith("cat-x");
            expect(discord.listMembersWithRoles).not.toHaveBeenCalled();
            expect(raiderCharactersStore.getCategoryAssignments).not.toHaveBeenCalled();
        });

        it("refuses to write a category of another server", async () => {
            const res = await post("/api/raider-characters", body);
            expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
            expect(json(res).error.code).toBe("other_server");
            expect(raiderCharactersStore.setCategoryAssignments).not.toHaveBeenCalled();
        });

        it("refuses a category no server claims", async () => {
            guildOfCategory.mockReturnValue("");
            expect((await get("/api/raider-characters", { category: "cat-x" })).writeHead).toHaveBeenCalledWith(403, expect.any(Object));
            expect((await post("/api/raider-characters", body)).writeHead).toHaveBeenCalledWith(403, expect.any(Object));
            expect(raiderCharactersStore.setCategoryAssignments).not.toHaveBeenCalled();
        });

        it("keeps a category of the own server working", async () => {
            guildOfCategory.mockReturnValue("guild-own");
            expect((await get("/api/raider-characters", { category: "cat-x" })).writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            expect(discord.listMembersWithRoles).toHaveBeenCalledWith("guild-own", ["role1"]);
            expect((await post("/api/raider-characters", body)).writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            expect(raiderCharactersStore.setCategoryAssignments).toHaveBeenCalledWith("cat-x", body.assignments, { actor: "2" });
        });

        it("leaves a full admin free of the check", async () => {
            auth.getUser.mockReturnValue(fullAdmin);
            expect((await get("/api/raider-characters", { category: "cat-x" })).writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            expect((await post("/api/raider-characters", body)).writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            expect(raiderCharactersStore.setCategoryAssignments).toHaveBeenCalledWith("cat-x", body.assignments, { actor: "1" });
        });
    });
});
