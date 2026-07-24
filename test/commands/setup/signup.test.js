const { mockInteraction, makeCollection } = require("../../helpers/mockInteraction.js");

jest.mock("../../../src/classes/raidhelper.js");
jest.mock("../../../src/utils/helper.js");

const Raidhelper = require("../../../src/classes/raidhelper.js");
const helper = require("../../../src/utils/helper.js");
const messages = require("../../../src/config/messages.js");
const signup = require("../../../src/commands/setup/signup.js");

const RAIDHELPER_BOT_ID = "579155972115660803";

function channelWithBotMessage() {
    return {
        id: "c1",
        parent: { id: "cat-1" },
        messages: {
            fetch: jest.fn().mockResolvedValue(
                makeCollection([["evt1", { author: { id: RAIDHELPER_BOT_ID } }]])
            ),
        },
    };
}

describe("commands/setup/signup", () => {
    let getEvent;
    let signUpToRaid;

    beforeEach(() => {
        jest.clearAllMocks();
        getEvent = jest.fn().mockResolvedValue({ templateId: "10" });
        signUpToRaid = jest.fn().mockResolvedValue(undefined);
        Raidhelper.mockImplementation(() => ({ getEvent, signUpToRaid }));
        helper.formatSpecs.mockReturnValue([{ className: "Paladin", specName: "Holy1" }]);
        helper.formatSignUps.mockReturnValue("icons");
    });

    it("exports the correct command contract", () => {
        expect(signup.name).toBe("signup");
        expect(typeof signup.description).toBe("string");
        expect(typeof signup.execute).toBe("function");
    });

    it("signs the user up and confirms on success", async () => {
        const interaction = mockInteraction({
            channel: channelWithBotMessage(),
            options: { specs: "Holy1" },
        });

        await signup.execute(interaction, {});

        expect(getEvent).toHaveBeenCalledWith("evt1");
        expect(signUpToRaid).toHaveBeenCalledWith(
            "evt1",
            [{ className: "Paladin", specName: "Holy1" }],
            interaction.user.id
        );
        expect(helper.botReply).toHaveBeenCalledTimes(1);
        expect(helper.botReply.mock.calls[0][1]).toBe(messages.signup.successTitle);
    });

    it("does not sign up when the channel has no raidhelper message", async () => {
        // default mock channel returns an empty message collection
        const interaction = mockInteraction({ options: { specs: "Holy1" } });

        await expect(signup.execute(interaction, {})).resolves.toBeUndefined();

        expect(signUpToRaid).not.toHaveBeenCalled();
        // NOTE: with no raid found, `raid` is undefined and `raid.templateId`
        // throws a TypeError that is swallowed by the try/catch, so no reply
        // (success or error) is ever sent to the user.
        expect(helper.botReply).not.toHaveBeenCalled();
    });
});
