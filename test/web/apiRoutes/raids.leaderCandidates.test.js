// The leader dropdown of the event dialog: the creator first, then the people signed up, each with a name.
const mockEvents = [];
const mockSignups = {};
jest.mock("../../../src/stores/eventStore", () => ({
    listEvents: () => mockEvents,
    getEvent: () => null,
    isOwnEventId: () => true,
}));
jest.mock("../../../src/stores/signupStore", () => ({ listSignups: (id) => mockSignups[id] || [] }));
const mockNames = jest.fn();
jest.mock("../../../src/web/discord", () => ({ resolveUserNames: (...a) => mockNames(...a), listGuilds: () => [] }));
jest.mock("../../../src/web/raidEventGroups", () => ({ loadEventGroups: jest.fn(), eventLookbackSince: () => 0 }));

const { leaderCandidates } = require("../../../src/web/apiRoutes/raids");

beforeEach(() => {
    mockEvents.length = 0;
    Object.keys(mockSignups).forEach((k) => delete mockSignups[k]);
    mockNames.mockReset();
    mockNames.mockImplementation(async (g, ids) => Object.fromEntries(ids.map((id) => [id, `Name ${id}`])));
});

describe("leaderCandidates", () => {
    it("lists the creator first, then everybody signed up to the guild's events, without duplicates", async () => {
        mockEvents.push({ id: "eh-1" }, { id: "eh-2" });
        mockSignups["eh-1"] = [{ userId: "u1" }, { userId: "me" }];
        mockSignups["eh-2"] = [{ userId: "u1" }, { userId: "u2" }];
        const out = await leaderCandidates("g", { id: "me", name: "Orga" }, null);
        expect(out).toEqual([{ id: "me", name: "Orga" }, { id: "u1", name: "Name u1" }, { id: "u2", name: "Name u2" }]);
    });

    it("for an event being edited: its signups and its current leader, not other events' signups", async () => {
        mockEvents.push({ id: "eh-9" });
        mockSignups["eh-9"] = [{ userId: "other" }];
        mockSignups["eh-1"] = [{ userId: "u1" }];
        const out = await leaderCandidates("g", { id: "me", name: "Orga" }, { id: "eh-1", leaderId: "old" });
        expect(out.map((c) => c.id)).toEqual(["me", "old", "u1"]);
    });

    it("still answers with the creator when Discord cannot name the others", async () => {
        mockEvents.push({ id: "eh-1" });
        mockSignups["eh-1"] = [{ userId: "u1" }];
        mockNames.mockRejectedValue(new Error("offline"));
        expect(await leaderCandidates("g", { id: "me", name: "Orga" }, null)).toEqual([{ id: "me", name: "Orga" }, { id: "u1", name: "" }]);
    });
});
