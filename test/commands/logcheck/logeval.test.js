jest.mock("../../../src/services/logcheck/logChannel.js");
jest.mock("../../../src/services/discord/discord.js");
jest.mock("../../../src/stores/logStore.js");
jest.mock("../../../src/utils/logcheck/report.js", () => ({
    reportSummaryLines: jest.fn(() => ["👥 Raider: **25**"]),
}));

const { MessageFlags } = require("discord.js");
const command = require("../../../src/commands/logcheck/logeval.js");
const { evaluateLog } = require("../../../src/services/logcheck/logChannel.js");
const { reportSummaryLines } = require("../../../src/utils/logcheck/report.js");
const logStore = require("../../../src/stores/logStore.js");
const discord = require("../../../src/services/discord/discord.js");
const { mockInteraction } = require("../../helpers/mockInteraction.js");
const { cardText, cardControls } = require("../../helpers/cardText.js");

beforeEach(() => {
    jest.clearAllMocks();
    discord.finishLogButton.mockResolvedValue(true);
    logStore.evaluatedSections.mockReturnValue(["cla"]);
    reportSummaryLines.mockReturnValue(["👥 Raider: **25**"]);
});

describe("commands/logcheck/logeval", () => {
    it("words a log of a version without rules in the reader's language (#746)", async () => {
        evaluateLog.mockResolvedValue({ ok: false, unsupported: true, versionId: "forever", error: "Logs von WoW Forever werden noch nicht ausgewertet." });
        const interaction = mockInteraction({ customId: "logcheck-eval:log1:cla" });
        interaction.locale = "en-GB";

        await command.execute(interaction);

        expect(cardText(interaction.editReply.mock.calls[0][0])).toContain("Logs from WoW Forever are not evaluated yet.");
        expect(discord.finishLogButton).not.toHaveBeenCalled();
    });

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

        expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
        // the message under the log is redrawn by evaluateLog itself (refreshLogButton)
        expect(evaluateLog).toHaveBeenCalledWith("log1", "cla", { button: expect.any(Object) });
        expect(discord.finishLogButton).not.toHaveBeenCalled();
        const arg = interaction.editReply.mock.calls[0][0];
        expect(cardText(arg)).toContain("CLA");
        expect(cardControls(arg)[0]).toMatchObject({ style: 5, url: "https://host/r/abc123" });
    });

    it("routes the RPB button to the RPB half", async () => {
        evaluateLog.mockResolvedValue({
            ok: true, id: "a", url: "/r/a", report: { title: "T" },
            log: { id: "log1" }, section: "rpb",
        });
        logStore.evaluatedSections.mockReturnValue(["cla", "rpb"]);
        const interaction = mockInteraction({ customId: "logcheck-eval:log1:rpb" });

        await command.execute(interaction);

        expect(evaluateLog).toHaveBeenCalledWith("log1", "rpb", expect.any(Object));
        expect(reportSummaryLines).toHaveBeenCalledWith({ title: "T" }, "rpb");
        expect(cardText(interaction.editReply.mock.calls[0][0])).toContain("RPB");
    });

    it("treats a legacy button without a section as CLA", async () => {
        evaluateLog.mockResolvedValue({
            ok: true, id: "a", url: "/r/a", report: { title: "T" }, log: {}, section: "cla",
        });
        const interaction = mockInteraction({ customId: "logcheck-eval:log1" });

        await command.execute(interaction);

        expect(evaluateLog).toHaveBeenCalledWith("log1", "cla", expect.any(Object));
    });

    it("includes the summary lines of the evaluated half in the reply", async () => {
        evaluateLog.mockResolvedValue({
            ok: true, id: "a", url: "/r/a", report: { title: "T" }, log: {}, section: "rpb",
        });
        reportSummaryLines.mockReturnValue(["💀 Tode: **40**", "🛑 Unterbrechungen: 9 Spieler"]);
        const interaction = mockInteraction({ customId: "logcheck-eval:log1:rpb" });

        await command.execute(interaction);

        const arg = interaction.editReply.mock.calls[0][0];
        expect(cardText(arg)).toContain("💀 Tode: **40**");
        expect(cardText(arg)).toContain("🛑 Unterbrechungen: 9 Spieler");
    });

    it("hands the clicked message to evaluateLog as the hint for a log that never stored its own", async () => {
        evaluateLog.mockResolvedValue({
            ok: true, id: "abc", url: "/r/abc", report: { title: "Kara" }, log: {}, section: "cla",
        });
        const interaction = mockInteraction({ customId: "logcheck-eval:log1:cla" });
        interaction.channelId = "chan9";
        interaction.message = { id: "btnX" };

        await command.execute(interaction);

        expect(evaluateLog).toHaveBeenCalledWith("log1", "cla", { button: { channelId: "chan9", messageId: "btnX" } });
        expect(interaction.editReply).toHaveBeenCalled();
    });

    it("surfaces the error (with existing url) when evaluation is refused", async () => {
        evaluateLog.mockResolvedValue({ ok: false, already: true, error: "Bereits ausgewertet.", url: "/r/old" });
        const interaction = mockInteraction({ customId: "logcheck-eval:log1:cla" });

        await command.execute(interaction);

        expect(discord.finishLogButton).not.toHaveBeenCalled();
        const arg = interaction.editReply.mock.calls[0][0];
        expect(cardText(arg)).toContain("Bereits ausgewertet.");
        // "/r/old" is no absolute url: no link button, the text stays
        expect(cardControls(arg)).toHaveLength(0);
        const withUrl = mockInteraction({ customId: "logcheck-eval:log1:cla" });
        evaluateLog.mockResolvedValue({ ok: false, error: "Bereits ausgewertet.", url: "https://host/r/old" });
        await command.execute(withUrl);
        expect(cardControls(withUrl.editReply.mock.calls[0][0])[0]).toMatchObject({ url: "https://host/r/old" });
    });
});

describe("commands/logcheck/logeval — a raid that is still running", () => {
    it("offers the confirm button instead of a dead end", async () => {
        // The guard refused; the click that follows opens the modal (see
        // logevalForce.js), so the refusal must carry that button.
        evaluateLog.mockResolvedValue({
            ok: false,
            incomplete: true,
            error: "Der Raid sieht noch nicht abgeschlossen aus. Der Endboss fehlt noch: **Der Schwarze Tempel**.",
            progress: { complete: false, pending: ["Der Schwarze Tempel"] },
        });
        const interaction = mockInteraction({ customId: "logcheck-eval:log1:cla" });

        await command.execute(interaction);

        const reply = interaction.editReply.mock.calls[0][0];
        expect(cardText(reply)).toContain("Der Schwarze Tempel");
        expect(JSON.stringify(reply.components)).toContain("logcheck-force:log:log1:cla");
    });

    it("leaves an ordinary failure without a confirm button", async () => {
        // "Evaluate anyway" makes no sense for a broken link or a private report.
        evaluateLog.mockResolvedValue({ ok: false, error: "Report konnte nicht geladen werden." });
        const interaction = mockInteraction({ customId: "logcheck-eval:log1:cla" });

        await command.execute(interaction);

        const reply = interaction.editReply.mock.calls[0][0];
        expect(cardText(reply)).toContain("Report konnte nicht geladen werden.");
        expect(JSON.stringify(reply.components)).not.toContain("logcheck-force");
    });
});
