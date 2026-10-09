// rosterMemberSearch (#655): the Discord member search of "Mitglied hinzufügen".
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());
jest.mock("../../../src/services/discord/discord", () => ({
    isOnline: jest.fn(() => true),
    getGuild: jest.fn(() => ({ id: "g1" })),
    fetchGuildMembersCached: jest.fn(),
}));

const fs = require("fs");
const discord = require("../../../src/services/discord/discord");
const raiderProfileStore = require("../../../src/stores/raiderProfileStore");
const { searchMembers } = require("../../../src/services/roster/rosterMemberSearch");

const member = (id, displayName, extra = {}) => ({ id, displayName, user: { username: displayName.toLowerCase(), bot: false }, ...extra });

beforeEach(() => {
    fs.__store.clear();
    jest.clearAllMocks();
    discord.isOnline.mockReturnValue(true);
    discord.getGuild.mockReturnValue({ id: "g1" });
    discord.fetchGuildMembersCached.mockResolvedValue([
        member("100001", "Anna"),
        member("100002", "Bert"),
        member("100003", "Robo", { user: { username: "robo", bot: true } }),
        member("100004", "Zora"),
    ]);
    raiderProfileStore.addCharacter("100002", { name: "Keslight", className: "Mage", specs: ["Mage-Frost"] });
    raiderProfileStore.addCharacter("100002", { name: "Aldric Sturmwind", className: "Warrior", specs: [], versionId: "forever" });
});

describe("services/roster/rosterMemberSearch", () => {
    it("finds by name and by a profile character of the roster's version, without bots, non-members first", async () => {
        const all = await searchMembers({ guildId: "g1", versionId: "tbc", members: { "100001": {} } });
        expect(all.results.map((r) => r.userId)).toEqual(["100002", "100004", "100001"]);
        expect(all.results[0]).toEqual({ userId: "100002", displayName: "Bert", inRoster: false, chars: [{ key: "keslight", name: "Keslight", className: "Mage", spec: "Mage-Frost", specId: "Frost", specLabel: "Frost", specIcon: expect.any(String), classColor: "#69CCF0" }] });
        expect(all.results[2].inRoster).toBe(true);
        expect((await searchMembers({ guildId: "g1", versionId: "tbc", query: "kes" })).results.map((r) => r.userId)).toEqual(["100002"]);
        expect((await searchMembers({ guildId: "g1", versionId: "tbc", query: "aldric" })).results).toEqual([]);
        const forever = await searchMembers({ guildId: "g1", versionId: "forever", query: "aldric" });
        expect(forever.results[0].chars).toEqual([{ key: "forever~aldric sturmwind", name: "Aldric Sturmwind", className: "Warrior", spec: "", specId: "", specLabel: "", specIcon: "", classColor: "#C79C6E" }]);
    });

    it("cuts to the limit", async () => {
        expect((await searchMembers({ guildId: "g1", versionId: "tbc", limit: 1 })).results).toHaveLength(1);
    });

    it("answers offline without the bot or the server, members_unavailable when the list fails", async () => {
        discord.isOnline.mockReturnValueOnce(false);
        expect(await searchMembers({ guildId: "g1", versionId: "tbc" })).toEqual({ error: "offline" });
        expect(await searchMembers({ guildId: "", versionId: "tbc" })).toEqual({ error: "offline" });
        discord.fetchGuildMembersCached.mockRejectedValueOnce(new Error("intent"));
        expect(await searchMembers({ guildId: "g1", versionId: "tbc" })).toEqual({ error: "members_unavailable" });
        discord.fetchGuildMembersCached.mockResolvedValueOnce([]);
        expect(await searchMembers({ guildId: "g1", versionId: "tbc" })).toEqual({ error: "members_unavailable" });
    });
});
