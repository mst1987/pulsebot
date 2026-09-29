// linkWatch (#537): a channel or tracked message deleted in Discord — links to
// it go at once, the overviews redraw, a deleted signup message is posted anew.
// The stores run for real on an in-memory disk; the redraws are mocks.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());
jest.mock("../../../src/services/talk/talkOverview", () => ({ scheduleOverviewSync: jest.fn() }));
jest.mock("../../../src/services/events/eventMessage", () => ({ redrawEventMessage: jest.fn(async () => null) }));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: jest.fn(() => ({ discordServers: { eventGuilds: [{ guildId: "g1" }] } })) }));

const fs = require("fs");
const { EventEmitter } = require("events");
const eventStore = require("../../../src/stores/eventStore");
const { setOverviewState } = require("../../../src/stores/talkOverviewStore");
const { scheduleOverviewSync } = require("../../../src/services/talk/talkOverview");
const { redrawEventMessage } = require("../../../src/services/events/eventMessage");
const linkWatch = require("../../../src/services/discord/linkWatch");
const { knownChannels, linkCheck } = require("../../helpers/linkCheck");

const START = Math.floor(Date.now() / 1000) + 3 * 86400;

function seed(over = {}) {
    return eventStore.createEvent({
        guildId: "g1", channelId: "c1", channelName: "mi-kara", categoryId: "cat", categoryName: "Raids",
        title: "Karazhan", startTime: START, instanceIds: ["kara"], size: 10, ...over,
    }).event;
}

beforeEach(() => {
    fs.__store.clear();
    jest.clearAllMocks();
    knownChannels("c1", "c2");
});

describe("services/discord/linkWatch", () => {
    it("marks a deleted channel missing, logs it on its events and redraws the overviews", () => {
        const event = seed();
        seed({ channelId: "c2", title: "Gruul" });
        expect(linkCheck.channelLink("g1", "c1")).not.toBe("");
        const hit = linkWatch.onChannelDelete({ id: "c1" });
        expect(hit).toEqual([event.id]);
        expect(linkCheck.channelState("g1", "c1")).toBe("missing");
        expect(linkCheck.channelLink("g1", "c1")).toBe("");
        expect(eventStore.getEvent(event.id).log.at(-1)).toMatchObject({ action: "channelGone", byName: "Discord", detail: "#mi-kara" });
        expect(scheduleOverviewSync).toHaveBeenCalledWith({ delayMs: linkWatch.REDRAW_DELAY_MS });
    });

    it("ignores a delete without an id", () => {
        expect(linkWatch.onChannelDelete(null)).toEqual([]);
        expect(scheduleOverviewSync).not.toHaveBeenCalled();
    });

    it("posts a deleted signup message anew and forgets a deleted setup post", () => {
        const event = seed();
        eventStore.setEventMessage(event.id, { channelId: "c1", messageId: "m1", hash: "h" });
        eventStore.setEventSetupPost(event.id, { channelId: "c1", messageId: "m2", version: 1 });
        const signup = linkWatch.onMessageDelete({ channelId: "c1", messageId: "m1" });
        expect(signup.redrawn).toEqual([event.id]);
        expect(eventStore.getEvent(event.id).message).toBeNull();
        expect(redrawEventMessage).toHaveBeenCalledWith(event.id);
        expect(linkCheck.messageLink("g1", "c1", "m1")).toBe("");
        const setup = linkWatch.onMessageDelete({ channelId: "c1", messageId: "m2" });
        expect(setup.setupCleared).toEqual([event.id]);
        expect(eventStore.getEvent(event.id).setupPost.messageId).toBe("");
    });

    it("redraws the overviews when their own message is deleted, and nothing for a stranger's", () => {
        setOverviewState("g1", { channelId: "ov", messageId: "m9" });
        expect(linkWatch.onMessageDelete({ channelId: "ov", messageId: "m9" })).toMatchObject({ overview: true });
        expect(scheduleOverviewSync).toHaveBeenCalledTimes(1);
        expect(linkWatch.onMessageDelete({ channelId: "x", messageId: "m-other" })).toMatchObject({ overview: false, redrawn: [] });
        expect(scheduleOverviewSync).toHaveBeenCalledTimes(1);
        expect(linkWatch.onMessageDelete({ channelId: "x", messageId: "" })).toEqual({ redrawn: [], setupCleared: [], overview: false });
    });

    it("hooks channelDelete and the raw MESSAGE_DELETE(_BULK) packets into the client", () => {
        const event = seed();
        eventStore.setEventMessage(event.id, { channelId: "c1", messageId: "m1" });
        const client = new EventEmitter();
        linkWatch.attach(client);
        client.emit("raw", { t: "MESSAGE_DELETE", d: { id: "m1", channel_id: "c1" } });
        expect(redrawEventMessage).toHaveBeenCalledWith(event.id);
        client.emit("raw", { t: "MESSAGE_DELETE_BULK", d: { ids: ["b1", "b2"], channel_id: "c1" } });
        expect(linkCheck.messageLink("g1", "c1", "b2")).toBe("");
        client.emit("raw", { t: "GUILD_CREATE", d: {} });
        client.emit("raw", null);
        client.emit("channelDelete", { id: "c1" });
        expect(linkCheck.channelLink("g1", "c1")).toBe("");
    });
});
