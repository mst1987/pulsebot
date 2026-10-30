// The cover of a Discord event: own picture vs. zone art, switch, cache, the
// "only when changed" rule on create/sync and that a failed fetch never fails the event.
const mockEvents = new Map();
jest.mock("axios", () => ({ get: jest.fn() }));
jest.mock("../../../src/stores/events/eventStore", () => ({
    getEvent: jest.fn((id) => (mockEvents.has(id) ? JSON.parse(JSON.stringify(mockEvents.get(id))) : null)),
    setEventDiscordEvent: jest.fn((id, patch) => {
        const e = mockEvents.get(id);
        if (!e) return null;
        e.discordEvent = patch ? { ...(e.discordEvent || {}), ...JSON.parse(JSON.stringify(patch)) } : null;
        return e;
    }),
}));
let mockConfig = {};
jest.mock("../../../src/stores/settings/settingsStore", () => ({ getConfig: () => mockConfig }));
jest.mock("../../../src/services/discord/discord", () => ({ getGuild: jest.fn(), botCanManageEvents: jest.fn(() => true) }));

const axios = require("axios");
const discord = require("../../../src/services/discord/discord");
const de = require("../../../src/services/discord/discordEvent");
const cover = require("../../../src/services/discord/discordEventCover");
const { event: baseEvent } = require("../../factories/events");
const { makeGuild } = require("../../helpers/discordClient");
const { knownChannels } = require("../../helpers/linkCheck");

const ART = "https://render.worldofwarcraft.com/eu/zones/serpentshrine-cavern-small.jpg";
const OWN = "https://example.com/own.png";
const png = (type = "image/png") => ({ data: Buffer.from("abc"), headers: { "content-type": type } });
const event = (over = {}) => baseEvent({
    id: "eh-1", guildId: "g1", categoryId: "cat1", channelName: "do", title: "SSC", durationMinutes: 180,
    voiceChannelId: "", status: "active", cancel: null, message: { channelId: "c1", messageId: "m1" },
    discordEvent: null, instanceIds: ["ssc"], image: { mode: "banner", url: "" }, ...over,
});
const put = (ev) => {
    mockEvents.set(ev.id, JSON.parse(JSON.stringify(ev)));
    return ev.id;
};

function fakeGuild() {
    const edit = jest.fn(() => Promise.resolve());
    const row = { id: "d1", status: 1, edit, setStatus: jest.fn(), delete: jest.fn() };
    const create = jest.fn(() => Promise.resolve(row));
    const guild = makeGuild({ id: "g1", channels: [], scheduledEvents: { create, fetch: jest.fn(() => Promise.resolve(row)) } });
    discord.getGuild.mockReturnValue(guild);
    return { create, edit };
}

describe("services/discord/discordEventCover", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockEvents.clear();
        cover.clearCache();
        knownChannels("c1");
        mockConfig = { categoryDiscordEvent: { cat1: true } };
        axios.get.mockResolvedValue(png());
        jest.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    it("takes the event's own picture first, the zone art of its instance otherwise, else none", () => {
        expect(cover.coverUrlFor(event({ image: { mode: "banner", url: OWN } }))).toBe(OWN);
        expect(cover.coverUrlFor(event())).toBe(ART);
        expect(cover.coverUrlFor(event({ instanceIds: [] }))).toBe("");
    });

    it("sends the picture as a data URI on create and remembers its key", async () => {
        const { create } = fakeGuild();
        const id = put(event());
        await de.createForEvent(id);
        expect(create.mock.calls[0][0].image).toBe(`data:image/png;base64,${Buffer.from("abc").toString("base64")}`);
        expect(axios.get).toHaveBeenCalledWith(ART, expect.objectContaining({ responseType: "arraybuffer", timeout: expect.any(Number) }));
        expect(mockEvents.get(id).discordEvent.coverKey).toBe(ART);
    });

    it("creates without a cover when there is no picture or the switch is off", async () => {
        const { create } = fakeGuild();
        await de.createForEvent(put(event({ id: "eh-a", instanceIds: [] })));
        mockConfig = { categoryDiscordEvent: { cat1: true }, discordVisuals: { eventCover: false } };
        await de.createForEvent(put(event({ id: "eh-b" })));
        expect(create.mock.calls.every((c) => c[0].image === undefined)).toBe(true);
        expect(axios.get).not.toHaveBeenCalled();
    });

    it("an unset switch means on", () => {
        expect(cover.coverEnabled({})).toBe(true);
        expect(cover.coverEnabled({ discordVisuals: {} })).toBe(true);
        expect(cover.coverEnabled({ discordVisuals: { eventCover: false } })).toBe(false);
    });

    it("reads the cover switch of the event's server, else the global default (#961)", async () => {
        const config = { discordVisuals: { eventCover: false }, serverSettings: { g1: { discordVisuals: { eventCover: true } } } };
        expect(cover.coverEnabled(config, "g1")).toBe(true);
        expect(cover.coverEnabled(config, "g2")).toBe(false);
        expect(cover.coverEnabled({ serverSettings: { g1: { discordVisuals: { eventCover: false } } } }, "g1")).toBe(false);
        // switched off on the event's server: nothing is fetched or sent
        expect(await cover.coverToSend({ guildId: "g2", coverUrl: "https://example.org/c.png" }, config)).toBeNull();
    });

    it("fetches a URL once (cached) and does not resend an unchanged cover on sync", async () => {
        const { edit } = fakeGuild();
        const id = put(event({ discordEvent: { id: "d1", guildId: "g1", coverKey: ART } }));
        await de.syncForEvent(id);
        expect(edit.mock.calls[0][0].image).toBeUndefined();
        expect(axios.get).not.toHaveBeenCalled();
        // the picture changed -> sent once
        mockEvents.get(id).image = { mode: "banner", url: OWN };
        await de.syncForEvent(id);
        expect(edit.mock.calls[1][0].image).toMatch(/^data:image\/png;base64,/);
        expect(mockEvents.get(id).discordEvent.coverKey).toBe(OWN);
        await cover.loadCover(OWN);
        expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it("tolerates a failing or unusable picture: the event is still created, without cover", async () => {
        const { create } = fakeGuild();
        axios.get.mockRejectedValueOnce(new Error("timeout"));
        expect((await de.createForEvent(put(event()))).id).toBe("d1");
        expect(create.mock.calls[0][0].image).toBeUndefined();
        expect(mockEvents.get("eh-1").discordEvent.coverKey).toBeUndefined();
        cover.clearCache();
        axios.get.mockResolvedValueOnce(png("text/html"));
        expect(await cover.loadCover(ART)).toBeNull();
        expect(await cover.loadCover("http://insecure.example/x.png")).toBeNull();
    });
});
