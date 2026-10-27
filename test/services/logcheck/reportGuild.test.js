const { reportGuild, reportGuildResolver, reportsOfGuild } = require("../../../src/services/logcheck/reportGuild");

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
