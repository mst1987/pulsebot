const { mockInteraction } = require("../../helpers/mockInteraction.js");

jest.mock("../../../src/classes/raidhelper.js");
jest.mock("../../../src/classes/sheets.js");
jest.mock("../../../src/utils/helper.js");

const Raidhelper = require("../../../src/classes/raidhelper.js");
const SheetsClient = require("../../../src/classes/sheets.js");
const helper = require("../../../src/utils/helper.js");
const fillSetup = require("../../../src/commands/setup/fillSetup.js");

function setupRaidhelper(getSetupImpl) {
    Raidhelper.mockImplementation(() => ({
        getSetup: jest.fn(getSetupImpl),
    }));
}

function setupSheets(overrides = {}) {
    const client = {
        batchClear: jest.fn().mockResolvedValue(undefined),
        batchWrite: jest.fn().mockResolvedValue(undefined),
        applyConditionalFormatting: jest.fn().mockResolvedValue(undefined),
        ...overrides,
    };
    SheetsClient.mockImplementation(() => client);
    return client;
}

describe("commands/setup/fillSetup", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("exports the correct command contract", () => {
        expect(fillSetup.name).toBe("fillsetup");
        expect(typeof fillSetup.description).toBe("string");
        expect(typeof fillSetup.execute).toBe("function");
    });

    it("defers ephemerally before doing work", async () => {
        setupRaidhelper(async () => ({ setup: [] }));
        const interaction = mockInteraction({ options: { setup_id: "s1" } });

        await fillSetup.execute(interaction, {});

        expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
        // never uses reply() after deferring
        expect(interaction.reply).not.toHaveBeenCalled();
    });

    it("edits an error reply when the setup is empty", async () => {
        setupRaidhelper(async () => ({ setup: [] }));
        const interaction = mockInteraction({ options: { setup_id: "s1" } });

        await fillSetup.execute(interaction, {});

        expect(helper.botEditReply).toHaveBeenCalledTimes(1);
        expect(helper.botEditReply.mock.calls[0][1]).toBe("Fehler");
        expect(helper.botEditReply.mock.calls[0][2]).toMatch(/Setup nicht gefunden/);
    });

    it("edits an error reply when Raidhelper throws", async () => {
        setupRaidhelper(async () => {
            throw new Error("api down");
        });
        const interaction = mockInteraction({ options: { setup_id: "s1" } });

        await fillSetup.execute(interaction, {});

        expect(helper.botEditReply).toHaveBeenCalledTimes(1);
        expect(helper.botEditReply.mock.calls[0][1]).toBe("Fehler");
        expect(helper.botEditReply.mock.calls[0][2]).toMatch(/Raidhelper Fehler: api down/);
    });

    it("edits an error reply when Google Sheets throws", async () => {
        setupRaidhelper(async () => ({
            setup: [{ name: "Alice", spec: "Holy1", group: 1 }],
        }));
        setupSheets({
            batchWrite: jest.fn().mockRejectedValue(new Error("sheet boom")),
        });
        const interaction = mockInteraction({ options: { setup_id: "s1" } });

        await fillSetup.execute(interaction, {});

        expect(helper.botEditReply).toHaveBeenCalledTimes(1);
        expect(helper.botEditReply.mock.calls[0][1]).toBe("Fehler");
        expect(helper.botEditReply.mock.calls[0][2]).toMatch(/Google Sheets Fehler: sheet boom/);
    });

    it("writes to the sheet and reports success on the happy path", async () => {
        setupRaidhelper(async () => ({
            setup: [
                { name: "Prot", spec: "Protection1", group: 1 },
                { name: "Heal", spec: "Holy1", group: 1 },
            ],
        }));
        const sheets = setupSheets();
        const interaction = mockInteraction({
            options: { setup_id: "s1", tank3: "ManualTank" },
        });

        await fillSetup.execute(interaction, {});

        expect(sheets.batchClear).toHaveBeenCalled();
        expect(sheets.batchWrite).toHaveBeenCalled();
        expect(sheets.applyConditionalFormatting).toHaveBeenCalled();
        expect(helper.botEditReply).toHaveBeenCalledTimes(1);
        expect(helper.botEditReply.mock.calls[0][1]).toBe("Setup befüllt");
        expect(helper.botEditReply.mock.calls[0][2]).toMatch(/2\*\* Spieler/);
    });
});
