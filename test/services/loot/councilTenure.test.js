// "Dabei seit" (#668): the earliest of roster date, first raid (log or signup)
// and first loot, per person across their characters.
const mockEvents = jest.fn(() => []);
const mockLogs = jest.fn(() => []);
const mockRoster = jest.fn(() => null);
const mockRosters = jest.fn(() => []);

jest.mock("../../../src/services/events/eventSources", () => ({ listStoredEvents: (...a) => mockEvents(...a) }));
jest.mock("../../../src/stores/logStore", () => ({ listLogs: (...a) => mockLogs(...a) }));
jest.mock("../../../src/stores/reportStore", () => ({
    getReportRoster: (id) => (id === "rep1" ? { roster: [{ name: "Devi-Thunderstrike" }] }
        : id === "rep2" ? { roster: [], players: [{ name: "Twink" }] } : null),
}));
jest.mock("../../../src/stores/rosterStore", () => ({
    rosterForCategory: (...a) => mockRoster(...a),
    listRosters: (...a) => mockRosters(...a),
}));

const { tenureContext, tenureDays, MAX_LOGS } = require("../../../src/services/loot/councilTenure");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 9, 12);
const iso = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();
const sec = (daysAgo) => Math.floor((NOW - daysAgo * DAY) / 1000);

beforeEach(() => {
    mockEvents.mockReturnValue([]);
    mockLogs.mockReturnValue([]);
    mockRoster.mockReturnValue(null);
    mockRosters.mockReturnValue([]);
});

describe("services/loot/councilTenure", () => {
    it("knows nothing without data", () => {
        expect(tenureContext({ categoryId: "c1", now: NOW })("devi")).toEqual({ joinedAt: 0, source: "" });
        expect(tenureDays(0, NOW)).toBe(0);
        expect(tenureDays(NOW - 10.5 * DAY, NOW)).toBe(10);
        expect(MAX_LOGS).toBeGreaterThan(10);
    });

    it("shares a person's roster date among their characters, versioned keys included", () => {
        mockRoster.mockReturnValue({
            categoryId: "c1",
            members: { u1: { since: iso(40), chars: ["devi", "forever~twink"], charNames: { devi: "Devi-Thunderstrike" } } },
            history: [{ at: iso(100), userId: "u1" }, { at: iso(300), userId: "u9" }],
        });
        const at = tenureContext({ categoryId: "c1", now: NOW });
        expect(at("devi")).toEqual({ joinedAt: NOW - 100 * DAY, source: "roster" });
        expect(at("twink").joinedAt).toBe(NOW - 100 * DAY);
        expect(at("stranger").joinedAt).toBe(0);
    });

    it("takes the earliest of roster, raid and loot", () => {
        mockRoster.mockReturnValue({ categoryId: "c1", members: { u1: { since: iso(10), chars: ["devi"] } }, history: [] });
        mockEvents.mockReturnValue([
            { id: "e1", categoryId: "c1", startTime: sec(50), signUps: [] },
            { id: "e2", categoryId: "c2", startTime: sec(500), signUps: [] },
            { id: "e3", categoryId: "c1", startTime: sec(-5), signUps: [{ userId: "u1", status: "signed" }] },
        ]);
        mockLogs.mockReturnValue([
            { eventId: "e1", reportRefId: "rep1" },
            { eventId: "e2", reportRefId: "rep1" },
            { eventId: "nope", reportRefId: "rep1" },
        ]);
        const loot = [
            { characterKey: "devi", categoryId: "c1", awardedAt: NOW - 20 * DAY },
            { characterKey: "devi", categoryId: "c2", awardedAt: NOW - 900 * DAY },
        ];
        // the category: the raid 50 days ago (the other category and a future night do not count)
        expect(tenureContext({ categoryId: "c1", allLoot: loot, now: NOW })("devi")).toEqual({ joinedAt: NOW - 50 * DAY, source: "raid" });
        // every category: the loot 900 days ago in the other one
        mockRosters.mockReturnValue([]);
        expect(tenureContext({ allLoot: loot, now: NOW })("devi")).toEqual({ joinedAt: NOW - 900 * DAY, source: "loot" });
    });

    it("reads the players of an old report and counts only attended signups", () => {
        mockRoster.mockReturnValue({ categoryId: "c1", members: { u2: { since: iso(1), chars: ["other"] }, u1: { since: iso(1), chars: ["twink"] } }, history: [] });
        mockEvents.mockReturnValue([
            { id: "e1", categoryId: "c1", startTime: sec(30), signUps: [{ userId: "u2", status: "absence" }] },
            { id: "e2", categoryId: "c1", startTime: sec(20), signUps: [{ userId: "u2", status: "late" }] },
        ]);
        mockLogs.mockReturnValue([{ eventId: "e1", reportRefId: "rep2" }]);
        const at = tenureContext({ categoryId: "c1", now: NOW });
        expect(at("twink")).toEqual({ joinedAt: NOW - 30 * DAY, source: "raid" });
        expect(at("other")).toEqual({ joinedAt: NOW - 20 * DAY, source: "raid" });
    });
});
