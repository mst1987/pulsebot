// services/discord/ingestServers.js: which servers a sync key may work on (#1000). The Discord side
// (the roles, the category rosters) is stubbed; the rule itself runs for real.
jest.mock("../../../src/services/discord/userAccess", () => {
    const actual = jest.requireActual("../../../src/services/discord/userAccess");
    return { ...actual, resolveGuildAccess: jest.fn() };
});
jest.mock("../../../src/services/roster/categoryOrga", () => ({
    createCache: jest.fn(() => ({ roles: new Map() })),
    isAnyCategoryManager: jest.fn(async () => false),
}));
jest.mock("../../../src/services/discord/discord", () => ({
    listGuilds: jest.fn(() => [{ id: "g1", name: "Pulse" }, { id: "g2", name: "Pulse Forever" }]),
}));
jest.mock("../../../src/services/discord/categoryNames", () => ({
    listKnownCategories: jest.fn(() => []),
}));

const { resolveGuildAccess } = require("../../../src/services/discord/userAccess");
const categoryOrga = require("../../../src/services/roster/categoryOrga");
const { listKnownCategories } = require("../../../src/services/discord/categoryNames");
const ingestServers = require("../../../src/services/discord/ingestServers");

const CONFIG = {
    discordServers: { servers: [{ guildId: "g1", label: "Hauptgilde" }, { guildId: "g2", label: "" }, { guildId: "g3" }] },
    mainVersion: "tbc",
};
const opts = { config: CONFIG };
const access = (guilds) => ({ isAdmin: false, guilds });
const orgaOn = (...gids) => access(Object.fromEntries(gids.map((g) => [g, { access: {}, isOrga: true }])));

beforeEach(() => {
    jest.clearAllMocks();
    resolveGuildAccess.mockResolvedValue(access({}));
    categoryOrga.isAnyCategoryManager.mockResolvedValue(false);
    listKnownCategories.mockReturnValue([]);
});

describe("orgaServersOf", () => {
    it("gives a full admin every configured server", async () => {
        resolveGuildAccess.mockResolvedValue({ isAdmin: true, guilds: {} });
        expect(await ingestServers.orgaServersOf("u1", opts)).toEqual([
            { guildId: "g1", role: "admin" }, { guildId: "g2", role: "admin" }, { guildId: "g3", role: "admin" },
        ]);
    });

    it("gives the servers with an orga role and those with a managed category roster", async () => {
        resolveGuildAccess.mockResolvedValue(orgaOn("g2"));
        categoryOrga.isAnyCategoryManager.mockImplementation(async (_user, { guildId }) => guildId === "g3");
        expect(await ingestServers.orgaServersOf("u1", opts)).toEqual([
            { guildId: "g2", role: "orga" }, { guildId: "g3", role: "category" },
        ]);
    });

    it("gives a raider without orga nothing, and no id nothing", async () => {
        expect(await ingestServers.orgaServersOf("u1", opts)).toEqual([]);
        expect(await ingestServers.orgaServersOf("", opts)).toEqual([]);
        expect(resolveGuildAccess).toHaveBeenCalledTimes(1);
    });
});

describe("serversOfToken", () => {
    it("gives a personal key only its owner's orga servers", async () => {
        resolveGuildAccess.mockResolvedValue(orgaOn("g1", "g3"));
        expect(await ingestServers.serversOfToken({ id: "t", ownerId: "u1" }, opts)).toEqual(["g1", "g3"]);
        expect(resolveGuildAccess).toHaveBeenCalledWith("u1");
    });

    it("drops a server at once when the role is taken away (asked anew each time)", async () => {
        const token = { id: "t", ownerId: "u1" };
        resolveGuildAccess.mockResolvedValue(orgaOn("g1", "g2"));
        expect(await ingestServers.serversOfToken(token, opts)).toEqual(["g1", "g2"]);
        resolveGuildAccess.mockResolvedValue(orgaOn("g1"));
        expect(await ingestServers.serversOfToken(token, opts)).toEqual(["g1"]);
        resolveGuildAccess.mockResolvedValue(access({}));
        expect(await ingestServers.serversOfToken(token, opts)).toEqual([]);
    });

    it("keeps a server key and an old key as before", async () => {
        expect(await ingestServers.serversOfToken({ id: "t", guildId: "g2" }, opts)).toEqual(["g2"]);
        expect(await ingestServers.serversOfToken({ id: "t", guildId: "" }, opts)).toBeNull();
        expect(await ingestServers.serversOfToken(null, opts)).toEqual([]);
        expect(resolveGuildAccess).not.toHaveBeenCalled();
    });

    it("tells a personal key from the others", () => {
        expect(ingestServers.isPersonToken({ ownerId: "u1" })).toBe(true);
        expect(ingestServers.isPersonToken({ guildId: "g1" })).toBe(false);
        expect(ingestServers.isPersonToken(null)).toBe(false);
    });
});

describe("describeServers", () => {
    it("names each server with its label, the role and its versions", () => {
        const out = ingestServers.describeServers([{ guildId: "g1", role: "orga" }, { guildId: "g3" }], opts);
        expect(out).toEqual([
            { guildId: "g1", name: "Pulse", label: "Hauptgilde", role: "orga", versions: [expect.objectContaining({ id: "tbc" })] },
            { guildId: "g3", name: "", label: "", role: "", versions: [expect.objectContaining({ id: "tbc" })] },
        ]);
        expect(out[0].versions[0]).toEqual({ id: "tbc", short: expect.any(String), realm: expect.any(String) });
        expect(out[0].versions[0].short).not.toBe("");
    });

    it("lists the versions of a server's categories once each", () => {
        listKnownCategories.mockReturnValue([{ id: "c1" }, { id: "c2" }, { id: "c3" }]);
        const config = { ...CONFIG, categoryVersion: { c1: "tbc", c2: "forever", c3: "forever" } };
        const ids = ingestServers.versionsOfServer("g1", config).map((v) => v.id);
        expect(ids).toEqual(["tbc", "forever"]);
    });
});

describe("versionHead", () => {
    it("names a version by its short name and the realm slug of that server", () => {
        const config = {
            ...CONFIG,
            versionSettings: { tbc: { blizzardRealmSlug: "thunderstrike" } },
            serverSettings: { g2: { versionOverrides: { tbc: { blizzardRealmSlug: "spineshatter" } } } },
        };
        expect(ingestServers.versionHead("tbc", "g1", config)).toEqual({ id: "tbc", short: "TBC", realm: "thunderstrike" });
        expect(ingestServers.versionHead("tbc", "g2", config).realm).toBe("spineshatter");
    });

    it("falls back to the id for the short name of an unknown version", () => {
        expect(ingestServers.versionHead("nope", "g1", CONFIG)).toEqual({ id: "nope", short: "nope", realm: expect.any(String) });
    });

    it("is what versionsOfServer lists", () => {
        listKnownCategories.mockReturnValue([{ id: "c1" }]);
        const config = { ...CONFIG, categoryVersion: { c1: "forever" } };
        expect(ingestServers.versionsOfServer("g1", config)).toEqual([ingestServers.versionHead("forever", "g1", config)]);
    });
});
