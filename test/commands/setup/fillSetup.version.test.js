// The Google raid sheet is laid out for TBC only (#751): /fillsetup on an own
// event of another version says so and never touches the sheet.
const { mockInteraction } = require("../../helpers/mockInteraction.js");

jest.mock("../../../src/classes/raidhelper.js");
jest.mock("../../../src/classes/sheets.js");
jest.mock("../../../src/utils/discord/reply.js");
jest.mock("../../../src/stores/events/eventStore", () => ({
    isOwnEventId: (id) => String(id).startsWith("eh-"),
    getEvent: jest.fn(),
}));
jest.mock("../../../src/services/events/eventSources", () => ({ ownEventInChannel: jest.fn() }));
jest.mock("../../../src/services/setup/setupEditor", () => ({ raidHelperSlots: jest.fn(() => [{ name: "A", specName: "Holy1" }]) }));
jest.mock("../../../src/utils/setup/fillSetup", () => ({ fillSetupSheet: jest.fn().mockResolvedValue({ playerCount: 1, tanks: [0, 0, 0], healers: 0, warlocks: 0, priests: 0, mages: 0, hunters: 0 }) }));

const reply = require("../../../src/utils/discord/reply.js");
const eventStore = require("../../../src/stores/events/eventStore");
const { fillSetupSheet } = require("../../../src/utils/setup/fillSetup");
const fillSetup = require("../../../src/commands/setup/fillSetup.js");

describe("commands/setup/fillSetup by game version", () => {
    beforeEach(() => jest.clearAllMocks());

    it("refuses a Forever event with a hint and does not fill the sheet", async () => {
        eventStore.getEvent.mockReturnValue({ id: "eh-1", title: "Ony", versionId: "forever" });
        await fillSetup.execute(mockInteraction({ options: { setup_id: "eh-1" } }), {});
        expect(reply.botEditReply.mock.calls[0][1]).toBe("Fehler");
        expect(reply.botEditReply.mock.calls[0][2]).toMatch(/keine Raidsheet-Vorlage/);
        expect(fillSetupSheet).not.toHaveBeenCalled();
    });

    it("fills the sheet of a TBC event as before", async () => {
        eventStore.getEvent.mockReturnValue({ id: "eh-2", title: "Kara", versionId: "tbc" });
        await fillSetup.execute(mockInteraction({ options: { setup_id: "eh-2" } }), {});
        expect(fillSetupSheet).toHaveBeenCalledTimes(1);
    });
});
