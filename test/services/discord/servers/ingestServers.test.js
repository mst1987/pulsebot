// services/discord/servers/ingestServers.js: which servers a sync key may work on (#1000). The Discord side
// (the roles, the category rosters) is stubbed; the rule itself runs for real.
jest.mock("../../../../src/services/discord/members/userAccess", () => {
    const actual = jest.requireActual("../../../../src/services/discord/members/userAccess");
    return { ...actual, resolveGuildAccess: jest.fn(), computeGuildAccess: jest.fn() };
});
jest.mock("../../../../src/services/roster/categoryOrga", () => ({
    createCache: jest.fn(() => ({ roles: new Map() })),
    isAnyCategoryManager: jest.fn(async () => false),
}));
jest.mock("../../../../src/services/discord/discord", () => ({
    listGuilds: jest.fn(() => [{ id: "g1", name: "Pulse" }, { id: "g2", name: "Pulse Forever" }]),
    guildIconUrl: jest.fn((id) => (id === "g1" ? "https://cdn.discordapp.com/icons/g1/abc.webp?size=64" : "")),
}));
jest.mock("../../../../src/services/categories/categoryNames", () => ({
    listKnownCategories: jest.fn(() => []),
}));

const { resolveGuildAccess, computeGuildAccess } = require("../../../../src/services/discord/members/userAccess");
const categoryOrga = require("../../../../src/services/roster/categoryOrga");
const { listKnownCategories } = require("../../../../src/services/categories/categoryNames");
const ingestServers = require("../../../../src/services/discord/servers/ingestServers");

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

    // #1072: an upload tied to no server counts the roles, the rank is a right on one server's data.
    describe("with rolesOnly", () => {
        const rank = (over = {}) => ({ access: {}, isOrga: true, isMember: true, isServerAdmin: true, roleAccess: {}, ...over });

        it("drops a server held by the rank alone and keeps one with an orga role next to it", async () => {
            resolveGuildAccess.mockResolvedValue(access({ g1: rank(), g2: rank({ roleIsOrga: true }) }));
            expect(await ingestServers.orgaServersOf("u1", opts)).toEqual([{ guildId: "g1", role: "orga" }, { guildId: "g2", role: "orga" }]);
            expect(await ingestServers.orgaServersOf("u1", { ...opts, rolesOnly: true })).toEqual([{ guildId: "g2", role: "orga" }]);
        });

        it("does the same for a session's stored access", async () => {
            const guildAccess = access({ g1: rank() });
            expect(await ingestServers.orgaServersOf("u1", { ...opts, guildAccess, rolesOnly: true })).toEqual([]);
            expect(resolveGuildAccess).not.toHaveBeenCalled();
        });

        it("leaves a full admin, an orga role and a category manager as they are", async () => {
            resolveGuildAccess.mockResolvedValue({ isAdmin: true, guilds: {} });
            expect(await ingestServers.orgaServersOf("u1", { ...opts, rolesOnly: true })).toHaveLength(3);
            resolveGuildAccess.mockResolvedValue(orgaOn("g2"));
            categoryOrga.isAnyCategoryManager.mockImplementation(async (_user, { guildId }) => guildId === "g3");
            expect(await ingestServers.orgaServersOf("u1", { ...opts, rolesOnly: true })).toEqual([
                { guildId: "g2", role: "orga" }, { guildId: "g3", role: "category" },
            ]);
        });

        it("reaches serversOfToken", async () => {
            resolveGuildAccess.mockResolvedValue(access({ g1: rank(), g2: rank({ roleIsOrga: true }) }));
            expect(await ingestServers.serversOfToken({ id: "t", ownerId: "u1" }, { ...opts, rolesOnly: true })).toEqual(["g2"]);
        });
    });
});

describe("tokenMayLearnClasses (#1072)", () => {
    const PERSON = { id: "t", ownerId: "u1" };
    const rank = (over = {}) => ({ access: { history: { read: true, write: true } }, isOrga: true, isMember: true, isServerAdmin: true, roleAccess: {}, ...over });
    const mayLearn = (token, guildId) => ingestServers.tokenMayLearnClasses(token, guildId, opts);

    it("refuses the owner of a personal key holding only the rank on that server", async () => {
        computeGuildAccess.mockResolvedValue(access({ g1: rank() }));
        expect(await mayLearn(PERSON, "g1")).toBe(false);
    });

    it("lets an orga role next to the rank learn, also without history write, as the same account without the rank", async () => {
        computeGuildAccess.mockResolvedValue(access({ g1: rank({ roleIsOrga: true }) }));
        expect(await mayLearn(PERSON, "g1")).toBe(true);
        computeGuildAccess.mockResolvedValue(access({ g1: { access: {}, isOrga: true } }));
        expect(await mayLearn(PERSON, "g1")).toBe(true);
    });

    it("lets a manager of a category roster next to the rank learn", async () => {
        computeGuildAccess.mockResolvedValue(access({ g1: rank() }));
        categoryOrga.isAnyCategoryManager.mockImplementation(async (_user, { guildId }) => guildId === "g1");
        expect(await mayLearn(PERSON, "g1")).toBe(true);
    });

    it("learns nothing when the lookup fails", async () => {
        computeGuildAccess.mockRejectedValue(new Error("Discord down"));
        expect(await mayLearn(PERSON, "g1")).toBe(false);
        expect(await mayLearn(PERSON, "")).toBe(false);
        expect(resolveGuildAccess).not.toHaveBeenCalled();
    });

    it("learns nothing when a later lookup of the roles fails", async () => {
        computeGuildAccess.mockResolvedValue(access({ g1: rank() }));
        categoryOrga.isAnyCategoryManager.mockRejectedValue(new Error("Discord down"));
        expect(await mayLearn(PERSON, "g1")).toBe(false);
    });

    it("asks every ranked server for a raid without a known server", async () => {
        computeGuildAccess.mockResolvedValue(access({ g1: rank({ roleIsOrga: true }), g2: rank() }));
        expect(await mayLearn(PERSON, "")).toBe(false);
        computeGuildAccess.mockResolvedValue(access({ g1: rank({ roleIsOrga: true }), g2: rank({ roleIsOrga: true }) }));
        expect(await mayLearn(PERSON, "")).toBe(true);
    });

    it("lets a full admin, a key without an owner and an owner without the rank learn as before", async () => {
        computeGuildAccess.mockResolvedValue({ isAdmin: true, guilds: {} });
        expect(await mayLearn(PERSON, "g1")).toBe(true);
        // the rank on another server says nothing about this raid's
        computeGuildAccess.mockResolvedValue(access({ g1: rank(), g2: { access: {}, isOrga: true } }));
        expect(await mayLearn(PERSON, "g2")).toBe(true);
        computeGuildAccess.mockResolvedValue(access({}));
        expect(await mayLearn(PERSON, "g1")).toBe(true);
        computeGuildAccess.mockClear();
        expect(await mayLearn({ id: "s", guildId: "g1" }, "g1")).toBe(true);
        expect(await mayLearn({ id: "o" }, "")).toBe(true);
        expect(computeGuildAccess).not.toHaveBeenCalled();
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
    it("names each server with its label, icon, the role and its versions", () => {
        const out = ingestServers.describeServers([{ guildId: "g1", role: "orga" }, { guildId: "g3" }], opts);
        expect(out).toEqual([
            { guildId: "g1", name: "Pulse", label: "Hauptgilde", iconUrl: "https://cdn.discordapp.com/icons/g1/abc.webp?size=64", role: "orga", versions: [expect.objectContaining({ id: "tbc" })] },
            { guildId: "g3", name: "", label: "", iconUrl: "", role: "", versions: [expect.objectContaining({ id: "tbc" })] },
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
