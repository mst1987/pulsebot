
const command = require("../../../src/commands/apply/createApplication.js");
const { mockInteraction } = require("../../helpers/mockInteraction.js");
const discordClient = require("../../helpers/discordClient.js");

function makeClient(sourceMessage) {
    const sourceChannel = discordClient.makeChannel({ id: "src-channel", messages: [["123456789", sourceMessage]] });
    return {
        client: discordClient.makeClient({ channels: [sourceChannel] }),
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

    it("is admin-only unless the Bot-Befehle settings say otherwise", () => {
        // The check itself runs centrally before execute (src/services/discord/botAccess.js).
        expect(command.defaultAccess).toBe("admins");
        expect(typeof command.group).toBe("string");
    });

    it("copies the source message and posts it with an apply button", async () => {
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
        const client = discordClient.makeClient(); // the source channel is unknown
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
