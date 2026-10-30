// A series whose template is of another version than its category (#738):
// the sweep runs through the real eventCreate, which refuses before any
// channel exists — no event, a failed date and a dashboard failure instead of
// a silently wrong-version raid. Saving such a series is refused as well,
// unless it is paused.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());
jest.mock("../../../src/services/discord/discord", () => ({
    getClient: jest.fn(() => ({ isReady: () => true })),
    getChannelCategoryMap: jest.fn(() => ({})),
    listCategories: jest.fn(() => [{ id: "cat1", name: "Forever Montag" }]),
    duplicateChannel: jest.fn(),
    listAllChannels: jest.fn(() => []),
}));
jest.mock("../../../src/services/discord/discordChannels", () => ({
    createFromTemplate: jest.fn(),
    placeChannel: jest.fn(async () => true),
    discordErrorText: (e) => String((e && e.message) || e),
}));
jest.mock("../../../src/services/discord/channelNaming", () => ({
    deriveChannelName: jest.fn(),
    loadNamingInputs: jest.fn(async () => ({ events: [], channels: [], schemas: {} })),
    raidTagFor: jest.fn(() => ""),
    namingContext: jest.fn(() => ({})),
    describeResult: jest.fn(() => ({ name: "", source: "schema", label: "", detail: "", design: "" })),
}));
jest.mock("../../../src/services/discord/roles/guildRoles", () => ({ serverIds: jest.fn(() => ["g1"]) }));
jest.mock("../../../src/services/events/raidEventGroups", () => ({
    loadEventGroups: jest.fn(async () => ({ groups: [], error: null })),
    eventLookbackSince: jest.fn(() => 1),
}));
jest.mock("../../../src/services/events/eventMessage", () => ({ postEventMessage: jest.fn(), refreshEventMessage: jest.fn() }));
jest.mock("../../../src/services/talk/talkOverview", () => ({ scheduleOverviewSync: jest.fn(), RAIDHELPER_CREATE_DELAY_MS: 35000 }));
jest.mock("../../../src/stores/settingsStore", () => ({
    getConfig: jest.fn(),
    getRaidTemplate: jest.fn((id) => (id === "tpl-ssc" ? { id: "tpl-ssc", name: "SSC + TK 25er", versionId: "tbc", instanceIds: ["ssc", "tk"], size: 25 } : null)),
}));

const { DateTime } = require("luxon");
const { getConfig } = require("../../../src/stores/settingsStore");
const discordChannels = require("../../../src/services/discord/discordChannels");
const eventStore = require("../../../src/stores/eventStore");
const store = require("../../../src/stores/eventSeriesStore");
const series = require("../../../src/web/events/eventSeries");
const { series: baseSeries } = require("../../factories/events");

const at = (iso) => DateTime.fromISO(iso, { zone: "Europe/Berlin" }).toMillis();
const FOREVER = { categoryIds: ["cat1"], categorySignupSource: { cat1: "eventhelper" }, categoryVersion: { cat1: "forever" }, categoryRaidTemplate: {} };

beforeEach(() => {
    jest.clearAllMocks();
    require("fs").__store.clear();
    series._resetForTests();
    getConfig.mockReturnValue(FOREVER);
    jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("web/events/eventSeries — template of another version (#738)", () => {
    const now = at("2026-09-14T12:00");

    it("a series with a TBC template in a Forever category creates no event and reports the failure", async () => {
        store.saveSeries(baseSeries({ guildId: "g1", weekdays: [3] }));
        const summary = await series.runSeries({ now, config: FOREVER });
        expect(summary.failed).toBe(1);
        expect(summary.created).toBe(0);
        expect(eventStore.listEvents("")).toEqual([]);
        expect(discordChannels.createFromTemplate).not.toHaveBeenCalled();
        expect(store.getRuns("cat1")["2026-09-16"]).toMatchObject({ status: "failed" });
        const [failure] = series.seriesFailures({ now });
        expect(failure).toMatchObject({ categoryId: "cat1", date: "2026-09-16", hasSeries: true });
        expect(failure.error).toContain("„SSC + TK 25er“ ist für TBC Anniversary, die Kategorie spielt WoW Forever.");
    });

    it("the category default works the same way", async () => {
        const config = { ...FOREVER, categoryRaidTemplate: { cat1: "tpl-ssc" } };
        getConfig.mockReturnValue(config);
        store.saveSeries(baseSeries({ guildId: "g1", weekdays: [3], raidTemplateId: "" }));
        expect((await series.runSeries({ now, config })).failed).toBe(1);
        expect(eventStore.listEvents("")).toEqual([]);
    });

    it("refuses to save a running series with an unfitting template, a paused one is kept", () => {
        const refused = series.saveSeriesFor({ guildId: "g1", input: baseSeries(), config: FOREVER, now });
        expect(refused.error).toMatchObject({ status: 400, code: "invalid" });
        expect(refused.error.message).toMatch(/Serie pausieren/);
        expect(series.saveSeriesFor({ guildId: "g1", input: baseSeries({ enabled: false }), config: FOREVER, now }).series).toMatchObject({ enabled: false, raidTemplateId: "tpl-ssc" });
        // the same template is fine in a TBC category
        const tbc = { ...FOREVER, categoryVersion: { cat1: "tbc" } };
        expect(series.saveSeriesFor({ guildId: "g1", input: baseSeries(), config: tbc, now }).series).toMatchObject({ enabled: true });
    });
});
