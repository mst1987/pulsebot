jest.mock("../../../src/web/eventStore", () => ({ getEvent: jest.fn() }));
jest.mock("../../../src/web/eventMessage", () => ({ SIGNUP_BUTTON_PREFIX: "event-signup" }));
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example" }));

const { getEvent } = require("../../../src/web/eventStore");
const command = require("../../../src/commands/setup/eventSignup");

describe("commands/setup/eventSignup", () => {
    beforeEach(() => jest.clearAllMocks());

    it("is routed by the button's customId prefix", () => {
        expect(command.name).toBe("event-signup");
    });

    it("answers privately with a link into the web", async () => {
        getEvent.mockReturnValue({ id: "eh-1", title: "Kara" });
        const interaction = { customId: "event-signup:eh-1", reply: jest.fn() };
        await command.execute(interaction);
        expect(getEvent).toHaveBeenCalledWith("eh-1");
        expect(interaction.reply).toHaveBeenCalledWith({
            content: expect.stringContaining("https://eh.example/signups?event=eh-1"),
            ephemeral: true,
        });
    });

    it("says so when the event is gone", async () => {
        getEvent.mockReturnValue(null);
        const interaction = { customId: "event-signup:eh-9", reply: jest.fn() };
        await command.execute(interaction);
        expect(interaction.reply).toHaveBeenCalledWith({ content: "Dieses Event gibt es nicht mehr.", ephemeral: true });
    });
});
