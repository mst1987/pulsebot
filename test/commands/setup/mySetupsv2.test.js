const { mockInteraction } = require("../../helpers/mockInteraction.js");

jest.mock("../../../src/utils/helper.js");
jest.mock("../../../src/utils/raidhelper.js");

const helper = require("../../../src/utils/helper.js");
const utilsRaidhelper = require("../../../src/utils/raidhelper.js");
const messages = require("../../../src/config/messages.js");
const mySetups = require("../../../src/commands/setup/mySetupsv2.js");

describe("commands/setup/mySetupsv2", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("exports the correct command contract", () => {
        expect(mySetups.name).toBe("show-mysetups");
        expect(typeof mySetups.description).toBe("string");
        expect(typeof mySetups.execute).toBe("function");
    });

    it("defers ephemerally and never calls reply()", async () => {
        utilsRaidhelper.getCategorySetups.mockResolvedValue([]);
        const interaction = mockInteraction();

        await mySetups.execute(interaction, {});

        expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
        expect(interaction.reply).not.toHaveBeenCalled();
    });

    it("edits an error reply when there is no parent category", async () => {
        const interaction = mockInteraction({ channel: { id: "c1", parent: null } });

        await mySetups.execute(interaction, {});

        expect(helper.botEditReply).toHaveBeenCalledTimes(1);
        expect(helper.botEditReply.mock.calls[0][1]).toBe("Fehler");
        expect(utilsRaidhelper.getCategorySetups).not.toHaveBeenCalled();
    });

    it("renders the setups list on success", async () => {
        utilsRaidhelper.getCategorySetups.mockResolvedValue([]);
        const interaction = mockInteraction();

        await mySetups.execute(interaction, {});

        expect(utilsRaidhelper.getCategorySetups).toHaveBeenCalledWith(interaction, "category-1");
        expect(helper.botEditReply).toHaveBeenCalledTimes(1);
        expect(helper.botEditReply.mock.calls[0][1]).toBe(messages.mysetups.successTitle);
    });

    it("falls back to a generic error reply when the query throws", async () => {
        utilsRaidhelper.getCategorySetups.mockRejectedValue(new Error("boom"));
        const interaction = mockInteraction();

        await mySetups.execute(interaction, {});

        const lastCall = helper.botEditReply.mock.calls.at(-1);
        expect(lastCall[1]).toBe(messages.general.errorTitle);
        expect(lastCall[2]).toBe(messages.general.errorMessage);
    });
});
