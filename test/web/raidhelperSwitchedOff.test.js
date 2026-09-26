// #291: with Raid-Helper switched off nothing asks raid-helper.xyz any more —
// the scan stops, the readers fall back to the stored history, which stays readable.
const mockConfig = { guildId: "g1", raidhelperRetirement: { disabled: true, at: 1, byName: "Orga" } };
jest.mock("../../src/web/settingsStore", () => ({ getConfig: jest.fn(() => mockConfig) }));

const mockReads = {
    fetchEvents: jest.fn(), getAllEvents: jest.fn(), getPastEvents: jest.fn(), getSetup: jest.fn(),
    getEvent: jest.fn(), getUserSignUps: jest.fn(), signUpToRaid: jest.fn(), createEvent: jest.fn(),
};
jest.mock("../../src/classes/raidhelper", () => jest.fn().mockImplementation(() => mockReads));

jest.mock("../../src/web/discord", () => ({
    getChannelCategoryMap: jest.fn(() => ({})),
    listGuilds: jest.fn(() => [{ id: "g1", name: "Gilde" }]),
}));
const mockPast = { id: "555", guildId: "g1", title: "Kara alt", channelId: "gone", channelName: "kara-alt", categoryId: "c1", categoryName: "Mittwoch", startTime: Math.floor(Date.now() / 1000) - 3 * 86400, signUps: [{ userId: "u1", specName: "Shadow", status: "signed" }], setup: [] };
jest.mock("../../src/web/raidEventStore", () => ({
    listRaidEvents: jest.fn(() => [mockPast]),
    getRaidEvent: jest.fn(() => mockPast),
    saveRaidEvents: jest.fn(() => 0),
}));
jest.mock("../../src/web/eventStore", () => ({
    listEvents: jest.fn(() => []), getEvent: jest.fn(() => null), isOwnEventId: (id) => String(id || "").startsWith("eh-"),
}));
jest.mock("../../src/web/signupStore", () => ({ listSignups: jest.fn(() => []) }));

const { saveRaidEvents } = require("../../src/web/raidEventStore");
const { createRaidhelperClient, raidhelperDisabled } = require("../../src/utils/raidhelperClient");
const { scanRaidEvents } = require("../../src/web/raidEventScan");
const { loadEventGroups, _resetEventsCacheForTests } = require("../../src/web/raidEventGroups");
const { loadMatchableEvents } = require("../../src/web/matchableEvents");

describe("Raid-Helper switched off (#291)", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        _resetEventsCacheForTests();
    });

    it("hands out a client whose reads answer empty without a request and whose writes are refused", async () => {
        expect(raidhelperDisabled()).toBe(true);
        const rh = createRaidhelperClient();
        expect(rh.disabled).toBe(true);
        await expect(rh.getAllEvents()).resolves.toEqual([]);
        await expect(rh.fetchEvents(1)).resolves.toEqual([]);
        await expect(rh.getPastEvents(1)).resolves.toEqual([]);
        await expect(rh.getUserSignUps("u1")).resolves.toEqual([]);
        await expect(rh.getSetup("1")).resolves.toBeUndefined();
        await expect(rh.getEvent("1")).resolves.toEqual({});
        await expect(rh.createEvent({})).rejects.toMatchObject({ code: "raidhelper_disabled" });
        await expect(rh.signUpToRaid("1", [], "u1")).rejects.toThrow(/abgeschaltet/);
        for (const name of ["fetchEvents", "getAllEvents", "getPastEvents", "getSetup", "getEvent", "getUserSignUps", "signUpToRaid", "createEvent"]) {
            expect(mockReads[name]).not.toHaveBeenCalled();
        }
    });

    it("stops the scan without touching the stored snapshots", async () => {
        await expect(scanRaidEvents("g1")).resolves.toEqual({ scanned: 0, error: null, disabled: true });
        expect(mockReads.getPastEvents).not.toHaveBeenCalled();
        expect(saveRaidEvents).not.toHaveBeenCalled();
    });

    it("keeps past Raid-Helper raids readable from the history, without an error", async () => {
        const { groups, error } = await loadEventGroups("g1", { sinceSeconds: Math.floor(Date.now() / 1000) - 30 * 86400 });
        expect(error).toBeNull();
        const events = groups.flatMap((g) => g.events);
        expect(events).toEqual([expect.objectContaining({ id: "555", source: "raidhelper", title: "Kara alt", signUpsFromSnapshot: true })]);

        const matchable = await loadMatchableEvents("g1");
        expect(matchable.error).toBeNull();
        expect(matchable.events.map((e) => e.id)).toEqual(["555"]);
        expect(mockReads.fetchEvents).not.toHaveBeenCalled();
        expect(mockReads.getPastEvents).not.toHaveBeenCalled();
    });
});
