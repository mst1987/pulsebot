// The person search of the "Vermerk anlegen" dialog and the recent raids (#980):
// members first, then who left (found through signups of the last year), no member
// list (or one that does not come in time) = nobody marked as gone; the raids of the
// last four weeks with `signed`, cancelled ones left out.
let mockOnline = true;
let mockMembers = [];
let mockEvents = [];
jest.mock("../../../src/services/discord/discord", () => ({
    isOnline: jest.fn(() => mockOnline),
    getGuild: jest.fn((id) => (id === "G" ? { id: "G" } : null)),
    fetchGuildMembersCached: jest.fn(async () => mockMembers),
    NAME_FETCH_MS: 5000,
}));
jest.mock("../../../src/services/events/eventSources", () => ({
    listStoredEvents: jest.fn(() => mockEvents),
}));

const discord = require("../../../src/services/discord/discord");
const { searchPeople, recentRaids, membersOf } = require("../../../src/services/vermerke/vermerkePeople");

const NOW = Date.UTC(2026, 9, 30, 12);
const sec = (daysAgo) => Math.floor((NOW - daysAgo * 86400000) / 1000);
const member = (id, displayName, bot = false, user = {}) => ({ id, displayName, user: { bot, username: displayName, ...user } });

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
        const { results } = await searchPeople("G", "", { now: NOW });
        expect(results).toEqual([
            { userId: "2", name: "Anna", gone: false },
            { userId: "1", name: "Zed", gone: false },
            { userId: "3", name: "Gonzo", gone: true },
            { userId: "4", name: "Zelda", gone: true },
        ]);
    });

    it("matches the name or the exact id", async () => {
        expect((await searchPeople("G", "ze", { now: NOW })).results.map((r) => r.userId)).toEqual(["1", "4"]);
        expect((await searchPeople("G", "3", { now: NOW })).results.map((r) => r.userId)).toEqual(["3"]);
    });

    it("finds members by their username and global name too", async () => {
        mockMembers = [member("1", "Zed", false, { username: "zedthehunter", globalName: "Zeddy" })];
        expect((await searchPeople("G", "hunter", { now: NOW })).results.map((r) => r.userId)).toEqual(["1"]);
        expect((await searchPeople("G", "zeddy", { now: NOW })).results.map((r) => r.userId)).toEqual(["1"]);
    });

    it("looks back one year for people who left", async () => {
        mockEvents.push({ id: "old", title: "Old", startTime: sec(400), signUps: [{ userId: "7", name: "Ancient" }] });
        const ids = (await searchPeople("G", "", { now: NOW })).results.map((r) => r.userId);
        expect(ids).not.toContain("7");
    });

    it("marks nobody as gone without the member list", async () => {
        mockOnline = false;
        expect(await membersOf("G")).toBeNull();
        const { results } = await searchPeople("G", "", { now: NOW });
        expect(results.every((r) => r.gone === null)).toBe(true);
        expect(results.map((r) => r.userId).sort()).toEqual(["1", "3", "4"]);
    });

    it("treats a hanging member list as not there instead of waiting for it", async () => {
        discord.fetchGuildMembersCached.mockImplementationOnce(() => new Promise(() => {}));
        expect(await membersOf("G", { waitMs: 10 })).toBeNull();
        discord.fetchGuildMembersCached.mockImplementationOnce(() => new Promise(() => {}));
        const { results } = await searchPeople("G", "", { now: NOW, waitMs: 10 });
        expect(results.every((r) => r.gone === null)).toBe(true);
    });

    it("keeps to the limit", async () => {
        expect((await searchPeople("G", "", { limit: 2, now: NOW })).results).toHaveLength(2);
    });

    it("gives the raids of the last four weeks, signed only for a real signup", () => {
        expect(recentRaids("G", "1", { now: NOW })).toEqual([
            { eventId: "e2", title: "Karazhan", startTime: sec(3), signed: true },
            { eventId: "e1", title: "Gruul", startTime: sec(10), signed: false },
        ]);
        expect(recentRaids("G", "", { now: NOW }).every((r) => r.signed === false)).toBe(true);
    });

    it("leaves cancelled raids out", () => {
        mockEvents[0].status = "cancelled";
        expect(recentRaids("G", "1", { now: NOW }).map((r) => r.eventId)).toEqual(["e1"]);
    });
});
