// The entry point of the role messages' buttons: everyone may click by default and
// the click goes to services/discord/roleMessages.handleRoleButton.
const mockHandle = jest.fn(async () => {});
jest.mock("../../../src/services/discord/roleMessages", () => ({
    BUTTON_PREFIX: "rolemsg",
    handleRoleButton: (...args) => mockHandle(...args),
}));

const command = require("../../../src/commands/channels/roleMessageButton");

describe("roleMessageButton", () => {
    it("is a button of the channels group that everyone may use by default", () => {
        expect(command).toMatchObject({ name: "rolemsg", group: "channels", defaultAccess: "everyone", kind: "button" });
        expect(command.data).toBeUndefined();
    });

    it("hands the click to the role messages", async () => {
        const interaction = { customId: "rolemsg:abc:1" };
        await command.execute(interaction);
        expect(mockHandle).toHaveBeenCalledWith(interaction);
    });
});
