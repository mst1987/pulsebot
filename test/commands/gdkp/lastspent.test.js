jest.mock("../../../src/classes/gdkp.js");
jest.mock("../../../src/utils/helper.js");

const GDKP = require("../../../src/classes/gdkp.js");
const command = require("../../../src/commands/gdkp/lastspent.js");
const messages = require("../../../src/config/messages.js");
const { botReply } = require("../../../src/utils/helper.js");
const { getWednesdayWeeksAgo } = require("../../../src/utils/date.js");
const { mockInteraction } = require("../../helpers/mockInteraction.js");

const fmt = (d) => `${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()}`;

function stubItems(items) {
    GDKP.mockImplementation(() => ({
        getTotalItems: jest.fn().mockResolvedValue(items),
    }));
}

describe("commands/gdkp/lastspent", () => {
    // The window runs from the Wednesday two weeks back to the Wednesday one week
    // back — so when the suite runs *on* a Wednesday it ends today, and the "too
    // new" item lands inside the window instead of after it. Freezing the clock on
    // a Friday keeps the window in the past on every day of the week.
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
        jest.setSystemTime(new Date(2026, 6, 24, 12, 0, 0));   // Friday, 24 July 2026
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it("exports the command contract with the correct name", () => {
        expect(command.name).toBe("lastspent");
        expect(typeof command.description).toBe("string");
        expect(typeof command.execute).toBe("function");
    });

    it("replies with the error message when no items are returned", async () => {
        stubItems(null);
        const interaction = mockInteraction();

        await command.execute(interaction, {});

        expect(botReply).toHaveBeenCalledWith(
            interaction,
            messages.lastspent.errorTitle,
            messages.lastspent.errorMessage
        );
    });

    it("sums only items within the previous-week window", async () => {
        const inWindow = fmt(getWednesdayWeeksAgo(2)); // == window start (inclusive)
        const today = fmt(new Date()); // after window end -> excluded
        const old = fmt(getWednesdayWeeksAgo(5)); // before window start -> excluded

        stubItems([
            { player: "InPlayer", class: "Fury1", item: "Axe", wowhead: "u1", gold: 700, date: inWindow },
            { player: "TooNew", class: "Fury1", item: "Bow", wowhead: "u2", gold: 999, date: today },
            { player: "TooOld", class: "Fury1", item: "Old", wowhead: "u3", gold: 111, date: old },
        ]);
        const interaction = mockInteraction();

        await command.execute(interaction, {});

        const [, title, message] = botReply.mock.calls[0];
        expect(title).toBe(messages.lastspent.successTitle);
        expect(message).toContain("Gesamtausgaben: **700g**");
        expect(message).toContain("InPlayer");
        expect(message).not.toContain("TooNew");
        expect(message).not.toContain("TooOld");
    });
});
