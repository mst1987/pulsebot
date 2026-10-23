// The fixed bot messages of one server (src/services/discord/botMessages.js):
// what is collected per side, the states (ok, deleted, channel missing, no
// access, unknown), the link only for a standing message, the ten-minute cache
// that never keeps "unknown", and the time limit of one check.
const { PermissionsBitField } = require("discord.js");

let mockOnline = true;
let mockGuild = null;
const mockMissingChannels = new Set();
const mockData = {};
jest.mock("../../../src/services/discord/discord", () => ({
    isOnline: () => mockOnline,
    getGuild: () => mockGuild,
    getClient: () => ({ channels: { cache: new Map([["300000000000000001", { name: "orga" }]]) } }),
}));
jest.mock("../../../src/services/discord/linkCheck", () => ({
    channelState: (g, c) => (mockMissingChannels.has(c) ? "missing" : "ok"),
    messageLink: (g, c, m) => `link:${g}/${c}/${m}`,
    messageFound: jest.fn(),
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
const { botMessages, collect, clearCache, statusOfError, CACHE_MS } = require("../../../src/services/discord/botMessages");

const EVENT = "900000000000000001";
const TALK = "900000000000000002";
const OTHER = "900000000000000009";
const CH = "300000000000000001";
const CH2 = "300000000000000002";
const msg = (n) => `40000000000000000${n}`;
const F = PermissionsBitField.Flags;
const READ = [F.ViewChannel, F.ReadMessageHistory];

/** A channel whose fetch answers per message id: an error object rejects, "hang" never answers. */
function channel({ rights = READ, answers = {}, cached = [] } = {}) {
    return {
        permissionsFor: () => new PermissionsBitField(rights),
        messages: {
            cache: new Map(cached.map((id) => [id, { id }])),
            fetch: jest.fn((id) => {
                const a = answers[id];
                if (a === "hang") return new Promise(() => {});
                return a ? Promise.reject(a) : Promise.resolve({ id });
            }),
        },
    };
}

function guild(channels) {
    return { channels: { cache: new Map(Object.entries(channels)) }, members: { me: { id: "bot" } } };
}

beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
    mockOnline = true;
    mockGuild = guild({ [CH]: channel() });
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

describe("statusOfError", () => {
    it("maps Discord errors; anything else is unknown", () => {
        expect(statusOfError({ code: 10008 })).toBe("deleted");
        expect(statusOfError({ status: 404 })).toBe("deleted");
        expect(statusOfError({ code: 10003 })).toBe("channel_missing");
        expect(statusOfError({ code: 50001 })).toBe("no_access");
        expect(statusOfError({ code: 50013 })).toBe("no_access");
        expect(statusOfError({ status: 403 })).toBe("no_access");
        expect(statusOfError({ status: 503 })).toBe("unknown");
        expect(statusOfError(new Error("timeout"))).toBe("unknown");
        expect(statusOfError(null)).toBe("unknown");
    });
});

describe("botMessages", () => {
    const hub = (n, channelId = CH) => ({ categoryId: "c1", guildId: EVENT, channelId, messageId: msg(n) });

    it("tells ok, deleted, channel missing and unknown apart; links only standing ones", async () => {
        mockGuild = guild({ [CH]: channel({ answers: { [msg(2)]: { code: 10008 }, [msg(4)]: { status: 502 } } }) });
        mockMissingChannels.add(CH2);
        mockData.hubs = [hub(1), hub(2), hub(3, CH2), hub(4), hub(5, "300000000000000005")];
        const list = await botMessages("event", EVENT, {});
        expect(list.map((m) => m.status)).toEqual(["ok", "deleted", "channel_missing", "unknown", "unknown"]);
        expect(list[0]).toEqual(expect.objectContaining({ kindLabel: "Orga-Zentrale", categoryName: "TBC", channelName: "orga", link: `link:${EVENT}/${CH}/${msg(1)}` }));
        expect(list[1].link).toBe("");
        expect(linkCheck.messageFound).toHaveBeenCalledWith(msg(1));
        expect(linkCheck.messageFound).toHaveBeenCalledTimes(1);
    });

    it("reads no_access when the bot cannot see or read the channel, without fetching", async () => {
        const noHistory = channel({ rights: [F.ViewChannel] });
        const hidden = channel({ rights: [] });
        mockGuild = guild({ [CH]: noHistory, [CH2]: hidden });
        mockData.hubs = [hub(1), hub(2, CH2)];
        expect((await botMessages("event", EVENT, {})).map((m) => m.status)).toEqual(["no_access", "no_access"]);
        expect(noHistory.messages.fetch).not.toHaveBeenCalled();
        expect(hidden.messages.fetch).not.toHaveBeenCalled();
    });

    it("reads no_access on a 50001 from the fetch, not deleted", async () => {
        mockGuild = guild({ [CH]: channel({ answers: { [msg(1)]: { code: 50001 } } }) });
        mockData.hubs = [hub(1)];
        expect((await botMessages("event", EVENT, {}))[0].status).toBe("no_access");
    });

    it("takes a message from the message cache without fetching", async () => {
        const ch = channel({ cached: [msg(1)] });
        mockGuild = guild({ [CH]: ch });
        mockData.hubs = [hub(1)];
        expect((await botMessages("event", EVENT, {}))[0].status).toBe("ok");
        expect(ch.messages.fetch).not.toHaveBeenCalled();
    });

    it("reads unknown without asking while the bot is offline, and does not keep that", async () => {
        const ch = channel();
        mockGuild = guild({ [CH]: ch });
        mockData.hubs = [hub(1)];
        mockOnline = false;
        expect((await botMessages("event", EVENT, {}))[0].status).toBe("unknown");
        expect(ch.messages.fetch).not.toHaveBeenCalled();
        mockOnline = true;
        expect((await botMessages("event", EVENT, {}))[0].status).toBe("ok");
    });

    it("keeps a result ten minutes per message unless fresh is asked", async () => {
        const ch = channel();
        mockGuild = guild({ [CH]: ch });
        mockData.hubs = [hub(1), hub(2)];
        const now = Date.now();
        await botMessages("event", EVENT, {}, { now });
        await botMessages("event", EVENT, {}, { now: now + CACHE_MS - 1 });
        expect(ch.messages.fetch).toHaveBeenCalledTimes(2);
        await botMessages("event", EVENT, {}, { now: now + 1, fresh: true });
        expect(ch.messages.fetch).toHaveBeenCalledTimes(4);
        mockData.hubs.push(hub(3));
        await botMessages("event", EVENT, {}, { now: now + 2 });
        expect(ch.messages.fetch).toHaveBeenCalledTimes(5);
        await botMessages("event", EVENT, {}, { now: now + CACHE_MS + 5 });
        expect(ch.messages.fetch).toHaveBeenCalledTimes(8);
    });

    it("does not keep a deleted message for good: fresh finds it again", async () => {
        const answers = { [msg(1)]: { code: 10008 } };
        mockGuild = guild({ [CH]: channel({ answers }) });
        mockData.hubs = [hub(1)];
        const now = Date.now();
        expect((await botMessages("event", EVENT, {}, { now }))[0].status).toBe("deleted");
        delete answers[msg(1)];
        expect((await botMessages("event", EVENT, {}, { now: now + 1 }))[0].status).toBe("deleted");
        expect((await botMessages("event", EVENT, {}, { now: now + 2, fresh: true }))[0].status).toBe("ok");
    });

    it("never keeps unknown (a 5xx is asked again on the next view)", async () => {
        const ch = channel({ answers: { [msg(1)]: { status: 503 } } });
        mockGuild = guild({ [CH]: ch });
        mockData.hubs = [hub(1)];
        const now = Date.now();
        await botMessages("event", EVENT, {}, { now });
        await botMessages("event", EVENT, {}, { now: now + 1 });
        expect(ch.messages.fetch).toHaveBeenCalledTimes(2);
    });

    it("stops at the time limit: what has not answered reads unknown and is not kept", async () => {
        const answers = { [msg(2)]: "hang" };
        const ch = channel({ answers });
        mockGuild = guild({ [CH]: ch });
        mockData.hubs = [hub(1), hub(2)];
        const now = Date.now();
        const list = await botMessages("event", EVENT, {}, { now, checkMs: 20 });
        expect(list.map((m) => m.status)).toEqual(["ok", "unknown"]);
        delete answers[msg(2)];
        const again = await botMessages("event", EVENT, {}, { now: now + 1, checkMs: 20 });
        expect(again.map((m) => m.status)).toEqual(["ok", "ok"]);
        expect(ch.messages.fetch).toHaveBeenCalledTimes(3);
    });

    it("reads unknown when the own member is not known", async () => {
        mockGuild = { channels: { cache: new Map([[CH, channel()]]) }, members: {} };
        mockData.hubs = [hub(1)];
        expect((await botMessages("event", EVENT, {}))[0].status).toBe("unknown");
    });
});
