jest.mock("../../../src/classes/gdkp.js");
jest.mock("../../../src/utils/helper.js");

const GDKP = require("../../../src/classes/gdkp.js");
const command = require("../../../src/commands/gdkp/currentspent.js");
const messages = require("../../../src/config/messages.js");
const { botReply } = require("../../../src/utils/helper.js");
const { getWednesdayWeeksAgo } = require("../../../src/utils/date.js");
const { mockInteraction } = require("../../helpers/mockInteraction.js");

// Format a Date into the "D-M-YYYY" string parseDMYDateString expects.
const fmt = (d) => `${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()}`;

function stubItems(items) {
    GDKP.mockImplementation(() => ({
        getTotalItems: jest.fn().mockResolvedValue(items),
    }));
}

describe("commands/gdkp/currentspent", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("exports the command contract with the correct name", () => {
        expect(command.name).toBe("currentspent");
        expect(typeof command.description).toBe("string");
        expect(typeof command.execute).toBe("function");
    });

    it("replies with the error message when no items are returned", async () => {
        stubItems(null);
        const interaction = mockInteraction();

        await command.execute(interaction, {});

        expect(botReply).toHaveBeenCalledTimes(1);
        expect(botReply).toHaveBeenCalledWith(
            interaction,
            messages.currentspent.errorTitle,
            messages.currentspent.errorMessage
        );
    });

    it("sums only items within the current-week window and formats them", async () => {
        const inWindow = fmt(getWednesdayWeeksAgo(1)); // == window start (inclusive)
        const today = fmt(new Date());
        const old = fmt(getWednesdayWeeksAgo(5)); // well before the window

        stubItems([
            { player: "Aaa", class: "Fury1", item: "Axe", wowhead: "u1", gold: 1000, date: inWindow },
            { player: "Bbb", class: "Fury1", item: "Bow", wowhead: "u2", gold: 500, date: today },
            { player: "Zzz", class: "Fury1", item: "Old", wowhead: "u3", gold: 9999, date: old },
        ]);
        const interaction = mockInteraction();

        await command.execute(interaction, {});

        expect(botReply).toHaveBeenCalledTimes(1);
        const [, title, message] = botReply.mock.calls[0];
        expect(title).toBe(messages.currentspent.successTitle);
        expect(message).toContain("Gesamtausgaben: **1500g**");
        expect(message).toContain("Aaa");
        expect(message).toContain("Bbb");
        expect(message).not.toContain("Zzz");
    });
});
