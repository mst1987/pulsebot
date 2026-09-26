const { MessageFlags } = require("discord.js");
const { mockInteraction } = require("../../helpers/mockInteraction.js");

jest.mock("../../../src/classes/raidhelper.js");
jest.mock("../../../src/utils/helper.js");
jest.mock("../../../src/utils/raidhelper.js");
jest.mock("../../../src/utils/responses.js");
jest.mock("../../../src/web/eventSources", () => ({ ownSignedUpEvents: jest.fn(() => []) }));
const eventSources = require("../../../src/web/eventSources");

const Raidhelper = require("../../../src/classes/raidhelper.js");
const helper = require("../../../src/utils/helper.js");
const utilsRaidhelper = require("../../../src/utils/raidhelper.js");
const responses = require("../../../src/utils/responses.js");
const messages = require("../../../src/config/messages.js");
const showAllSetups = require("../../../src/commands/setup/showAllSetups.js");

describe("commands/setup/showAllSetups", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        Raidhelper.mockImplementation(() => ({
            getUserSignUps: jest.fn().mockResolvedValue([]),
        }));
        responses.setupResponse.mockReturnValue("SETUP");
    });

    it("exports the correct command contract", () => {
        expect(showAllSetups.name).toBe("show-allsetups");
        expect(typeof showAllSetups.description).toBe("string");
        expect(typeof showAllSetups.execute).toBe("function");
    });

    it("defers ephemerally and never calls reply()", async () => {
        utilsRaidhelper.getSetupsFromEvents.mockResolvedValue([]);
        const interaction = mockInteraction();

        await showAllSetups.execute(interaction, {});

        expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
        expect(interaction.reply).not.toHaveBeenCalled();
    });

    it("reports an error when there are no setups", async () => {
        utilsRaidhelper.getSetupsFromEvents.mockResolvedValue([]);
        const interaction = mockInteraction();

        await showAllSetups.execute(interaction, {});

        expect(helper.botEditReply).toHaveBeenCalledTimes(1);
        expect(helper.botEditReply.mock.calls[0][1]).toBe(messages.allsetups.errorTitle);
        expect(helper.botEditReply.mock.calls[0][2]).toBe(messages.allsetups.errorMessage);
    });

    it("renders all setups when some exist", async () => {
        utilsRaidhelper.getSetupsFromEvents.mockResolvedValue([
            { startTime: 2, setup: [{ id: "123" }] },
            { startTime: 1, setup: [{ id: "123" }] },
        ]);
        const interaction = mockInteraction();

        await showAllSetups.execute(interaction, {});

        expect(responses.setupResponse).toHaveBeenCalledTimes(2);
        expect(helper.botEditReply).toHaveBeenCalledTimes(1);
        expect(helper.botEditReply.mock.calls[0][1]).toBe("Alle deine Setups auf dem Discord");
    });

    it("asks for the user's own EventHelper events too (their approved setups, #263)", async () => {
        Raidhelper.mockImplementation(() => ({ getUserSignUps: jest.fn().mockResolvedValue([{ id: "1" }]) }));
        eventSources.ownSignedUpEvents.mockReturnValue([{ id: "eh-1", source: "eventhelper" }]);
        utilsRaidhelper.getSetupsFromEvents.mockResolvedValue([]);
        const interaction = mockInteraction();

        await showAllSetups.execute(interaction, {});

        expect(eventSources.ownSignedUpEvents).toHaveBeenCalledWith(interaction.user.id);
        expect(utilsRaidhelper.getSetupsFromEvents.mock.calls[0][2]).toEqual([{ id: "1" }, { id: "eh-1", source: "eventhelper" }]);
    });
});
