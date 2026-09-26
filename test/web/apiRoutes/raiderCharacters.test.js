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
jest.mock("../../../src/stores/characterStore", () => ({
    getCharacter: jest.fn(() => null),
    listCharacters: jest.fn(() => []),
    characterMap: jest.fn(() => ({})),
}));
jest.mock("../../../src/stores/raiderCharactersStore", () => ({
    getCategoryAssignments: jest.fn(() => ({})),
    listAllAssignments: jest.fn(() => ({})),
    setCategoryAssignments: jest.fn(),
    resolveAssignmentProfiles: jest.fn(() => ({})),
}));
jest.mock("../../../src/utils/loot/lootImport", () => {
    class LootParseError extends Error {}
    const actual = jest.requireActual("../../../src/utils/loot/lootImport");
    return {
        parseLoot: jest.fn(() => []),
        detectImportDate: jest.fn(() => null),
        enrichItemNames: jest.fn((items) => Promise.resolve(items)),
        // Pure normalisation, no I/O: the roster keys its rows with
        // characterKey, and buildManualItem's shape (dedup key included) is what
        // the loot-add endpoint is tested for — a stub would test the stub.
        characterKey: actual.characterKey,
        characterKeyOf: actual.characterKeyOf,
        splitPlayer: actual.splitPlayer,
        buildManualItem: actual.buildManualItem,
        LootParseError,
    };
});
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
jest.mock("../../../src/utils/loot/wowhead", () => {
    const actual = jest.requireActual("../../../src/utils/loot/wowhead");
    return {
        searchItems: jest.fn(() => Promise.resolve([])),
        // Pure URL builders, no network: the loot catalogue's icon and Wowhead
        // links are exactly these strings, and stubbing them tests nothing.
        iconUrl: actual.iconUrl,
        itemLink: actual.itemLink,
    };
});
const auth = require("../../../src/web/auth");
const settingsStore = require("../../../src/stores/settingsStore");
const { activeGuildFor } = require("../../../src/web/activeGuild");
const discord = require("../../../src/web/discord");
const characterStore = require("../../../src/stores/characterStore");
const raiderCharactersStore = require("../../../src/stores/raiderCharactersStore");
const { post, get } = routerClient(require("../../../src/web/apiRoutes/raiderCharacters"));

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

            expect(raiderCharactersStore.setCategoryAssignments).toHaveBeenCalledWith("cat1", { u1: "Elesham", u2: "" });
            expect(json(res)).toEqual({ data: { assignments: { u1: "Elesham" } } });
        });
    });
});
