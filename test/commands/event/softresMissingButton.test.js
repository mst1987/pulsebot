// "Wer fehlt?" on the softres card: every raider may look, so the button
// inherits the signup's access ("event-signup") and goes through componentRoute.
jest.mock("../../../src/services/loot/softresMissingBot", () => ({
    SOFTRES_MISSING_PREFIX: "softres-missing",
    SOFTRES_PING_PREFIX: "softres-ping",
    handleSoftresComponent: jest.fn(async () => "handled"),
}));
jest.mock("../../../src/services/events/eventDraft", () => ({
    guildFor: jest.fn(() => ({ guildId: "g1" })),
}));

const { handleSoftresComponent } = require("../../../src/services/loot/softresMissingBot");
const button = require("../../../src/commands/event/softresMissingButton");
const { mockInteraction } = require("../../helpers/mockInteraction");

beforeEach(() => jest.clearAllMocks());

describe("commands/event/softresMissingButton", () => {
    it("is named after the missing prefix and inherits the signup access", () => {
        expect(button.name).toBe("softres-missing");
        expect(button.accessOf).toBe("event-signup");
        expect(button.description).toMatch(/Wer fehlt/);
    });

    it("hands the click to the softres handler", async () => {
        const interaction = mockInteraction({ customId: "softres-missing:eh-abc" });
        await button.execute(interaction);
        expect(handleSoftresComponent).toHaveBeenCalledTimes(1);
        expect(handleSoftresComponent.mock.calls[0][0]).toBe(interaction);
    });
});
