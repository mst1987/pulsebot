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

const profiles = require("../../../src/stores/roster/raiderProfileStore");
const { charactersForUser } = require("../../../src/stores/roster/raiderCharactersStore");
const { getReportRoster } = require("../../../src/stores/loot/reportStore");
const { mineFilter, reportNameKeys } = require("../../../src/services/logcheck/myLogs");

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

        it("reads each report once per filter", () => {
            charactersForUser.mockReturnValue([{ character: "Fremder", categoryIds: ["c1"] }]);
            const mine = mineFilter("u1");
            mine(row("ccc333"));
            mine(row("ccc333"));
            expect(getReportRoster).toHaveBeenCalledTimes(1);
        });
    });
});
