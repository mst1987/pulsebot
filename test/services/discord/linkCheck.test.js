// linkCheck (#537): the one place an overview gets a link — only to a channel,
// message or page that is there. Discord is a fake client (helpers/discordClient),
// the stores are mocked; nothing talks to the network.
jest.mock("../../../src/services/discord/discord", () => require("../../helpers/discordMock").withClientHelpers({ getClient: jest.fn(() => null) }));
jest.mock("../../../src/utils/publicUrl", () => ({ publicBaseUrl: jest.fn(() => "https://eh.example") }));
jest.mock("../../../src/stores/eventStore", () => ({
    isOwnEventId: (id) => String(id).startsWith("eh-"),
    getEvent: jest.fn((id) => (id === "eh-1" ? { id: "eh-1" } : null)),
}));
jest.mock("../../../src/stores/raidplanStore", () => ({ getPlan: jest.fn(() => null) }));

const discord = require("../../../src/services/discord/discord");
const { publicBaseUrl } = require("../../../src/utils/publicUrl");
const raidplanStore = require("../../../src/stores/raidplanStore");
const linkCheck = require("../../../src/services/discord/linkCheck");
const { makeClient, makeGuild, makeChannel, discordError } = require("../../helpers/discordClient");

/** The bot online with guild g1 holding `channels` (cached in guild and client). */
function online(channels = [], { guilds } = {}) {
    const list = channels.map((c) => (typeof c === "string" ? makeChannel({ id: c }) : c));
    const client = makeClient({ guilds: guilds || [makeGuild({ id: "g1", channels: list })], channels: list });
    discord.getClient.mockReturnValue(client);
    return client;
}

beforeEach(() => {
    linkCheck._reset();
    discord.getClient.mockReturnValue(null);
    publicBaseUrl.mockReturnValue("https://eh.example");
});

describe("services/discord/linkCheck — channels", () => {
    it("links a channel that is in the bot's cache", () => {
        online(["c1"]);
        expect(linkCheck.channelState("g1", "c1")).toBe("ok");
        expect(linkCheck.channelLink("g1", "c1")).toBe("https://discord.com/channels/g1/c1");
    });

    it("calls a channel missing that its guild does not have any more (deleted)", () => {
        online(["c1"]);
        expect(linkCheck.channelState("g1", "c-gone")).toBe("missing");
        expect(linkCheck.channelLink("g1", "c-gone")).toBe("");
        expect(linkCheck.channelInfo("g1", "c-gone")).toEqual({ state: "missing", url: "" });
    });

    it("gives no link without ids", () => {
        expect(linkCheck.channelLink("", "c1")).toBe("");
        expect(linkCheck.channelLink("g1", "")).toBe("");
        expect(linkCheck.channelState("g1", "")).toBe("missing");
    });

    it("keeps the last known state while the bot is offline, and leaves the link out with none", () => {
        online(["c1"]);
        expect(linkCheck.channelState("g1", "c1")).toBe("ok");
        expect(linkCheck.channelState("g1", "c2")).toBe("missing");
        discord.getClient.mockReturnValue(null);
        expect(linkCheck.channelLink("g1", "c1")).toBe("https://discord.com/channels/g1/c1");
        expect(linkCheck.channelState("g1", "c2")).toBe("missing");
        expect(linkCheck.channelState("g1", "c3")).toBe("unknown");
        expect(linkCheck.channelLink("g1", "c3")).toBe("");
    });

    it("marks a channel deleted on the gateway at once, whatever the cache says", () => {
        online(["c1"]);
        expect(linkCheck.channelState("g1", "c1")).toBe("ok");
        linkCheck.channelDeleted("c1");
        expect(linkCheck.channelState("g1", "c1")).toBe("missing");
        expect(linkCheck.channelLink("g1", "c1")).toBe("");
    });

    it("confirms with a request where the cache cannot say, and remembers it for five minutes", async () => {
        // the bot is not on guild g9: only a fetch can tell
        const client = online([]);
        client.channels.fetch.mockRejectedValueOnce(discordError("channel"));
        expect(await linkCheck.checkChannel("g9", "x1", 1000)).toBe("missing");
        expect(client.channels.fetch).toHaveBeenCalledTimes(1);
        expect(await linkCheck.checkChannel("g9", "x1", 2000)).toBe("missing");
        expect(client.channels.fetch).toHaveBeenCalledTimes(1);
        // after the five minutes it asks again
        client.channels.fetch.mockResolvedValueOnce(makeChannel({ id: "x1" }));
        expect(await linkCheck.checkChannel("g9", "x1", 1000 + linkCheck.TTL_MS + 1)).toBe("ok");
        expect(client.channels.fetch).toHaveBeenCalledTimes(2);
    });

    it("treats missing access as missing and any other error as unknown", async () => {
        const client = online([]);
        client.channels.fetch.mockRejectedValueOnce(Object.assign(new Error("Missing Access"), { code: 50001 }));
        expect(await linkCheck.checkChannel("g9", "x2")).toBe("missing");
        client.channels.fetch.mockRejectedValueOnce(new Error("socket hang up"));
        expect(await linkCheck.checkChannel("g9", "x3")).toBe("unknown");
    });

    it("never fetches while the bot is offline", async () => {
        expect(await linkCheck.checkChannel("g1", "c1")).toBe("unknown");
        await linkCheck.checkChannels([{ guildId: "g1", channelId: "c1" }, { guildId: "g1", channelId: "c1" }, { channelId: "" }]);
        expect(linkCheck.channelState("g1", "c1")).toBe("unknown");
    });

    it("annotates web rows with the channel state", () => {
        online(["c1"]);
        expect(linkCheck.withChannelState("g1", [{ id: "a", channelId: "c1" }, { id: "b", channelId: "c2" }, { id: "c" }])).toEqual([
            { id: "a", channelId: "c1", channelState: "ok" },
            { id: "b", channelId: "c2", channelState: "missing" },
            { id: "c" },
        ]);
    });

    it("knows the Discord errors that mean gone", () => {
        expect(linkCheck.isGone({ code: 10003 })).toBe(true);
        expect(linkCheck.isGone({ code: 10008 })).toBe(true);
        expect(linkCheck.isGone({ status: 404 })).toBe(true);
        expect(linkCheck.isGone({ code: "channel_not_found" })).toBe(true);
        expect(linkCheck.isGone({ message: "Unknown Channel" })).toBe(true);
        expect(linkCheck.isGone({ code: 50013 })).toBe(false);
        expect(linkCheck.isGone(null)).toBe(false);
    });
});

describe("services/discord/linkCheck — messages", () => {
    it("links a message in an existing channel until it is deleted", () => {
        online(["c1"]);
        expect(linkCheck.messageLink("g1", "c1", "m1")).toBe("https://discord.com/channels/g1/c1/m1");
        linkCheck.messageDeleted("m1");
        expect(linkCheck.messageLink("g1", "c1", "m1")).toBe("");
        expect(linkCheck.messageLink("g1", "c1", "")).toBe("");
    });

    it("gives no message link when its channel is gone", () => {
        online([]);
        expect(linkCheck.messageLink("g1", "c1", "m1")).toBe("");
    });

    it("confirms a message with a request (Unknown Message = missing)", async () => {
        const channel = makeChannel({ id: "c1", messages: [{ id: "m1" }] });
        online([channel]);
        expect(await linkCheck.checkMessage("g1", "c1", "m1")).toBe("ok");
        expect(await linkCheck.checkMessage("g1", "c1", "m2")).toBe("missing");
        expect(linkCheck.messageLink("g1", "c1", "m2")).toBe("");
        expect(await linkCheck.checkMessage("g1", "c1", "")).toBe("missing");
    });

    it("links an event's signup message, else its channel, else nothing", () => {
        online(["c1"]);
        const event = { guildId: "g1", channelId: "c1", message: { channelId: "c1", messageId: "m1" } };
        expect(linkCheck.eventLink(event)).toBe("https://discord.com/channels/g1/c1/m1");
        linkCheck.messageDeleted("m1");
        expect(linkCheck.eventLink(event)).toBe("https://discord.com/channels/g1/c1");
        linkCheck.channelDeleted("c1");
        expect(linkCheck.eventLink(event)).toBe("");
        expect(linkCheck.eventLink(null)).toBe("");
    });
});

describe("services/discord/linkCheck — web and external links", () => {
    it("builds web links on PUBLIC_BASE_URL", () => {
        expect(linkCheck.webLink("/raids")).toBe("https://eh.example/raids");
        expect(linkCheck.webLink("signups")).toBe("https://eh.example/signups");
        expect(linkCheck.webLink("")).toBe("");
    });

    it("gives no web link without a usable PUBLIC_BASE_URL", () => {
        publicBaseUrl.mockReturnValue("");
        expect(linkCheck.webLink("/raids")).toBe("");
        expect(linkCheck.webTarget("signup", "eh-1")).toBe("");
        publicBaseUrl.mockReturnValue("/relative");
        expect(linkCheck.webBase()).toBe("");
    });

    it("refuses the localhost fallback when PUBLIC_BASE_URL is not set, accepts it when it is", () => {
        const before = process.env.PUBLIC_BASE_URL;
        publicBaseUrl.mockReturnValue("http://localhost:3005");
        delete process.env.PUBLIC_BASE_URL;
        expect(linkCheck.webBase()).toBe("");
        process.env.PUBLIC_BASE_URL = "http://localhost:3005";
        expect(linkCheck.webBase()).toBe("http://localhost:3005");
        if (before === undefined) delete process.env.PUBLIC_BASE_URL;
        else process.env.PUBLIC_BASE_URL = before;
    });

    it("links an event page, comp and calendar only for an own event that exists", () => {
        expect(linkCheck.webTarget("event", "eh-1")).toBe("https://eh.example/e/eh-1");
        expect(linkCheck.webTarget("comp", "eh-1")).toBe("https://eh.example/e/eh-1/comp");
        expect(linkCheck.webTarget("calendar", "eh-1")).toBe("https://eh.example/r/cal/eh-1.ics");
        expect(linkCheck.webTarget("event", "eh-gone")).toBe("");
        expect(linkCheck.webTarget("event", "12345")).toBe("");
        expect(linkCheck.webTarget("signup", "12345")).toBe("https://eh.example/signups?event=12345");
        expect(linkCheck.webTarget("setup", "eh-1")).toBe("https://eh.example/raids/detail?event=eh-1&tab=setup");
        expect(linkCheck.webTarget("nope", "eh-1")).toBe("");
        expect(linkCheck.webTarget("event", "")).toBe("");
    });

    it("links a raid plan only while it is published (an expired share has no link)", () => {
        raidplanStore.getPlan.mockReturnValue({ status: "published", publicToken: "tok" });
        expect(linkCheck.webTarget("raidplan", "eh-1")).toBe("https://eh.example/p/tok");
        raidplanStore.getPlan.mockReturnValue({ status: "draft", publicToken: "tok" });
        expect(linkCheck.webTarget("raidplan", "eh-1")).toBe("");
        raidplanStore.getPlan.mockReturnValue(null);
        expect(linkCheck.webTarget("raidplan", "eh-1")).toBe("");
    });

    it("keeps an external link only when stored and well formed", () => {
        expect(linkCheck.externalLink("https://docs.google.com/spreadsheets/d/x")).toBe("https://docs.google.com/spreadsheets/d/x");
        expect(linkCheck.externalLink("  https://softres.it/raid/abc  ")).toBe("https://softres.it/raid/abc");
        expect(linkCheck.externalLink("")).toBe("");
        expect(linkCheck.externalLink("softres.it/raid/abc")).toBe("");
        expect(linkCheck.externalLink("javascript:alert(1)")).toBe("");
        expect(linkCheck.externalLink("https://with space")).toBe("");
        expect(linkCheck.externalLink(null)).toBe("");
    });
});
