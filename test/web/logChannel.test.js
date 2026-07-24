jest.mock("../../src/web/settingsStore.js");
jest.mock("../../src/web/logStore.js");
jest.mock("../../src/web/discord.js");
jest.mock("../../src/utils/logcheck/report.js", () => {
    class ReportError extends Error {}
    return { buildReport: jest.fn(), ReportError };
});

const { getConfig } = require("../../src/web/settingsStore.js");
const logStore = require("../../src/web/logStore.js");
const discord = require("../../src/web/discord.js");
const { buildReport, ReportError } = require("../../src/utils/logcheck/report.js");
const { handleLogMessage, evaluateLog, scanLogChannels, messageText } = require("../../src/web/logChannel.js");

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
    logStore.saveLog.mockImplementation((d) => ({ id: "log1", status: "open", ...d }));
    logStore.setButtonMessage.mockReturnValue(null);
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
    it("registers a fresh log and posts an evaluate button", async () => {
        await handleLogMessage(msg({ content: "log https://classic.warcraftlogs.com/reports/RPT1" }));
        expect(logStore.saveLog).toHaveBeenCalledWith(expect.objectContaining({ reportId: "RPT1", channelId: "logch", source: "listener", postedAt: 111000 }));
        expect(discord.postLogButton).toHaveBeenCalledWith(expect.any(Object), { logId: "log1" });
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

    it("does not re-post for an already-evaluated report", async () => {
        logStore.getByReportId.mockReturnValue({ id: "log1", status: "done" });
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

    it("refuses to evaluate a done log and surfaces the existing url", async () => {
        logStore.getLog.mockReturnValue({ id: "l1", status: "done", reportUrl: "/r/xy" });
        const res = await evaluateLog("l1");
        expect(res).toMatchObject({ ok: false, already: true, url: "/r/xy" });
        expect(buildReport).not.toHaveBeenCalled();
    });

    it("builds, marks evaluated and returns the url on success", async () => {
        logStore.getLog.mockReturnValue({ id: "l1", status: "open", link: "https://classic.warcraftlogs.com/reports/RPT1" });
        logStore.markEvaluated.mockReturnValue({ id: "l1", status: "done", buttonMessageId: "btn1" });
        buildReport.mockResolvedValue({ id: "abc123", url: "/r/abc123", report: { title: "SSC + TK", zone: "SSC" } });

        const res = await evaluateLog("l1");
        expect(buildReport).toHaveBeenCalledWith("https://classic.warcraftlogs.com/reports/RPT1");
        expect(logStore.markEvaluated).toHaveBeenCalledWith("l1", expect.objectContaining({ reportRefId: "abc123", reportUrl: "/r/abc123", title: "SSC + TK" }));
        expect(res).toMatchObject({ ok: true, id: "abc123", url: "/r/abc123" });
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
