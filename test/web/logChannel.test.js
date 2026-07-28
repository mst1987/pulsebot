jest.mock("../../src/web/settingsStore.js");
jest.mock("../../src/web/logStore.js");
jest.mock("../../src/web/discord.js");
jest.mock("../../src/utils/logcheck/report.js", () => {
    class ReportError extends Error {}
    return { buildReport: jest.fn(), ReportError };
});
const mockGetFights = jest.fn();
jest.mock("../../src/classes/warcraftlogs.js", () =>
    jest.fn().mockImplementation(() => ({ getFights: mockGetFights })));

const WarcraftLogs = require("../../src/classes/warcraftlogs.js");
const { getConfig } = require("../../src/web/settingsStore.js");
const logStore = require("../../src/web/logStore.js");
const discord = require("../../src/web/discord.js");
const { buildReport, ReportError } = require("../../src/utils/logcheck/report.js");
const { handleLogMessage, evaluateLog, scanLogChannels, backfillLogTitles, messageText } = require("../../src/web/logChannel.js");

const CLIENT = { user: { id: "botself" } };

function msg(over = {}) {
    return {
        author: { id: "someuser" },
        guildId: "g1",
        channelId: "logch",
        id: "m1",
        createdTimestamp: 111000,
        content: "",
        embeds: [],
        components: [],
        reply: jest.fn(),
        ...over,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    discord.getClient.mockReturnValue(CLIENT);
    getConfig.mockReturnValue({ logChannelIds: ["logch"] });
    logStore.getByReportId.mockReturnValue(null);
    // the real saveLog dedups by reportId and keeps the existing entry's state,
    // so a refresh of an already-evaluated log carries its sections along
    logStore.saveLog.mockImplementation((d) => {
        const existing = logStore.getByReportId(d.reportId);
        return { id: "log1", status: "open", ...(existing || {}), ...d };
    });
    logStore.setButtonMessage.mockReturnValue(null);
    // mirror the real implementation: explicit sections win, a legacy "done" log
    // counts as having had its CLA half evaluated
    logStore.evaluatedSections.mockImplementation((log) => {
        if (!log) return [];
        if (Array.isArray(log.sections) && log.sections.length) return log.sections;
        return log.status === "done" ? ["cla"] : [];
    });
    discord.postLogButton.mockResolvedValue({ channelId: "logch", messageId: "btn1" });
});

describe("web/logChannel — messageText", () => {
    it("gathers text from content, embeds and link buttons", () => {
        const text = messageText(msg({
            content: "hi https://classic.warcraftlogs.com/reports/AAA",
            embeds: [{ url: "https://fresh.warcraftlogs.com/reports/BBB", title: "T", description: "D", fields: [{ name: "n", value: "v" }] }],
            components: [{ components: [{ url: "https://classic.warcraftlogs.com/reports/CCC" }] }],
        }));
        expect(text).toContain("AAA");
        expect(text).toContain("BBB");
        expect(text).toContain("CCC");
        expect(text).toContain("v");
    });
});

describe("web/logChannel — handleLogMessage", () => {
    it("registers a fresh log and posts the evaluate buttons", async () => {
        await handleLogMessage(msg({ content: "log https://classic.warcraftlogs.com/reports/RPT1" }));
        expect(logStore.saveLog).toHaveBeenCalledWith(expect.objectContaining({ reportId: "RPT1", channelId: "logch", source: "listener", postedAt: 111000 }));
        expect(discord.postLogButton).toHaveBeenCalledWith(expect.any(Object), { logId: "log1", doneSections: [] });
        expect(logStore.setButtonMessage).toHaveBeenCalledWith("log1", { channelId: "logch", messageId: "btn1" });
    });

    it("ignores messages outside the configured log channels", async () => {
        await handleLogMessage(msg({ channelId: "other", content: "https://classic.warcraftlogs.com/reports/RPT1" }));
        expect(logStore.saveLog).not.toHaveBeenCalled();
        expect(discord.postLogButton).not.toHaveBeenCalled();
    });

    it("ignores the bot's own messages", async () => {
        await handleLogMessage(msg({ author: { id: "botself" }, content: "https://classic.warcraftlogs.com/reports/RPT1" }));
        expect(logStore.saveLog).not.toHaveBeenCalled();
    });

    it("still offers the RPB button for a report whose CLA already ran", async () => {
        logStore.getByReportId.mockReturnValue({ id: "log1", status: "done", sections: ["cla"] });
        await handleLogMessage(msg({ content: "https://classic.warcraftlogs.com/reports/RPT1" }));
        expect(logStore.saveLog).toHaveBeenCalled();
        expect(discord.postLogButton).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ doneSections: ["cla"] }));
    });

    it("does not re-post once both analyses are done", async () => {
        logStore.getByReportId.mockReturnValue({ id: "log1", status: "done", sections: ["cla", "rpb"] });
        await handleLogMessage(msg({ content: "https://classic.warcraftlogs.com/reports/RPT1" }));
        expect(logStore.saveLog).not.toHaveBeenCalled();
        expect(discord.postLogButton).not.toHaveBeenCalled();
    });

    it("does not re-post when a live button already exists", async () => {
        logStore.getByReportId.mockReturnValue({ id: "log1", status: "open", buttonMessageId: "btn0" });
        await handleLogMessage(msg({ content: "https://classic.warcraftlogs.com/reports/RPT1" }));
        expect(logStore.saveLog).not.toHaveBeenCalled();
        expect(discord.postLogButton).not.toHaveBeenCalled();
    });

    it("does nothing when there is no message link", async () => {
        await handleLogMessage(msg({ content: "just chatting" }));
        expect(logStore.saveLog).not.toHaveBeenCalled();
    });

    it("survives a failing postLogButton without throwing", async () => {
        discord.postLogButton.mockRejectedValue(new Error("discord down"));
        await expect(handleLogMessage(msg({ content: "https://classic.warcraftlogs.com/reports/RPT1" }))).resolves.toBeUndefined();
        expect(logStore.saveLog).toHaveBeenCalled();
    });
});

describe("web/logChannel — evaluateLog", () => {
    it("returns an error for an unknown log", async () => {
        logStore.getLog.mockReturnValue(null);
        const res = await evaluateLog("missing");
        expect(res.ok).toBe(false);
        expect(buildReport).not.toHaveBeenCalled();
    });

    it("refuses to run the same half twice and surfaces the existing url", async () => {
        logStore.getLog.mockReturnValue({ id: "l1", status: "done", sections: ["cla"], reportUrl: "/r/xy" });
        const res = await evaluateLog("l1", "cla");
        expect(res).toMatchObject({ ok: false, already: true, url: "/r/xy" });
        expect(res.error).toContain("CLA");
        expect(buildReport).not.toHaveBeenCalled();
    });

    it("still runs the RPB half when only the CLA half is done", async () => {
        logStore.getLog.mockReturnValue({ id: "l1", status: "done", sections: ["cla"], reportRefId: "abc123", link: "x" });
        logStore.markEvaluated.mockReturnValue({ id: "l1", sections: ["cla", "rpb"] });
        buildReport.mockResolvedValue({ id: "abc123", url: "/r/abc123", report: { title: "T", zone: "Z" } });

        const res = await evaluateLog("l1", "rpb");
        expect(res).toMatchObject({ ok: true, section: "rpb" });
        // merges into the page the CLA run created rather than making a second one
        expect(buildReport).toHaveBeenCalledWith("x", { sections: ["rpb"], mergeIntoId: "abc123" });
    });

    it("builds, marks evaluated and returns the url on success", async () => {
        logStore.getLog.mockReturnValue({ id: "l1", status: "open", link: "https://classic.warcraftlogs.com/reports/RPT1" });
        logStore.markEvaluated.mockReturnValue({ id: "l1", status: "done", sections: ["cla"], buttonMessageId: "btn1" });
        buildReport.mockResolvedValue({ id: "abc123", url: "/r/abc123", report: { title: "SSC + TK", zone: "SSC" } });

        const res = await evaluateLog("l1");
        expect(buildReport).toHaveBeenCalledWith(
            "https://classic.warcraftlogs.com/reports/RPT1",
            { sections: ["cla"], mergeIntoId: undefined },
        );
        expect(logStore.markEvaluated).toHaveBeenCalledWith("l1", expect.objectContaining({
            reportRefId: "abc123", reportUrl: "/r/abc123", title: "SSC + TK", sections: ["cla"],
        }));
        expect(res).toMatchObject({ ok: true, id: "abc123", url: "/r/abc123", section: "cla" });
    });

    it("defaults to the CLA half when no section is given", async () => {
        logStore.getLog.mockReturnValue({ id: "l1", status: "open", link: "x" });
        logStore.markEvaluated.mockReturnValue({ id: "l1", sections: ["cla"] });
        buildReport.mockResolvedValue({ id: "a", url: "/r/a", report: { title: "T" } });
        const res = await evaluateLog("l1");
        expect(res.section).toBe("cla");
    });

    it("surfaces a ReportError message and does not mark evaluated", async () => {
        logStore.getLog.mockReturnValue({ id: "l1", status: "open", link: "x" });
        buildReport.mockRejectedValue(new ReportError("Report ist privat."));
        const res = await evaluateLog("l1");
        expect(res).toMatchObject({ ok: false, error: "Report ist privat." });
        expect(logStore.markEvaluated).not.toHaveBeenCalled();
    });
});

describe("web/logChannel — scanLogChannels", () => {
    it("returns 0 when the bot client is not connected", async () => {
        discord.getClient.mockReturnValue(null);
        expect(await scanLogChannels("g1")).toBe(0);
    });

    it("registers new logs found in the configured channels", async () => {
        const messages = new Map([
            ["m1", { content: "https://classic.warcraftlogs.com/reports/RPT1", embeds: [], components: [], createdTimestamp: 222000 }],
        ]);
        const channel = {
            isTextBased: () => true,
            guildId: "g1",
            id: "logch",
            messages: { fetch: jest.fn().mockResolvedValue(messages) },
        };
        discord.getClient.mockReturnValue({ ...CLIENT, channels: { fetch: jest.fn().mockResolvedValue(channel) } });
        logStore.getByReportId.mockReturnValue(null);

        const count = await scanLogChannels("g1");
        expect(count).toBe(1);
        expect(logStore.saveLog).toHaveBeenCalledWith(expect.objectContaining({ reportId: "RPT1", source: "scan", postedAt: 222000 }));
    });
});

describe("web/logChannel — backfillLogTitles", () => {
    const OLD_KEY = process.env.WARCRAFTLOGS_API_KEY;
    beforeEach(() => {
        process.env.WARCRAFTLOGS_API_KEY = "wcl-key";
        mockGetFights.mockReset();
        WarcraftLogs.mockImplementation(() => ({ getFights: mockGetFights }));
    });
    afterEach(() => {
        if (OLD_KEY === undefined) delete process.env.WARCRAFTLOGS_API_KEY;
        else process.env.WARCRAFTLOGS_API_KEY = OLD_KEY;
    });

    it("fills the WCL report name into logs missing a title and persists it", async () => {
        mockGetFights.mockResolvedValue({ title: "  Karazhan 24/07 ", zoneName: "Karazhan" });
        const logs = [
            { id: "l1", reportId: "AAA" },
            { id: "l2", reportId: "BBB", title: "Kept" }, // already has a title → skipped
        ];
        const filled = await backfillLogTitles(logs);
        expect(filled).toBe(1);
        expect(logs[0].title).toBe("Karazhan 24/07");           // mutated in place
        expect(logStore.setLogTitle).toHaveBeenCalledWith("l1", "Karazhan 24/07");
        expect(mockGetFights).toHaveBeenCalledTimes(1);          // only the untitled one
        expect(logs[1].title).toBe("Kept");
    });

    it("is a no-op without any untitled logs", async () => {
        expect(await backfillLogTitles([{ id: "x", reportId: "Y", title: "T" }])).toBe(0);
        expect(mockGetFights).not.toHaveBeenCalled();
    });

    it("skips silently when the WCL API key is missing", async () => {
        delete process.env.WARCRAFTLOGS_API_KEY;
        WarcraftLogs.mockImplementationOnce(() => { throw new Error("WARCRAFTLOGS_API_KEY is not set"); });
        expect(await backfillLogTitles([{ id: "l1", reportId: "AAA" }])).toBe(0);
        expect(logStore.setLogTitle).not.toHaveBeenCalled();
    });

    it("tolerates a failed/empty WCL response (keeps the code, no crash)", async () => {
        mockGetFights.mockRejectedValueOnce(new Error("404"));
        mockGetFights.mockResolvedValueOnce({ title: "" });
        const logs = [{ id: "l1", reportId: "AAA" }, { id: "l2", reportId: "BBB" }];
        expect(await backfillLogTitles(logs)).toBe(0);
        expect(logStore.setLogTitle).not.toHaveBeenCalled();
        expect(logs[0].title).toBeUndefined();
    });
});
