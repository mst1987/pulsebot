const mockEvents = [];
const mockSignups = {};

jest.mock("../../../src/services/discord/members/serverMembers", () => ({ serverMemberIds: jest.fn() }));
jest.mock("../../../src/stores/events/eventStore", () => ({
    eventIdsOfGuild: (guildId) => mockEvents.filter((e) => e.guildId === guildId).map((e) => e.id),
}));
jest.mock("../../../src/stores/events/signupStore", () => ({
    userIdsOfEvents: (ids) => new Set([...ids].flatMap((id) => mockSignups[id] || [])),
}));

const { serverMemberIds } = require("../../../src/services/discord/members/serverMembers");
const { signedUpIds, visibleRaiderIds, withinVisible } = require("../../../src/services/characters/profileVisibility");

describe("profileVisibility (#1077)", () => {
    beforeEach(() => {
        serverMemberIds.mockReset();
        mockEvents.length = 0;
        for (const key of Object.keys(mockSignups)) delete mockSignups[key];
        mockEvents.push({ id: "a1", guildId: "A" }, { id: "b1", guildId: "B" });
        mockSignups.a1 = ["signedOnA"];
        mockSignups.b1 = ["signedOnB"];
    });

    test("members of the server and raiders signed up there", async () => {
        serverMemberIds.mockResolvedValue(new Set(["memberOfA"]));
        const visible = await visibleRaiderIds("A");
        expect([...visible].sort()).toEqual(["memberOfA", "signedOnA"]);
        expect(serverMemberIds).toHaveBeenCalledWith("A", {});
    });

    test("a raider only of another server is not in it, until the signup on this one", async () => {
        serverMemberIds.mockResolvedValue(new Set());
        expect((await visibleRaiderIds("A")).has("signedOnB")).toBe(false);
        mockSignups.a1.push("signedOnB");
        expect((await visibleRaiderIds("A")).has("signedOnB")).toBe(true);
    });

    test("an unreadable member list leaves the signups, never everybody", async () => {
        serverMemberIds.mockResolvedValue(null);
        expect([...(await visibleRaiderIds("A"))]).toEqual(["signedOnA"]);
    });

    test("how long to wait goes to the bounded lookup", async () => {
        serverMemberIds.mockResolvedValue(null);
        await visibleRaiderIds("A", { waitMs: 50 });
        expect(serverMemberIds).toHaveBeenCalledWith("A", { waitMs: 50 });
    });

    test("no server: nobody", async () => {
        serverMemberIds.mockResolvedValue(null);
        expect((await visibleRaiderIds("")).size).toBe(0);
        expect(signedUpIds("").size).toBe(0);
    });

    test("withinVisible keeps what the limit lets through, null means no limit", () => {
        const list = [{ userId: "1" }, { userId: 2 }, { userId: "3" }];
        expect(withinVisible(list, new Set(["1", "2"]))).toEqual([{ userId: "1" }, { userId: 2 }]);
        expect(withinVisible(list, null)).toBe(list);
        expect(withinVisible(list, new Set())).toEqual([]);
    });
});
