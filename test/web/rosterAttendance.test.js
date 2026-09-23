// Attendance and role are derived from three stores — all mocked, so this tests
// the counting rules themselves (see the header of rosterAttendance.js).
const mockListRaidEvents = jest.fn(() => []);
jest.mock("../../src/web/raidEventStore", () => ({
    listRaidEvents: (...a) => mockListRaidEvents(...a),
}));

const mockListLogs = jest.fn(() => []);
jest.mock("../../src/web/logStore", () => ({
    listLogs: (...a) => mockListLogs(...a),
}));

const mockListReports = jest.fn(() => []);
const mockGetReport = jest.fn(() => null);
jest.mock("../../src/web/reportStore", () => ({
    listReports: (...a) => mockListReports(...a),
    getReport: (...a) => mockGetReport(...a),
}));

// The EventHelper's own events reach attendance through the real adapter.
const mockListOwnEvents = jest.fn(() => []);
const mockListSignups = jest.fn(() => []);
jest.mock("../../src/web/eventStore", () => ({
    listEvents: (...a) => mockListOwnEvents(...a),
    getEvent: jest.fn(),
    isOwnEventId: (id) => String(id).startsWith("eh-"),
}));
jest.mock("../../src/web/signupStore", () => ({ listSignups: (...a) => mockListSignups(...a) }));
jest.mock("../../src/web/settingsStore", () => ({ getConfig: () => ({}) }));

const {
    buildAttendanceContext, attendanceFor, attendanceForAccounts, categoryInfo, roleFor, roleFromSpec, RAID_WINDOW,
} = require("../../src/web/rosterAttendance");

const NOW = Date.UTC(2026, 8, 14);
const DAY = 86400000;

const event = (id, daysAgo, over = {}) => ({
    id, guildId: "g1", categoryId: "cat1", title: `Raid ${id}`, startTime: NOW - daysAgo * DAY, signUps: [], ...over,
});

let reportSeq = 0;
function withReports(reports) {
    // reports: [{ id, eventId, names, zone, healers, tanks, rpbRoles }], newest first
    reportSeq += 1;
    mockListReports.mockReturnValue(reports.map((r, i) => ({ id: r.id, zone: r.zone || "", generatedAt: reportSeq * 1000 - i })));
    mockListLogs.mockReturnValue(reports.filter((r) => r.eventId).map((r) => ({ eventId: r.eventId, reportRefId: r.id })));
    mockGetReport.mockImplementation((id) => {
        const r = reports.find((x) => x.id === id);
        if (!r) return null;
        return {
            zone: r.zone || "",
            roster: (r.names || []).map((name) => ({ name, ...(r.classes && r.classes[name] ? { className: r.classes[name] } : {}) })),
            healers: { players: (r.healers || []).map((name) => ({ name })) },
            timeline: { fights: (r.tanks || []).map((name) => ({ healers: { tank: { name } } })) },
            rpb: { roles: r.rpbRoles || {} },
        };
    });
}

describe("web/rosterAttendance", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockListRaidEvents.mockReturnValue([]);
        withReports([]);
    });

    it("counts a night the character is in the log as attended, and one it is missing from as missed", () => {
        mockListRaidEvents.mockReturnValue([event("e1", 7), event("e2", 14)]);
        withReports([
            { id: "r1", eventId: "e1", names: ["Anna-Thunderstrike"] },
            { id: "r2", eventId: "e2", names: ["Bob"] },
        ]);
        const ctx = buildAttendanceContext("g1", { now: NOW });

        const a = attendanceFor(ctx, "cat1", "Anna");

        expect(a).toMatchObject({ attended: 1, total: 2, pct: 50 });
        expect(a.missed).toEqual([{ eventId: "e2", title: "Raid e2", startTime: NOW - 14 * DAY, reason: "nicht im Log" }]);
        expect(a.raids.map((r) => r.attended)).toEqual([true, false]);
    });

    it("falls back to the Raid-Helper signups of the assigned raider when a night has no log", () => {
        mockListRaidEvents.mockReturnValue([
            event("e1", 7, { signUps: [{ userId: "u1", status: "signed" }] }),
            event("e2", 14, { signUps: [{ userId: "u1", status: "absence" }] }),
            event("e3", 21, { signUps: [{ userId: "u2", status: "signed" }] }),
            event("e4", 28, { signUps: [{ userId: "u1", status: "bench" }] }),
            event("e5", 35, { signUps: [{ userId: "u1", status: "late" }] }),
        ]);
        const ctx = buildAttendanceContext("g1", { now: NOW });

        const a = attendanceFor(ctx, "cat1", "Anna", ["u1"]);

        expect(a).toMatchObject({ attended: 2, total: 5, pct: 40 });
        expect(a.missed.map((m) => [m.eventId, m.reason])).toEqual([
            ["e2", "abgemeldet"], ["e3", "keine Anmeldung"], ["e4", "Ersatzbank"],
        ]);
    });

    it("does not count a night without a log for a character no raider is assigned to", () => {
        mockListRaidEvents.mockReturnValue([event("e1", 7, { signUps: [{ userId: "u1", status: "signed" }] })]);
        const ctx = buildAttendanceContext("g1", { now: NOW });
        expect(attendanceFor(ctx, "cat1", "Anna", [])).toMatchObject({ attended: 0, total: 0, pct: null, missed: [] });
    });

    it("keeps the signed-off reason on a logged night the character missed", () => {
        mockListRaidEvents.mockReturnValue([event("e1", 7, { signUps: [{ userId: "u1", status: "absence" }] })]);
        withReports([{ id: "r1", eventId: "e1", names: ["Bob"] }]);
        const ctx = buildAttendanceContext("g1", { now: NOW });
        expect(attendanceFor(ctx, "cat1", "Anna", ["u1"]).missed[0].reason).toBe("abgemeldet");
    });

    it("looks at the category's last nights with evidence only, never at future or empty events", () => {
        const events = [event("future", -3, { signUps: [{ userId: "u1", status: "signed" }] }), event("empty", 1)];
        for (let i = 0; i < RAID_WINDOW + 3; i += 1) {
            events.push(event(`e${i}`, 7 * (i + 1), { signUps: [{ userId: "u1", status: "signed" }] }));
        }
        events.push(event("other", 2, { categoryId: "cat2", signUps: [{ userId: "u1", status: "absence" }] }));
        mockListRaidEvents.mockReturnValue(events);
        const ctx = buildAttendanceContext("g1", { now: NOW });

        const a = attendanceFor(ctx, "cat1", "Anna", ["u1"]);

        expect(a.total).toBe(RAID_WINDOW);
        expect(a.raids[0].eventId).toBe("e0");
        expect(a.raids.some((r) => r.eventId === "future" || r.eventId === "empty")).toBe(false);
        expect(mockListRaidEvents).toHaveBeenCalledWith("g1");
    });

    it("takes the role the character last played in a log over the spec", () => {
        withReports([
            { id: "new", names: ["Dorn"], healers: ["Dorn"] },
            { id: "old", names: ["Dorn", "Brok", "Rex"], tanks: ["Dorn"], rpbRoles: { Rex: "Tank" } },
        ]);
        const ctx = buildAttendanceContext("g1", { now: NOW });

        expect(roleFor(ctx, "Dorn", "Druid", "Feral")).toBe("healer");
        expect(roleFor(ctx, "Rex", "Warrior", "Arms")).toBe("tank");
        expect(roleFor(ctx, "Brok", "Warrior", "Protection")).toBe("dps");
        expect(roleFor(ctx, "Nobody", "Paladin", "Holy")).toBe("healer");
    });

    it("derives a role from the spec alone", () => {
        expect(roleFromSpec("Warrior", "Protection")).toBe("tank");
        expect(roleFromSpec("Shaman", "Restoration")).toBe("healer");
        expect(roleFromSpec("Mage", "Fire")).toBe("dps");
        expect(roleFromSpec("Mage", "")).toBe("");
    });

    it("describes a category by its counted nights, its raids and the newest raid's boss icon", () => {
        mockListRaidEvents.mockReturnValue([
            event("e1", 7, { title: "Hyjal + BT" }),
            event("e2", 14, { title: "egal" }),
        ]);
        withReports([{ id: "r2", eventId: "e2", names: ["Anna"], zone: "Serpentshrine Cavern" }]);
        const ctx = buildAttendanceContext("g1", { now: NOW });
        mockListRaidEvents.mockReturnValue([]);

        // e1 has neither signups nor a log, so it is not a counted night
        expect(categoryInfo(ctx, "cat1")).toEqual({ raids: 1, contents: ["SSC"], icon: "achievement_boss_ladyvashj" });
        expect(categoryInfo(ctx, "nothing")).toEqual({ raids: 0, contents: [], icon: "" });
    });

    it("counts the EventHelper's own raids with their own signups like Raid-Helper's", () => {
        const secondsAgo = (days) => Math.floor(Date.now() / 1000) - days * 86400;
        const own = (id, days) => ({
            id, source: "eventhelper", guildId: "g1", categoryId: "cat1", categoryName: "Raids", channelId: "c",
            channelName: "c", title: `EH ${id}`, startTime: secondsAgo(days), versionId: "tbc", instanceIds: [], size: 25,
        });
        mockListOwnEvents.mockReturnValue([own("eh-1", 2), own("eh-2", 9)]);
        mockListSignups.mockImplementation((eventId) => (eventId === "eh-1"
            ? [{ userId: "u1", spec: "Mage-Fire", role: "ranged", status: "signed" }]
            : [{ userId: "u1", status: "absence" }]));
        try {
            const ctx = buildAttendanceContext("g1");
            const result = attendanceFor(ctx, "cat1", "Anna", ["u1"]);
            expect(result).toMatchObject({ attended: 1, total: 2, pct: 50 });
            expect(result.missed).toEqual([expect.objectContaining({ eventId: "eh-2", reason: "abgemeldet" })]);
        } finally {
            mockListOwnEvents.mockReturnValue([]);
            mockListSignups.mockReturnValue([]);
        }
    });
});

describe("web/rosterAttendance — attendanceForAccounts (per Discord account)", () => {
    const acc = (userId, chars) => ({ userId, chars });
    const ch = (name, className, manual = false) => ({ name, className, manual });

    beforeEach(() => {
        jest.clearAllMocks();
        mockListRaidEvents.mockReturnValue([event("e1", 7), event("e2", 14)]);
    });

    it("counts a night when any character of the account stands in the log — a twink night is not an absence", () => {
        withReports([
            { id: "r1", eventId: "e1", names: ["Mainchar"] },
            { id: "r2", eventId: "e2", names: ["Twink"] },
        ]);
        const ctx = buildAttendanceContext("g1", { now: NOW });
        const out = attendanceForAccounts(ctx, "cat1", [acc("u1", [ch("Mainchar", "Druid", true), ch("Twink", "Mage", true)])]);
        expect(out.get("u1")).toMatchObject({ attended: 2, total: 2, pct: 100, link: "manual", inferred: 0, missed: [] });
    });

    it("badges the link \"auto\" while only signup characters stand behind it", () => {
        withReports([{ id: "r1", eventId: "e1", names: ["Mainchar"] }, { id: "r2", eventId: "e2", names: ["Mainchar"] }]);
        const ctx = buildAttendanceContext("g1", { now: NOW });
        const out = attendanceForAccounts(ctx, "cat1", [acc("u1", [ch("Mainchar", "Druid", false)])]);
        expect(out.get("u1")).toMatchObject({ pct: 100, link: "auto" });
    });

    it("explains a missed night by class when an unclaimed log player of that class was there — and says so (auto)", () => {
        withReports([
            { id: "r1", eventId: "e1", names: ["Mainchar", "Stranger"], classes: { Mainchar: "Druid", Stranger: "Mage" } },
            { id: "r2", eventId: "e2", names: ["Mainchar"], classes: { Mainchar: "Druid" } },
        ]);
        const ctx = buildAttendanceContext("g1", { now: NOW });
        const out = attendanceForAccounts(ctx, "cat1", [
            acc("u1", [ch("Mainchar", "Druid", true)]),
            acc("u2", [ch("Elsewhere", "Mage", true)]),
        ]);
        // u2 was not seen by name, but an unclaimed mage stood in the first night's log; the second night has none
        expect(out.get("u2")).toMatchObject({ attended: 1, total: 2, pct: 50, inferred: 1, link: "auto" });
        expect(out.get("u2").missed).toEqual([{ eventId: "e2", title: "Raid e2", startTime: NOW - 14 * DAY, reason: "nicht im Log" }]);
        expect(out.get("u1")).toMatchObject({ pct: 100, inferred: 0, link: "manual" });
    });

    it("does not guess when more accounts of a class are missing than unclaimed players of it", () => {
        withReports([{ id: "r1", eventId: "e1", names: ["Stranger"], classes: { Stranger: "Mage" } }, { id: "r2", eventId: "e2", names: ["Stranger"], classes: { Stranger: "Mage" } }]);
        const ctx = buildAttendanceContext("g1", { now: NOW });
        const out = attendanceForAccounts(ctx, "cat1", [acc("a", [ch("A", "Mage", true)]), acc("b", [ch("B", "Mage", true)])]);
        expect(out.get("a")).toMatchObject({ attended: 0, inferred: 0 });
        expect(out.get("b")).toMatchObject({ attended: 0, inferred: 0 });
    });

    it("never guesses over a signed-off night (the reason stays)", () => {
        mockListRaidEvents.mockReturnValue([event("e1", 7, { signUps: [{ userId: "u1", status: "absence" }] })]);
        withReports([{ id: "r1", eventId: "e1", names: ["Stranger"], classes: { Stranger: "Mage" } }]);
        const ctx = buildAttendanceContext("g1", { now: NOW });
        const out = attendanceForAccounts(ctx, "cat1", [acc("u1", [ch("Mage1", "Mage", true)])]);
        expect(out.get("u1")).toMatchObject({ attended: 0, total: 1 });
        expect(out.get("u1").missed[0].reason).toBe("abgemeldet");
    });

    it("gives null instead of a percentage while no raid is countable, and skips accounts without characters", () => {
        mockListRaidEvents.mockReturnValue([]);
        const ctx = buildAttendanceContext("g1", { now: NOW });
        const out = attendanceForAccounts(ctx, "cat1", [acc("u1", [ch("Anna", "Priest", true)]), acc("u2", [])]);
        expect(out.get("u1")).toMatchObject({ total: 0, pct: null });
        expect(out.has("u2")).toBe(false);
    });
});
