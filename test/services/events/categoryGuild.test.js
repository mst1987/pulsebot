// categoryGuild (#926): the server of a raid category and whether it is proven gone.
jest.mock("../../../src/services/discord/discord", () => ({ isOnline: jest.fn(() => true), getGuild: jest.fn(), isGuildAvailable: jest.fn(), listCategories: jest.fn(), listGuilds: jest.fn() }));
jest.mock("../../../src/services/discord/guildRoles", () => ({ eventGuildIds: jest.fn(() => []) }));
jest.mock("../../../src/services/discord/serverOf", () => ({ storedCategoryGuilds: jest.fn(() => new Map()), firstServerId: jest.fn(() => "A") }));
jest.mock("../../../src/stores/eventStore", () => ({ listEvents: jest.fn(() => []) }));
jest.mock("../../../src/stores/raidEventStore", () => ({ listRaidEvents: jest.fn(() => []) }));
jest.mock("../../../src/stores/rosterStore", () => ({ listRosters: jest.fn(() => []) }));

const discord = require("../../../src/services/discord/discord");
const guildRoles = require("../../../src/services/discord/guildRoles");
const serverOf = require("../../../src/services/discord/serverOf");
const eventStore = require("../../../src/stores/eventStore");
const { listRaidEvents } = require("../../../src/stores/raidEventStore");
const rosterStore = require("../../../src/stores/rosterStore");
const cg = require("../../../src/services/events/categoryGuild");

beforeEach(() => {
    jest.clearAllMocks();
    discord.isOnline.mockReturnValue(true);
    discord.getGuild.mockImplementation((id) => ({ id }));
    discord.isGuildAvailable.mockImplementation((id) => id === "A" || id === "B");
    discord.listGuilds.mockReturnValue([{ id: "A" }, { id: "B" }]);
    discord.listCategories.mockImplementation((id) => (id === "A" ? [{ id: "a1" }] : id === "B" ? [{ id: "b1" }] : []));
    guildRoles.eventGuildIds.mockReturnValue(["A", "B"]);
    serverOf.storedCategoryGuilds.mockReturnValue(new Map([["a2", "A"], ["b2", "B"]]));
    serverOf.firstServerId.mockReturnValue("A");
    eventStore.listEvents.mockReturnValue([]);
    listRaidEvents.mockReturnValue([]);
    rosterStore.listRosters.mockReturnValue([]);
});

describe("services/events/categoryGuild", () => {
    describe("categoryContext", () => {
        it("reads live categories over every bot server, then snapshot, raids and rosters (first hit wins)", () => {
            serverOf.storedCategoryGuilds.mockReturnValue(new Map([["a1", "B"], ["s1", "A"]]));
            eventStore.listEvents.mockReturnValue([{ guildId: "B", categoryId: "s1" }, { guildId: "A", categoryId: "e1" }, { categoryId: "nog" }]);
            listRaidEvents.mockReturnValue([{ guildId: "B", categoryId: "r1" }]);
            rosterStore.listRosters.mockReturnValue([{ guildId: "A", categoryId: "o1" }]);
            const ctx = cg.categoryContext({});
            expect(ctx.online).toBe(true);
            expect([...ctx.live]).toEqual([["a1", "A"], ["b1", "B"]]);
            expect(Object.fromEntries(ctx.owners)).toEqual({ a1: "A", b1: "B", s1: "A", e1: "A", r1: "B", o1: "A" });
            // only live and the snapshot are proof; events, raids and rosters only place a category
            expect(Object.fromEntries(ctx.proofs)).toEqual({ a1: "A", b1: "B", s1: "A" });
            expect(Object.fromEntries(ctx.liveCounts)).toEqual({ A: 1, B: 1 });
            expect(ctx.servers).toEqual(["A", "B"]);
            expect(ctx.first).toBe("A");
        });

        it("has no live categories while the bot is offline, and treats an unreadable store as no proof", () => {
            discord.isOnline.mockReturnValue(false);
            serverOf.storedCategoryGuilds.mockImplementation(() => { throw new Error("broken"); });
            listRaidEvents.mockImplementation(() => { throw new Error("broken"); });
            const ctx = cg.categoryContext(null);
            expect(ctx.online).toBe(false);
            expect(ctx.live.size).toBe(0);
            expect(ctx.owners.size).toBe(0);
            expect(discord.listGuilds).not.toHaveBeenCalled();
        });
    });

    describe("categoryState", () => {
        it("tells live, missing and every unknown reason apart", () => {
            serverOf.storedCategoryGuilds.mockReturnValue(new Map([["a2", "A"], ["c2", "C"], ["b2", "B"]]));
            discord.isGuildAvailable.mockImplementation((id) => id === "A"); // B not cached
            const ctx = cg.categoryContext({});
            expect(cg.categoryState("a1", ctx)).toEqual({ state: "live", guildId: "A", reason: "" });
            expect(cg.categoryState("a2", ctx)).toEqual({ state: "missing", guildId: "A", reason: "" });
            expect(cg.categoryState("x", ctx)).toEqual({ state: "unknown", guildId: "", reason: "no_server" });
            expect(cg.categoryState("c2", ctx)).toEqual({ state: "unknown", guildId: "C", reason: "server_not_configured" });
            expect(cg.categoryState("b2", ctx)).toEqual({ state: "unknown", guildId: "B", reason: "server_unreachable" });
            discord.isOnline.mockReturnValue(false);
            expect(cg.categoryState("a2", cg.categoryContext({})).reason).toBe("offline");
        });

        it("never reads a category of an unavailable server (Discord outage) as missing", () => {
            // discord.js v14: the server stays cached with available === false and no channels
            discord.isGuildAvailable.mockImplementation((id) => id === "B");
            discord.listCategories.mockImplementation((id) => (id === "B" ? [{ id: "b1" }] : []));
            const ctx = cg.categoryContext({});
            expect(discord.listCategories).not.toHaveBeenCalledWith("A");
            expect(cg.categoryState("a2", ctx)).toEqual({ state: "unknown", guildId: "A", reason: "server_unreachable" });
            expect(cg.categoryState("b2", ctx).state).toBe("missing");
        });

        it("falls back to getGuild().available without isGuildAvailable", () => {
            const isGuildAvailable = discord.isGuildAvailable;
            delete discord.isGuildAvailable;
            try {
                discord.getGuild.mockImplementation((id) => (id === "A" ? { id, available: false } : id === "B" ? { id } : null));
                const ctx = cg.categoryContext({});
                expect(cg.categoryState("a2", ctx).reason).toBe("server_unreachable");
                expect(cg.categoryState("b2", ctx).state).toBe("missing");
            } finally {
                discord.isGuildAvailable = isGuildAvailable;
            }
        });

        it("does not trust a configured server that lists no category although the snapshot knows some", () => {
            discord.listCategories.mockImplementation((id) => (id === "B" ? [{ id: "b1" }] : []));
            const ctx = cg.categoryContext({});
            expect(cg.categoryState("a2", ctx)).toEqual({ state: "unknown", guildId: "A", reason: "server_empty" });
            expect(cg.categoryState("b2", ctx).state).toBe("missing");
        });

        it("places a category by a roster or raid, but never proves it deleted from them", () => {
            serverOf.storedCategoryGuilds.mockReturnValue(new Map());
            rosterStore.listRosters.mockReturnValue([{ guildId: "B", categoryId: "o1" }]);
            listRaidEvents.mockReturnValue([{ guildId: "B", categoryId: "r1" }]);
            eventStore.listEvents.mockReturnValue([{ guildId: "B", categoryId: "e1" }]);
            const ctx = cg.categoryContext({});
            for (const id of ["o1", "r1", "e1"]) {
                expect(cg.displayServerOf(id, ctx)).toBe("B");
                expect(cg.categoryState(id, ctx)).toEqual({ state: "unknown", guildId: "B", reason: "no_server" });
            }
        });
    });

    describe("servers of a list", () => {
        it("puts a category of an unlisted server on the first server, marked unproven", () => {
            serverOf.storedCategoryGuilds.mockReturnValue(new Map([["c2", "C"]]));
            const ctx = cg.categoryContext({});
            expect(cg.displayServerOf("c2", ctx)).toBe("A");
            expect(cg.hasKnownServer("c2", ctx)).toBe(false);
        });

        it("puts a category without proven server on the first server", () => {
            const ctx = cg.categoryContext({});
            expect(cg.displayServerOf("b1", ctx)).toBe("B");
            expect(cg.displayServerOf("x", ctx)).toBe("A");
            expect(cg.hasKnownServer("x", ctx)).toBe(false);
            expect(cg.hasKnownServer("b2", ctx)).toBe(true);
            expect(cg.idsOnServer(["a1", "b1", "x", "b2", ""], "B", ctx)).toEqual(["b1", "b2"]);
            expect(cg.idsOnServer(["a1", "b1", "x"], "", ctx)).toEqual(["a1", "x"]);
            expect(cg.idsOnServer(null, "A", ctx)).toEqual([]);
        });

        it("merges a save on one server without touching the others, in stored order", () => {
            const ctx = cg.categoryContext({});
            const stored = ["b1", "a1", "b2", "a2"];
            // A drops a2, adds x (unproven -> first server A), tries to drop b1/b2 and add nothing of B
            expect(cg.mergeServerCategoryIds({ stored, sent: ["a1", "x"], guildId: "A", ctx })).toEqual(["b1", "a1", "b2", "x"]);
            // a list sent on A that names B's categories cannot add them for A either
            expect(cg.mergeServerCategoryIds({ stored: ["a1"], sent: ["a1", "b1"], guildId: "A", ctx })).toEqual(["a1"]);
            // B empties its list: A's stay
            expect(cg.mergeServerCategoryIds({ stored, sent: [], guildId: "B", ctx })).toEqual(["a1", "a2"]);
            // no server given: the first server
            expect(cg.mergeServerCategoryIds({ stored: undefined, sent: ["a1"], guildId: "", ctx })).toEqual(["a1"]);
        });
    });
});
