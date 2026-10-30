// The confirmation path past the unfinished-raid guard: the "Trotzdem
// auswerten" button opens a modal, and only the submitted modal — with JA typed
// into it — actually starts the evaluation.
//
// What matters here is that the guard cannot be walked past by accident: a
// click alone evaluates nothing, and a submit without the word does not either.
jest.mock("../../../src/services/logcheck/logChannel.js");
jest.mock("../../../src/services/discord/discord.js");
jest.mock("../../../src/stores/loot/logStore.js");
jest.mock("../../../src/utils/logcheck/report.js", () => ({
    buildReport: jest.fn(),
    reportSummaryLines: jest.fn(() => ["👥 Raider: **25**"]),
    ReportError: class ReportError extends Error {},
}));

const { MessageFlags } = require("discord.js");
const command = require("../../../src/commands/logcheck/logevalForce.js");
const { evaluateLog } = require("../../../src/services/logcheck/logChannel.js");
const { buildReport } = require("../../../src/utils/logcheck/report.js");
const logStore = require("../../../src/stores/loot/logStore.js");
const discord = require("../../../src/services/discord/discord.js");
const { mockInteraction } = require("../../helpers/mockInteraction.js");
const { cardText, cardControls } = require("../../helpers/cardText.js");

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

    it("reads the refusal back from a card too", async () => {
        const message = command.refusalCard({ error: "Der Endboss fehlt noch: **Der Schwarze Tempel**." }, { title: "Raid noch nicht abgeschlossen" });
        const interaction = mockInteraction({ customId: "logcheck-force:log:log1:cla", message });
        await command.execute(interaction);
        const json = JSON.stringify(interaction.showModal.mock.calls[0][0].toJSON());
        expect(json).toContain("Der Schwarze Tempel");
        expect(json).not.toContain("\"value\":\"Raid noch nicht");
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
        const reply = interaction.editReply.mock.calls[0][0];
        expect(cardControls(reply)[0]).toMatchObject({ url: "https://host/r/abc" });
        expect(cardText(reply)).toContain("noch nicht abgeschlossen");
    });

    it("leaves the button message to evaluateLog (it redraws it itself)", async () => {
        evaluateLog.mockResolvedValue({
            ok: true,
            url: "https://host/r/abc",
            report: { title: "BT" },
            log: { id: "log1", buttonChannelId: "ch", buttonMessageId: "msg" },
            section: "rpb",
        });

        await command.execute(submit("logcheck-force:log:log1:rpb", "JA"));

        expect(evaluateLog).toHaveBeenCalledWith("log1", "rpb", { force: true });
        expect(discord.finishLogButton).not.toHaveBeenCalled();
    });

    it("evaluates nothing when the confirmation is missing", async () => {
        const interaction = submit("logcheck-force:log:log1:cla", "vielleicht");

        await command.execute(interaction);

        expect(evaluateLog).not.toHaveBeenCalled();
        expect(interaction.deferReply).not.toHaveBeenCalled();
        const sent = interaction.reply.mock.calls[0][0];
        expect(cardText(sent)).toContain("Abgebrochen");
        expect(sent.flags & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
    });

    it("builds a bare report id the same way, for the /logcheck path", async () => {
        buildReport.mockResolvedValue({ id: "r1", url: "https://host/r/r1", report: { title: "Kara" } });

        await command.execute(submit("logcheck-force:id:RPT123:all", "JA"));

        // no host on the button and no tracked log: the id alone (buildReport takes TBC, #746)
        expect(buildReport).toHaveBeenCalledWith("RPT123", { force: true, guildId: "" });
        expect(evaluateLog).not.toHaveBeenCalled();
    });

    it("words a version without rules in the reader's language on both forced paths (#746)", async () => {
        evaluateLog.mockResolvedValue({ ok: false, unsupported: true, versionId: "forever", error: "x" });
        const viaLog = submit("logcheck-force:log:log1:cla", "JA");
        await command.execute(viaLog);
        expect(cardText(viaLog.editReply.mock.calls[0][0])).toContain("Logs von WoW Forever werden noch nicht ausgewertet.");

        buildReport.mockRejectedValue(Object.assign(new Error("x"), { unsupported: true, versionId: "forever" }));
        const viaId = submit("logcheck-force:id:RPT123:all", "JA");
        await command.execute(viaId);
        expect(cardText(viaId.editReply.mock.calls[0][0])).toContain("Logs von WoW Forever werden noch nicht ausgewertet.");
    });

    it("reads a host from the customId only when it is a Warcraft-Logs one", () => {
        expect(command.forceCustomId("id", "R1", "all", "fresh.warcraftlogs.com")).toBe("logcheck-force:id:R1:all:fresh.warcraftlogs.com");
        expect(command.forceCustomId("id", "R1", "all", "evil.example.com")).toBe("logcheck-force:id:R1:all");
        expect(command.parseCustomId("logcheck-force:id:R1:all:vanilla.warcraftlogs.com")).toEqual({ kind: "id", ref: "R1", section: "all", host: "vanilla.warcraftlogs.com" });
        expect(command.parseCustomId("logcheck-force:id:R1:all:evil.example.com").host).toBe("");
    });

    it("asks the host the button carries, never a fixed one (#746)", async () => {
        buildReport.mockResolvedValue({ id: "r1", url: "https://host/r/r1", report: { title: "Kara" } });

        await command.execute(submit("logcheck-force:id:RPT123:all:fresh.warcraftlogs.com", "JA"));

        expect(buildReport).toHaveBeenCalledWith("https://fresh.warcraftlogs.com/reports/RPT123", { force: true, guildId: "" });
    });

    it("takes the stored link of a log tracked under the id when the button has no host", async () => {
        buildReport.mockResolvedValue({ id: "r1", url: "https://host/r/r1", report: { title: "Kara" } });
        logStore.getByReportId.mockReturnValue({ id: "l1", link: "https://vanilla.warcraftlogs.com/reports/RPT123" });

        await command.execute(submit("logcheck-force:id:RPT123:all", "JA"));

        expect(logStore.getByReportId).toHaveBeenCalledWith("RPT123");
        expect(buildReport).toHaveBeenCalledWith("https://vanilla.warcraftlogs.com/reports/RPT123", { force: true, guildId: "" });
    });

    it("passes a failed evaluation on instead of claiming success", async () => {
        evaluateLog.mockResolvedValue({ ok: false, error: "Log nicht gefunden." });

        const interaction = submit("logcheck-force:log:gone:cla", "JA");
        await command.execute(interaction);

        expect(cardText(interaction.editReply.mock.calls[0][0])).toContain("Log nicht gefunden.");
        expect(discord.finishLogButton).not.toHaveBeenCalled();
    });
});
