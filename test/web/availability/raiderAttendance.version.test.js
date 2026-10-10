// "Meine Anwesenheit" per game version (#740), through the real attendance rules:
// a category ran 11 TBC raids, was switched to Forever and ran 2 Forever raids -
// under Forever the quota counts the 2, under TBC the 11. Only the stores are mocked.
const NOW = Date.UTC(2030, 2, 21, 12, 0);
const NOW_SEC = Math.floor(NOW / 1000);
const DAY = 86400;

const mockListRaidEvents = jest.fn(() => []);
jest.mock("../../../src/stores/raidEventStore", () => ({ listRaidEvents: (...a) => mockListRaidEvents(...a) }));
jest.mock("../../../src/stores/logStore", () => ({ listLogs: () => [] }));
jest.mock("../../../src/stores/reportStore", () => ({ listReports: () => [], getReport: () => null }));
const mockOwnEvents = jest.fn(() => []);
jest.mock("../../../src/stores/eventStore", () => ({
    listEvents: (...a) => mockOwnEvents(...a),
    getEvent: jest.fn(),
    isOwnEventId: (id) => String(id).startsWith("eh-"),
}));
const mockGetSignup = jest.fn(() => null);
jest.mock("../../../src/stores/signupStore", () => ({ listSignups: () => [], getSignup: (...a) => mockGetSignup(...a) }));
jest.mock("../../../src/stores/availabilityStore", () => ({ listEntries: () => [] }));
jest.mock("../../../src/stores/attendanceOverridesStore", () => ({ listOverrides: () => ({}) }));
let mockConfig = {};
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => mockConfig }));
let mockAssignments = {};
jest.mock("../../../src/stores/raiderCharactersStore", () => ({
    getCategoryAssignments: (id) => mockAssignments[id] || {},
    listAllAssignments: () => mockAssignments,
}));

const configStore = require("../../../src/stores/configStore");
const profiles = require("../../../src/stores/raiderProfileStore");
const { raiderAttendance } = require("../../../src/web/availability/raiderAttendance");
const { tempStoreFile } = require("../../helpers/tempStore");

const night = (id, daysAgo, versionId, status = "signed") => ({
    id, guildId: "g1", categoryId: "do", title: `Raid ${id}`, startTime: NOW_SEC - daysAgo * DAY, versionId,
    signUps: [{ userId: "u1", status, character: "Elesham" }],
});
const tbcNights = Array.from({ length: 11 }, (_, i) => night(`t${i + 1}`, 21 + i * 7, "tbc"));

let configSpy;
beforeAll(() => profiles.useFile(tempStoreFile("eh-raider-attendance-version-profiles.json")));
afterAll(() => profiles.useFile(null));
beforeEach(() => {
    profiles.reset();
    mockAssignments = {};
    mockOwnEvents.mockReturnValue([]);
    // the category was switched to Forever (#738): the stored nights keep their version
    mockConfig = { categoryIds: ["do"], categoryVersion: { do: "forever" } };
    configSpy = jest.spyOn(configStore, "getConfig").mockImplementation(() => mockConfig);
});
afterEach(() => configSpy.mockRestore());

describe("Meine Anwesenheit per game version (#740)", () => {
    it("counts the 2 Forever raids under Forever and the 11 TBC raids under TBC", () => {
        mockListRaidEvents.mockReturnValue([night("f1", 7, "forever"), night("f2", 14, "forever", "absence"), ...tbcNights]);

        const forever = raiderAttendance("u1", { now: NOW, versionId: "forever" });
        expect(forever.versionId).toBe("forever");
        expect(forever.categories).toHaveLength(1);
        expect(forever.categories[0]).toMatchObject({ id: "do", attended: 1, total: 2, pct: 50 });
        expect(forever.categories[0].raids.map((r) => r.eventId).sort()).toEqual(["f1", "f2"]);

        const tbc = raiderAttendance("u1", { now: NOW, versionId: "tbc" });
        expect(tbc.categories[0]).toMatchObject({ id: "do", attended: 11, total: 11, pct: 100 });
        expect(tbc.categories[0].raids.map((r) => r.eventId).sort()).toEqual(tbcNights.map((e) => e.id).sort());
    });

    it("shows the switched category under Forever before its first Forever raid, with no quota instead of 0 %", () => {
        mockListRaidEvents.mockReturnValue(tbcNights);
        const view = raiderAttendance("u1", { now: NOW, versionId: "forever" });
        expect(view.categories).toEqual([expect.objectContaining({ id: "do", pct: null, total: 0, raids: [] })]);
    });

    it("leaves a category that plays another version and ran nothing of this one out", () => {
        mockListRaidEvents.mockReturnValue(tbcNights);
        mockConfig = { categoryIds: ["do"] };
        mockAssignments = { do: { u1: "Elesham" } };
        expect(raiderAttendance("u1", { now: NOW, versionId: "forever" }).categories).toEqual([]);
        expect(raiderAttendance("u1", { now: NOW, versionId: "tbc" }).categories).toHaveLength(1);
    });

    it("lists only the coming raids of the version", () => {
        mockListRaidEvents.mockReturnValue([]);
        mockOwnEvents.mockReturnValue([
            { id: "eh-f", guildId: "g1", categoryId: "do", title: "Forever", startTime: NOW_SEC + 2 * DAY, versionId: "forever" },
            { id: "eh-t", guildId: "g1", categoryId: "do", title: "TBC", startTime: NOW_SEC + 3 * DAY, versionId: "tbc" },
        ]);
        mockGetSignup.mockReturnValue({ status: "signed" });
        const forever = raiderAttendance("u1", { now: NOW, versionId: "forever" });
        expect(forever.categories[0].upcoming.map((u) => u.eventId)).toEqual(["eh-f"]);
        const tbc = raiderAttendance("u1", { now: NOW, versionId: "tbc" });
        expect(tbc.categories[0].upcoming.map((u) => u.eventId)).toEqual(["eh-t"]);
    });

    it("counts the main version when no version is named", () => {
        mockListRaidEvents.mockReturnValue([night("f1", 7, "forever"), ...tbcNights]);
        mockConfig = { ...mockConfig, mainVersion: "forever" };
        expect(raiderAttendance("u1", { now: NOW }).categories[0]).toMatchObject({ total: 1 });
    });
});
