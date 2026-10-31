jest.mock("fs", () => require("../../../helpers/memoryFs").memoryFs());

const fs = require("fs");
const { settingsPath } = require("../../../../src/config/paths");
const {
    firstServerId, categoryGuildIndex, storedCategoryGuilds, guildOfEvent, postGuildOf, logGuild,
} = require("../../../../src/services/discord/servers/serverOf");

const A = "111111111111111111";
const B = "222222222222222222";
const C = "333333333333333333";

beforeEach(() => fs.__store.clear());

describe("services/discord/servers/serverOf (#917)", () => {
    describe("firstServerId", () => {
        it("is the first server, else the home guild, else empty", () => {
            expect(firstServerId({ guildId: C, discordServers: { servers: [{ guildId: A }, { guildId: B }] } })).toBe(A);
            expect(firstServerId({ guildId: C, discordServers: { servers: [] } })).toBe(C);
            expect(firstServerId({})).toBe("");
            expect(firstServerId(undefined)).toBe("");
        });
    });

    describe("categoryGuildIndex", () => {
        it("maps every category to its server, the first server wins", () => {
            const index = categoryGuildIndex({ [A]: { cat1: "Raids", cat2: "PuGs" }, [B]: { cat2: "Doppelt", cat3: "x" }, [C]: null });
            expect([...index.entries()]).toEqual([["cat1", A], ["cat2", A], ["cat3", B]]);
            expect(categoryGuildIndex(undefined).size).toBe(0);
        });

        it("reads the stored category-name snapshot", () => {
            fs.__store.set(settingsPath("category-names.json"), JSON.stringify({ guilds: { [B]: { cat9: "Raids" } } }));
            expect(storedCategoryGuilds().get("cat9")).toBe(B);
        });

        it("reads nothing without a snapshot", () => {
            expect(storedCategoryGuilds().size).toBe(0);
        });
    });

    describe("guildOfEvent", () => {
        const categoryGuilds = new Map([["cat1", B]]);

        it("takes the event's own server first", () => {
            expect(guildOfEvent({ guildId: A, categoryId: "cat1" }, { categoryGuilds })).toBe(A);
        });

        it("falls back to the server of the category (Raid-Helper events)", () => {
            expect(guildOfEvent({ categoryId: "cat1" }, { categoryGuilds })).toBe(B);
            expect(guildOfEvent({ categoryId: "unknown" }, { categoryGuilds })).toBe("");
            expect(guildOfEvent({}, { categoryGuilds })).toBe("");
            expect(guildOfEvent(null)).toBe("");
        });

        it("uses the stored snapshot when no index is handed in", () => {
            fs.__store.set(settingsPath("category-names.json"), JSON.stringify({ guilds: { [C]: { cat7: "Raids" } } }));
            expect(guildOfEvent({ categoryId: "cat7" })).toBe(C);
        });
    });

    describe("postGuildOf", () => {
        it("keeps the stored origin server", () => {
            expect(postGuildOf({ postGuildId: B, guildId: A, guildFrom: "event" })).toBe(B);
        });

        it("reads an old log as coming from its guildId, with or without a channel", () => {
            expect(postGuildOf({ guildId: A, channelId: "c1" })).toBe(A);
            expect(postGuildOf({ guildId: A })).toBe(A);
        });

        it("has no origin server for a log already assigned without one, or none at all", () => {
            expect(postGuildOf({ guildId: A, channelId: "c1", guildFrom: "event" })).toBe("");
            expect(postGuildOf({ guildId: "" })).toBe("");
            expect(postGuildOf(null)).toBe("");
        });
    });

    describe("logGuild: raid before origin server before first server", () => {
        it("the linked raid wins over the channel", () => {
            expect(logGuild({ guildId: A, channelId: "c1", eventId: "e1" }, { eventGuildId: B, firstGuildId: C }))
                .toEqual({ guildId: B, guildFrom: "event", postGuildId: A });
        });

        it("the origin server wins over the first server", () => {
            expect(logGuild({ guildId: A, channelId: "c1" }, { firstGuildId: C }))
                .toEqual({ guildId: A, guildFrom: "channel", postGuildId: A });
        });

        it("a log without a channel keeps the server it was added on", () => {
            expect(logGuild({ guildId: B }, { firstGuildId: C })).toEqual({ guildId: B, guildFrom: "channel", postGuildId: B });
        });

        it("a log whose raid is gone and that has no channel keeps its server", () => {
            expect(logGuild({ guildId: B, eventId: "gone" }, { firstGuildId: C })).toEqual({ guildId: B, guildFrom: "channel", postGuildId: B });
        });

        it("only a log without any server gets the first server", () => {
            expect(logGuild({ eventId: "" }, { firstGuildId: C })).toEqual({ guildId: C, guildFrom: "first", postGuildId: "" });
            expect(logGuild({ guildId: "  " }, { firstGuildId: C })).toEqual({ guildId: C, guildFrom: "first", postGuildId: "" });
        });

        it("without any server the log stays unassigned", () => {
            expect(logGuild({}, {})).toEqual({ guildId: "", guildFrom: "", postGuildId: "" });
            expect(logGuild(undefined)).toEqual({ guildId: "", guildFrom: "", postGuildId: "" });
        });

        it("a log whose raid is gone falls back to its origin server", () => {
            const assigned = { guildId: B, guildFrom: "event", postGuildId: A, channelId: "c1", eventId: "" };
            expect(logGuild(assigned, { firstGuildId: C })).toEqual({ guildId: A, guildFrom: "channel", postGuildId: A });
        });

        it("a log still linked to a raid that is not found keeps the raid's server", () => {
            const assigned = { guildId: B, guildFrom: "event", postGuildId: A, channelId: "c1", eventId: "e1" };
            expect(logGuild(assigned, { firstGuildId: C })).toEqual({ guildId: B, guildFrom: "event", postGuildId: A });
        });

        it("is stable: the result read again gives the same result", () => {
            const log = { guildId: A, channelId: "c1", eventId: "e1" };
            const once = { ...log, ...logGuild(log, { eventGuildId: B, firstGuildId: C }) };
            expect(logGuild(once, { eventGuildId: B, firstGuildId: C })).toEqual({ guildId: B, guildFrom: "event", postGuildId: A });
        });
    });
});
