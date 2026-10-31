// #744: a renamed category. The group carries the name the category has in
// Discord now; a raid of a closed section of it keeps the name of that section,
// a raid of the current one shows the live name.
const mockGetAllEvents = jest.fn();
jest.mock("../../../src/classes/raidhelper", () =>
    jest.fn().mockImplementation(() => ({ fetchEvents: jest.fn(async () => []), getAllEvents: mockGetAllEvents })));
jest.mock("../../../src/services/discord/discord", () => ({ getChannelCategoryMap: jest.fn() }));
jest.mock("../../../src/stores/events/raidEventStore", () => ({ listRaidEvents: jest.fn(() => []), getRaidEvent: jest.fn() }));
jest.mock("../../../src/stores/events/eventStore", () => ({
    listEvents: jest.fn(() => []), getEvent: jest.fn(), isOwnEventId: (id) => String(id).startsWith("eh-"),
}));
jest.mock("../../../src/stores/events/signupStore", () => ({ listSignups: jest.fn(() => []) }));
jest.mock("../../../src/stores/settings/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../../src/stores/settings/configStore", () => ({ getConfig: jest.fn(() => ({})) }));

const discord = require("../../../src/services/discord/discord");
const eventStore = require("../../../src/stores/events/eventStore");
const configStore = require("../../../src/stores/settings/configStore");
const { listRaidEvents, getRaidEvent } = require("../../../src/stores/events/raidEventStore");
const { loadEventGroups, _resetEventsCacheForTests } = require("../../../src/services/events/raidEventGroups");
const { listStoredEvents, getStoredEvent } = require("../../../src/services/events/eventSources");
const { ownEvent } = require("../../factories/events");

const SWITCH = Date.UTC(2026, 9, 1); // TBC Montag → Forever, then renamed in Discord
const before = Math.floor(SWITCH / 1000) - 7 * 86400;
const after = Math.floor(SWITCH / 1000) + 7 * 86400;
const config = {
    categoryVersion: { cat1: "forever" },
    categoryEras: { cat1: [{ versionId: "tbc", from: 0, name: "TBC Montag" }, { versionId: "forever", from: SWITCH, name: "TBC Montag" }] },
};

beforeEach(() => {
    jest.clearAllMocks();
    _resetEventsCacheForTests();
    configStore.getConfig.mockReturnValue(config);
    discord.getChannelCategoryMap.mockReturnValue({ chan1: { name: "mo-raid", categoryId: "cat1", categoryName: "Forever Montag" } });
    mockGetAllEvents.mockResolvedValue([]);
});

describe("raid category names after a rename (#744)", () => {
    it("names the group after the live category, the old raid after its closed section", async () => {
        listRaidEvents.mockReturnValue([
            { id: "rh-old", guildId: "g1", title: "Kara", channelId: "chan-gone", channelName: "kara", categoryId: "cat1", categoryName: "TBC Montag", startTime: before, signUps: [] },
        ]);
        eventStore.listEvents.mockReturnValue([ownEvent({ id: "eh-new", guildId: "g1", channelId: "chan1", categoryId: "cat1", categoryName: "Forever Montag", startTime: after })]);

        const { groups } = await loadEventGroups("g1", { sinceSeconds: 1 });

        expect(groups).toHaveLength(1);
        expect(groups[0].categoryName).toBe("Forever Montag");
        const names = Object.fromEntries(groups[0].events.map((e) => [e.id, e.categoryName]));
        expect(names).toEqual({ "rh-old": "TBC Montag", "eh-new": "Forever Montag" });
    });

    it("an old raid stored with the new name (a later scan) still shows the old one", () => {
        listRaidEvents.mockReturnValue([
            { id: "rh-old", guildId: "g1", title: "Kara", channelId: "c", categoryId: "cat1", categoryName: "Forever Montag", startTime: before, signUps: [] },
            { id: "rh-new", guildId: "g1", title: "Kara", channelId: "c", categoryId: "cat1", categoryName: "Forever Montag", startTime: after, signUps: [] },
        ]);
        eventStore.listEvents.mockReturnValue([]);
        const names = Object.fromEntries(listStoredEvents("g1", { now: (after + 86400) * 1000 }).map((e) => [e.id, e.categoryName]));
        expect(names).toEqual({ "rh-old": "TBC Montag", "rh-new": "Forever Montag" });
    });

    it("one stored raid by id carries the name of its section too", () => {
        getRaidEvent.mockReturnValue({ id: "rh-old", categoryId: "cat1", categoryName: "Forever Montag", startTime: before });
        expect(getStoredEvent("rh-old").categoryName).toBe("TBC Montag");
    });

    it("a category never switched keeps the name it carries", () => {
        configStore.getConfig.mockReturnValue({});
        listRaidEvents.mockReturnValue([{ id: "rh-old", categoryId: "cat1", categoryName: "Forever Montag", startTime: before, signUps: [] }]);
        eventStore.listEvents.mockReturnValue([]);
        expect(listStoredEvents("g1")[0].categoryName).toBe("Forever Montag");
    });
});
