// The confirmation path past the unfinished-raid guard: the "Trotzdem
// auswerten" button opens a modal, and only the submitted modal — with JA typed
// into it — actually starts the evaluation.
//
// What matters here is that the guard cannot be walked past by accident: a
// click alone evaluates nothing, and a submit without the word does not either.
jest.mock("../../../src/web/logChannel.js");
jest.mock("../../../src/web/discord.js");
jest.mock("../../../src/web/logStore.js");
jest.mock("../../../src/utils/logcheck/report.js", () => ({
    buildReport: jest.fn(),
    reportSummaryLines: jest.fn(() => ["👥 Raider: **25**"]),
    ReportError: class ReportError extends Error {},
}));

const command = require("../../../src/commands/logcheck/logevalForce.js");
const { evaluateLog } = require("../../../src/web/logChannel.js");
const { buildReport } = require("../../../src/utils/logcheck/report.js");
const logStore = require("../../../src/web/logStore.js");
const discord = require("../../../src/web/discord.js");
const { mockInteraction } = require("../../helpers/mockInteraction.js");

beforeEach(() => {
    jest.clearAllMocks();
    discord.finishLogButton.mockResolvedValue(true);
    logStore.evaluatedSections.mockReturnValue(["cla"]);
});

describe("commands/logcheck/logevalForce — the click", () => {
    it("routes under the same name the button and the modal carry", () => {
        expect(command.name).toBe("logcheck-force");
        expect(command.forceCustomId("log", "log1", "cla")).toBe("logcheck-force:log:log1:cla");
    });

    it("opens the modal instead of evaluating anything", async () => {
        const interaction = mockInteraction({ customId: "logcheck-force:log:log1:cla" });

        await command.execute(interaction);

        expect(interaction.showModal).toHaveBeenCalledTimes(1);
        expect(evaluateLog).not.toHaveBeenCalled();
        expect(interaction.deferReply).not.toHaveBeenCalled();
    });

    it("shows the refusal it sits under, so nobody confirms blind", async () => {
        const interaction = mockInteraction({
            customId: "logcheck-force:log:log1:cla",
            message: { content: "⚠️ Der Endboss fehlt noch: **Der Schwarze Tempel** (Endboss: Illidan Stormrage)." },
        });

        await command.execute(interaction);

        const modal = interaction.showModal.mock.calls[0][0];
        const json = JSON.stringify(modal.toJSON());
        expect(json).toContain("Illidan Stormrage");
        expect(json).not.toContain("⚠️");
    });
});

describe("commands/logcheck/logevalForce — the submitted modal", () => {
    function submit(customId, typed) {
        return mockInteraction({ customId, modal: true, options: { confirm: typed } });
    }

    it("evaluates with force once JA was typed", async () => {
        evaluateLog.mockResolvedValue({
            ok: true,
            url: "https://host/r/abc",
            report: { title: "BT" },
            log: { id: "log1", buttonChannelId: "ch", buttonMessageId: "msg" },
            section: "cla",
        });

        const interaction = submit("logcheck-force:log:log1:cla", "ja");
        await command.execute(interaction);

        expect(evaluateLog).toHaveBeenCalledWith("log1", "cla", { force: true });
        expect(interaction.editReply).toHaveBeenCalledWith(
            expect.objectContaining({ content: expect.stringContaining("https://host/r/abc") }),
        );
    });

    it("refreshes the log's button message afterwards", async () => {
        evaluateLog.mockResolvedValue({
            ok: true,
            url: "https://host/r/abc",
            report: { title: "BT" },
            log: { id: "log1", buttonChannelId: "ch", buttonMessageId: "msg" },
            section: "rpb",
        });

        await command.execute(submit("logcheck-force:log:log1:rpb", "JA"));

        expect(discord.finishLogButton).toHaveBeenCalledWith("ch", "msg", expect.objectContaining({
            reportUrl: "https://host/r/abc",
            logId: "log1",
        }));
    });

    it("evaluates nothing when the confirmation is missing", async () => {
        const interaction = submit("logcheck-force:log:log1:cla", "vielleicht");

        await command.execute(interaction);

        expect(evaluateLog).not.toHaveBeenCalled();
        expect(interaction.deferReply).not.toHaveBeenCalled();
        expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining("Abgebrochen"),
            ephemeral: true,
        }));
    });

    it("builds a bare report id the same way, for the /logcheck path", async () => {
        buildReport.mockResolvedValue({ id: "r1", url: "https://host/r/r1", report: { title: "Kara" } });

        await command.execute(submit("logcheck-force:id:RPT123:all", "JA"));

        expect(buildReport).toHaveBeenCalledWith(
            "https://classic.warcraftlogs.com/reports/RPT123",
            { force: true },
        );
        expect(evaluateLog).not.toHaveBeenCalled();
    });

    it("passes a failed evaluation on instead of claiming success", async () => {
        evaluateLog.mockResolvedValue({ ok: false, error: "Log nicht gefunden." });

        const interaction = submit("logcheck-force:log:gone:cla", "JA");
        await command.execute(interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(
            expect.objectContaining({ content: expect.stringContaining("Log nicht gefunden.") }),
        );
        expect(discord.finishLogButton).not.toHaveBeenCalled();
    });
});
