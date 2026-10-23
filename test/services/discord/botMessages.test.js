// The fixed bot messages of one server (src/services/discord/botMessages.js):
// what is collected per side, the four states, the link only for a standing
// message, and the ten-minute cache.
let mockOnline = true;
const mockStates = {};
const mockMissingChannels = new Set();
const mockData = {};
jest.mock("../../../src/services/discord/discord", () => ({
    isOnline: () => mockOnline,
    getClient: () => ({ channels: { cache: new Map([["300000000000000001", { name: "orga" }]]) } }),
}));
jest.mock("../../../src/services/discord/linkCheck", () => ({
    checkMessage: jest.fn(async (g, c, m) => mockStates[m] || "ok"),
    channelState: (g, c) => (mockMissingChannels.has(c) ? "missing" : "ok"),
    messageLink: (g, c, m) => `link:${g}/${c}/${m}`,
}));
jest.mock("../../../src/services/discord/categoryNames", () => ({ listKnownCategories: () => [{ id: "c1", name: "TBC" }] }));
jest.mock("../../../src/stores/orgaHubStore", () => ({ listHubs: () => mockData.hubs || [] }));
jest.mock("../../../src/stores/availabilityStore", () => ({ listPanels: () => mockData.panels || [] }));
jest.mock("../../../src/stores/raidOverviewStore", () => ({ listOverviews: () => mockData.overviews || [] }));
jest.mock("../../../src/stores/talkOverviewStore", () => ({ getOverviewState: (gid) => (mockData.talk || {})[gid] || { channelId: "", messageId: "" } }));
jest.mock("../../../src/stores/roleMessageStore", () => ({ listMessages: () => mockData.roleMessages || [] }));
jest.mock("../../../src/stores/addonCenterStore", () => ({ getCenter: () => mockData.center || null }));
jest.mock("../../../src/stores/recruitmentStore", () => ({ listRecruitmentPosts: () => mockData.recruitment || [] }));

const linkCheck = require("../../../src/services/discord/linkCheck");
const { botMessages, collect, clearCache, CACHE_MS } = require("../../../src/services/discord/botMessages");

const EVENT = "900000000000000001";
const TALK = "900000000000000002";
const OTHER = "900000000000000009";
const CH = "300000000000000001";
const msg = (n) => `40000000000000000${n}`;

beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
    mockOnline = true;
    for (const k of Object.keys(mockStates)) delete mockStates[k];
    for (const k of Object.keys(mockData)) delete mockData[k];
    mockMissingChannels.clear();
});

describe("collect", () => {
    it("takes every kind that sits on this server", () => {
        mockData.hubs = [{ categoryId: "c1", guildId: EVENT, channelId: CH, messageId: msg(1) }, { categoryId: "c2", guildId: OTHER, channelId: CH, messageId: msg(2) }];
        mockData.panels = [{ categoryId: "c1", guildId: EVENT, channelId: CH, messageId: msg(3) }];
        mockData.overviews = [{ categoryId: "c1", guildId: EVENT, channelId: CH, messageId: msg(4) }];
        mockData.roleMessages = [{ guildSide: "event", channelId: CH, messageId: msg(5), title: "Rollen" }, { guildSide: "event", channelId: CH, messageId: "", title: "Entwurf" }, { guildSide: "talk", channelId: CH, messageId: msg(6) }];
        mockData.center = { guildId: EVENT, channelId: CH, messageId: msg(7) };
        mockData.recruitment = [{ guildId: EVENT, channelId: CH, messageId: msg(8), title: "", channelName: "bewerbung" }];
        const list = collect("event", EVENT, {});
        expect(list.map((m) => m.kind)).toEqual(["orgaHub", "availability", "raidOverview", "roleMessage", "addonCenter", "recruitment"]);
        expect(list.find((m) => m.kind === "recruitment").title).toBe("bewerbung");
        expect(collect("event", "", {})).toEqual([]);
    });

    it("finds the talk overview of an event server on the server it is posted to", () => {
        mockData.talk = { [EVENT]: { channelId: CH, messageId: msg(9) } };
        const config = { discordServers: { eventGuilds: [{ guildId: EVENT, label: "TBC", overviewGuildId: TALK, overviewChannelId: CH }] } };
        expect(collect("talk", TALK, config)).toEqual([expect.objectContaining({ kind: "talkOverview", guildId: TALK, title: "TBC", messageId: msg(9) })]);
        expect(collect("event", EVENT, config)).toEqual([]);
    });
});

describe("botMessages", () => {
    beforeEach(() => {
        mockData.hubs = [
            { categoryId: "c1", guildId: EVENT, channelId: CH, messageId: msg(1) },
            { categoryId: "c2", guildId: EVENT, channelId: CH, messageId: msg(2) },
            { categoryId: "c3", guildId: EVENT, channelId: "300000000000000002", messageId: msg(3) },
            { categoryId: "c4", guildId: EVENT, channelId: CH, messageId: msg(4) },
        ];
    });

    it("tells standing, deleted, channel missing and unknown apart; links only standing ones", async () => {
        mockStates[msg(2)] = "missing";
        mockStates[msg(3)] = "missing";
        mockMissingChannels.add("300000000000000002");
        mockStates[msg(4)] = "unknown";
        const list = await botMessages("event", EVENT, {});
        expect(list.map((m) => m.status)).toEqual(["ok", "deleted", "channel_missing", "unknown"]);
        expect(list[0]).toEqual(expect.objectContaining({ kindLabel: "Orga-Zentrale", categoryName: "TBC", channelName: "orga", link: `link:${EVENT}/${CH}/${msg(1)}` }));
        expect(list[1].link).toBe("");
    });

    it("reads unknown without asking while the bot is offline, and does not keep that", async () => {
        mockOnline = false;
        expect((await botMessages("event", EVENT, {})).map((m) => m.status)).toEqual(["unknown", "unknown", "unknown", "unknown"]);
        expect(linkCheck.checkMessage).not.toHaveBeenCalled();
        mockOnline = true;
        expect((await botMessages("event", EVENT, {}))[0].status).toBe("ok");
    });

    it("keeps a result ten minutes unless the list changed or fresh is asked", async () => {
        const now = Date.now();
        await botMessages("event", EVENT, {}, { now });
        await botMessages("event", EVENT, {}, { now: now + CACHE_MS - 1 });
        expect(linkCheck.checkMessage).toHaveBeenCalledTimes(4);
        await botMessages("event", EVENT, {}, { now: now + 1, fresh: true });
        expect(linkCheck.checkMessage).toHaveBeenCalledTimes(8);
        mockData.hubs.pop();
        await botMessages("event", EVENT, {}, { now: now + 2 });
        expect(linkCheck.checkMessage).toHaveBeenCalledTimes(11);
        await botMessages("event", EVENT, {}, { now: now + CACHE_MS + 5 });
        expect(linkCheck.checkMessage).toHaveBeenCalledTimes(14);
    });

    it("reads unknown when a check throws", async () => {
        linkCheck.checkMessage.mockRejectedValueOnce(new Error("boom"));
        expect((await botMessages("event", EVENT, {}))[0].status).toBe("unknown");
    });
});
