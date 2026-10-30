// GET /api/ingest/council - the sync tool's council roster, through the real
// router. Same bearer-token auth as the uploads; no Discord session anywhere.
const { status, body, routerClient } = require("../../../helpers/http");

jest.mock("../../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => null),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(() => true),
    setActiveGuild: jest.fn(),
}));
jest.mock("../../../../src/stores/ingestTokenStore", () => ({
    verifyToken: jest.fn(),
    touchToken: jest.fn(),
    bearerFrom: (req) => {
        const h = (req.headers && req.headers.authorization) || "";
        return h.startsWith("Bearer ") ? h.slice(7) : "";
    },
}));
jest.mock("../../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));
jest.mock("../../../../src/stores/settingsStore", () => ({
    getConfig: jest.fn(() => ({ categoryIds: ["c1", "c2"] })),
}));
jest.mock("../../../../src/services/discord/discord", () => ({
    listCategories: jest.fn(() => [{ id: "c1", name: "SSC/TK Mittwoch" }]),
    listGuilds: jest.fn(() => [{ id: "gA", name: "Pulse" }, { id: "gB", name: "Pulse Forever" }]),
}));
// Category c2 lives on server gB (the category-name snapshot, #919).
jest.mock("../../../../src/services/discord/servers/serverOf", () => ({
    ...jest.requireActual("../../../../src/services/discord/servers/serverOf"),
    storedCategoryGuilds: jest.fn(() => new Map([["c2", "gB"]])),
}));
// A personal key's servers (#1000) come from its owner's orga roles - set per test, never Discord.
jest.mock("../../../../src/services/discord/servers/ingestServers", () => {
    const actual = jest.requireActual("../../../../src/services/discord/servers/ingestServers");
    return { ...actual, serversOfToken: jest.fn(actual.serversOfToken) };
});
jest.mock("../../../../src/web/loot/lootCouncil", () => ({
    ...jest.requireActual("../../../../src/web/loot/lootCouncil"),
    councilRoster: jest.fn(),
}));

const { verifyToken, touchToken } = require("../../../../src/stores/ingestTokenStore");
const { councilRoster } = require("../../../../src/web/loot/lootCouncil");
const { getConfig } = require("../../../../src/stores/settingsStore");
const { listCategories } = require("../../../../src/services/discord/discord");
const { serversOfToken } = require("../../../../src/services/discord/servers/ingestServers");
const { storedCategoryGuilds } = require("../../../../src/services/discord/servers/serverOf");
const ingest = require("../../../../src/web/apiRoutes/loot/ingest");

const { get, handle, urlFor } = routerClient(ingest);

/** A GET carrying an authorization header (routerClient's own get sends none). */
async function authed(path, query, authorization = "Bearer ehl_good") {
    const { mockRes } = require("../../../helpers/http");
    const res = mockRes();
    await handle(path, { method: "GET", headers: authorization ? { authorization } : {} }, res, urlFor(path, query));
    return res;
}

const ROW = {
    key: "gemli", character: "Gemli", className: "Priest", specLabel: "Shadow", role: "caster",
    needScore: 0.5, needParts: { drought: 0.5, share: 0.5, need: 0.5 },
    lootCount: 0, lootTotal: 0, otherCount: 0, lastAwardAt: 0, daysSinceLoot: null,
    bis: { tier: "t6", source: "wowsims", owned: 0, total: 1, items: [{ id: 7, owned: false }] },
    items: [],
};

beforeEach(() => {
    jest.clearAllMocks();
    verifyToken.mockReturnValue({ id: "t1", name: "Raidlead-PC" });
    councilRoster.mockReturnValue({ rows: [ROW], avgLootCount: 0, bisTier: "t6" });
    getConfig.mockReturnValue({ categoryIds: ["c1", "c2"], guildId: "g1" });
});

describe("GET /api/ingest/council", () => {
    it("refuses a request without a token", async () => {
        const res = await get("/api/ingest/council");
        expect(status(res)).toBe(401);
        expect(body(res).error.code).toBe("no_token");
        expect(councilRoster).not.toHaveBeenCalled();
    });

    it("refuses an unknown token", async () => {
        verifyToken.mockReturnValue(null);
        const res = await authed("/api/ingest/council");
        expect(status(res)).toBe(401);
        expect(body(res).error.code).toBe("bad_token");
        expect(councilRoster).not.toHaveBeenCalled();
    });

    it("answers a valid token with the slim payload and records the use", async () => {
        const res = await authed("/api/ingest/council");
        expect(status(res)).toBe(200);
        expect(touchToken).toHaveBeenCalledWith("t1");
        const data = body(res);
        expect(data).toMatchObject({
            format: "eventhelper-council",
            version: 1,
            filter: { category: "", categoryName: "", role: "", bisTier: "t6", bisTierDerived: true },
            categories: [{ id: "c1", name: "SSC/TK Mittwoch" }, { id: "c2", name: "c2" }],
            weights: { drought: 45, share: 30, need: 10 },
        });
        expect(data.raiders).toHaveLength(1);
        expect(data.raiders[0]).toMatchObject({ character: "Gemli", classFile: "PRIEST", need: 50, daysSinceLoot: -1, bis: { missing: [7] } });
    });

    // #919: no session behind the token - the asked category's server, else
    // the first server; never the server of whoever is logged in elsewhere.
    it("works on the asked category's server, else on the first server", async () => {
        getConfig.mockReturnValue({ categoryIds: ["c1", "c2"], discordServers: { servers: [{ guildId: "gA" }, { guildId: "gB" }] } });
        await authed("/api/ingest/council", { category: "c2" });
        expect(listCategories).toHaveBeenLastCalledWith("gB");
        // the same server reads the gear in its own realm (#923)
        expect(councilRoster.mock.calls[0][0]).toMatchObject({ categoryId: "c2", guildId: "gB" });
        await authed("/api/ingest/council");
        expect(listCategories).toHaveBeenLastCalledWith("gA");
    });

    it("answers ?v=2 with every Loot-Council category (version 2), none here", async () => {
        const res = await authed("/api/ingest/council", { v: "2" });
        expect(status(res)).toBe(200);
        expect(body(res)).toMatchObject({ format: "eventhelper-council", version: 2, categories: [] });
        expect(councilRoster).not.toHaveBeenCalled();
    });

    it("builds a v2 entry per Loot-Council category with the raider key", async () => {
        getConfig.mockReturnValue({ categoryIds: ["c1", "c2"], guildId: "g1", categoryLootSystem: { c1: "lootcouncil" } });
        const res = await authed("/api/ingest/council", { v: "2" });
        const data = body(res);
        expect(data.categories.map((c) => [c.id, c.name])).toEqual([["c1", "SSC/TK Mittwoch"]]);
        expect(data.categories[0].raiders[0]).toMatchObject({ key: "gemli", character: "Gemli" });
        expect(councilRoster).toHaveBeenCalledWith(expect.objectContaining({ categoryId: "c1" }));
    });

    it("answers ?v=3 with version 3: every role, status and the category's weighting (#670)", async () => {
        getConfig.mockReturnValue({ categoryIds: ["c1", "c2"], guildId: "g1", categoryLootSystem: { c1: "lootcouncil" } });
        councilRoster.mockReturnValue({
            rows: [ROW, { ...ROW, key: "hauer", character: "Hauer", className: "Warrior", specLabel: "Fury", role: "melee", status: "trial", lootPoints: 0 }],
            avgLootCount: 0, avgLootPoints: 0, bisTier: "t6",
        });
        const res = await authed("/api/ingest/council", { v: "3" });
        expect(status(res)).toBe(200);
        const data = body(res);
        expect(data).toMatchObject({ format: "eventhelper-council", version: 3, weights: { drought: 45, share: 30, need: 10, tenure: 15 } });
        expect(data.categories.map((c) => c.id)).toEqual(["c1"]);
        expect(data.categories[0].raiders.map((r) => [r.key, r.role, r.status])).toEqual([["gemli", "caster", ""], ["hauer", "melee", "trial"]]);
        expect(data.categories[0]).toHaveProperty("itemWeights.classes.trinket", 2);
        expect(data.categories[0]).toHaveProperty("itemClasses");
    });

    it("answers a higher version than it knows with version 4, and v=3/v=4 with a category with version 1", async () => {
        expect(body(await authed("/api/ingest/council", { v: "9" })).version).toBe(4);
        expect(body(await authed("/api/ingest/council", { v: "4" })).version).toBe(4);
        expect(body(await authed("/api/ingest/council", { v: "3" })).version).toBe(3);
        expect(body(await authed("/api/ingest/council", { v: "3", category: "c1" })).version).toBe(1);
        expect(body(await authed("/api/ingest/council", { v: "4", category: "c1" })).version).toBe(1);
    });

    it("passes category and role through to the roster", async () => {
        const res = await authed("/api/ingest/council", { category: "c1", role: "healer", tiers: "t5" });
        expect(councilRoster).toHaveBeenCalledWith(expect.objectContaining({ categoryId: "c1", role: "healer", tierIds: [], bisTier: "" }));
        expect(body(res).filter).toMatchObject({ category: "c1", categoryName: "SSC/TK Mittwoch", role: "healer" });
    });

    // #994: a key with a server sees only the categories of that server.
    describe("key with a server", () => {
        const TWO_SERVERS = {
            categoryIds: ["c1", "c2"],
            discordServers: { servers: [{ guildId: "gA" }, { guildId: "gB" }] },
            categoryLootSystem: { c1: "lootcouncil", c2: "lootcouncil" },
        };

        beforeEach(() => {
            getConfig.mockReturnValue(TWO_SERVERS);
        });

        it("lists only its server's categories in v2 and v3", async () => {
            verifyToken.mockReturnValue({ id: "t1", name: "PC", guildId: "gB" });
            expect(body(await authed("/api/ingest/council", { v: "2" })).categories.map((c) => c.id)).toEqual(["c2"]);
            expect(body(await authed("/api/ingest/council", { v: "3" })).categories.map((c) => c.id)).toEqual(["c2"]);
            expect(councilRoster.mock.calls.every(([opts]) => opts.categoryId === "c2")).toBe(true);
        });

        it("never reads a category of another server in v1", async () => {
            verifyToken.mockReturnValue({ id: "t1", name: "PC", guildId: "gA" });
            const res = await authed("/api/ingest/council", { category: "c2" });
            expect(status(res)).toBe(200);
            expect(councilRoster.mock.calls[0][0]).toMatchObject({ categoryId: "", guildId: "gA" });
            expect(body(res).categories.map((c) => c.id)).toEqual(["c1"]);
        });

        it("reads its own category in v1", async () => {
            verifyToken.mockReturnValue({ id: "t1", name: "PC", guildId: "gB" });
            const res = await authed("/api/ingest/council", { category: "c2" });
            expect(councilRoster.mock.calls[0][0]).toMatchObject({ categoryId: "c2", guildId: "gB" });
            expect(body(res).categories.map((c) => c.id)).toEqual(["c2"]);
        });

        // #1000: a personal key whose owner is orga on A, not on B.
        describe("personal key", () => {
            const PERSON = { id: "p1", name: "Laptop", ownerId: "u1", guildId: "" };
            beforeEach(() => verifyToken.mockReturnValue(PERSON));

            it("lists only its owner's servers' categories in v2 and v3", async () => {
                serversOfToken.mockResolvedValueOnce(["gA"]).mockResolvedValueOnce(["gA"]);
                expect(body(await authed("/api/ingest/council", { v: "2" })).categories.map((c) => c.id)).toEqual(["c1"]);
                expect(body(await authed("/api/ingest/council", { v: "3" })).categories.map((c) => c.id)).toEqual(["c1"]);
                expect(councilRoster.mock.calls.every(([opts]) => opts.categoryId === "c1")).toBe(true);
                expect(serversOfToken).toHaveBeenCalledWith(PERSON);
            });

            it("drops a v1 category of B and reads A", async () => {
                serversOfToken.mockResolvedValueOnce(["gA"]);
                const res = await authed("/api/ingest/council", { category: "c2" });
                expect(status(res)).toBe(200);
                expect(councilRoster.mock.calls[0][0]).toMatchObject({ categoryId: "", guildId: "gA" });
                expect(body(res).categories.map((c) => c.id)).toEqual(["c1"]);
            });

            it("reads a v1 category of its second server", async () => {
                serversOfToken.mockResolvedValueOnce(["gA", "gB"]);
                const res = await authed("/api/ingest/council", { category: "c2" });
                expect(status(res)).toBe(200);
                expect(councilRoster.mock.calls[0][0]).toMatchObject({ categoryId: "c2", guildId: "gB" });
            });

            it("answers 403 no_server when its owner is orga nowhere", async () => {
                serversOfToken.mockResolvedValueOnce([]);
                const res = await authed("/api/ingest/council", { v: "3" });
                expect(status(res)).toBe(403);
                expect(councilRoster).not.toHaveBeenCalled();
            });
        });

        it("keeps every server's categories for a key without a server", async () => {
            expect(body(await authed("/api/ingest/council", { v: "3" })).categories.map((c) => c.id)).toEqual(["c1", "c2"]);
        });
    });

    // #1001: version 4 groups the version 3 categories by server, then game version.
    describe("version 4", () => {
        // gA plays TBC (c1) and Forever (c4), gB Forever (c2), gC TBC (c3).
        const THREE_SERVERS = {
            categoryIds: ["c1", "c2", "c3", "c4"],
            discordServers: { servers: [{ guildId: "gA", label: "Pulse EU" }, { guildId: "gB" }, { guildId: "gC" }] },
            categoryLootSystem: { c1: "lootcouncil", c2: "lootcouncil", c3: "lootcouncil", c4: "lootcouncil" },
            categoryVersion: { c2: "forever", c4: "forever" },
            versionSettings: { tbc: { blizzardRealmSlug: "thunderstrike" } },
            serverSettings: {
                gA: { wclGuilds: [
                    { versionId: "tbc", guildName: "Pulse", realm: "Thunderstrike", region: "EU" },
                    { versionId: "forever", guildName: "Pulse Forever", realm: "Doomhowl", region: "EU" },
                ] },
            },
        };
        const PERSON = { id: "p1", name: "Laptop", ownerId: "u1", guildId: "" };
        const v4 = async () => body(await authed("/api/ingest/council", { v: "4" }));
        const shape = (data) => data.servers.map((s) => [s.guildId, s.versions.map((v) => [v.id, v.categories.map((c) => c.id)])]);

        beforeEach(() => {
            getConfig.mockReturnValue(THREE_SERVERS);
            storedCategoryGuilds.mockReturnValue(new Map([["c1", "gA"], ["c2", "gB"], ["c3", "gC"], ["c4", "gA"]]));
        });
        afterEach(() => storedCategoryGuilds.mockReturnValue(new Map([["c2", "gB"]])));

        it("gives a personal key with orga on A and B both servers apart, never C", async () => {
            verifyToken.mockReturnValue(PERSON);
            serversOfToken.mockResolvedValueOnce(["gA", "gB"]);
            const data = await v4();
            expect(data).toMatchObject({ format: "eventhelper-council", version: 4, weights: { drought: 45, share: 30, need: 10, tenure: 15 } });
            expect(shape(data)).toEqual([
                ["gA", [["tbc", ["c1"]], ["forever", ["c4"]]]],
                ["gB", [["forever", ["c2"]]]],
            ]);
            expect(councilRoster.mock.calls.map(([opts]) => opts.categoryId).sort()).toEqual(["c1", "c2", "c4"]);
        });

        it("names server, realm and WoW guilds for the addon's choice", async () => {
            verifyToken.mockReturnValue(PERSON);
            serversOfToken.mockResolvedValueOnce(["gA", "gB"]);
            const [a, b] = (await v4()).servers;
            expect(a).toMatchObject({ guildId: "gA", name: "Pulse", label: "Pulse EU" });
            expect(a.versions[0]).toMatchObject({
                id: "tbc", short: "TBC", realm: "thunderstrike",
                guilds: [{ name: "Pulse", realm: "Thunderstrike", region: "EU" }],
            });
            expect(a.versions[1]).toMatchObject({ id: "forever", guilds: [{ name: "Pulse Forever", realm: "Doomhowl", region: "EU" }] });
            expect(b).toMatchObject({ guildId: "gB", name: "Pulse Forever" });
            expect(b.versions[0].guilds).toEqual([]);
        });

        it("keeps each category exactly as version 3 builds it", async () => {
            verifyToken.mockReturnValue(PERSON);
            serversOfToken.mockResolvedValueOnce(["gA", "gB"]).mockResolvedValueOnce(["gA", "gB"]);
            const four = await v4();
            const three = body(await authed("/api/ingest/council", { v: "3" }));
            const grouped = four.servers.flatMap((s) => s.versions.flatMap((v) => v.categories));
            expect(grouped.sort((x, y) => x.id.localeCompare(y.id))).toEqual(three.categories.sort((x, y) => x.id.localeCompare(y.id)));
        });

        it("lists a server of the key without Loot-Council category with no versions", async () => {
            verifyToken.mockReturnValue(PERSON);
            serversOfToken.mockResolvedValueOnce(["gA", "gB"]);
            getConfig.mockReturnValue({ ...THREE_SERVERS, categoryLootSystem: { c1: "lootcouncil" } });
            expect(shape(await v4())).toEqual([["gA", [["tbc", ["c1"]]]], ["gB", []]]);
        });

        it("gives a server key only its own server", async () => {
            verifyToken.mockReturnValue({ id: "t1", name: "PC", guildId: "gB" });
            expect(shape(await v4())).toEqual([["gB", [["forever", ["c2"]]]]]);
        });

        it("gives an old key without server every server", async () => {
            expect(shape(await v4()).map(([gid]) => gid)).toEqual(["gA", "gB", "gC"]);
        });

        // Review #1001: an old key gets every category of v3, even one whose server is missing
        // from discordServers.servers (the prod case of #926).
        it("gives an old key the category of a server missing from the server list", async () => {
            storedCategoryGuilds.mockReturnValue(new Map([["c1", "gA"], ["c2", "gB"], ["c3", "gC"], ["c4", "gFresh"]]));
            const four = await v4();
            expect(shape(four)).toEqual([
                ["gA", [["tbc", ["c1"]]]],
                ["gB", [["forever", ["c2"]]]],
                ["gC", [["tbc", ["c3"]]]],
                ["gFresh", [["forever", ["c4"]]]],
            ]);
            const three = body(await authed("/api/ingest/council", { v: "3" }));
            const grouped = four.servers.flatMap((s) => s.versions.flatMap((v) => v.categories)).map((c) => c.id);
            expect(grouped.sort()).toEqual(three.categories.map((c) => c.id).sort());
        });

        it("gives an old key every category even with no server configured", async () => {
            getConfig.mockReturnValue({ ...THREE_SERVERS, discordServers: { servers: [] } });
            storedCategoryGuilds.mockReturnValue(new Map());
            const four = await v4();
            const three = body(await authed("/api/ingest/council", { v: "3" }));
            expect(four.servers.length).toBeGreaterThan(0);
            const grouped = four.servers.flatMap((s) => s.versions.flatMap((v) => v.categories)).map((c) => c.id);
            expect(grouped.sort()).toEqual(three.categories.map((c) => c.id).sort());
            expect(grouped.sort()).toEqual(["c1", "c2", "c3", "c4"]);
        });

        it("keeps a personal key to its servers even when a category sits on another one", async () => {
            verifyToken.mockReturnValue(PERSON);
            serversOfToken.mockResolvedValueOnce(["gA"]);
            storedCategoryGuilds.mockReturnValue(new Map([["c1", "gA"], ["c4", "gFresh"]]));
            expect(shape(await v4()).map(([gid]) => gid)).toEqual(["gA"]);
        });

        it("answers 403 no_server when the owner is orga nowhere", async () => {
            verifyToken.mockReturnValue(PERSON);
            serversOfToken.mockResolvedValueOnce([]);
            const res = await authed("/api/ingest/council", { v: "4" });
            expect(status(res)).toBe(403);
            expect(body(res).error.code).toBe("no_server");
        });

        it("falls back to the default weights without any category", async () => {
            getConfig.mockReturnValue({ ...THREE_SERVERS, categoryLootSystem: {} });
            const data = await v4();
            expect(data.weights).toMatchObject({ scope: "global", drought: 45, share: 30, need: 10, tenure: 15 });
            expect(data.servers.every((s) => s.versions.length === 0)).toBe(true);
        });
    });
});
