const { MessageFlags } = require("discord.js");
const { mockInteraction } = require("../../helpers/mockInteraction.js");

jest.mock("../../../src/utils/discord/reply.js");
jest.mock("../../../src/utils/raidhelper/queries.js");

const reply = require("../../../src/utils/discord/reply.js");
const utilsRaidhelper = require("../../../src/utils/raidhelper/queries.js");
const messages = require("../../../src/config/messages.js");
const showSignups = require("../../../src/commands/setup/showSignups.js");

describe("commands/setup/showSignups", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("exports the correct command contract", () => {
        expect(showSignups.name).toBe("show-signups");
        expect(typeof showSignups.description).toBe("string");
        expect(typeof showSignups.execute).toBe("function");
    });

    it("defers ephemerally and never calls reply()", async () => {
        utilsRaidhelper.getAllSignUps.mockResolvedValue({ noSignUps: "", signUps: "" });
        const interaction = mockInteraction({ channel: { id: "c1", parent: { id: "cat-1", name: "Raids" } } });

        await showSignups.execute(interaction, {});

        expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
        expect(interaction.reply).not.toHaveBeenCalled();
    });

    it("edits an error reply when there is no parent category", async () => {
        const interaction = mockInteraction({ channel: { id: "c1", parent: null } });

        await showSignups.execute(interaction, {});

        expect(reply.botEditReply).toHaveBeenCalledTimes(1);
        expect(reply.botEditReply.mock.calls[0][1]).toBe("Fehler");
        expect(utilsRaidhelper.getAllSignUps).not.toHaveBeenCalled();
    });

    it("renders the sign-up overview on success", async () => {
        utilsRaidhelper.getAllSignUps.mockResolvedValue({
            noSignUps: "<#111>",
            signUps: "<#222>",
        });
        const interaction = mockInteraction({ channel: { id: "c1", parent: { id: "cat-1", name: "Raids" } } });

        await showSignups.execute(interaction, {});

        expect(utilsRaidhelper.getAllSignUps).toHaveBeenCalledWith(interaction, "cat-1");
        expect(reply.botEditReply).toHaveBeenCalledTimes(1);
        expect(reply.botEditReply.mock.calls[0][1]).toBe("Raids");
        expect(reply.botEditReply.mock.calls[0][2]).toContain("<#111>");
        expect(reply.botEditReply.mock.calls[0][2]).toContain("<#222>");
    });

    it("falls back to a generic error reply when the query throws", async () => {
        utilsRaidhelper.getAllSignUps.mockRejectedValue(new Error("boom"));
        const interaction = mockInteraction({ channel: { id: "c1", parent: { id: "cat-1", name: "Raids" } } });

        await showSignups.execute(interaction, {});

        const lastCall = reply.botEditReply.mock.calls.at(-1);
        expect(lastCall[1]).toBe(messages.general.errorTitle);
        expect(lastCall[2]).toBe(messages.general.errorMessage);
    });
});
