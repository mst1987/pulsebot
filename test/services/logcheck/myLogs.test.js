// "Nur meine Raids": the stores are stand-ins, the name matching
// (nameKey, charactersOfVersion) is the real one.
jest.mock("../../../src/stores/roster/raiderProfileStore", () => ({
    ...jest.requireActual("../../../src/stores/roster/raiderProfileStore"),
    getProfile: jest.fn(() => null),
}));
jest.mock("../../../src/stores/roster/raiderCharactersStore", () => ({
    charactersForUser: jest.fn(() => []),
}));
jest.mock("../../../src/stores/loot/reportStore", () => ({
    getReportRoster: jest.fn(() => null),
}));
jest.mock("../../../src/stores/events/eventStore", () => ({
    isOwnEventId: (id) => String(id || "").startsWith("eh-"),
    getEvent: jest.fn(() => null),
}));
jest.mock("../../../src/stores/events/signupStore", () => ({
    getSignup: jest.fn(() => null),
}));
jest.mock("../../../src/stores/events/raidEventStore", () => ({
    getRaidEvent: jest.fn(() => null),
}));

const profiles = require("../../../src/stores/roster/raiderProfileStore");
const { charactersForUser } = require("../../../src/stores/roster/raiderCharactersStore");
const { getReportRoster } = require("../../../src/stores/loot/reportStore");
const eventStore = require("../../../src/stores/events/eventStore");
const { getSignup } = require("../../../src/stores/events/signupStore");
const { getRaidEvent } = require("../../../src/stores/events/raidEventStore");
const { mineFilter, reportNameKeys, attendedEvent } = require("../../../src/services/logcheck/myLogs");

const approvedSetup = (placed, bench = []) => ({
    approved: { groups: [{ slots: placed.map((userId) => ({ userId })) }], bench: bench.map((userId) => ({ userId })) },
});

const REPORTS = {
    aaa111: { roster: [{ name: "Devi", type: "Priest" }, { name: "Grom-Thunderstrike", type: "Warrior" }] },
    bbb222: { roster: [], players: [{ name: "Altchar" }] },
    ccc333: { roster: [{ name: "Fremder" }] },
};
const row = (reportId, versionId = "tbc") => ({ id: `log-${reportId}`, versionId, report: reportId ? { id: reportId } : null });

describe("services/logcheck/myLogs", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getReportRoster.mockImplementation((id) => REPORTS[id] || null);
        profiles.getProfile.mockReturnValue(null);
        charactersForUser.mockReturnValue([]);
        eventStore.getEvent.mockReturnValue(null);
        getSignup.mockReturnValue(null);
        getRaidEvent.mockReturnValue(null);
    });

    describe("attendedEvent", () => {
        it("own event with an approved setup: placed in a group counts, the bench does not", () => {
            eventStore.getEvent.mockReturnValue({ id: "eh-1", setup: approvedSetup(["u1"], ["u2"]) });
            getSignup.mockReturnValue({ userId: "u2", status: "signed" });
            expect(attendedEvent("eh-1", "u1")).toBe(true);
            expect(attendedEvent("eh-1", "u2")).toBe(false);
        });

        it("own event with an approved setup: a placed tentative counts", () => {
            eventStore.getEvent.mockReturnValue({ id: "eh-1", setup: approvedSetup(["u1"]) });
            getSignup.mockReturnValue({ userId: "u1", status: "tentative" });
            expect(attendedEvent("eh-1", "u1")).toBe(true);
        });

        it("own event with a multi-raid approved setup: placed in a further raid counts", () => {
            eventStore.getEvent.mockReturnValue({ id: "eh-1", setup: { approved: { groups: [], events: [{ groups: [{ slots: [{ userId: "u1" }] }] }] } } });
            expect(attendedEvent("eh-1", "u1")).toBe(true);
        });

        it.each([
            ["signed", true], ["late", true], ["tentative", false], ["bench", false], ["absence", false],
        ])("own event without an approved setup: status %s -> %s", (status, expected) => {
            eventStore.getEvent.mockReturnValue({ id: "eh-1", setup: { groups: [{ slots: [{ userId: "u1" }] }] } });
            getSignup.mockReturnValue({ userId: "u1", status });
            expect(attendedEvent("eh-1", "u1")).toBe(expected);
        });

        it("a further raid of a raid group reads the signup of its first raid", () => {
            eventStore.getEvent.mockReturnValue({ id: "eh-2", raidGroupId: "eh-1" });
            getSignup.mockImplementation((eventId) => (eventId === "eh-1" ? { userId: "u1", status: "signed" } : null));
            expect(attendedEvent("eh-2", "u1")).toBe(true);
            expect(getSignup).toHaveBeenCalledWith("eh-1", "u1");
        });

        it.each([
            ["signed", true], ["late", true], ["tentative", false], ["bench", false], ["absence", false],
        ])("Raid-Helper event: snapshot status %s -> %s", (status, expected) => {
            getRaidEvent.mockReturnValue({ id: "123", signUps: [{ userId: "u2", status: "signed" }, { userId: "u1", status }] });
            expect(attendedEvent("123", "u1")).toBe(expected);
        });

        it("is false without a signup, an unknown event or no ids", () => {
            getRaidEvent.mockReturnValue({ id: "123", signUps: [{ userId: "u2", status: "signed" }] });
            expect(attendedEvent("123", "u1")).toBe(false);
            expect(attendedEvent("eh-9", "u1")).toBe(false);
            expect(attendedEvent("", "u1")).toBe(false);
            expect(attendedEvent("123", "")).toBe(false);
        });
    });

    describe("reportNameKeys", () => {
        it("reads the roster and the legacy players, realm dropped", () => {
            expect([...reportNameKeys("aaa111")]).toEqual(["devi", "grom"]);
            expect([...reportNameKeys("bbb222")]).toEqual(["altchar"]);
        });

        it("is empty for a missing report or no id", () => {
            expect(reportNameKeys("fff999").size).toBe(0);
            expect(reportNameKeys("").size).toBe(0);
        });
    });

    describe("mineFilter", () => {
        it("matches a row whose report lists a profile character of the row's version", () => {
            profiles.getProfile.mockReturnValue({ characters: [{ key: "grom", name: "Grom", versionId: "tbc" }] });
            const mine = mineFilter("u1");
            expect(mine(row("aaa111"))).toBe(true);
            expect(mine(row("ccc333"))).toBe(false);
        });

        it("ignores a profile character of another version", () => {
            profiles.getProfile.mockReturnValue({ characters: [{ key: "forever~devi", name: "Devi", versionId: "forever" }] });
            const mine = mineFilter("u1");
            expect(mine(row("aaa111", "tbc"))).toBe(false);
            expect(mine(row("aaa111", "forever"))).toBe(true);
        });

        it("counts the characters the categories assign to the account, case-insensitive", () => {
            charactersForUser.mockReturnValue([{ character: "ALTCHAR", categoryIds: ["c1"] }]);
            expect(mineFilter("u1")(row("bbb222"))).toBe(true);
        });

        it("never matches a row without a report (a log that was not evaluated)", () => {
            charactersForUser.mockReturnValue([{ character: "Devi", categoryIds: ["c1"] }]);
            expect(mineFilter("u1")(row(null))).toBe(false);
        });

        it("matches nothing for an account without characters or without an id", () => {
            expect(mineFilter("u1")(row("aaa111"))).toBe(false);
            expect(mineFilter("")(row("aaa111"))).toBe(false);
            expect(profiles.getProfile).not.toHaveBeenCalledWith("");
        });

        it("matches a row through its raid event without characters or a report", () => {
            getRaidEvent.mockReturnValue({ id: "123", signUps: [{ userId: "u1", status: "late" }] });
            const mine = mineFilter("u1");
            expect(mine({ ...row(null), eventId: "123" })).toBe(true);
            expect(mine({ ...row(null), eventId: "" })).toBe(false);
        });

        it("matches a row through the report even when the raid event says no", () => {
            charactersForUser.mockReturnValue([{ character: "Devi", categoryIds: ["c1"] }]);
            getRaidEvent.mockReturnValue({ id: "123", signUps: [{ userId: "u1", status: "absence" }] });
            expect(mineFilter("u1")({ ...row("aaa111"), eventId: "123" })).toBe(true);
            expect(mineFilter("u1")({ ...row("ccc333"), eventId: "123" })).toBe(false);
        });

        it("reads each raid event once per filter", () => {
            const mine = mineFilter("u1");
            mine({ ...row(null), eventId: "123" });
            mine({ ...row(null), eventId: "123" });
            expect(getRaidEvent).toHaveBeenCalledTimes(1);
        });

        it("reads each report once per filter", () => {
            charactersForUser.mockReturnValue([{ character: "Fremder", categoryIds: ["c1"] }]);
            const mine = mineFilter("u1");
            mine(row("ccc333"));
            mine(row("ccc333"));
            expect(getReportRoster).toHaveBeenCalledTimes(1);
        });
    });
});
