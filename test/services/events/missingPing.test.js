// Who is missing (findMissingRaiders): the derivation the raid detail, Event verwalten
// and the signup message's "Fehlende pingen" share — and the ping on top of it.
jest.mock("../../../src/services/events/raidEventGroups", () => ({ loadEventGroups: jest.fn(), eventLookbackSince: jest.fn(() => 0) }));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: jest.fn(() => ({ categoryRoles: { cat1: ["500000"] } })) }));
jest.mock("../../../src/services/discord/discord", () => ({ listMembersWithRoles: jest.fn(), postMissingPing: jest.fn() }));
jest.mock("../../../src/services/discord/botLanguage", () => ({ serverLang: jest.fn(() => "de"), langOf: jest.fn(() => "de") }));

const { loadEventGroups } = require("../../../src/services/events/raidEventGroups");
const settingsStore = require("../../../src/stores/settingsStore");
const discord = require("../../../src/services/discord/discord");
const { findMissingRaiders, pingMissingRaiders } = require("../../../src/services/events/missingPing");

const future = Math.floor(Date.now() / 1000) + 3600;
const event = (over = {}) => ({ id: "eh-1", title: "Kara", startTime: future, channelId: "110000", signUps: [{ userId: "1", status: "signed" }], ...over });
const groups = (e) => ({ groups: [{ categoryId: "cat1", events: [e] }], error: null });

beforeEach(() => {
    jest.clearAllMocks();
    loadEventGroups.mockResolvedValue(groups(event()));
    discord.listMembersWithRoles.mockResolvedValue({ members: [{ id: "1", displayName: "A" }, { id: "2", displayName: "B" }], error: null });
    discord.postMissingPing.mockResolvedValue({ channelId: "110000", messageId: "m1" });
    jest.spyOn(console, "log").mockImplementation(() => {});
});

describe("findMissingRaiders", () => {
    it("lists the role holders without a reaction, with the event and the roles", async () => {
        const r = await findMissingRaiders({ guildId: "100000", eventId: "eh-1" });
        expect(r.missing).toEqual([{ id: "2", displayName: "B" }]);
        expect(r.event.id).toBe("eh-1");
        expect(r.roleIds).toEqual(["500000"]);
        expect(discord.listMembersWithRoles).toHaveBeenCalledWith("100000", ["500000"]);
        expect(discord.postMissingPing).not.toHaveBeenCalled();
    });

    it("refuses without raider roles, for a cancelled or started raid, and when the lists cannot be read", async () => {
        settingsStore.getConfig.mockReturnValueOnce({ categoryRoles: {} });
        expect((await findMissingRaiders({ guildId: "100000", eventId: "eh-1" })).error.code).toBe("no_roles");
        loadEventGroups.mockResolvedValueOnce(groups(event({ status: "cancelled" })));
        expect((await findMissingRaiders({ guildId: "100000", eventId: "eh-1" })).error.code).toBe("cancelled");
        loadEventGroups.mockResolvedValueOnce(groups(event({ startTime: 1000 })));
        expect((await findMissingRaiders({ guildId: "100000", eventId: "eh-1" })).error.code).toBe("event_past");
        expect((await findMissingRaiders({ guildId: "100000", eventId: "eh-x" })).error.code).toBe("not_found");
        loadEventGroups.mockResolvedValueOnce({ groups: [], error: "Raid-Helper weg" });
        expect((await findMissingRaiders({ guildId: "100000", eventId: "eh-1" })).error.code).toBe("events_unavailable");
        discord.listMembersWithRoles.mockResolvedValueOnce({ members: [], error: "Intent fehlt" });
        expect((await findMissingRaiders({ guildId: "100000", eventId: "eh-1" })).error.code).toBe("members_unavailable");
    });
});

describe("pingMissingRaiders", () => {
    it("pings exactly the derived list in the event channel", async () => {
        const r = await pingMissingRaiders({ guildId: "100000", eventId: "eh-1", target: "event" });
        expect(discord.postMissingPing).toHaveBeenCalledTimes(1);
        expect(discord.postMissingPing).toHaveBeenCalledWith("110000", ["2"], expect.stringContaining("Bitte melde dich"));
        expect(r).toEqual({ message: "1 fehlende Raider gepingt.", count: 1 });
    });

    it("pings nobody when everybody reacted", async () => {
        discord.listMembersWithRoles.mockResolvedValue({ members: [{ id: "1", displayName: "A" }], error: null });
        const r = await pingMissingRaiders({ guildId: "100000", eventId: "eh-1", target: "event" });
        expect(r.count).toBe(0);
        expect(discord.postMissingPing).not.toHaveBeenCalled();
    });
});
