// Who is missing (findMissingRaiders): the derivation the raid detail, Event verwalten
// and the signup message's "Fehlende pingen" share — and the ping on top of it.
jest.mock("../../../src/services/events/raidEventGroups", () => ({ loadEventGroups: jest.fn(), eventLookbackSince: jest.fn(() => 0) }));
jest.mock("../../../src/stores/settings/settingsStore", () => ({ getConfig: jest.fn(() => ({ categoryRoles: { cat1: ["500000"] } })) }));
jest.mock("../../../src/services/discord/discord", () => ({
    listMembersWithRoles: jest.fn(), listHumanMembers: jest.fn(), postMissingPing: jest.fn(),
    getGuild: jest.fn(), fetchGuildMembersCached: jest.fn(), sendDirectMessage: jest.fn(),
}));
jest.mock("../../../src/stores/roster/rosterStore", () => ({ rosterForCategory: jest.fn(() => null) }));
jest.mock("../../../src/services/discord/botLanguage", () => ({ serverLang: jest.fn(() => "de"), eventLang: jest.fn(() => "de"), langOf: jest.fn(() => "de") }));

const { loadEventGroups } = require("../../../src/services/events/raidEventGroups");
const settingsStore = require("../../../src/stores/settings/settingsStore");
const discord = require("../../../src/services/discord/discord");
const rosterStore = require("../../../src/stores/roster/rosterStore");
const { findMissingRaiders, pingMissingRaiders } = require("../../../src/services/events/missingPing");

const future = Math.floor(Date.now() / 1000) + 3600;
const event = (over = {}) => ({ id: "eh-1", title: "Kara", startTime: future, channelId: "110000", signUps: [{ userId: "1", status: "signed" }], ...over });
const groups = (e) => ({ groups: [{ categoryId: "cat1", events: [e] }], error: null });

beforeEach(() => {
    jest.clearAllMocks();
    loadEventGroups.mockResolvedValue(groups(event()));
    discord.listMembersWithRoles.mockResolvedValue({ members: [{ id: "1", displayName: "A" }, { id: "2", displayName: "B" }], error: null });
    discord.postMissingPing.mockResolvedValue({ channelId: "110000", messageId: "m1" });
    // #894: the ping goes to the raid's server only; both raiders are members there
    discord.getGuild.mockReturnValue({ id: "100000" });
    discord.fetchGuildMembersCached.mockResolvedValue([{ id: "1" }, { id: "2" }]);
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

describe("findMissingRaiders with a roster (#658)", () => {
    afterEach(() => rosterStore.rosterForCategory.mockReturnValue(null));

    it("expects the roster's core and trial members instead of the role holders", async () => {
        rosterStore.rosterForCategory.mockReturnValue({ roleIds: [], members: {
            1: { status: "core" }, 3: { status: "trial" }, 4: { status: "bench" }, 5: { status: "pause" },
        } });
        discord.listHumanMembers.mockResolvedValue({ members: [{ id: "1", displayName: "A" }, { id: "3", displayName: "C" }, { id: "4", displayName: "D" }], error: null });
        // no roles at all on the category: a roster is enough
        settingsStore.getConfig.mockReturnValueOnce({ categoryRoles: {} });
        const r = await findMissingRaiders({ guildId: "100000", eventId: "eh-1" });
        expect(r.missing).toEqual([{ id: "3", displayName: "C" }]);
        expect(discord.listMembersWithRoles).not.toHaveBeenCalled();
    });
});

describe("pingMissingRaiders", () => {
    it("pings exactly the derived list in the event channel", async () => {
        const r = await pingMissingRaiders({ guildId: "100000", eventId: "eh-1" });
        expect(discord.postMissingPing).toHaveBeenCalledTimes(1);
        expect(discord.postMissingPing).toHaveBeenCalledWith("110000", ["2"], expect.stringContaining("Bitte melde dich"));
        expect(r).toMatchObject({ message: "1 fehlende Raider gepingt.", count: 1, delivery: { mentioned: 1, dm: null } });
        expect(discord.fetchGuildMembersCached).toHaveBeenCalledWith("100000", expect.anything());
    });

    it("DMs a missing raider who is not on the raid's server (#894)", async () => {
        discord.fetchGuildMembersCached.mockResolvedValue([{ id: "1" }]);
        discord.sendDirectMessage.mockResolvedValue({ ok: true, messageId: "dm" });
        const r = await pingMissingRaiders({ guildId: "100000", eventId: "eh-1" });
        expect(discord.postMissingPing).not.toHaveBeenCalled();
        expect(discord.sendDirectMessage).toHaveBeenCalledWith("2", expect.any(Object));
        expect(r.message).toBe("1 fehlende Raider gepingt · 1 per DM.");
    });

    it("answers 500 and posts nothing when the bot is not on the raid's server", async () => {
        discord.getGuild.mockReturnValue(null);
        const r = await pingMissingRaiders({ guildId: "100000", eventId: "eh-1" });
        expect(r.error).toMatchObject({ status: 500, code: "post_failed" });
        expect(discord.postMissingPing).not.toHaveBeenCalled();
    });

    it("mentions everyone and says so when the raid server's member list is unreadable (#894)", async () => {
        discord.fetchGuildMembersCached.mockRejectedValue(new Error("Intent fehlt"));
        const r = await pingMissingRaiders({ guildId: "100000", eventId: "eh-1" });
        expect(discord.postMissingPing).toHaveBeenCalledWith("110000", ["2"], expect.any(String));
        expect(discord.sendDirectMessage).not.toHaveBeenCalled();
        expect(r.message).toBe("1 fehlende Raider gepingt · Mitgliederliste nicht lesbar, alle im Kanal erwähnt.");
    });

    it("answers with a default message when the post fails without one", async () => {
        jest.spyOn(console, "error").mockImplementation(() => {});
        discord.postMissingPing.mockRejectedValue(new Error(""));
        const r = await pingMissingRaiders({ guildId: "100000", eventId: "eh-1" });
        expect(r.error).toMatchObject({ status: 500, code: "post_failed", message: "Posten fehlgeschlagen." });
    });

    it("pings nobody when everybody reacted", async () => {
        discord.listMembersWithRoles.mockResolvedValue({ members: [{ id: "1", displayName: "A" }], error: null });
        const r = await pingMissingRaiders({ guildId: "100000", eventId: "eh-1" });
        expect(r.count).toBe(0);
        expect(discord.postMissingPing).not.toHaveBeenCalled();
    });
});
