jest.mock("../../../src/utils/helper.js");

const command = require("../../../src/commands/apply/createApplication.js");
const { checkForPermission } = require("../../../src/utils/helper.js");
const { mockInteraction } = require("../../helpers/mockInteraction.js");

function makeClient(sourceMessage) {
    const sourceChannel = {
        messages: { fetch: jest.fn().mockResolvedValue(sourceMessage) },
    };
    return {
        client: { channels: { fetch: jest.fn().mockResolvedValue(sourceChannel) } },
        sourceChannel,
    };
}

describe("commands/apply/createApplication", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("exports the command contract with the correct name", () => {
        expect(command.name).toBe("createapplication");
        expect(typeof command.description).toBe("string");
        expect(typeof command.execute).toBe("function");
    });

    it("aborts before deferring when the user lacks permission", async () => {
        checkForPermission.mockReturnValue(false);
        const interaction = mockInteraction();

        await command.execute(interaction, { channels: { fetch: jest.fn() } });

        expect(interaction.deferReply).not.toHaveBeenCalled();
    });

    it("copies the source message and posts it with an apply button", async () => {
        checkForPermission.mockReturnValue(true);
        const sourceMessage = { content: "Bewirb dich!", embeds: [] };
        const { client } = makeClient(sourceMessage);
        const targetSend = jest.fn().mockResolvedValue({ url: "https://discord/msg/1" });
        const targetChannel = { send: targetSend, toString: () => "#recruit" };

        const interaction = mockInteraction({
            options: { message_id: "123456789", channel: targetChannel },
        });
        interaction.channelId = "src-channel";

        await command.execute(interaction, client);

        expect(interaction.deferReply).toHaveBeenCalledTimes(1);
        expect(targetSend).toHaveBeenCalledTimes(1);
        const sendArg = targetSend.mock.calls[0][0];
        expect(sendArg.content).toBe("Bewirb dich!");
        expect(sendArg.components).toHaveLength(1);
        expect(interaction.editReply).toHaveBeenCalledWith(
            expect.stringContaining("https://discord/msg/1")
        );
    });

    it("reports when the source message cannot be fetched", async () => {
        checkForPermission.mockReturnValue(true);
        const client = { channels: { fetch: jest.fn().mockRejectedValue(new Error("404")) } };
        const targetChannel = { send: jest.fn() };

        const interaction = mockInteraction({
            options: { message_id: "999", channel: targetChannel },
        });
        interaction.channelId = "src-channel";

        await command.execute(interaction, client);

        expect(interaction.editReply).toHaveBeenCalledWith(
            expect.stringContaining("Quell-Nachricht nicht gefunden")
        );
        expect(targetChannel.send).not.toHaveBeenCalled();
    });
});
