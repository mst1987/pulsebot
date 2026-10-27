// The server rule for loot (#919): raid -> import server -> category -> first server.
jest.mock("../../../src/stores/settingsStore", () => ({
    ...jest.requireActual("../../../src/stores/settingsStore"),
    getConfig: jest.fn(() => ({ discordServers: { servers: [{ guildId: "gA" }, { guildId: "gB" }] } })),
}));
jest.mock("../../../src/services/discord/serverOf", () => ({
    ...jest.requireActual("../../../src/services/discord/serverOf"),
    storedCategoryGuilds: () => new Map([["cat-b", "gB"]]),
}));

const { serverContext, guildOfLootEvent, lootInGuild, lootOfGuild, eventInGuild } = require("../../../src/services/loot/lootServer");

const EVENTS = {
    evA: { id: "evA", guildId: "gA" },
    evB: { id: "evB", guildId: "gB" },
    evCatB: { id: "evCatB", categoryId: "cat-b" },
};
const ctxOf = (config) => serverContext({
    config: config || { discordServers: { servers: [{ guildId: "gA" }, { guildId: "gB" }] } },
    categoryGuilds: new Map([["cat-b", "gB"]]),
    eventOf: (id) => EVENTS[id] || null,
});

describe("guildOfLootEvent", () => {
    it("takes the raid's server first, also over its category", () => {
        const ctx = ctxOf();
        expect(guildOfLootEvent(ctx, "evB")).toBe("gB");
        expect(guildOfLootEvent(ctx, "evCatB")).toBe("gB");
        expect(guildOfLootEvent(ctx, "evA", "cat-b", "gB")).toBe("gA");
    });

    it("places a raidless bucket by import server, then category, then the first server", () => {
        const ctx = ctxOf();
        expect(guildOfLootEvent(ctx, "manual-x", "cat-b", "gC")).toBe("gC");
        expect(guildOfLootEvent(ctx, "manual-x", "cat-b")).toBe("gB");
        expect(guildOfLootEvent(ctx, "manual-x")).toBe("gA");
        expect(guildOfLootEvent(ctx, "")).toBe("gA");
    });

    it("survives an event lookup that throws and caches per key", () => {
        const eventOf = jest.fn(() => { throw new Error("broken"); });
        const ctx = serverContext({ config: { guildId: "gZ" }, categoryGuilds: new Map(), eventOf });
        expect(guildOfLootEvent(ctx, "evX")).toBe("gZ");
        expect(guildOfLootEvent(ctx, "evX")).toBe("gZ");
        expect(eventOf).toHaveBeenCalledTimes(1);
    });
});

describe("lootInGuild / lootOfGuild / eventInGuild", () => {
    const rows = [
        { id: 1, eventId: "evA" },
        { id: 2, eventId: "evB" },
        { id: 3, eventId: "manual-b", guildId: "gB" },
        { id: 4, eventId: "manual-c", categoryId: "cat-b" },
        { id: 5, eventId: "manual-old" },
    ];

    it("keeps only the rows of the active server", () => {
        const ctx = ctxOf();
        expect(lootOfGuild(rows, "gA", ctx).map((r) => r.id)).toEqual([1, 5]);
        expect(lootOfGuild(rows, "gB", ctx).map((r) => r.id)).toEqual([2, 3, 4]);
    });

    it("filters nothing without an active server and copes with no list", () => {
        expect(lootOfGuild(rows, "")).toBe(rows);
        expect(lootOfGuild(null, "gA")).toEqual([]);
        expect(lootInGuild(ctxOf(), null, "")).toBe(true);
    });

    it("counts unplaceable rows for the active server when no server is configured", () => {
        const ctx = serverContext({ config: {}, categoryGuilds: new Map(), eventOf: () => null });
        expect(lootInGuild(ctx, { eventId: "manual-old" }, "gA")).toBe(true);
    });

    it("builds its own context from the settings when none is given", () => {
        expect(lootOfGuild([{ eventId: "manual-q", categoryId: "cat-b" }], "gA")).toEqual([]);
    });

    it("answers for an import or inbox target", () => {
        const ctx = ctxOf();
        expect(eventInGuild(ctx, "evB", "gA")).toBe(false);
        expect(eventInGuild(ctx, "evB", "gB")).toBe(true);
        expect(eventInGuild(ctx, "manual-z", "gB", "cat-b")).toBe(true);
    });
});
