jest.mock("../../../../src/services/discord/discord", () => ({ listHumanMembers: jest.fn() }));

const discord = require("../../../../src/services/discord/discord");
const { serverMemberIds } = require("../../../../src/services/discord/members/serverMembers");

describe("serverMemberIds", () => {
    beforeEach(() => discord.listHumanMembers.mockReset());

    test("the ids of the server's members", async () => {
        discord.listHumanMembers.mockResolvedValue({ members: [{ id: "1" }, { id: 2 }], error: null });
        expect([...(await serverMemberIds("g1"))]).toEqual(["1", "2"]);
        expect(discord.listHumanMembers).toHaveBeenCalledWith("g1");
    });

    test("an empty server is an empty set, not an unknown one", async () => {
        discord.listHumanMembers.mockResolvedValue({ members: [], error: null });
        expect((await serverMemberIds("g1")).size).toBe(0);
    });

    test.each([
        ["no server", "", () => {}],
        ["a lookup error", "g1", () => discord.listHumanMembers.mockResolvedValue({ members: [], error: "boom" })],
        ["a lookup that throws", "g1", () => discord.listHumanMembers.mockRejectedValue(new Error("boom"))],
        ["no answer shape", "g1", () => discord.listHumanMembers.mockResolvedValue(null)],
    ])("%s proves nothing", async (_name, guildId, arrange) => {
        arrange();
        expect(await serverMemberIds(guildId)).toBeNull();
    });

    test("a lookup that takes too long proves nothing, waiting is bounded", async () => {
        discord.listHumanMembers.mockReturnValue(new Promise(() => {}));
        expect(await serverMemberIds("g1", { waitMs: 5 })).toBeNull();
    });
});
