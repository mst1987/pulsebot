// #291: the legacy setup commands with the EventHelper's own events — each one
// either works with both sources or points at the new flow, and none of them
// fails outright because Raid-Helper does not answer.
const { mockInteraction } = require("../../helpers/mockInteraction.js");

jest.mock("../../../src/classes/raidhelper.js");
jest.mock("../../../src/classes/sheets.js");
jest.mock("../../../src/utils/discord/reply.js");
jest.mock("../../../src/utils/format.js");
jest.mock("../../../src/utils/setup/fillSetup.js", () => ({
    fillSetupSheet: jest.fn(async (client, slots) => ({ playerCount: slots.length, tanks: ["", "", ""], healers: 0, warlocks: 0, priests: 0, mages: 0, hunters: 0 })),
}));
jest.mock("../../../src/utils/raidhelper/queries.js");
jest.mock("../../../src/utils/setup/response.js");
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../../src/web/eventSources", () => ({
    ownEventInChannel: jest.fn(() => null),
    ownSignedUpEvents: jest.fn(() => []),
}));
jest.mock("../../../src/stores/eventStore", () => ({
    isOwnEventId: (id) => String(id || "").startsWith("eh-"),
    getEvent: jest.fn(() => null),
}));
jest.mock("../../../src/web/setupEditor", () => ({ raidHelperSlots: jest.fn(() => []) }));

const Raidhelper = require("../../../src/classes/raidhelper.js");
const reply = require("../../../src/utils/discord/reply.js");
const { fillSetupSheet } = require("../../../src/utils/setup/fillSetup.js");
const utilsRaidhelper = require("../../../src/utils/raidhelper/queries.js");
const eventSources = require("../../../src/web/eventSources");
const eventStore = require("../../../src/stores/eventStore");
const { raidHelperSlots } = require("../../../src/web/setupEditor");
const signup = require("../../../src/commands/setup/signup.js");
const fillSetup = require("../../../src/commands/setup/fillSetup.js");
const showAllSetups = require("../../../src/commands/setup/showAllSetups.js");

const OWN = { id: "eh-7", title: "SSC Mittwoch", channelId: "channel-1", startTime: 2000000000 };
const SLOTS = [{ id: "u1", name: "Zibbo", specName: "Shadow", className: "Priest", groupNumber: 1 }];

describe("legacy setup commands with own events (#291)", () => {
    let rh;
    beforeEach(() => {
        jest.clearAllMocks();
        rh = {
            getEvent: jest.fn(), signUpToRaid: jest.fn(), getSetup: jest.fn(),
            getUserSignUps: jest.fn(async () => []),
        };
        Raidhelper.mockImplementation(() => rh);
        eventSources.ownEventInChannel.mockReturnValue(null);
        eventStore.getEvent.mockReturnValue(null);
        raidHelperSlots.mockReturnValue([]);
    });

    describe("/signup", () => {
        it("points an own event's channel at the event message instead of Raid-Helper", async () => {
            eventSources.ownEventInChannel.mockReturnValue(OWN);
            const interaction = mockInteraction({ options: { specs: "Shadow" } });
            await signup.execute(interaction, {});
            expect(eventSources.ownEventInChannel).toHaveBeenCalledWith("channel-1");
            expect(reply.botReply).toHaveBeenCalledTimes(1);
            expect(reply.botReply.mock.calls[0][1]).toBe("Anmeldung über den EventHelper");
            expect(reply.botReply.mock.calls[0][2]).toMatch(/SSC Mittwoch.*Anmelden/s);
            expect(rh.getEvent).not.toHaveBeenCalled();
            expect(rh.signUpToRaid).not.toHaveBeenCalled();
        });
    });

    describe("/fillsetup", () => {
        it("fills the sheet from an own event's approved setup by eh- id, without Raid-Helper", async () => {
            eventStore.getEvent.mockReturnValue(OWN);
            raidHelperSlots.mockReturnValue(SLOTS);
            await fillSetup.execute(mockInteraction({ options: { setup_id: "eh-7" } }), {});
            expect(rh.getSetup).not.toHaveBeenCalled();
            expect(fillSetupSheet).toHaveBeenCalledWith(expect.anything(), SLOTS, expect.any(Object));
            expect(reply.botEditReply.mock.calls[0][1]).toBe("Setup befüllt");
        });

        it("takes the channel's own event when no id is given", async () => {
            eventSources.ownEventInChannel.mockReturnValue(OWN);
            raidHelperSlots.mockReturnValue(SLOTS);
            await fillSetup.execute(mockInteraction({ options: {} }), {});
            expect(fillSetupSheet).toHaveBeenCalled();
        });

        it("refuses before approval, an unknown eh- id and an empty id without an own event", async () => {
            eventStore.getEvent.mockReturnValue(OWN);
            await fillSetup.execute(mockInteraction({ options: { setup_id: "eh-7" } }), {});
            expect(reply.botEditReply.mock.calls[0][2]).toMatch(/kein freigegebenes Setup/);

            eventStore.getEvent.mockReturnValue(null);
            await fillSetup.execute(mockInteraction({ options: { setup_id: "eh-404" } }), {});
            expect(reply.botEditReply.mock.calls[1][2]).toMatch(/Event nicht gefunden/);

            await fillSetup.execute(mockInteraction({ options: {} }), {});
            expect(reply.botEditReply.mock.calls[2][2]).toMatch(/Keine Setup-ID/);
            expect(fillSetupSheet).not.toHaveBeenCalled();
        });

        it("still reads a numeric Raid-Helper raidplan", async () => {
            rh.getSetup.mockResolvedValue({ setup: SLOTS });
            await fillSetup.execute(mockInteraction({ options: { setup_id: "12345" } }), {});
            expect(rh.getSetup).toHaveBeenCalledWith("12345");
            expect(fillSetupSheet).toHaveBeenCalled();
        });
    });

    describe("/show-allsetups", () => {
        it("keeps the own events when Raid-Helper does not answer", async () => {
            rh.getUserSignUps.mockRejectedValue(new Error("HTTP 404"));
            eventSources.ownSignedUpEvents.mockReturnValue([{ id: "eh-7" }]);
            utilsRaidhelper.getSetupsFromEvents.mockResolvedValue([]);
            await showAllSetups.execute(mockInteraction(), {});
            expect(utilsRaidhelper.getSetupsFromEvents).toHaveBeenCalledWith({}, expect.anything(), [{ id: "eh-7" }]);
        });
    });
});
