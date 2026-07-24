jest.mock("../../../src/classes/gdkp.js");
jest.mock("../../../src/utils/helper.js");

const GDKP = require("../../../src/classes/gdkp.js");
const command = require("../../../src/commands/gdkp/totalspent.js");
const messages = require("../../../src/config/messages.js");
const { botReply, botFollowup } = require("../../../src/utils/helper.js");
const { mockInteraction } = require("../../helpers/mockInteraction.js");

function stubItems(items) {
    GDKP.mockImplementation(() => ({
        getTotalItems: jest.fn().mockResolvedValue(items),
    }));
}

describe("commands/gdkp/totalspent", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("exports the command contract with the correct name", () => {
        expect(command.name).toBe("totalspent");
        expect(typeof command.description).toBe("string");
        expect(typeof command.execute).toBe("function");
    });

    it("replies with the error message when no items are returned", async () => {
        stubItems(null);
        const interaction = mockInteraction();

        await command.execute(interaction, {});

        expect(botReply).toHaveBeenCalledWith(
            interaction,
            messages.totalspent.errorTitle,
            messages.totalspent.errorMessage
        );
        expect(botFollowup).not.toHaveBeenCalled();
    });

    it("sums all items and reports the total in a single reply", async () => {
        stubItems([
            { player: "Bbb", class: "Fury1", item: "Bow", wowhead: "u2", gold: 2000 },
            { player: "Aaa", class: "Fury1", item: "Axe", wowhead: "u1", gold: 1000 },
        ]);
        const interaction = mockInteraction();

        await command.execute(interaction, {});

        expect(botReply).toHaveBeenCalledTimes(1);
        const [, title, message] = botReply.mock.calls[0];
        expect(title).toBe(messages.totalspent.successTitle);
        expect(message).toContain("Gesamtausgaben: **3000g**");
        expect(message).toContain("Aaa");
        expect(message).toContain("Bbb");
        expect(botFollowup).not.toHaveBeenCalled();
    });

    it("splits into follow-up messages when more than 15 items are returned", async () => {
        const items = Array.from({ length: 16 }, (_, n) => ({
            player: `P${String(n).padStart(2, "0")}`,
            class: "Fury1",
            item: `Item${n}`,
            wowhead: `u${n}`,
            gold: 1,
        }));
        stubItems(items);
        const interaction = mockInteraction();

        await command.execute(interaction, {});

        // first 15 entries + total go into the initial reply
        expect(botReply).toHaveBeenCalledTimes(1);
        expect(botReply.mock.calls[0][2]).toContain("Gesamtausgaben: **16g**");
        // the 16th entry spills into exactly one follow-up
        expect(botFollowup).toHaveBeenCalledTimes(1);
    });
});
