// One raider's attendance per raid category and per raid (src/web/availability/raiderAttendance.js):
// which categories count, the verdicts from rosterAttendance, the coming raids with the own status.
const NOW = Date.UTC(2030, 2, 21, 12, 0);
const sec = (iso) => Math.floor(Date.parse(iso) / 1000);

let mockNights = new Map();
const mockAttendance = jest.fn();
jest.mock("../../../src/services/characters/rosterAttendance", () => ({
    RAID_WINDOW: 11,
    categoryInfo: (_ctx, id) => ({ icon: id === "mon" ? "achievement_boss_illidan" : "" }),
    buildAttendanceContext: () => ({ raidsByCategory: mockNights, allRaidsByCategory: mockNights }),
    attendanceForAccounts: (...args) => mockAttendance(...args),
}));
const mockEvents = new Map();
jest.mock("../../../src/stores/eventStore", () => ({
    listEvents: (_g, { sinceSeconds = 0 } = {}) => [...mockEvents.values()].filter((e) => e.startTime >= sinceSeconds),
}));
const mockSignups = new Map();
jest.mock("../../../src/stores/signupStore", () => ({
    getSignup: (eventId, userId) => mockSignups.get(`${eventId}/${userId}`) || null,
    listSignups: () => [],
}));
let mockAssignments = {};
jest.mock("../../../src/stores/raiderCharactersStore", () => ({ getCategoryAssignments: (id) => mockAssignments[id] || {} }));
let mockConfig = {};
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => mockConfig }));

const profiles = require("../../../src/stores/raiderProfileStore");
const { raiderAttendance } = require("../../../src/web/availability/raiderAttendance");
const { tempStoreFile } = require("../../helpers/tempStore");

const night = (id, iso, signUps = []) => ({ id, title: id, startTime: sec(iso), signUps, logs: [] });

beforeAll(() => profiles.useFile(tempStoreFile("eh-raider-attendance-profiles.json")));
afterAll(() => profiles.useFile(null));
beforeEach(() => {
    profiles.reset();
    mockNights = new Map();
    mockEvents.clear();
    mockSignups.clear();
    mockAssignments = {};
    mockConfig = { categoryIds: ["mon", "wed"] };
    mockAttendance.mockReset();
    mockAttendance.mockImplementation((_ctx, _cat, accounts) => new Map(accounts.map((a) => [a.userId, {
        attended: 2, total: 3, pct: 67, link: "manual", inferred: 0, missed: [],
        raids: [{ eventId: "n1", title: "n1", startTime: 1, attended: true, reason: "im Log" }],
    }])));
});

describe("raiderAttendance", () => {
    it("counts every active category the raider signed up for, with the characters of the newest signup", () => {
        mockNights.set("mon", [night("n2", "2030-03-18T19:00:00Z", [{ userId: "u1", status: "signed", character: "Bananajoe", spec: "Druid-Restoration" }]), night("n1", "2030-03-11T19:00:00Z")]);
        mockNights.set("wed", [night("w1", "2030-03-13T19:00:00Z", [{ userId: "someone", status: "signed" }])]);
        mockNights.set("other", [night("o1", "2030-03-13T19:00:00Z", [{ userId: "u1", status: "signed", character: "X" }])]);
        const view = raiderAttendance("u1", { now: NOW, categoryNames: { mon: "TBC Montag" } });
        expect(view.categories.map((c) => [c.id, c.name, c.pct, c.attended, c.total, c.window])).toEqual([["mon", "TBC Montag", 67, 2, 3, 11]]);
        expect(view.categories[0].raids).toHaveLength(1);
        expect(view.categories[0].icon).toBe("achievement_boss_illidan");
        const [, categoryId, accounts, opts] = mockAttendance.mock.calls[0];
        expect(categoryId).toBe("mon");
        expect(accounts[0].chars.map((c) => c.name)).toEqual(["Bananajoe"]);
        expect(opts).toEqual({ nights: true, window: 11 });
        expect(view.character).toBe("Bananajoe");
    });

    it("takes a category the orga assigned a character in, or one with a coming raid signed up for", () => {
        mockAssignments = { wed: { u1: "Zibbi" } };
        mockEvents.set("eh-1", { id: "eh-1", title: "Kara", startTime: sec("2030-03-25T19:00:00Z"), categoryId: "mon" });
        mockEvents.set("eh-0", { id: "eh-0", title: "past", startTime: sec("2030-03-18T19:00:00Z"), categoryId: "mon" });
        mockSignups.set("eh-1/u1", { status: "absence" });
        const view = raiderAttendance("u1", { now: NOW, eventUrl: (e) => `https://x/e/${e.id}` });
        expect(view.categories.map((c) => c.id).sort()).toEqual(["mon", "wed"]);
        const mon = view.categories.find((c) => c.id === "mon");
        expect(mon.upcoming).toEqual([{ eventId: "eh-1", title: "Kara", startTime: sec("2030-03-25T19:00:00Z"), status: "absence", url: "https://x/e/eh-1" }]);
        // no characters known in "mon" (only a coming absence): no quota, no error
        expect(mon).toMatchObject({ pct: null, total: 0, raids: [] });
    });

    it("names a category after its Discord category, else after the name its events were created with", () => {
        mockAssignments = { mon: { u1: "Zibbi" }, wed: { u1: "Zibbi" } };
        mockEvents.set("eh-1", { id: "eh-1", title: "Kara", startTime: sec("2030-03-25T19:00:00Z"), categoryId: "wed", categoryName: "Mittwoch alt" });
        const view = raiderAttendance("u1", { now: NOW, categoryNames: { mon: "TBC Montag" } });
        expect(Object.fromEntries(view.categories.map((c) => [c.id, c.name]))).toEqual({ mon: "TBC Montag", wed: "Mittwoch alt" });
    });

    it("hides a category switched off in the settings and counts each over its own window", () => {
        mockAssignments = { mon: { u1: "Zibbi" }, wed: { u1: "Zibbi" } };
        mockConfig = { categoryIds: ["mon", "wed"], categoryAttendance: { mon: { show: false }, wed: { window: 4 } } };
        const view = raiderAttendance("u1", { now: NOW });
        expect(view.categories.map((c) => [c.id, c.window])).toEqual([["wed", 4]]);
        expect(mockAttendance.mock.calls.map((c) => [c[1], c[3]])).toEqual([["wed", { nights: true, window: 4 }]]);
    });

    it("leaves out categories the raider never raided in and cancelled raids", () => {
        mockNights.set("mon", [night("n1", "2030-03-18T19:00:00Z", [{ userId: "someone", status: "signed" }])]);
        mockEvents.set("eh-1", { id: "eh-1", startTime: sec("2030-03-25T19:00:00Z"), categoryId: "mon", status: "cancelled" });
        expect(raiderAttendance("u1", { now: NOW }).categories).toEqual([]);
    });
});
