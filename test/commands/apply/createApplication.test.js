
const command = require("../../../src/commands/apply/createApplication.js");
const { cardText, cardControls } = require("../../helpers/cardText.js");
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
        const targetChannel = { guildId: "g1", send: targetSend, toString: () => "#recruit" };

        const interaction = mockInteraction({
            options: { message_id: "123456789", channel: targetChannel },
        });
        interaction.channelId = "src-channel";
        interaction.guildId = "g1";

        await command.execute(interaction, client);

        expect(interaction.deferReply).toHaveBeenCalledTimes(1);
        expect(targetSend).toHaveBeenCalledTimes(1);
        const sendArg = targetSend.mock.calls[0][0];
        expect(sendArg.content).toBe("Bewirb dich!");
        expect(sendArg.components).toHaveLength(1);
        // the button collects applications for the main version (#553)
        expect(sendArg.components[0].components[0].data.custom_id).toMatch(/^apply:(tbc|classic|forever)$/);
        const reply = interaction.editReply.mock.calls[0][0];
        expect(cardText(reply)).toContain("Bewerbungs-Nachricht gepostet");
        expect(cardControls(reply)[0]).toMatchObject({ style: 5, url: "https://discord/msg/1" });
    });

    it("reports when the source message cannot be fetched", async () => {
        const client = discordClient.makeClient(); // the source channel is unknown
        const targetChannel = { guildId: "g1", send: jest.fn() };

        const interaction = mockInteraction({
            options: { message_id: "999", channel: targetChannel },
        });
        interaction.channelId = "src-channel";
        interaction.guildId = "g1";

        await command.execute(interaction, client);

        expect(cardText(interaction.editReply.mock.calls[0][0])).toContain("Quell-Nachricht nicht gefunden");
        expect(targetChannel.send).not.toHaveBeenCalled();
    });

    // #1073: the rank Server-Admin may run it now - no message of another server comes here
    it("never copies a message from a channel of another server, even by its link", async () => {
        // ids are digits: the link pattern takes only those
        const foreign = discordClient.makeChannel({ id: "222", guildId: "2002", messages: [["333", { content: "geheim", embeds: [] }]] });
        const client = discordClient.makeClient({ channels: [foreign] });
        const targetChannel = { guildId: "1001", send: jest.fn() };
        const interaction = mockInteraction({
            options: { message_id: "https://discord.com/channels/2002/222/333", channel: targetChannel },
        });
        interaction.guildId = "1001";

        await command.execute(interaction, client);

        expect(cardText(interaction.editReply.mock.calls[0][0])).toContain("Quell-Nachricht nicht gefunden");
        expect(foreign.messages.fetch).not.toHaveBeenCalled();
        expect(targetChannel.send).not.toHaveBeenCalled();
    });

    it("posts only into a channel of the server of the command, and never from a DM", async () => {
        const { client } = makeClient({ content: "x", embeds: [] });
        const targetChannel = { guildId: "g2", send: jest.fn() };
        const interaction = mockInteraction({ options: { message_id: "123456789", channel: targetChannel } });
        interaction.channelId = "src-channel";
        interaction.guildId = "g1";
        await command.execute(interaction, client);
        expect(cardText(interaction.editReply.mock.calls[0][0])).toContain("Ziel-Channel nicht auf diesem Server");
        expect(targetChannel.send).not.toHaveBeenCalled();

        const inDm = mockInteraction({ options: { message_id: "123456789", channel: { guildId: "g1", send: jest.fn() } } });
        inDm.guildId = null;
        await command.execute(inDm, client);
        expect(cardText(inDm.editReply.mock.calls[0][0])).toContain("Ziel-Channel nicht auf diesem Server");
    });
});
