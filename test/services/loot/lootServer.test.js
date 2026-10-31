// The server rule for loot (#919): raid -> import server -> category -> first server.
jest.mock("../../../src/stores/settings/settingsStore", () => ({
    ...jest.requireActual("../../../src/stores/settings/settingsStore"),
    getConfig: jest.fn(() => ({ discordServers: { servers: [{ guildId: "gA" }, { guildId: "gB" }] } })),
}));
jest.mock("../../../src/services/discord/servers/serverOf", () => ({
    ...jest.requireActual("../../../src/services/discord/servers/serverOf"),
    storedCategoryGuilds: () => new Map([["cat-b", "gB"]]),
}));

const { serverContext, guildOfLootEvent, lootInGuild, lootOfGuild, eventInGuild, sessionInGuild, serverWithoutSession, serverOfInteraction } = require("../../../src/services/loot/lootServer");

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

    it("filters nothing without a server argument and copes with no list", () => {
        expect(lootOfGuild(rows, undefined)).toBe(rows);
        expect(lootOfGuild(null, "gA")).toEqual([]);
        expect(lootInGuild(ctxOf(), null, undefined)).toBe(true);
    });

    it("shows nothing when there is no active server (fail closed)", () => {
        expect(lootOfGuild(rows, "")).toEqual([]);
        expect(lootOfGuild(rows, null)).toEqual([]);
        expect(lootInGuild(ctxOf(), { eventId: "manual-old" }, "")).toBe(false);
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

describe("sessionInGuild (addon inbox cards, #919)", () => {
    const card = (suggested) => ({ id: "s", match: suggested ? { suggested } : null });

    it("shows a card on the server its match stored, else on its raid's server", () => {
        const ctx = ctxOf();
        expect(sessionInGuild(ctx, card({ eventId: "evA", guildId: "gB" }), "gB")).toBe(true);
        expect(sessionInGuild(ctx, card({ eventId: "evA", guildId: "gB" }), "gA")).toBe(false);
        expect(sessionInGuild(ctx, card({ eventId: "evCatB" }), "gB")).toBe(true);
        expect(sessionInGuild(ctx, card({ eventId: "evCatB" }), "gA")).toBe(false);
    });

    it("shows a card without a suggestion on every server", () => {
        const ctx = ctxOf();
        expect(sessionInGuild(ctx, card(null), "gA")).toBe(true);
        expect(sessionInGuild(ctx, card({ eventId: "" }), "gB")).toBe(true);
    });

    // #1002: a waiting upload shows for the orga of every candidate's server.
    it("shows a waiting upload on each of its servers, on all without any", () => {
        const ctx = ctxOf();
        const waiting = { ...card({ eventId: "evA", guildId: "gB" }), guildId: "gB", waiting: true, servers: ["gA", "gC"] };
        expect(sessionInGuild(ctx, waiting, "gA")).toBe(true);
        expect(sessionInGuild(ctx, waiting, "gC")).toBe(true);
        expect(sessionInGuild(ctx, waiting, "gB")).toBe(false);
        expect(sessionInGuild(ctx, { ...card(null), waiting: true, servers: [] }, "gB")).toBe(true);
        expect(sessionInGuild(ctx, { ...card(null), waiting: true }, "")).toBe(false);
    });

    // #994: the upload key's server keeps a card without a suggestion at home.
    it("shows a card without a suggestion only on the server of its upload key", () => {
        const ctx = ctxOf();
        const ofKey = { ...card(null), guildId: "gA" };
        expect(sessionInGuild(ctx, ofKey, "gA")).toBe(true);
        expect(sessionInGuild(ctx, ofKey, "gB")).toBe(false);
        expect(sessionInGuild(ctx, { ...card({ eventId: "" }), guildId: "gB" }, "gA")).toBe(false);
        // a suggestion still wins over the key's server
        expect(sessionInGuild(ctx, { ...card({ eventId: "evA", guildId: "gB" }), guildId: "gA" }, "gB")).toBe(true);
    });

    it("shows nothing without an active server, everything without a filter", () => {
        const ctx = ctxOf();
        expect(sessionInGuild(ctx, card(null), "")).toBe(false);
        expect(sessionInGuild(ctx, card({ eventId: "evB", guildId: "gB" }), undefined)).toBe(true);
    });
});

describe("serverWithoutSession (token routes, #919)", () => {
    it("takes the category's server, else the first server", () => {
        expect(serverWithoutSession("cat-b", ctxOf())).toBe("gB");
        expect(serverWithoutSession("", ctxOf())).toBe("gA");
        expect(serverWithoutSession("cat-unknown")).toBe("gA");
    });
});

describe("serverOfInteraction (bot commands, #919)", () => {
    it("takes the server the command was used on, in a DM the first server", () => {
        expect(serverOfInteraction({ guildId: "gB" }, ctxOf())).toBe("gB");
        expect(serverOfInteraction({ guild: { id: "gB" } }, ctxOf())).toBe("gB");
        expect(serverOfInteraction({ guildId: null }, ctxOf())).toBe("gA");
        expect(serverOfInteraction(null, ctxOf())).toBe("gA");
    });
});
