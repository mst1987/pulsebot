const mockListLogs = jest.fn(() => []);
const mockLinkEvent = jest.fn();
jest.mock("../../src/web/logStore", () => ({
    listLogs: (...a) => mockListLogs(...a),
    linkEvent: (...a) => mockLinkEvent(...a),
}));

const mockListGuilds = jest.fn(() => []);
jest.mock("../../src/web/discord", () => ({ listGuilds: (...a) => mockListGuilds(...a) }));

const mockLoadMatchableEvents = jest.fn(async () => ({ events: [], error: null }));
jest.mock("../../src/web/matchableEvents", () => ({
    loadMatchableEvents: (...a) => mockLoadMatchableEvents(...a),
    eventLinkFields: jest.requireActual("../../src/web/matchableEvents").eventLinkFields,
}));

const { autoLinkLogs, autoLinkAllGuilds, startLogAutoLink, _resetTimerForTests } = require("../../src/web/logAutoLink.js");

const HOUR = 3600000;
const NOW = 1_700_000_000_000;
// Two raids, one a day apart, so a log can be matched unambiguously.
const raidA = { id: "evA", title: "Kara", startTime: Math.floor((NOW - 24 * HOUR) / 1000), categoryId: "cat1" };
const raidB = { id: "evB", title: "Gruul", startTime: Math.floor((NOW - 3 * HOUR) / 1000), categoryId: "cat1" };

const log = (id, postedAt, extra = {}) => ({ id, guildId: "g1", reportId: `rep-${id}`, postedAt, ...extra });

describe("web/logAutoLink", () => {
    beforeEach(() => {
        mockListLogs.mockReset().mockReturnValue([]);
        mockLinkEvent.mockReset();
        mockListGuilds.mockReset().mockReturnValue([]);
        mockLoadMatchableEvents.mockReset().mockResolvedValue({ events: [], error: null });
        _resetTimerForTests();
    });
    afterEach(() => _resetTimerForTests());

    describe("autoLinkLogs", () => {
        it("does nothing without a guild id", async () => {
            expect(await autoLinkLogs("")).toEqual({ linked: 0, remaining: 0, error: null });
            expect(mockLoadMatchableEvents).not.toHaveBeenCalled();
        });

        it("skips the Raid-Helper call entirely when every log is already assigned", async () => {
            mockListLogs.mockReturnValue([log("l1", NOW - 2 * HOUR, { eventId: "evB" })]);
            expect(await autoLinkLogs("g1")).toEqual({ linked: 0, remaining: 0, error: null });
            expect(mockLoadMatchableEvents).not.toHaveBeenCalled();
        });

        it("persists the unambiguous match, snapshotting the event's label and start", async () => {
            mockListLogs.mockReturnValue([log("l1", raidB.startTime * 1000 + HOUR)]);
            mockLoadMatchableEvents.mockResolvedValue({ events: [raidA, raidB], error: null });

            expect(await autoLinkLogs("g1")).toEqual({ linked: 1, remaining: 0, error: null });
            expect(mockLinkEvent).toHaveBeenCalledWith("l1", {
                eventId: "evB",
                eventLabel: "Gruul",
                eventStartTime: raidB.startTime,
                source: "auto",
            });
        });

        it("leaves an ambiguous log alone for an admin to decide", async () => {
            // Two raids starting within the ambiguity threshold of each other:
            // whichever is picked would be a coin flip.
            const twin = { id: "evC", title: "SSC", startTime: raidB.startTime + 1800, categoryId: "cat1" };
            mockListLogs.mockReturnValue([log("l1", (raidB.startTime + 900) * 1000)]);
            mockLoadMatchableEvents.mockResolvedValue({ events: [raidB, twin], error: null });

            expect(await autoLinkLogs("g1")).toEqual({ linked: 0, remaining: 1, error: null });
            expect(mockLinkEvent).not.toHaveBeenCalled();
        });

        it("never touches a log that already has an event", async () => {
            mockListLogs.mockReturnValue([log("l1", raidB.startTime * 1000 + HOUR, { eventId: "evA" })]);
            mockLoadMatchableEvents.mockResolvedValue({ events: [raidA, raidB], error: null });

            await autoLinkLogs("g1");
            expect(mockLinkEvent).not.toHaveBeenCalled();
        });

        it("ignores logs belonging to another guild", async () => {
            mockListLogs.mockReturnValue([{ ...log("l1", raidB.startTime * 1000 + HOUR), guildId: "other" }]);
            mockLoadMatchableEvents.mockResolvedValue({ events: [raidB], error: null });

            expect(await autoLinkLogs("g1")).toEqual({ linked: 0, remaining: 0, error: null });
            expect(mockLinkEvent).not.toHaveBeenCalled();
        });

        it("reports a Raid-Helper failure without throwing when there is nothing to match against", async () => {
            mockListLogs.mockReturnValue([log("l1", raidB.startTime * 1000 + HOUR)]);
            mockLoadMatchableEvents.mockResolvedValue({ events: [], error: "API down" });

            expect(await autoLinkLogs("g1")).toEqual({ linked: 0, remaining: 1, error: "API down" });
            expect(mockLinkEvent).not.toHaveBeenCalled();
        });

        it("still assigns from the persisted snapshot while Raid-Helper is down", async () => {
            mockListLogs.mockReturnValue([log("l1", raidB.startTime * 1000 + HOUR)]);
            mockLoadMatchableEvents.mockResolvedValue({ events: [raidA, raidB], error: "API down" });

            expect(await autoLinkLogs("g1")).toMatchObject({ linked: 1, remaining: 0 });
            expect(mockLinkEvent).toHaveBeenCalledWith("l1", expect.objectContaining({ eventId: "evB", source: "auto" }));
        });

        it("leaves a log with no event in the window unassigned", async () => {
            mockListLogs.mockReturnValue([log("l1", (raidA.startTime - 5 * 86400) * 1000)]);
            mockLoadMatchableEvents.mockResolvedValue({ events: [raidA, raidB], error: null });

            expect(await autoLinkLogs("g1")).toEqual({ linked: 0, remaining: 1, error: null });
        });
    });

    describe("autoLinkAllGuilds", () => {
        it("sums the assignments across every guild", async () => {
            mockListGuilds.mockReturnValue([{ id: "g1" }, { id: "g2" }]);
            // guildId-less logs count for whichever guild is being processed.
            mockListLogs.mockImplementation(() => [{ ...log("l1", raidB.startTime * 1000 + HOUR), guildId: "" }]);
            mockLoadMatchableEvents.mockResolvedValue({ events: [raidA, raidB], error: null });

            expect(await autoLinkAllGuilds()).toBe(2);
        });

        it("keeps going when one guild fails", async () => {
            const spy = jest.spyOn(console, "error").mockImplementation(() => {});
            mockListGuilds.mockReturnValue([{ id: "bad" }, { id: "g2" }]);
            // guildId-less logs count for whichever guild is being processed.
            mockListLogs.mockImplementation(() => [{ ...log("l1", raidB.startTime * 1000 + HOUR), guildId: "" }]);
            mockLoadMatchableEvents.mockImplementation(async (guildId) =>
                (guildId === "bad" ? { events: [], error: "API down" } : { events: [raidA, raidB], error: null }));

            expect(await autoLinkAllGuilds()).toBe(1);
            spy.mockRestore();
        });
    });

    describe("startLogAutoLink", () => {
        it("runs once immediately and then on an interval, and is idempotent", async () => {
            jest.useFakeTimers();
            mockListGuilds.mockReturnValue([{ id: "g1" }]);
            const timer = startLogAutoLink({ intervalMs: 1000 });
            expect(startLogAutoLink({ intervalMs: 1000 })).toBe(timer);
            expect(mockListGuilds).toHaveBeenCalledTimes(1);

            jest.advanceTimersByTime(2000);
            expect(mockListGuilds).toHaveBeenCalledTimes(3);
            jest.useRealTimers();
        });
    });
});
