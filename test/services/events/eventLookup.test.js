jest.mock("../../../src/services/events/raidEventGroups", () => ({ loadEventGroups: jest.fn(), eventLookbackSince: jest.fn(() => 1000) }));
jest.mock("../../../src/services/discord/guildRoles", () => ({ eventGuildId: jest.fn(() => "event-guild") }));

const { loadEventGroups } = require("../../../src/services/events/raidEventGroups");
const { listEvents, statusOf, statusCounts } = require("../../../src/services/events/eventLookup");

describe("services/events/eventLookup", () => {
    beforeEach(() => jest.clearAllMocks());

    it("flattens the event groups of the event server, oldest first, once per event", async () => {
        loadEventGroups.mockResolvedValue({
            groups: [
                { categoryName: "Montag", events: [{ id: "b", startTime: 200 }, { id: "a", startTime: 100 }] },
                { categoryName: "Pug", events: [{ id: "a", startTime: 100 }, { id: "c", startTime: 150 }] },
            ],
            error: null,
        });
        const { events, error } = await listEvents();
        expect(loadEventGroups).toHaveBeenCalledWith("event-guild", {});
        expect(events.map((e) => e.id)).toEqual(["a", "c", "b"]);
        expect(events[0].categoryName).toBe("Montag");
        expect(error).toBeNull();
    });

    it("asks for the lookback window when past raids are wanted", async () => {
        loadEventGroups.mockResolvedValue({ groups: [], error: "down" });
        const { events, error } = await listEvents({ past: true });
        expect(loadEventGroups).toHaveBeenCalledWith("event-guild", { sinceSeconds: 1000 });
        expect(events).toEqual([]);
        expect(error).toBe("down");
    });

    it("reads a user's status and the counts from the latest reaction per user", () => {
        const event = {
            signUps: [
                { userId: "u1", specName: "Fire" },
                { userId: "u2", specName: "Absence" },
                { userId: "u3", status: "bench" },
                { userId: "u1", specName: "Late" },
            ],
        };
        expect(statusOf(event, "u1")).toBe("late");
        expect(statusOf(event, "u2")).toBe("absence");
        expect(statusOf(event, "nobody")).toBe("");
        expect(statusCounts(event)).toEqual({ signed: 0, late: 1, tentative: 0, bench: 1, absence: 1 });
    });
});
