// The "Confirm" / "Cancel" buttons under the setup message: a component route
// without a server check that hands every click to setupConfirmBot.
jest.mock("../../../src/services/setup/setupConfirmBot", () => ({
    CONFIRM_PREFIX: "setupconfirm",
    handleConfirmComponent: jest.fn(async () => "handled"),
}));
jest.mock("../../../src/services/events/eventDraft", () => ({
    guildFor: jest.fn(() => ({ error: "Nur auf dem Event-Server." })),
}));

const { handleConfirmComponent } = require("../../../src/services/setup/setupConfirmBot");
const { guildFor } = require("../../../src/services/events/eventDraft");
const button = require("../../../src/commands/event/setupConfirmButton");
const { mockInteraction } = require("../../helpers/mockInteraction");

beforeEach(() => jest.clearAllMocks());

describe("setupConfirmButton", () => {
    it("is named after the confirm prefix and inherits the signup access", () => {
        expect(button.name).toBe("setupconfirm");
        expect(button.accessOf).toBe("event-signup");
        expect(button.description).toMatch(/Setup-Nachricht/);
    });

    it("hands the click to the confirm handler without a server check (DMs too)", async () => {
        const interaction = mockInteraction({ customId: "setupconfirm:ev1:yes" });
        interaction.guild = null;
        await expect(button.execute(interaction)).resolves.toBe("handled");
        expect(handleConfirmComponent).toHaveBeenCalledTimes(1);
        expect(handleConfirmComponent.mock.calls[0]).toEqual([interaction]);
        expect(guildFor).not.toHaveBeenCalled();
        expect(interaction.reply).not.toHaveBeenCalled();
    });
});
