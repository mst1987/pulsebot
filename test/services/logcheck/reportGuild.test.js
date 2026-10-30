jest.mock("../../../src/stores/loot/logStore", () => ({ getLog: jest.fn(), deleteLog: jest.fn(() => true), listLogs: jest.fn(() => []) }));
jest.mock("../../../src/stores/loot/reportStore", () => ({ setReportGuild: jest.fn(() => true), listReports: jest.fn(() => []) }));

const logStore = require("../../../src/stores/loot/logStore");
const reportStore = require("../../../src/stores/loot/reportStore");
const { reportGuild, reportGuildResolver, reportsOfGuild, deleteLogKeepingReportGuild } = require("../../../src/services/logcheck/reportGuild");

describe("services/logcheck/reportGuild (#920)", () => {
    const logs = [
        { id: "l1", reportRefId: "r1", guildId: "A" },
        { id: "l2", reportRefId: "r2", guildId: "B" },
        { id: "l3", guildId: "A" }, // never evaluated
    ];

    test("a report with a log belongs to the log's server, whatever it carries itself", () => {
        expect(reportGuild({ id: "r1", guildId: "B" }, logs)).toBe("A");
        expect(reportGuild({ id: "r2" }, logs)).toBe("B");
    });

    test("a report without a log keeps its own server", () => {
        expect(reportGuild({ id: "x", guildId: "B" }, logs)).toBe("B");
        expect(reportGuild({ id: "x" }, logs)).toBe("");
        expect(reportGuild(null, logs)).toBe("");
        expect(reportGuildResolver(undefined)({ id: "x", guildId: "C" })).toBe("C");
    });

    test("a log moved to another server takes its report along", () => {
        expect(reportGuild({ id: "r1", guildId: "A" }, [{ reportRefId: "r1", guildId: "B" }])).toBe("B");
    });

    test("a log without a server leaves the report its own server", () => {
        expect(reportGuild({ id: "r1", guildId: "B" }, [{ reportRefId: "r1", guildId: "" }])).toBe("B");
        expect(reportGuild({ id: "r1" }, [{ reportRefId: "r1" }])).toBe("");
    });

    test("reportsOfGuild keeps one server's reports only", () => {
        const reports = [{ id: "r1" }, { id: "r2" }, { id: "x", guildId: "A" }, { id: "y", guildId: "B" }, { id: "z" }];
        expect(reportsOfGuild(reports, "A", logs).map((r) => r.id)).toEqual(["r1", "x"]);
        expect(reportsOfGuild(reports, "B", logs).map((r) => r.id)).toEqual(["r2", "y"]);
    });

    test("without a server there are no reports", () => {
        expect(reportsOfGuild([{ id: "x", guildId: "A" }], "", logs)).toEqual([]);
        expect(reportsOfGuild([{ id: "x", guildId: "" }], "", logs)).toEqual([]);
        expect(reportsOfGuild(undefined, "A", logs)).toEqual([]);
    });
});

describe("services/logcheck/reportGuild deleteLogKeepingReportGuild (#920)", () => {
    beforeEach(() => jest.clearAllMocks());

    test("writes the log's server onto its report before deleting the log", () => {
        logStore.getLog.mockReturnValue({ id: "l1", reportRefId: "abc111", guildId: "B" });
        expect(deleteLogKeepingReportGuild(" l1 ")).toBe(true);
        expect(reportStore.setReportGuild).toHaveBeenCalledWith("abc111", "B");
        expect(logStore.deleteLog).toHaveBeenCalledWith("l1");
        expect(reportStore.setReportGuild.mock.invocationCallOrder[0]).toBeLessThan(logStore.deleteLog.mock.invocationCallOrder[0]);
    });

    test("a log without a report or without a server is only deleted", () => {
        logStore.getLog
            .mockReturnValueOnce({ id: "l2", guildId: "B" })
            .mockReturnValueOnce({ id: "l3", reportRefId: "abc111" })
            .mockReturnValueOnce(null);
        deleteLogKeepingReportGuild("l2");
        deleteLogKeepingReportGuild("l3");
        deleteLogKeepingReportGuild("nope");
        expect(reportStore.setReportGuild).not.toHaveBeenCalled();
        expect(logStore.deleteLog).toHaveBeenCalledTimes(3);
    });
});
