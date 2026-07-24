jest.mock("../../../src/web/logChannel.js");
jest.mock("../../../src/web/discord.js");

const command = require("../../../src/commands/logcheck/logeval.js");
const { evaluateLog } = require("../../../src/web/logChannel.js");
const discord = require("../../../src/web/discord.js");
const { mockInteraction } = require("../../helpers/mockInteraction.js");

beforeEach(() => {
    jest.clearAllMocks();
    discord.finishLogButton.mockResolvedValue(true);
});

describe("commands/logcheck/logeval", () => {
    it("exports the button contract with the routing name", () => {
        expect(command.name).toBe("logcheck-eval");
        expect(typeof command.execute).toBe("function");
    });

    it("evaluates the log, updates the button message and replies with the url", async () => {
        evaluateLog.mockResolvedValue({
            ok: true,
            id: "abc123",
            url: "https://host/r/abc123",
            report: { title: "SSC + TK" },
            log: { buttonChannelId: "logch", buttonMessageId: "btn1" },
        });
        const interaction = mockInteraction({ customId: "logcheck-eval:log1" });

        await command.execute(interaction);

        expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
        expect(evaluateLog).toHaveBeenCalledWith("log1");
        expect(discord.finishLogButton).toHaveBeenCalledWith("logch", "btn1", {
            reportUrl: "https://host/r/abc123",
            title: "SSC + TK",
        });
        expect(interaction.editReply).toHaveBeenCalledWith({
            content: expect.stringContaining("https://host/r/abc123"),
        });
    });

    it("does not fail evaluation on a missing tracked button (uses interaction fallback)", async () => {
        evaluateLog.mockResolvedValue({
            ok: true, id: "abc", url: "/r/abc", report: { title: "Kara" }, log: {},
        });
        const interaction = mockInteraction({ customId: "logcheck-eval:log1" });
        interaction.channelId = "chan9";
        interaction.message = { id: "btnX" };

        await command.execute(interaction);

        expect(discord.finishLogButton).toHaveBeenCalledWith("chan9", "btnX", expect.any(Object));
        expect(interaction.editReply).toHaveBeenCalled();
    });

    it("surfaces the error (with existing url) when evaluation is refused", async () => {
        evaluateLog.mockResolvedValue({ ok: false, already: true, error: "Bereits ausgewertet.", url: "/r/old" });
        const interaction = mockInteraction({ customId: "logcheck-eval:log1" });

        await command.execute(interaction);

        expect(discord.finishLogButton).not.toHaveBeenCalled();
        const arg = interaction.editReply.mock.calls[0][0];
        expect(arg.content).toContain("Bereits ausgewertet.");
        expect(arg.content).toContain("/r/old");
    });
});
