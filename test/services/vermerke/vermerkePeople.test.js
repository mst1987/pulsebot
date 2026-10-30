// The person search of the "Vermerk anlegen" dialog and the recent raids (#980):
// members first, then who left (found through earlier signups), no member list =
// nobody marked as gone; the raids of the last four weeks with `signed`.
let mockOnline = true;
let mockMembers = [];
let mockEvents = [];
jest.mock("../../../src/services/discord/discord", () => ({
    isOnline: jest.fn(() => mockOnline),
    getGuild: jest.fn((id) => (id === "G" ? { id: "G" } : null)),
    fetchGuildMembersCached: jest.fn(async () => mockMembers),
}));
jest.mock("../../../src/services/events/eventSources", () => ({
    listStoredEvents: jest.fn(() => mockEvents),
}));

const { searchPeople, recentRaids, membersOf } = require("../../../src/services/vermerke/vermerkePeople");

const NOW = Date.UTC(2026, 9, 30, 12);
const sec = (daysAgo) => Math.floor((NOW - daysAgo * 86400000) / 1000);
const member = (id, displayName, bot = false) => ({ id, displayName, user: { bot, username: displayName } });

beforeEach(() => {
    mockOnline = true;
    mockMembers = [member("1", "Zed"), member("2", "Anna"), member("9", "Botty", true)];
    mockEvents = [
        { id: "e2", title: "Karazhan", startTime: sec(3), signUps: [{ userId: "1", status: "primary" }, { userId: "3", name: "Gonzo" }] },
        { id: "e1", title: "Gruul", startTime: sec(10), signUps: [{ userId: "1", className: "Absence" }, { userId: "4", character: "Zelda" }] },
        { id: "e0", title: "Alt", startTime: sec(40), signUps: [{ userId: "1" }] },
    ];
});

describe("services/vermerke/vermerkePeople", () => {
    it("lists members first, then who left, without bots", async () => {
        const { results } = await searchPeople("G", "");
        expect(results).toEqual([
            { userId: "2", name: "Anna", gone: false },
            { userId: "1", name: "Zed", gone: false },
            { userId: "3", name: "Gonzo", gone: true },
            { userId: "4", name: "Zelda", gone: true },
        ]);
    });

    it("matches the name or the exact id", async () => {
        expect((await searchPeople("G", "ze")).results.map((r) => r.userId)).toEqual(["1", "4"]);
        expect((await searchPeople("G", "3")).results.map((r) => r.userId)).toEqual(["3"]);
    });

    it("marks nobody as gone without the member list", async () => {
        mockOnline = false;
        expect(await membersOf("G")).toBeNull();
        const { results } = await searchPeople("G", "");
        expect(results.every((r) => r.gone === null)).toBe(true);
        expect(results.map((r) => r.userId).sort()).toEqual(["1", "3", "4"]);
    });

    it("keeps to the limit", async () => {
        expect((await searchPeople("G", "", { limit: 2 })).results).toHaveLength(2);
    });

    it("gives the raids of the last four weeks, signed only for a real signup", () => {
        expect(recentRaids("G", "1", { now: NOW })).toEqual([
            { eventId: "e2", title: "Karazhan", startTime: sec(3), signed: true },
            { eventId: "e1", title: "Gruul", startTime: sec(10), signed: false },
        ]);
        expect(recentRaids("G", "", { now: NOW }).every((r) => r.signed === false)).toBe(true);
    });
});
