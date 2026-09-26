// The "Wohin" of the raid-detail ping and sign-up call (#264): target "event"
// keeps the old single post, the talk server goes through pingDelivery.
jest.mock("../../../src/web/http/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock({ user: { id: "1", isAdmin: true } }));
jest.mock("../../../src/web/http/apiBody", () => require("../../helpers/http").apiBodyMock());
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "100000") }));
jest.mock("../../../src/services/events/raidEventGroups", () => ({
    loadEventGroups: jest.fn(),
    eventLookbackSince: jest.fn(() => 0),
}));
jest.mock("../../../src/stores/settingsStore", () => ({
    getConfig: jest.fn(() => ({ categoryRoles: { 900000: ["500000"] } })),
    getNotify: jest.fn(),
    listNotify: jest.fn(() => []),
    listRaidsheets: jest.fn(() => []),
    getRaidsheet: jest.fn(),
    resolveEventSheetLink: jest.fn(() => null),
}));
jest.mock("../../../src/services/discord/discord", () => ({
    listMembersWithRoles: jest.fn(),
    postMissingPing: jest.fn(),
    postAnnouncement: jest.fn(),
    listRoles: jest.fn(() => []),
    getGuild: jest.fn(() => null),
}));
jest.mock("../../../src/services/discord/pingDelivery", () => {
    const actual = jest.requireActual("../../../src/services/discord/pingDelivery");
    return { ...actual, deliverUserPing: jest.fn(), deliverAnnouncement: jest.fn() };
});

const { readJsonBody } = require("../../../src/web/http/apiBody");
const { loadEventGroups } = require("../../../src/services/events/raidEventGroups");
const settingsStore = require("../../../src/stores/settingsStore");
const discord = require("../../../src/services/discord/discord");
const pingDelivery = require("../../../src/services/discord/pingDelivery");
const { postPingMissing, postNotify } = require("../../../src/web/apiRoutes/raidDetail");

const { mockRes, json } = require("../../helpers/http");
const { event: baseEvent } = require("../../factories/events");

const event = baseEvent({ startTime: Math.floor(Date.now() / 1000) + 3600, channelId: "110000", signUps: [{ userId: "1" }] });

beforeEach(() => {
    jest.clearAllMocks();
    loadEventGroups.mockResolvedValue({ groups: [{ categoryId: "900000", categoryName: "Raids", events: [event] }], error: null });
    discord.listMembersWithRoles.mockResolvedValue({ members: [{ id: "1" }, { id: "2" }, { id: "3" }], error: null });
});

describe("POST /api/raids/ping-missing with a target", () => {
    it("keeps the single event-channel post without a target", async () => {
        readJsonBody.mockResolvedValue({ event: "e1", text: "Hi" });
        const r = mockRes();
        await postPingMissing({}, r);
        expect(discord.postMissingPing).toHaveBeenCalledWith("110000", ["2", "3"], "Hi");
        expect(pingDelivery.deliverUserPing).not.toHaveBeenCalled();
        expect(json(r).data.message).toBe("2 fehlende Raider gepingt.");
    });

    it("hands the talk server to pingDelivery and reports the DMs", async () => {
        readJsonBody.mockResolvedValue({ event: "e1", text: "Hi", target: "talk" });
        pingDelivery.deliverUserPing.mockResolvedValue({ target: "talk", dm: { sent: ["3"], failed: [] } });
        const r = mockRes();
        await postPingMissing({}, r);
        expect(pingDelivery.deliverUserPing).toHaveBeenCalledWith(expect.objectContaining({
            target: "talk", userIds: ["2", "3"], text: "Hi", guildId: "100000",
        }));
        expect(discord.postMissingPing).not.toHaveBeenCalled();
        expect(json(r).data.message).toBe("2 fehlende Raider gepingt (Kommunikations-Discord) · 1 per DM.");
    });

    it("answers a delivery error as post_failed", async () => {
        readJsonBody.mockResolvedValue({ event: "e1", target: "both" });
        pingDelivery.deliverUserPing.mockRejectedValue(new Error("Auf dem Kommunikations-Discord ist kein Ping-Kanal eingestellt."));
        const spy = jest.spyOn(console, "error").mockImplementation(() => {});
        const r = mockRes();
        await postPingMissing({}, r);
        expect(r.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
        expect(json(r).error.message).toContain("kein Ping-Kanal");
        spy.mockRestore();
    });
});

describe("POST /api/raids/notify with a target", () => {
    it("needs no event channel for the talk server and resolves the event for the DMs", async () => {
        settingsStore.getNotify.mockReturnValue({ id: "t1", title: "Anmeldung" });
        readJsonBody.mockResolvedValue({ event: "e1", templateId: "t1", channelId: "", roleIds: ["500000"], target: "talk" });
        pingDelivery.deliverAnnouncement.mockResolvedValue({ target: "talk", dm: null });
        const r = mockRes();
        await postNotify({}, r);
        expect(pingDelivery.deliverAnnouncement).toHaveBeenCalledWith(expect.objectContaining({
            target: "talk", event: expect.objectContaining({ id: "e1" }), roleIds: ["500000"], guildId: "100000",
        }));
        expect(discord.postAnnouncement).not.toHaveBeenCalled();
        expect(json(r).data.message).toBe("Anmelde-Aufruf gepostet (Kommunikations-Discord).");
    });

    it("still requires the event channel when it is part of the target", async () => {
        settingsStore.getNotify.mockReturnValue({ id: "t1" });
        readJsonBody.mockResolvedValue({ event: "e1", templateId: "t1", channelId: "", target: "both" });
        const r = mockRes();
        await postNotify({}, r);
        expect(r.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
        expect(pingDelivery.deliverAnnouncement).not.toHaveBeenCalled();
    });
});
