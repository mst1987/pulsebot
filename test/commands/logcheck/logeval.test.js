jest.mock("../../../src/web/logChannel.js");
jest.mock("../../../src/web/discord.js");
jest.mock("../../../src/web/logStore.js");
jest.mock("../../../src/utils/logcheck/report.js", () => ({
    reportSummaryLines: jest.fn(() => ["👥 Raider: **25**"]),
}));

const command = require("../../../src/commands/logcheck/logeval.js");
const { evaluateLog } = require("../../../src/web/logChannel.js");
const { reportSummaryLines } = require("../../../src/utils/logcheck/report.js");
const logStore = require("../../../src/web/logStore.js");
const discord = require("../../../src/web/discord.js");
const { mockInteraction } = require("../../helpers/mockInteraction.js");

beforeEach(() => {
    jest.clearAllMocks();
    discord.finishLogButton.mockResolvedValue(true);
    logStore.evaluatedSections.mockReturnValue(["cla"]);
    reportSummaryLines.mockReturnValue(["👥 Raider: **25**"]);
});

describe("commands/logcheck/logeval", () => {
    it("exports the button contract with the routing name", () => {
        expect(command.name).toBe("logcheck-eval");
        expect(typeof command.execute).toBe("function");
    });

    it("evaluates the CLA half, updates the button message and replies with the url", async () => {
        evaluateLog.mockResolvedValue({
            ok: true,
            id: "abc123",
            url: "https://host/r/abc123",
            report: { title: "SSC + TK" },
            log: { id: "log1", buttonChannelId: "logch", buttonMessageId: "btn1" },
            section: "cla",
        });
        const interaction = mockInteraction({ customId: "logcheck-eval:log1:cla" });

        await command.execute(interaction);

        expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
        expect(evaluateLog).toHaveBeenCalledWith("log1", "cla");
        expect(discord.finishLogButton).toHaveBeenCalledWith("logch", "btn1", {
            reportUrl: "https://host/r/abc123",
            title: "SSC + TK",
            logId: "log1",
            doneSections: ["cla"],
        });
        const arg = interaction.editReply.mock.calls[0][0];
        expect(arg.content).toContain("CLA");
        expect(arg.content).toContain("https://host/r/abc123");
    });

    it("routes the RPB button to the RPB half", async () => {
        evaluateLog.mockResolvedValue({
            ok: true, id: "a", url: "/r/a", report: { title: "T" },
            log: { id: "log1" }, section: "rpb",
        });
        logStore.evaluatedSections.mockReturnValue(["cla", "rpb"]);
        const interaction = mockInteraction({ customId: "logcheck-eval:log1:rpb" });

        await command.execute(interaction);

        expect(evaluateLog).toHaveBeenCalledWith("log1", "rpb");
        expect(reportSummaryLines).toHaveBeenCalledWith({ title: "T" }, "rpb");
        expect(interaction.editReply.mock.calls[0][0].content).toContain("RPB");
    });

    it("treats a legacy button without a section as CLA", async () => {
        evaluateLog.mockResolvedValue({
            ok: true, id: "a", url: "/r/a", report: { title: "T" }, log: {}, section: "cla",
        });
        const interaction = mockInteraction({ customId: "logcheck-eval:log1" });

        await command.execute(interaction);

        expect(evaluateLog).toHaveBeenCalledWith("log1", "cla");
    });

    it("includes the summary lines of the evaluated half in the reply", async () => {
        evaluateLog.mockResolvedValue({
            ok: true, id: "a", url: "/r/a", report: { title: "T" }, log: {}, section: "rpb",
        });
        reportSummaryLines.mockReturnValue(["💀 Tode: **40**", "🛑 Unterbrechungen: 9 Spieler"]);
        const interaction = mockInteraction({ customId: "logcheck-eval:log1:rpb" });

        await command.execute(interaction);

        const arg = interaction.editReply.mock.calls[0][0];
        expect(arg.content).toContain("💀 Tode: **40**");
        expect(arg.content).toContain("🛑 Unterbrechungen: 9 Spieler");
    });

    it("does not fail evaluation on a missing tracked button (uses interaction fallback)", async () => {
        evaluateLog.mockResolvedValue({
            ok: true, id: "abc", url: "/r/abc", report: { title: "Kara" }, log: {}, section: "cla",
        });
        const interaction = mockInteraction({ customId: "logcheck-eval:log1:cla" });
        interaction.channelId = "chan9";
        interaction.message = { id: "btnX" };

        await command.execute(interaction);

        expect(discord.finishLogButton).toHaveBeenCalledWith("chan9", "btnX", expect.any(Object));
        expect(interaction.editReply).toHaveBeenCalled();
    });

    it("surfaces the error (with existing url) when evaluation is refused", async () => {
        evaluateLog.mockResolvedValue({ ok: false, already: true, error: "Bereits ausgewertet.", url: "/r/old" });
        const interaction = mockInteraction({ customId: "logcheck-eval:log1:cla" });

        await command.execute(interaction);

        expect(discord.finishLogButton).not.toHaveBeenCalled();
        const arg = interaction.editReply.mock.calls[0][0];
        expect(arg.content).toContain("Bereits ausgewertet.");
        expect(arg.content).toContain("/r/old");
    });
});
