jest.mock("../../../src/web/eventSources", () => ({ getStoredEvent: jest.fn() }));
jest.mock("../../../src/web/talkOverview", () => ({ SELECT_ID: "talk-signup" }));
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example" }));

const { getStoredEvent } = require("../../../src/web/eventSources");
const command = require("../../../src/commands/setup/talkSignup");

describe("commands/setup/talkSignup", () => {
    beforeEach(() => jest.clearAllMocks());

    it("is routed by the select's customId and open to every raider", () => {
        expect(command.name).toBe("talk-signup");
        expect(command.group).toBe("signup");
        expect(command.defaultAccess).toBe("everyone");
    });

    it("answers privately with a link to the chosen raid", async () => {
        getStoredEvent.mockReturnValue({ id: "eh-1", title: "Kara" });
        const interaction = { customId: "talk-signup", values: ["eh-1"], reply: jest.fn() };
        await command.execute(interaction);
        expect(getStoredEvent).toHaveBeenCalledWith("eh-1");
        expect(interaction.reply).toHaveBeenCalledWith({
            content: "Die Anmeldung zu **Kara** läuft über den EventHelper: https://eh.example/raids/detail?event=eh-1",
            ephemeral: true,
        });
    });

    it("still links a raid it cannot name (an upcoming Raid-Helper event)", async () => {
        getStoredEvent.mockReturnValue(null);
        const interaction = { values: ["123456"], reply: jest.fn() };
        await command.execute(interaction);
        expect(interaction.reply.mock.calls[0][0].content).toContain("diesem Raid");
        expect(interaction.reply.mock.calls[0][0].content).toContain("/raids/detail?event=123456");
    });

    it("says so when nothing was chosen", async () => {
        const interaction = { values: [], reply: jest.fn() };
        await command.execute(interaction);
        expect(interaction.reply).toHaveBeenCalledWith({ content: "Kein Raid gewählt.", ephemeral: true });
    });
});
