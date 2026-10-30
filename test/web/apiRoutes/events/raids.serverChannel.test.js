// Rights hold per server (#925, docs/permissions.md "Rechte je Server"): creating a raid posts in,
// clones or makes a Discord channel the request names - every channel, source event and category of
// the body must belong to the caller's active server, before anything is cloned or posted. Through
// the real router (apiRouter.handle), the real raids routes, eventCreateAccess and eventServer; only
// Discord, the stores and the side effects of eventCreate stand in.
const { json: sent, status, routerClient } = require("../../../helpers/http");

let mockUser = null;
jest.mock("../../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => mockUser),
    checkCsrf: jest.fn(() => true),
    getActiveGuild: jest.fn(() => "B"),
}));
let mockActive = "B";
jest.mock("../../../../src/web/http/activeGuild", () => ({
    activeGuildFor: jest.fn(() => mockActive),
    pickActiveGuild: jest.fn(async () => mockActive),
}));
// the bot's live cache: channels, voice channels and categories of server A and server B
const mockLive = { chA: "A", voiceA: "A", catA: "A", chB: "B", voiceB: "B", catB: "B" };
jest.mock("../../../../src/services/discord/discord", () => ({
    ...jest.requireActual("../../../../src/services/discord/discord"),
    getClient: () => ({ channels: { cache: { get: (id) => (mockLive[id] ? { id, guildId: mockLive[id] } : null) } } }),
    duplicateChannel: jest.fn(async () => ({ id: "clone" })),
    createChannel: jest.fn(async () => ({ id: "made" })),
}));
jest.mock("../../../../src/services/events/eventMessage", () => ({
    ...jest.requireActual("../../../../src/services/events/eventMessage"),
    postEventMessage: jest.fn(async () => {}),
}));
jest.mock("../../../../src/services/discord/serverOf", () => ({
    ...jest.requireActual("../../../../src/services/discord/serverOf"),
    storedCategoryGuilds: () => new Map(),
}));
jest.mock("../../../../src/stores/eventSeriesStore", () => ({
    ...jest.requireActual("../../../../src/stores/eventSeriesStore"),
    getSeries: jest.fn(() => null),
}));
// own events: one on each server
const mockEvents = {
    "eh-a": { id: "eh-a", guildId: "A", categoryId: "catA", channelId: "chA" },
    "eh-b": { id: "eh-b", guildId: "B", categoryId: "catB", channelId: "chB", voiceChannelId: "voiceB" },
};
jest.mock("../../../../src/stores/eventStore", () => ({
    ...jest.requireActual("../../../../src/stores/eventStore"),
    isOwnEventId: (id) => String(id).startsWith("eh-"),
    getEvent: (id) => mockEvents[id] || null,
}));
jest.mock("../../../../src/stores/raidEventStore", () => ({
    ...jest.requireActual("../../../../src/stores/raidEventStore"),
    getRaidEvent: jest.fn(() => null),
}));
jest.mock("../../../../src/stores/raidhelperEventsStore", () => ({
    ...jest.requireActual("../../../../src/stores/raidhelperEventsStore"),
    snapshotGuilds: jest.fn(() => []),
    readSnapshot: jest.fn(() => ({ events: [] })),
}));
// what the server check lets through reaches createEvent / updateEvent: they stand in here
jest.mock("../../../../src/services/events/eventCreate", () => ({
    ...jest.requireActual("../../../../src/services/events/eventCreate"),
    createEvent: jest.fn(async () => ({ status: 201, body: { id: "eh-new" } })),
    updateEvent: jest.fn(async () => ({ status: 200, body: { id: "eh-b" } })),
}));

const discord = require("../../../../src/services/discord/discord");
const { postEventMessage } = require("../../../../src/services/events/eventMessage");
const { createEvent, updateEvent } = require("../../../../src/services/events/eventCreate");
const { emptyAccess } = require("../../../../src/config/permissions");

const { post, patch } = routerClient(require("../../../../src/web/apiRoutes/events/raids"));
const allAreas = () => Object.fromEntries(Object.keys(emptyAccess()).map((k) => [k, { read: true, write: true }]));
// the orga of server B: an orga role and every area at write level there
const orgaOfB = { id: "7", name: "Bob", isAdmin: false, isOrga: true, access: allAreas() };
const fullAdmin = { id: "1", name: "Admin", isAdmin: true, isOrga: true, access: allAreas() };

const base = { date: "2026-11-05T20:00", title: "Karazhan" };
const otherServer = (res) => status(res) === 403 && sent(res).error.code === "other_server";
// a source event or new category of server A names a raid of server A: withUser's server check
// (apiHandler.js) answers 404 before the route's channel check - refused either way
const refusedByServer = (res) => otherServer(res) || (status(res) === 404 && sent(res).error.code === "not_found");
const nothingDone = () => {
    expect(createEvent).not.toHaveBeenCalled();
    expect(postEventMessage).not.toHaveBeenCalled();
    expect(discord.duplicateChannel).not.toHaveBeenCalled();
    expect(discord.createChannel).not.toHaveBeenCalled();
};

beforeEach(() => {
    jest.clearAllMocks();
    mockUser = orgaOfB;
    mockActive = "B";
});

describe("POST /api/raids: the orga of server B with something of server A (#925)", () => {
    it.each([
        ["a channel to post in", { channelId: "chA" }],
        ["a voice channel", { channelId: "chB", voiceChannelId: "voiceA" }],
        ["a source event to clone", { sourceEventId: "eh-a" }],
        ["a category for the new channel", { newChannel: { categoryId: "catA" } }],
        ["a template channel for the new channel", { newChannel: { categoryId: "catB", templateChannelId: "chA" } }],
    ])("refuses %s by the server check, before anything is cloned or posted", async (label, extra) => {
        const res = await post("/api/raids", { ...base, ...extra });
        expect(refusedByServer(res)).toBe(true);
        nothingDone();
    });

    it.each([
        ["a channel the bot does not see", { channelId: "ghost" }],
        ["a source event nobody knows", { sourceEventId: "eh-ghost" }],
        ["a category nobody knows", { newChannel: { categoryId: "catGhost" } }],
    ])("refuses %s too (fail closed)", async (label, extra) => {
        const res = await post("/api/raids", { ...base, ...extra });
        expect(refusedByServer(res)).toBe(true);
        nothingDone();
    });

    it("lets channels, source event and category of server B through to createEvent", async () => {
        const res = await post("/api/raids", { ...base, channelId: "chB", voiceChannelId: "voiceB", sourceEventId: "eh-b" });
        expect(status(res)).toBe(201);
        expect(createEvent).toHaveBeenCalledTimes(1);
        expect(createEvent.mock.calls[0][0].guildId).toBe("B");
    });

    it("lets a full admin use a channel of server A from server B", async () => {
        mockUser = fullAdmin;
        const res = await post("/api/raids", { ...base, channelId: "chA", sourceEventId: "eh-a" });
        expect(status(res)).toBe(201);
        expect(createEvent).toHaveBeenCalledTimes(1);
    });
});

describe("foreignChannelRefusal itself, past withUser (#925)", () => {
    const { foreignChannelRefusal } = require("../../../../src/web/events/eventCreateAccess");
    const req = {};
    it.each([
        [{ channelId: "chA" }], [{ voiceChannelId: "voiceA" }], [{ sourceEventId: "eh-a" }],
        [{ newChannel: { categoryId: "catA" } }], [{ newChannel: { categoryId: "catB", templateChannelId: "chA" } }],
        [{ sourceEventId: "eh-ghost" }], [{ newChannel: { categoryId: "catGhost" } }], [{ channelId: "ghost" }],
    ])("refuses %j with 403 other_server", (body) => {
        const r = foreignChannelRefusal(orgaOfB, req, body);
        expect(r && r.error).toMatchObject({ status: 403, code: "other_server" });
    });

    it("lets everything of server B and an empty body through; a full admin always", () => {
        expect(foreignChannelRefusal(orgaOfB, req, { channelId: "chB", voiceChannelId: "voiceB", sourceEventId: "eh-b", newChannel: { categoryId: "catB", templateChannelId: "chB" } })).toBeNull();
        expect(foreignChannelRefusal(orgaOfB, req, {})).toBeNull();
        expect(foreignChannelRefusal(fullAdmin, req, { channelId: "chA", sourceEventId: "eh-a" })).toBeNull();
    });
});

describe("PATCH /api/raids: a changed voice channel (#925)", () => {
    it("refuses a voice channel of server A", async () => {
        const res = await patch("/api/raids", { id: "eh-b", voiceChannelId: "voiceA" });
        expect(otherServer(res)).toBe(true);
        expect(updateEvent).not.toHaveBeenCalled();
    });

    it("keeps the stored voice channel without asking again, and takes one of server B", async () => {
        expect(status(await patch("/api/raids", { id: "eh-b", voiceChannelId: "voiceB" }))).not.toBe(403);
        expect(status(await patch("/api/raids", { id: "eh-b", voiceChannelId: "" }))).not.toBe(403);
        expect(updateEvent).toHaveBeenCalledTimes(2);
    });

    it("answers 404 for a raid of server A, whatever the body", async () => {
        const res = await patch("/api/raids", { id: "eh-a", voiceChannelId: "voiceB" });
        expect(status(res)).toBe(404);
        expect(updateEvent).not.toHaveBeenCalled();
    });
});
