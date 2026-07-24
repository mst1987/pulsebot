// WarcraftLogs: real static parseReportId behaviour, mocked instance API calls.
jest.mock("../../../src/classes/warcraftlogs.js", () => {
    const getFights = jest.fn();
    const getCasts = jest.fn();
    const WarcraftLogs = jest.fn().mockImplementation(() => ({ getFights, getCasts }));
    WarcraftLogs.parseReportId = jest.fn((input) => (input ? "REPORTID" : ""));
    WarcraftLogs.__getFights = getFights;
    WarcraftLogs.__getCasts = getCasts;
    return WarcraftLogs;
});
jest.mock("../../../src/web/reportStore.js");
jest.mock("../../../src/utils/helper.js");
jest.mock("../../../src/utils/logcheck/gearIssues.js");
jest.mock("../../../src/utils/logcheck/consumables.js");
jest.mock("../../../src/utils/logcheck/shadowResi.js");
jest.mock("../../../src/utils/logcheck/drums.js");
jest.mock("../../../src/utils/logcheck/potions.js");
jest.mock("../../../src/utils/logcheck/sunder.js");
jest.mock("../../../src/utils/logcheck/bossUptimes.js");
jest.mock("../../../src/utils/logcheck/common.js");

const command = require("../../../src/commands/logcheck/logcheck.js");
const WarcraftLogs = require("../../../src/classes/warcraftlogs.js");
const { saveReport } = require("../../../src/web/reportStore.js");
const { botEditReply } = require("../../../src/utils/helper.js");
const { buildGearIssues } = require("../../../src/utils/logcheck/gearIssues.js");
const { analyzeConsumables } = require("../../../src/utils/logcheck/consumables.js");
const { analyzeShadowResi } = require("../../../src/utils/logcheck/shadowResi.js");
const { analyzeDrums } = require("../../../src/utils/logcheck/drums.js");
const { analyzePotions, potionsByName } = require("../../../src/utils/logcheck/potions.js");
const { analyzeSunder } = require("../../../src/utils/logcheck/sunder.js");
const { analyzeBossUptimes } = require("../../../src/utils/logcheck/bossUptimes.js");
const { selectPlayers } = require("../../../src/utils/logcheck/common.js");
const { mockInteraction } = require("../../helpers/mockInteraction.js");

function primeAnalyzers() {
    // buildGearIssues / selectPlayers / potionsByName results are used unguarded,
    // so they must return sensible shapes; the async analyzers may return null.
    buildGearIssues.mockReturnValue([]);
    selectPlayers.mockReturnValue([]);
    potionsByName.mockReturnValue({});
    analyzeConsumables.mockResolvedValue(null);
    analyzeShadowResi.mockReturnValue(null);
    analyzeDrums.mockResolvedValue(null);
    analyzePotions.mockResolvedValue(null);
    analyzeSunder.mockResolvedValue(null);
    analyzeBossUptimes.mockResolvedValue(null);
    saveReport.mockReturnValue("abc123");
    WarcraftLogs.__getFights.mockResolvedValue({
        title: "My Raid",
        zoneName: "AQ40",
        start: Date.now(),
        end: 1000,
    });
    WarcraftLogs.__getCasts.mockResolvedValue({});
}

describe("commands/logcheck/logcheck", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        WarcraftLogs.parseReportId.mockImplementation((input) => (input ? "REPORTID" : ""));
        primeAnalyzers();
    });

    it("exports the command contract with the correct name", () => {
        expect(command.name).toBe("logcheck");
        expect(typeof command.description).toBe("string");
        expect(typeof command.execute).toBe("function");
    });

    it("replies with an error when the report id cannot be parsed", async () => {
        WarcraftLogs.parseReportId.mockReturnValueOnce("");
        const interaction = mockInteraction({ options: { link: "not-a-report" } });

        await command.execute(interaction);

        // buildReport validates the link and throws a ReportError, which the
        // command surfaces via botEditReply after deferring.
        expect(interaction.deferReply).toHaveBeenCalled();
        expect(botEditReply).toHaveBeenCalledWith(
            interaction,
            "Fehler",
            expect.stringContaining("Report-ID")
        );
    });

    it("builds the report, saves it, and replies with the result url", async () => {
        const interaction = mockInteraction({
            options: { link: "https://classic.warcraftlogs.com/reports/xyz" },
        });

        await command.execute(interaction);

        expect(interaction.deferReply).toHaveBeenCalledTimes(1);
        expect(saveReport).toHaveBeenCalledTimes(1);
        expect(saveReport.mock.calls[0][0]).toMatchObject({
            title: "My Raid",
            reportId: "REPORTID",
        });

        expect(botEditReply).toHaveBeenCalledTimes(1);
        const [, title, message] = botEditReply.mock.calls[0];
        expect(title).toBe("Log-Check: My Raid");
        expect(message).toContain("/r/abc123");
        expect(message).toContain("Auswertung");
    });

    it("reports an error when the report cannot be loaded", async () => {
        WarcraftLogs.__getFights.mockRejectedValueOnce(new Error("boom"));
        const interaction = mockInteraction({
            options: { link: "https://classic.warcraftlogs.com/reports/xyz" },
        });

        await command.execute(interaction);

        expect(interaction.deferReply).toHaveBeenCalledTimes(1);
        expect(saveReport).not.toHaveBeenCalled();
        expect(botEditReply).toHaveBeenCalledWith(
            interaction,
            "Fehler",
            expect.stringContaining("Report konnte nicht geladen werden")
        );
    });
});
