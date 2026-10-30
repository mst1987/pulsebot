// The raid-detail ping and sign-up call stay on the raid's own server (#894): there is
// no "Wohin" any more. An old target in the body ("talk", "both") is ignored.
jest.mock("../../../../src/web/http/apiMiddleware", () => require("../../../helpers/http").apiMiddlewareMock({ user: { id: "1", isAdmin: true } }));
jest.mock("../../../../src/web/http/apiBody", () => require("../../../helpers/http").apiBodyMock());
jest.mock("../../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "100000") }));
jest.mock("../../../../src/services/events/raidEventGroups", () => ({
    loadEventGroups: jest.fn(),
    eventLookbackSince: jest.fn(() => 0),
}));
jest.mock("../../../../src/stores/settingsStore", () => ({
    getConfig: jest.fn(() => ({ categoryRoles: { 900000: ["500000"] } })),
    getNotify: jest.fn(),
    listNotify: jest.fn(() => []),
    listRaidsheets: jest.fn(() => []),
    getRaidsheet: jest.fn(),
    resolveEventSheetLink: jest.fn(() => null),
}));
jest.mock("../../../../src/services/discord/discord", () => ({
    listMembersWithRoles: jest.fn(),
    postMissingPing: jest.fn(),
    postAnnouncement: jest.fn(),
    listRoles: jest.fn(() => []),
    getGuild: jest.fn(),
    fetchGuildMembersCached: jest.fn(),
    sendDirectMessage: jest.fn(),
}));

const { readJsonBody } = require("../../../../src/web/http/apiBody");
const { loadEventGroups } = require("../../../../src/services/events/raidEventGroups");
const settingsStore = require("../../../../src/stores/settingsStore");
const discord = require("../../../../src/services/discord/discord");
const { postPingMissing, postNotify } = require("../../../../src/web/apiRoutes/events/raidDetail");

const { mockRes, json } = require("../../../helpers/http");
const { event: baseEvent } = require("../../../factories/events");

const event = baseEvent({ startTime: Math.floor(Date.now() / 1000) + 3600, channelId: "110000", signUps: [{ userId: "1" }] });

beforeEach(() => {
    jest.clearAllMocks();
    loadEventGroups.mockResolvedValue({ groups: [{ categoryId: "900000", categoryName: "Raids", events: [event] }], error: null });
    discord.listMembersWithRoles.mockResolvedValue({ members: [{ id: "1" }, { id: "2" }, { id: "3" }], error: null });
    discord.getGuild.mockReturnValue({ id: "100000" });
    // 2 is on the raid's server, 3 is not
    discord.fetchGuildMembersCached.mockResolvedValue([{ id: "1" }, { id: "2" }]);
    discord.postMissingPing.mockResolvedValue({ channelId: "110000", messageId: "m1" });
    discord.sendDirectMessage.mockResolvedValue({ ok: true, messageId: "dm" });
});

describe("POST /api/raids/ping-missing on the raid's server", () => {
    it.each([undefined, "talk", "both"])("mentions the members in the raid channel and DMs the rest (target %s)", async (target) => {
        readJsonBody.mockResolvedValue({ event: "e1", text: "Hi", target });
        const r = mockRes();
        await postPingMissing({}, r);
        expect(discord.fetchGuildMembersCached).toHaveBeenCalledWith("100000", expect.anything());
        expect(discord.postMissingPing).toHaveBeenCalledWith("110000", ["2"], "Hi");
        expect(discord.sendDirectMessage).toHaveBeenCalledTimes(1);
        expect(discord.sendDirectMessage).toHaveBeenCalledWith("3", expect.any(Object));
        expect(json(r).data.message).toBe("2 fehlende Raider gepingt · 1 per DM.");
        expect(json(r).data.delivery).toMatchObject({ mentioned: 1, dm: { sent: ["3"], failed: [] } });
    });

    it("answers 500 and posts nothing when the bot is not on the raid's server", async () => {
        readJsonBody.mockResolvedValue({ event: "e1" });
        discord.getGuild.mockReturnValue(null);
        const spy = jest.spyOn(console, "error").mockImplementation(() => {});
        const r = mockRes();
        await postPingMissing({}, r);
        expect(r.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
        expect(json(r).error.message).toBe("Der Bot ist nicht auf dem Server des Raids.");
        expect(discord.postMissingPing).not.toHaveBeenCalled();
        expect(discord.sendDirectMessage).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});

describe("POST /api/raids/notify in the raid channel", () => {
    it.each(["talk", "both"])("posts in the event channel even with an old target %s", async (target) => {
        settingsStore.getNotify.mockReturnValue({ id: "t1", title: "Anmeldung" });
        readJsonBody.mockResolvedValue({ event: "e1", templateId: "t1", channelId: "110000", roleIds: ["500000"], target });
        const r = mockRes();
        await postNotify({}, r);
        expect(discord.postAnnouncement).toHaveBeenCalledWith("110000", { id: "t1", title: "Anmeldung" }, ["500000"]);
        expect(json(r).data.message).toBe("Anmelde-Aufruf gepostet.");
    });

    it("refuses without the event channel, whatever the old target says", async () => {
        settingsStore.getNotify.mockReturnValue({ id: "t1" });
        readJsonBody.mockResolvedValue({ event: "e1", templateId: "t1", channelId: "", target: "talk" });
        const r = mockRes();
        await postNotify({}, r);
        expect(r.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
        expect(discord.postAnnouncement).not.toHaveBeenCalled();
    });
});
