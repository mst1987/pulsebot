// Where a ping goes (#264): event channel, talk server, or both — and who gets
// a DM because they are not on the talk server.
jest.mock("../../src/web/discord", () => ({
    getGuild: jest.fn(),
    fetchGuildMembersCached: jest.fn(),
    postMissingPing: jest.fn(),
    postAnnouncement: jest.fn(),
    listMembersWithRoles: jest.fn(),
    sendDirectMessage: jest.fn(),
}));
jest.mock("../../src/stores/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));

const discord = require("../../src/web/discord");
const ping = require("../../src/web/pingDelivery");
const { event: baseEvent } = require("../factories/events");
const { makeGuild, makeChannel } = require("../helpers/discordClient");

const config = (over = {}) => ({
    guildId: "100000",
    discordServers: { eventGuildId: "100000", talkGuildId: "200000", talkOverviewChannelId: "", talkPingChannelId: "210000" },
    roleSync: [],
    ...over,
});
const event = baseEvent({ title: "Karazhan", startTime: 1900000000, channelId: "110000" });

beforeEach(() => {
    jest.resetAllMocks();
    // built after the reset, so the guilds' own mocks keep their implementations
    const talkGuild = makeGuild({ id: "200000", name: "Pulse Talk", channels: [makeChannel({ id: "210000", name: "pings", guildId: "200000" })] });
    const eventGuild = makeGuild({ id: "100000", name: "Event" });
    discord.getGuild.mockImplementation((id) => (id === "200000" ? talkGuild : eventGuild));
    // Users 1 and 2 are on the talk server, 3 is not.
    discord.fetchGuildMembersCached.mockResolvedValue([{ id: "1" }, { id: "2" }]);
    discord.postMissingPing.mockResolvedValue({ channelId: "x", messageId: "m" });
    discord.postAnnouncement.mockResolvedValue({ channelId: "x", messageId: "m" });
    discord.sendDirectMessage.mockResolvedValue({ ok: true, messageId: "dm" });
});

describe("pingDelivery targets", () => {
    it("falls back to the event channel for an unknown target", () => {
        expect(ping.normalizePingTarget("talk")).toBe("talk");
        expect(ping.normalizePingTarget("bogus")).toBe("event");
        expect(ping.normalizePingTarget(undefined)).toBe("event");
    });

    it("offers the talk server only with a talk server and a ping channel", () => {
        expect(ping.pingTargetInfo(config())).toEqual({ talk: true, talkGuildName: "Pulse Talk", talkChannelName: "pings" });
        const noChannel = config({ discordServers: { eventGuildId: "100000", talkGuildId: "200000", talkPingChannelId: "" } });
        expect(ping.pingTargetInfo(noChannel).talk).toBe(false);
        expect(ping.pingTargetInfo({ guildId: "100000" }).talk).toBe(false);
    });
});

describe("deliverUserPing", () => {
    it("pings only in the event channel for target event, without touching the talk server", async () => {
        const r = await ping.deliverUserPing({ target: "event", event, userIds: ["1", "3"], text: "Hallo", config: config() });
        expect(discord.postMissingPing).toHaveBeenCalledTimes(1);
        expect(discord.postMissingPing).toHaveBeenCalledWith("110000", ["1", "3"], "Hallo");
        expect(discord.fetchGuildMembersCached).not.toHaveBeenCalled();
        expect(r.dm).toBeNull();
    });

    it("mentions talk members in the ping channel and DMs the rest for target talk", async () => {
        const r = await ping.deliverUserPing({ target: "talk", event, userIds: ["1", "2", "3"], text: "Bitte melden", guildId: "100000", config: config() });
        expect(discord.postMissingPing).toHaveBeenCalledTimes(1);
        expect(discord.postMissingPing).toHaveBeenCalledWith("210000", ["1", "2"], "Bitte melden");
        expect(discord.sendDirectMessage).toHaveBeenCalledTimes(1);
        const [userId, payload] = discord.sendDirectMessage.mock.calls[0];
        expect(userId).toBe("3");
        expect(payload.content).toContain("Bitte melden");
        expect(payload.content).toContain("**Karazhan**");
        expect(payload.content).toContain("https://discord.com/channels/100000/110000");
        expect(r).toMatchObject({ target: "talk", mentioned: 2, dm: { sent: ["3"], failed: [] } });
    });

    it("posts in both channels for target both and sends no DM on top", async () => {
        const r = await ping.deliverUserPing({ target: "both", event, userIds: ["1", "3"], config: config() });
        expect(discord.postMissingPing).toHaveBeenCalledWith("110000", ["1", "3"], "");
        expect(discord.postMissingPing).toHaveBeenCalledWith("210000", ["1"], "");
        expect(discord.sendDirectMessage).not.toHaveBeenCalled();
        expect(r.dm).toBeNull();
    });

    it("counts failed DMs instead of failing the ping", async () => {
        discord.sendDirectMessage.mockResolvedValue({ ok: false, error: "DMs geschlossen" });
        const r = await ping.deliverUserPing({ target: "talk", event, userIds: ["3"], config: config() });
        expect(discord.postMissingPing).not.toHaveBeenCalled();
        expect(r.dm).toEqual({ sent: [], failed: ["3"] });
        expect(ping.dmSummary(r.dm)).toBe(" · 1 DM fehlgeschlagen");
    });

    it("refuses the talk server without a ping channel, before posting anything", async () => {
        const cfg = config({ discordServers: { eventGuildId: "100000", talkGuildId: "", talkPingChannelId: "" } });
        await expect(ping.deliverUserPing({ target: "both", event, userIds: ["1"], config: cfg }))
            .rejects.toThrow("kein Ping-Kanal");
        expect(discord.postMissingPing).not.toHaveBeenCalled();
    });

    it("posts nothing when the talk members cannot be read", async () => {
        discord.fetchGuildMembersCached.mockRejectedValue(new Error("intent"));
        await expect(ping.deliverUserPing({ target: "both", event, userIds: ["1"], config: config() }))
            .rejects.toThrow("Kommunikations-Discords nicht lesbar");
        expect(discord.postMissingPing).not.toHaveBeenCalled();
    });
});

describe("deliverAnnouncement", () => {
    const template = { title: "Anmeldung", body: "Bitte eintragen" };

    it("keeps the old call for the event channel", async () => {
        await ping.deliverAnnouncement({ target: "event", channelId: "110000", template, roleIds: ["500000"], config: config() });
        expect(discord.postAnnouncement).toHaveBeenCalledWith("110000", template, ["500000"]);
        expect(discord.listMembersWithRoles).not.toHaveBeenCalled();
    });

    it("maps a synced role to its talk role, mentions members of unmapped roles and DMs who is not there", async () => {
        const cfg = config({ roleSync: [{ eventRoleId: "500000", talkRoleId: "600000", direction: "toTalk" }] });
        discord.listMembersWithRoles.mockImplementation(async (guildId, roleIds) => {
            if (roleIds.length === 2) return { members: [{ id: "1" }, { id: "2" }, { id: "3" }], error: null };
            return { members: [{ id: "1" }], error: null }; // holders of the mapped role 500000
        });
        const r = await ping.deliverAnnouncement({
            target: "talk", event, channelId: "", template, roleIds: ["500000", "700000"], guildId: "100000", config: cfg,
        });
        // 1 is reached by the talk role, 2 by a mention, 3 is not on the talk server.
        expect(discord.postAnnouncement).toHaveBeenCalledTimes(1);
        expect(discord.postAnnouncement).toHaveBeenCalledWith("210000", template, ["600000"], ["2"]);
        expect(discord.sendDirectMessage).toHaveBeenCalledWith("3", expect.objectContaining({ content: expect.stringContaining("**Anmeldung**") }));
        expect(r.dm).toEqual({ sent: ["3"], failed: [] });
    });

    it("posts in both places and sends no DM for target both", async () => {
        discord.listMembersWithRoles.mockResolvedValue({ members: [{ id: "1" }, { id: "3" }], error: null });
        await ping.deliverAnnouncement({ target: "both", event, channelId: "110000", template, roleIds: ["700000"], guildId: "100000", config: config() });
        expect(discord.postAnnouncement).toHaveBeenCalledWith("110000", template, ["700000"]);
        expect(discord.postAnnouncement).toHaveBeenCalledWith("210000", template, [], ["1"]);
        expect(discord.sendDirectMessage).not.toHaveBeenCalled();
    });

    it("fails before posting when the role members cannot be read", async () => {
        discord.listMembersWithRoles.mockResolvedValue({ members: [], error: "GuildMembers-Intent fehlt." });
        await expect(ping.deliverAnnouncement({ target: "both", event, channelId: "110000", template, roleIds: ["700000"], config: config() }))
            .rejects.toThrow("GuildMembers-Intent fehlt.");
        expect(discord.postAnnouncement).not.toHaveBeenCalled();
    });
});
