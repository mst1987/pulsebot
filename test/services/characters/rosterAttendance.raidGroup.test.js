// Attendance of a raid group (#811): "Zul'Aman" and "Zul'Aman 2" from one
// signup are ONE night per person — present when in the log of any raid of the
// group, placed (or benched) in any of their setups; the further raid is never a
// night of its own. Somebody signed up at the first raid, placed in Raid 2 and in
// Raid 2's log is present, not "Nicht erschienen".
jest.mock("../../../src/stores/events/raidEventStore", () => ({ listRaidEvents: () => [] }));
const mockLogs = [];
jest.mock("../../../src/stores/loot/logStore", () => ({ listLogs: () => mockLogs }));
const mockReports = new Map();
jest.mock("../../../src/stores/loot/reportStore", () => ({
    listReports: () => [...mockReports.keys()].map((id, i) => ({ id, zone: "Zul'Aman", generatedAt: 1000 - i })),
    getReport: (id) => (mockReports.has(id) ? { zone: "Zul'Aman", roster: mockReports.get(id).map((name) => ({ name })) } : null),
}));
const mockEvents = [];
jest.mock("../../../src/stores/events/eventStore", () => ({
    listEvents: (guildId, opts = {}) => mockEvents.filter((e) => opts.siblings === true || !(e.raidGroupId && e.raidGroupId !== e.id))
        .filter((e) => !opts.untilSeconds || e.startTime <= opts.untilSeconds),
    getEvent: (id) => mockEvents.find((e) => e.id === id) || null,
    isOwnEventId: (id) => String(id).startsWith("eh-"),
}));
const mockSignups = {};
jest.mock("../../../src/stores/events/signupStore", () => ({ listSignups: (id) => mockSignups[id] || [] }));
jest.mock("../../../src/stores/settings/settingsStore", () => ({ getConfig: () => ({}) }));
jest.mock("../../../src/stores/roster/raiderCharactersStore", () => ({
    ...jest.requireActual("../../../src/stores/roster/raiderCharactersStore"),
    listAllAssignments: () => ({}),
}));
jest.mock("../../../src/stores/events/availabilityStore", () => ({ listEntries: () => [] }));
jest.mock("../../../src/stores/events/attendanceOverridesStore", () => ({ listOverrides: () => ({}) }));

const { buildAttendanceContext, attendanceForAccounts, attendanceFor } = require("../../../src/services/characters/rosterAttendance");

const NOW = Date.UTC(2026, 9, 10);
const START = Math.floor(NOW / 1000) - 86400;
const lineup = (slots) => ({ status: "approved", groups: [{ index: 1, slots }], bench: [], approved: { version: 1, groups: [{ index: 1, slots }], bench: [] } });
const sign = (userId, character, status = "signed") => ({ userId, character, spec: "Mage-Fire", role: "ranged", status });

beforeEach(() => {
    mockEvents.length = 0;
    mockLogs.length = 0;
    mockReports.clear();
    for (const k of Object.keys(mockSignups)) delete mockSignups[k];
    mockEvents.push(
        { id: "eh-za", guildId: "g1", categoryId: "cat", title: "Zul'Aman", startTime: START, versionId: "tbc", raidGroupId: "eh-za", raidGroupIndex: 1,
            setup: lineup([{ userId: "u1", character: "Alpha", spec: "Mage-Fire", role: "ranged" }]) },
        { id: "eh-za2", guildId: "g1", categoryId: "cat", title: "Zul'Aman 2", startTime: START, versionId: "tbc", raidGroupId: "eh-za", raidGroupIndex: 2,
            setup: lineup([{ userId: "u2", character: "Bravo", spec: "Mage-Fire", role: "ranged" }, { userId: "u3", character: "Charlie", spec: "Mage-Fire", role: "ranged" }]) },
    );
    mockSignups["eh-za"] = [sign("u1", "Alpha"), sign("u2", "Bravo"), sign("u3", "Charlie", "tentative"), sign("u4", "Delta")];
    mockReports.set("r1", ["Alpha"]);
    mockReports.set("r2", ["Bravo"]);
    mockLogs.push({ eventId: "eh-za", reportRefId: "r1" }, { eventId: "eh-za2", reportRefId: "r2" });
});

const accounts = [
    { userId: "u1", chars: [{ name: "Alpha" }] },
    { userId: "u2", chars: [{ name: "Bravo" }] },
    { userId: "u3", chars: [{ name: "Charlie" }] },
    { userId: "u4", chars: [{ name: "Delta" }] },
];

describe("a raid group's night", () => {
    it("counts once per person: the further raid is no night of its own", () => {
        const ctx = buildAttendanceContext("g1", { now: NOW, versionId: "tbc" });
        expect(ctx.raidsByCategory.get("cat").map((r) => r.id)).toEqual(["eh-za"]);
        const result = attendanceForAccounts(ctx, "cat", accounts, { nights: true });
        for (const id of ["u1", "u2", "u3", "u4"]) expect(result.get(id).raids).toHaveLength(1);
    });

    it("is present in the log of any raid of the group — placed in Raid 2 and in its log is present, not \"Nicht erschienen\"", () => {
        const ctx = buildAttendanceContext("g1", { now: NOW, versionId: "tbc" });
        const result = attendanceForAccounts(ctx, "cat", accounts, { nights: true });
        expect(result.get("u1").raids[0]).toMatchObject({ status: "present", detail: "inLog" });
        expect(result.get("u2").raids[0]).toMatchObject({ status: "present", detail: "inLog", eventId: "eh-za" });
        expect(attendanceFor(ctx, "cat", "Bravo", ["u2"]).pct).toBe(100);
    });

    it("knows the placements of every raid: a \"maybe\" placed in Raid 2 and in no log did not show, a signed raider left out sat on the bench", () => {
        const ctx = buildAttendanceContext("g1", { now: NOW, versionId: "tbc" });
        const result = attendanceForAccounts(ctx, "cat", accounts, { nights: true });
        expect(result.get("u3").raids[0]).toMatchObject({ status: "noShow", detail: "tentativePlaced" });
        expect(result.get("u4").raids[0]).toMatchObject({ status: "bench", detail: "benchNotInLog" });
    });
});
